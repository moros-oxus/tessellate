import type { FigmaType } from '@vertekum/ext-export-figma';

/**
 * The host-agnostic vocabulary. Core never imports a host API — each plugin package implements
 * `HostAdapter`, and everything else (diff, plan, apply) is pure and unit-testable.
 */

/** The identity stamp written to every entity tessellate touches (host plugin-data). */
export interface Stamp {
  /** The vertekum token path (slash form) this entity was created from. */
  path: string;
  /** The model CONTRACT version (`draft.NN` / `YYYY.MM`) that applied it — not a content revision. */
  modelVersion: string;
  /** Stable JSON of the values as APPLIED — what makes drift detectable, not name-guessed. */
  applied: string;
}

export interface SnapshotVariable {
  name: string;
  type: FigmaType;
  valuesByMode: Record<string, unknown>;
  alias?: Record<string, string>;
  /** Present when tessellate wrote it before; absent on foreign variables. */
  stamp?: Stamp;
}

export interface SnapshotCollection {
  name: string;
  modes: string[];
  variables: SnapshotVariable[];
}

export interface SnapshotStyle {
  kind: 'text' | 'effect';
  name: string;
  properties: Array<{ property: string; value: unknown; variable?: string }>;
  stamp?: Stamp;
}

export interface HostSnapshot {
  collections: SnapshotCollection[];
  styles: SnapshotStyle[];
}

/** What a host package implements. Write ops are idempotent by (collection, name). */
export interface HostAdapter {
  snapshot(): Promise<HostSnapshot>;
  /** Modes-per-collection the seat allows; undefined = unknown (assume enough). */
  modeCapacity(): number | undefined;
  ensureCollection(name: string): Promise<void>;
  ensureMode(collection: string, mode: string): Promise<void>;
  upsertVariable(
    collection: string,
    variable: {
      name: string;
      type: FigmaType;
      valuesByMode: Record<string, unknown>;
      stamp: Stamp;
    },
  ): Promise<void>;
  bindAlias(
    collection: string,
    name: string,
    mode: string,
    target: string,
  ): Promise<void>;
  upsertTextStyle(style: {
    name: string;
    properties: Array<{ property: string; value: unknown; variable?: string }>;
    stamp: Stamp;
  }): Promise<void>;
}

export type VariableState = 'add' | 'update' | 'unchanged' | 'drift';

export interface VariableDiff {
  name: string;
  type: FigmaType;
  state: VariableState;
  /** Human-readable specifics ("mode 'dark' changes", "host edited since last apply"). */
  details: string[];
}

export interface CollectionDiff {
  name: string;
  exists: boolean;
  /** Modes the host is missing. */
  missingModes: string[];
  variables: VariableDiff[];
}

export interface StyleDiff {
  name: string;
  kind: 'text' | 'effect';
  state: VariableState;
}

export interface ModelDiff {
  collections: CollectionDiff[];
  styles: StyleDiff[];
  counts: Record<VariableState, number>;
}

export type Op =
  | { op: 'ensureCollection'; collection: string }
  | { op: 'ensureMode'; collection: string; mode: string }
  | {
      op: 'upsertVariable';
      collection: string;
      name: string;
      type: FigmaType;
      valuesByMode: Record<string, unknown>;
      stamp: Stamp;
    }
  | {
      op: 'bindAlias';
      collection: string;
      name: string;
      mode: string;
      target: string;
    }
  | {
      op: 'upsertTextStyle';
      name: string;
      properties: Array<{
        property: string;
        value: unknown;
        variable?: string;
      }>;
      stamp: Stamp;
    };

export interface Plan {
  ops: Op[];
  /** Anything the plan chose not to do, stated ("collection 'x' exceeds 1 mode — split applied"). */
  notes: string[];
}

export interface PlanPolicy {
  /** v1 is delete-free by design; the field exists so the default is a statement, not an absence. */
  deletes: 'never';
  /** What to do when a collection's modes exceed the seat's capacity. */
  modeFallback: 'split-collections' | 'fail';
}

export const DEFAULT_POLICY: PlanPolicy = {
  deletes: 'never',
  modeFallback: 'split-collections',
};

/**
 * Numeric normalization: hosts store floats at their own precision (Figma: 32-bit colour
 * components), so a written 0.2627 reads back 0.26269999…. Every comparison rounds numbers
 * to four decimals on BOTH sides — without this, apply → re-diff reports phantom drift.
 */
export function normalizeNumbers(value: unknown): unknown {
  if (typeof value === 'number') return Math.round(value * 10_000) / 10_000;
  if (Array.isArray(value)) return value.map(normalizeNumbers);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, held] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = normalizeNumbers(held);
    }
    return out;
  }
  return value;
}

/**
 * The canonical comparison form of a variable: alias wins its mode, so an aliased mode's
 * concrete value is EXCLUDED, and numbers are normalized (see `normalizeNumbers`). `desired`
 * (model), `held` (host), and the stamp's `applied` all use this one form — which is what
 * makes "no-op re-diff" and drift detection honest.
 */
export function appliedForm(
  valuesByMode: Record<string, unknown>,
  alias: Record<string, string> | undefined,
): string {
  const values: Record<string, unknown> = {};
  for (const [mode, value] of Object.entries(valuesByMode)) {
    if (alias?.[mode] === undefined) values[mode] = normalizeNumbers(value);
  }
  return stable({ values, alias: alias ?? {} });
}

/** Stable JSON (sorted keys) — the stamp's `applied` and every value comparison use it. */
export function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value as object)
    .sort()
    .map(
      (k) =>
        `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`,
    )
    .join(',')}}`;
}
