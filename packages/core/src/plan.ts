import type { FigmaCollection, FigmaModel } from '@vertekum/ext-export-figma';
import type { ModelDiff } from './types';
import {
  appliedForm,
  DEFAULT_POLICY,
  type Op,
  type Plan,
  type PlanPolicy,
  type Stamp,
} from './types';

/**
 * Diff → an ordered, serializable operation list. Order is the alias guarantee: collections,
 * then modes, then every variable VALUE, then alias bindings (targets exist by then), then
 * styles. Delete-free by policy — the plan states what it will not do rather than doing it.
 *
 * Seat-aware modes: when the host's mode capacity is known and a collection exceeds it, the
 * `split-collections` fallback rewrites that collection into sibling single-mode collections
 * (`color-mode/dark`) — decided at plan time, visible in the plan's notes, superseding any
 * static output-side strategy.
 */

function stampFor(
  collection: string,
  name: string,
  version: number,
  applied: string,
): Stamp {
  return { path: `${collection}:${name}`, modelVersion: version, applied };
}

interface SplitCollection {
  name: string;
  modes: string[];
  source: FigmaCollection;
  /** mode-in-model → mode-in-host for this (possibly split) collection. */
  modeName: (mode: string) => string;
}

function fit(
  collection: FigmaCollection,
  capacity: number | undefined,
  policy: PlanPolicy,
  notes: string[],
): SplitCollection[] {
  if (capacity === undefined || collection.modes.length <= capacity) {
    return [
      {
        name: collection.name,
        modes: collection.modes,
        source: collection,
        modeName: (mode) => mode,
      },
    ];
  }
  if (policy.modeFallback === 'fail') {
    throw new Error(
      `collection '${collection.name}' needs ${collection.modes.length} modes; the seat allows ${capacity}`,
    );
  }
  notes.push(
    `collection '${collection.name}' exceeds the seat's ${capacity} mode(s) — split into ${collection.modes
      .map((m) => `'${collection.name}/${m}'`)
      .join(', ')}`,
  );
  return collection.modes.map((mode) => ({
    name: `${collection.name}/${mode}`,
    modes: [mode],
    source: collection,
    modeName: () => mode,
  }));
}

export function plan(
  model: FigmaModel,
  diffed: ModelDiff,
  capacity: number | undefined,
  policy: PlanPolicy = DEFAULT_POLICY,
): Plan {
  const notes: string[] = [`deletes: ${policy.deletes} (policy)`];
  const ops: Op[] = [];
  const aliases: Op[] = [];

  for (const collection of model.collections) {
    const diffCollection = diffed.collections.find(
      (c) => c.name === collection.name,
    );
    const changed = new Set(
      (diffCollection?.variables ?? [])
        .filter((v) => v.state !== 'unchanged')
        .map((v) => v.name),
    );
    if (
      changed.size === 0 &&
      diffCollection?.exists &&
      diffCollection.missingModes.length === 0
    ) {
      continue;
    }
    for (const part of fit(collection, capacity, policy, notes)) {
      ops.push({ op: 'ensureCollection', collection: part.name });
      for (const mode of part.modes) {
        ops.push({
          op: 'ensureMode',
          collection: part.name,
          mode: part.modeName(mode),
        });
      }
      for (const variable of collection.variables) {
        if (!changed.has(variable.name)) continue;
        const valuesByMode: Record<string, unknown> = {};
        const modeAliases: Array<{ mode: string; target: string }> = [];
        for (const mode of part.modes) {
          const hostMode = part.modeName(mode);
          const alias = variable.alias?.[mode];
          if (alias !== undefined) {
            modeAliases.push({ mode: hostMode, target: alias });
            continue;
          }
          if (variable.valuesByMode[mode] !== undefined) {
            valuesByMode[hostMode] = variable.valuesByMode[mode];
          }
        }
        ops.push({
          op: 'upsertVariable',
          collection: part.name,
          name: variable.name,
          type: variable.type,
          valuesByMode,
          stamp: stampFor(
            part.name,
            variable.name,
            model.version,
            appliedForm(variable.valuesByMode, variable.alias),
          ),
        });
        for (const bound of modeAliases) {
          aliases.push({
            op: 'bindAlias',
            collection: part.name,
            name: variable.name,
            mode: bound.mode,
            target: bound.target,
          });
        }
      }
    }
  }
  ops.push(...aliases);

  for (const style of model.styles) {
    const state = diffed.styles.find(
      (s) => s.name === style.name && s.kind === style.kind,
    )?.state;
    if (state === 'unchanged') continue;
    if (style.kind !== 'text') {
      notes.push(`style '${style.name}' (${style.kind}) is not applied in v1`);
      continue;
    }
    ops.push({
      op: 'upsertTextStyle',
      name: style.name,
      properties: style.properties,
      stamp: stampFor(
        'styles',
        style.name,
        model.version,
        appliedForm({ default: style.properties }, undefined),
      ),
    });
  }

  return { ops, notes };
}
