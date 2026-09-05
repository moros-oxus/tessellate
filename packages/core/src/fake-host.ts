import {
  type HostAdapter,
  type HostSnapshot,
  type SnapshotCollection,
  type SnapshotStyle,
  type Stamp,
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
      stamp: Stamp;
    },
  ): Promise<void> {
    const held = this.collections.get(collection);
    if (!held) throw new Error(`no collection '${collection}'`);
    const existing = held.variables.find((v) => v.name === variable.name);
    if (existing) {
      existing.type = variable.type;
      existing.valuesByMode = {
        ...existing.valuesByMode,
        ...variable.valuesByMode,
      };
      existing.alias = undefined;
      existing.stamp = variable.stamp;
    } else {
      held.variables.push({
        ...variable,
        valuesByMode: { ...variable.valuesByMode },
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
    stamp: Stamp;
  }): Promise<void> {
    this.styles.set(style.name, { kind: 'text', ...style });
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
