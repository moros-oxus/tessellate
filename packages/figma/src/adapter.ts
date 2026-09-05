import type {
  HostAdapter,
  HostSnapshot,
  SnapshotCollection,
  SnapshotVariable,
  Stamp,
} from '@tessellate/core';

/**
 * The Figma implementation of the host adapter — the only file that talks to `figma.*`.
 * Identity: every entity tessellate writes carries a `tessellate` plugin-data stamp
 * (path, model version, applied form), which is what makes re-import idempotent and
 * drift detectable rather than name-guessed.
 */

const STAMP_KEY = 'tessellate';

function readStamp(node: {
  getPluginData(key: string): string;
}): Stamp | undefined {
  const raw = node.getPluginData(STAMP_KEY);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Stamp;
  } catch {
    return undefined;
  }
}

async function variableName(id: string): Promise<string> {
  const target = await figma.variables.getVariableByIdAsync(id);
  return target?.name ?? id;
}

export class FigmaAdapter implements HostAdapter {
  async snapshot(): Promise<HostSnapshot> {
    const collections: SnapshotCollection[] = [];
    for (const collection of await figma.variables.getLocalVariableCollectionsAsync()) {
      const modeName = new Map(collection.modes.map((m) => [m.modeId, m.name]));
      const variables: SnapshotVariable[] = [];
      for (const id of collection.variableIds) {
        const variable = await figma.variables.getVariableByIdAsync(id);
        if (!variable) continue;
        const valuesByMode: Record<string, unknown> = {};
        const alias: Record<string, string> = {};
        for (const [modeId, value] of Object.entries(variable.valuesByMode)) {
          const mode = modeName.get(modeId) ?? modeId;
          if (
            value !== null &&
            typeof value === 'object' &&
            (value as { type?: string }).type === 'VARIABLE_ALIAS'
          ) {
            alias[mode] = await variableName((value as { id: string }).id);
          } else {
            valuesByMode[mode] = value;
          }
        }
        variables.push({
          name: variable.name,
          type: variable.resolvedType as SnapshotVariable['type'],
          valuesByMode,
          ...(Object.keys(alias).length > 0 ? { alias } : {}),
          stamp: readStamp(variable),
        });
      }
      collections.push({
        name: collection.name,
        modes: [...modeName.values()],
        variables,
      });
    }

    const styles = (await figma.getLocalTextStylesAsync()).map((style) => ({
      kind: 'text' as const,
      name: style.name,
      properties: [
        { property: 'font-family', value: style.fontName.family },
        { property: 'font-size', value: `${style.fontSize}px` },
      ],
      stamp: readStamp(style),
    }));
    return { collections, styles };
  }

  modeCapacity(): number | undefined {
    // No direct API; the UI offers a "limited-modes seat" toggle that plans with capacity 1.
    return undefined;
  }

  private async collection(name: string) {
    const all = await figma.variables.getLocalVariableCollectionsAsync();
    return all.find((c) => c.name === name);
  }

  async ensureCollection(name: string): Promise<void> {
    if (!(await this.collection(name))) {
      figma.variables.createVariableCollection(name);
    }
  }

  async ensureMode(collectionName: string, mode: string): Promise<void> {
    const collection = await this.collection(collectionName);
    if (!collection) throw new Error(`no collection '${collectionName}'`);
    if (collection.modes.some((m) => m.name === mode)) return;
    // A fresh collection holds one default mode — the first ensure renames it.
    const first = collection.modes[0];
    if (
      collection.modes.length === 1 &&
      first &&
      first.name.startsWith('Mode')
    ) {
      collection.renameMode(first.modeId, mode);
      return;
    }
    collection.addMode(mode);
  }

  private async variable(collectionName: string, name: string) {
    const collection = await this.collection(collectionName);
    if (!collection) throw new Error(`no collection '${collectionName}'`);
    for (const id of collection.variableIds) {
      const variable = await figma.variables.getVariableByIdAsync(id);
      if (variable?.name === name) return { collection, variable };
    }
    return { collection, variable: undefined };
  }

  async upsertVariable(
    collectionName: string,
    wanted: {
      name: string;
      type: SnapshotVariable['type'];
      valuesByMode: Record<string, unknown>;
      stamp: Stamp;
    },
  ): Promise<void> {
    const { collection, variable: existing } = await this.variable(
      collectionName,
      wanted.name,
    );
    const variable =
      existing ??
      figma.variables.createVariable(wanted.name, collection, wanted.type);
    const modeId = new Map(collection.modes.map((m) => [m.name, m.modeId]));
    for (const [mode, value] of Object.entries(wanted.valuesByMode)) {
      const id = modeId.get(mode);
      if (id === undefined)
        throw new Error(`no mode '${mode}' in '${collectionName}'`);
      variable.setValueForMode(id, value as VariableValue);
    }
    variable.setPluginData(STAMP_KEY, JSON.stringify(wanted.stamp));
  }

  async bindAlias(
    collectionName: string,
    name: string,
    mode: string,
    targetName: string,
  ): Promise<void> {
    const { collection, variable } = await this.variable(collectionName, name);
    if (!variable) throw new Error(`no variable '${collectionName}/${name}'`);
    // Targets may live in ANY local collection.
    let target: Variable | undefined;
    for (const held of await figma.variables.getLocalVariableCollectionsAsync()) {
      for (const id of held.variableIds) {
        const candidate = await figma.variables.getVariableByIdAsync(id);
        if (candidate?.name === targetName) target = candidate;
      }
    }
    if (!target) throw new Error(`alias target '${targetName}' does not exist`);
    const modeId = collection.modes.find((m) => m.name === mode)?.modeId;
    if (!modeId) throw new Error(`no mode '${mode}' in '${collectionName}'`);
    variable.setValueForMode(
      modeId,
      figma.variables.createVariableAlias(target),
    );
  }

  async upsertTextStyle(wanted: {
    name: string;
    properties: Array<{ property: string; value: unknown; variable?: string }>;
    stamp: Stamp;
  }): Promise<void> {
    const styles = await figma.getLocalTextStylesAsync();
    const style =
      styles.find((s) => s.name === wanted.name) ?? figma.createTextStyle();
    style.name = wanted.name;
    const get = (property: string) =>
      wanted.properties.find((p) => p.property === property)?.value;
    const family = get('font-family');
    if (typeof family === 'string') {
      const fontName = {
        family: family.split(',')[0]?.trim() ?? family,
        style: 'Regular',
      };
      await figma.loadFontAsync(fontName);
      style.fontName = fontName;
    }
    const size = get('font-size');
    if (typeof size === 'string') style.fontSize = Number.parseFloat(size);
    const lineHeight = get('line-height');
    if (typeof lineHeight === 'number') {
      style.lineHeight = { unit: 'PERCENT', value: lineHeight * 100 };
    }
    style.setPluginData(STAMP_KEY, JSON.stringify(wanted.stamp));
  }
}
