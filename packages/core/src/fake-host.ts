import { type Binding, parseBinding } from './binding';
import { withDeprecation } from './deprecation';
import {
  type HostAdapter,
  type HostSnapshot,
  type SnapshotCollection,
  type SnapshotStyle,
  type Stamp,
  type StyleBinding,
  stable,
} from './types';

/**
 * An in-memory host: the adapter contract made runnable. Tests drive the whole pipeline
 * through it (and any real adapter must pass the same contract suite); the alias resolution
 * mirrors what hosts do — a binding records the target by name, resolution is the host's.
 */
export class FakeHost implements HostAdapter {
  collections = new Map<string, SnapshotCollection>();
  styles = new Map<string, SnapshotStyle>();
  /** The document-level binding, stored as a host stores it: serialized. */
  binding: string | undefined;
  /** Which style each layer uses — a host's style consumers. */
  private layers = new Map<string, string>();
  private capacity: number | undefined;

  constructor(options: { modeCapacity?: number } = {}) {
    this.capacity = options.modeCapacity;
  }

  async snapshot(): Promise<HostSnapshot> {
    return JSON.parse(
      JSON.stringify({
        collections: [...this.collections.values()],
        styles: [...this.styles.values()],
      }),
    );
  }

  modeCapacity(): number | undefined {
    return this.capacity;
  }

  async ensureCollection(name: string): Promise<void> {
    if (!this.collections.has(name)) {
      this.collections.set(name, { name, modes: [], variables: [] });
    }
  }

  async ensureMode(collection: string, mode: string): Promise<void> {
    const held = this.collections.get(collection);
    if (!held) throw new Error(`no collection '${collection}'`);
    if (!held.modes.includes(mode)) {
      if (this.capacity !== undefined && held.modes.length >= this.capacity) {
        throw new Error(`mode limit reached (${this.capacity})`);
      }
      held.modes.push(mode);
    }
  }

  async upsertVariable(
    collection: string,
    variable: {
      name: string;
      type: SnapshotCollection['variables'][0]['type'];
      valuesByMode: Record<string, unknown>;
      deprecated?: string;
      stamp: Stamp;
    },
  ): Promise<void> {
    const held = this.collections.get(collection);
    if (!held) throw new Error(`no collection '${collection}'`);
    const existing = held.variables.find((v) => v.name === variable.name);
    const description = withDeprecation(
      existing?.description,
      variable.deprecated,
    );
    if (existing) {
      existing.type = variable.type;
      existing.valuesByMode = {
        ...existing.valuesByMode,
        ...variable.valuesByMode,
      };
      existing.alias = undefined;
      existing.stamp = variable.stamp;
      existing.description = description;
    } else {
      held.variables.push({
        name: variable.name,
        type: variable.type,
        valuesByMode: { ...variable.valuesByMode },
        stamp: variable.stamp,
        ...(description !== '' ? { description } : {}),
      });
    }
  }

  async bindAlias(
    collection: string,
    name: string,
    mode: string,
    target: string,
  ): Promise<void> {
    const held = this.collections.get(collection);
    const variable = held?.variables.find((v) => v.name === name);
    if (!variable) throw new Error(`no variable '${collection}/${name}'`);
    const exists = [...this.collections.values()].some((c) =>
      c.variables.some((v) => v.name === target),
    );
    if (!exists) throw new Error(`alias target '${target}' does not exist`);
    variable.alias = { ...variable.alias, [mode]: target };
  }

  async upsertTextStyle(style: {
    name: string;
    properties: SnapshotStyle['properties'];
    bindings: StyleBinding[];
    deprecated?: string;
    stamp: Stamp;
  }): Promise<void> {
    // Bindings are replaced, not merged — what a host's unbind-the-rest step leaves.
    for (const binding of style.bindings) {
      const exists = this.collections
        .get(binding.collection)
        ?.variables.some((v) => v.name === binding.variable);
      if (!exists) {
        throw new Error(
          `no variable '${binding.collection}/${binding.variable}' to bind`,
        );
      }
    }
    const description = withDeprecation(
      this.styles.get(style.name)?.description,
      style.deprecated,
    );
    this.styles.set(style.name, {
      kind: 'text',
      name: style.name,
      properties: style.properties,
      bindings: [...style.bindings],
      stamp: style.stamp,
      ...(description !== '' ? { description } : {}),
    });
  }

  async migrateStyleUsages(from: string, to: string): Promise<number> {
    if (!this.styles.has(to)) throw new Error(`no style '${to}'`);
    let moved = 0;
    for (const [layer, style] of this.layers) {
      if (style !== from) continue;
      this.layers.set(layer, to);
      moved++;
    }
    return moved;
  }

  async removeTextStyle(name: string): Promise<void> {
    this.styles.delete(name);
    // A host detaches what still used it: the layer keeps its values, unlinked.
    for (const [layer, style] of this.layers) {
      if (style === name) this.layers.delete(layer);
    }
  }

  async removeVariable(collection: string, name: string): Promise<void> {
    const held = this.collections.get(collection);
    if (!held) throw new Error(`no collection '${collection}'`);
    held.variables = held.variables.filter((v) => v.name !== name);
  }

  async removeCollection(name: string): Promise<void> {
    const held = this.collections.get(name);
    if (!held) return;
    if (held.variables.length > 0) {
      throw new Error(`collection '${name}' still holds variables`);
    }
    this.collections.delete(name);
  }

  async styleUses(names: string[]): Promise<Record<string, number>> {
    const uses: Record<string, number> = {};
    for (const name of names) {
      uses[name] = [...this.layers.values()].filter((s) => s === name).length;
    }
    return uses;
  }

  /** Test helper: a layer uses a style. */
  useStyle(style: string, layer: string): void {
    this.layers.set(layer, style);
  }

  /** Test helper: the style a layer uses, if any. */
  layerStyle(layer: string): string | undefined {
    return this.layers.get(layer);
  }

  async readBinding(): Promise<Binding | undefined> {
    return parseBinding(this.binding ?? '');
  }

  async writeBinding(binding: Binding): Promise<void> {
    this.binding = JSON.stringify(binding);
  }

  /** Test helper: a host-side edit tessellate did not make (drift). */
  edit(collection: string, name: string, mode: string, value: unknown): void {
    const variable = this.collections
      .get(collection)
      ?.variables.find((v) => v.name === name);
    if (!variable) throw new Error(`no variable '${collection}/${name}'`);
    variable.valuesByMode[mode] = value;
  }
}

export { stable };
