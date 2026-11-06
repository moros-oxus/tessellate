import {
  type Binding,
  type HostAdapter,
  type HostSnapshot,
  parseBinding,
  type SnapshotCollection,
  type SnapshotVariable,
  type Stamp,
  type StyleBinding,
} from '@tessellate/core';
import { facesToLoad, fontStyleFor, letterSpacingOf, weightOf } from './font';

/** The model's style properties → the text-style fields a variable binds to. */
const TEXT_FIELDS: Record<string, VariableBindableTextField> = {
  'font-family': 'fontFamily',
  'font-size': 'fontSize',
  'font-weight': 'fontWeight',
  'letter-spacing': 'letterSpacing',
};

/** Every field tessellate writes a plain value to — a stale binding on one would hide it. */
const WRITTEN_FIELDS: VariableBindableTextField[] = [
  'fontFamily',
  'fontStyle',
  'fontSize',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
];

/**
 * The Figma implementation of the host adapter — the only file that talks to `figma.*`.
 * Identity: every entity tessellate writes carries a `tessellate` plugin-data stamp
 * (path, model version, applied form), which is what makes re-import idempotent and
 * drift detectable rather than name-guessed. The file's binding lives on the document
 * (`figma.root`), so it is shared by every collaborator and travels with the file.
 */

const STAMP_KEY = 'tessellate';
const BINDING_KEY = 'tessellate:binding';
/** Must match a `relaunchButtons` command in manifest.json. */
export const RELAUNCH_COMMAND = 'open';

/** `2026-09-23T12:00:00.000Z` → `2026-09-23 12:00 UTC`. */
export function when(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

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

  async readBinding(): Promise<Binding | undefined> {
    return parseBinding(figma.root.getPluginData(BINDING_KEY));
  }

  async writeBinding(binding: Binding): Promise<void> {
    figma.root.setPluginData(BINDING_KEY, JSON.stringify(binding));
    // The file's properties panel (nothing selected) carries a button back into the plugin.
    figma.root.setRelaunchData({
      [RELAUNCH_COMMAND]: `${binding.label} — last applied ${when(binding.appliedAt)}`,
    });
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

  /** Available fonts, read once per adapter — the list is large and does not change mid-apply. */
  private fonts: Promise<Font[]> | undefined;

  /** The style names a family offers in this file's environment; empty when it is not installed. */
  private async stylesOf(family: string): Promise<string[]> {
    this.fonts ??= figma.listAvailableFontsAsync();
    return (await this.fonts)
      .filter((font) => font.fontName.family === family)
      .map((font) => font.fontName.style);
  }

  /** Every mode's value of a variable, aliases followed (into any collection). */
  private async modeValues(
    collection: string,
    name: string,
  ): Promise<unknown[]> {
    const { variable } = await this.variable(collection, name);
    return variable ? this.resolvedValues(variable, 0) : [];
  }

  private async resolvedValues(
    variable: Variable,
    depth: number,
  ): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const value of Object.values(variable.valuesByMode)) {
      if (
        value !== null &&
        typeof value === 'object' &&
        (value as { type?: string }).type === 'VARIABLE_ALIAS'
      ) {
        if (depth > 8) continue; // a cycle is the host's to report, not ours to loop on
        const target = await figma.variables.getVariableByIdAsync(
          (value as { id: string }).id,
        );
        if (target) out.push(...(await this.resolvedValues(target, depth + 1)));
      } else {
        out.push(value);
      }
    }
    return out;
  }

  private async loadBoundFaces(
    bindings: StyleBinding[],
    plainFace: FontName | undefined,
    plainWeight: unknown,
  ): Promise<void> {
    const familyBinding = bindings.find((b) => b.property === 'font-family');
    const weightBinding = bindings.find((b) => b.property === 'font-weight');
    if (!familyBinding && !weightBinding) return;
    const families = [
      ...(plainFace ? [plainFace.family] : []),
      ...(familyBinding
        ? await this.modeValues(
            familyBinding.collection,
            familyBinding.variable,
          )
        : []),
    ].filter((f): f is string => typeof f === 'string');
    const weights = [
      weightOf(plainWeight),
      ...(weightBinding
        ? (
            await this.modeValues(
              weightBinding.collection,
              weightBinding.variable,
            )
          ).map(weightOf)
        : []),
    ];
    this.fonts ??= figma.listAvailableFontsAsync();
    const available = await this.fonts;
    const faces = facesToLoad({
      families,
      weights,
      keepStyle: plainFace?.style,
      stylesOf: (family) =>
        available
          .filter((font) => font.fontName.family === family)
          .map((font) => font.fontName.style),
    });
    for (const face of faces) {
      try {
        await figma.loadFontAsync(face);
      } catch {
        // Listed but unloadable: the binding itself reports what it can't reach.
      }
    }
  }

  async upsertTextStyle(wanted: {
    name: string;
    properties: Array<{ property: string; value: unknown; variable?: string }>;
    bindings: StyleBinding[];
    stamp: Stamp;
  }): Promise<void> {
    const styles = await figma.getLocalTextStylesAsync();
    const style =
      styles.find((s) => s.name === wanted.name) ?? figma.createTextStyle();
    style.name = wanted.name;
    const get = (property: string) =>
      wanted.properties.find((p) => p.property === property)?.value;

    // 1. Plain values — what the style shows wherever no binding resolves.
    const family = get('font-family');
    let plainFace: FontName | undefined;
    if (typeof family === 'string') {
      const name = family.split(',')[0]?.trim() ?? family;
      // The weight picks one of the family's OWN style names (they differ per family).
      const fontName = {
        family: name,
        style: fontStyleFor(
          weightOf(get('font-weight')),
          await this.stylesOf(name),
        ),
      };
      // 2. The font is loaded before anything binds over it.
      await figma.loadFontAsync(fontName);
      style.fontName = fontName;
      plainFace = fontName;
    }
    const size = get('font-size');
    if (typeof size === 'string') style.fontSize = Number.parseFloat(size);
    const lineHeight = get('line-height');
    if (typeof lineHeight === 'number') {
      style.lineHeight = { unit: 'PERCENT', value: lineHeight * 100 };
    }
    const spacing = letterSpacingOf(get('letter-spacing'));
    if (spacing) style.letterSpacing = spacing;

    // 2b. Figma refuses to bind into a face that isn't loaded, and a bound family or weight
    // resolves on its own (the variable's default mode first) — load every face it can reach.
    await this.loadBoundFaces(wanted.bindings, plainFace, get('font-weight'));

    // 3. Bind exactly the model's bindings; 4. unbind every field tessellate writes and the
    // model no longer binds, so a re-apply leaves the model's bindings and no others.
    const bound = new Set<VariableBindableTextField>();
    for (const binding of wanted.bindings) {
      const field = TEXT_FIELDS[binding.property];
      if (!field) continue;
      const { variable } = await this.variable(
        binding.collection,
        binding.variable,
      );
      if (!variable) {
        throw new Error(
          `no variable '${binding.collection}/${binding.variable}' to bind ${binding.property}`,
        );
      }
      style.setBoundVariable(field, variable);
      bound.add(field);
    }
    for (const field of WRITTEN_FIELDS) {
      if (!bound.has(field) && style.boundVariables?.[field]) {
        style.setBoundVariable(field, null);
      }
    }
    style.setPluginData(STAMP_KEY, JSON.stringify(wanted.stamp));
  }
}
