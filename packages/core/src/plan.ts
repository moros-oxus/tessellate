import type { FigmaModel } from '@vertekum/ext-export-figma';
import { fit, partOf } from './layout';
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
 * (`color-mode/dark`) — decided by `fit` (shared with diff), visible in the plan's notes,
 * superseding any static output-side strategy.
 */

function stampFor(
  collection: string,
  name: string,
  version: string,
  applied: string,
): Stamp {
  return { path: `${collection}:${name}`, modelVersion: version, applied };
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
    const { parts, note } = fit(collection, capacity, policy);
    if (note) notes.push(note);
    for (const part of parts) {
      ops.push({ op: 'ensureCollection', collection: part.name });
      for (const mode of part.modes) {
        ops.push({ op: 'ensureMode', collection: part.name, mode });
      }
      for (const variable of collection.variables) {
        if (!changed.has(variable.name)) continue;
        const { valuesByMode, alias } = partOf(variable, part);
        ops.push({
          op: 'upsertVariable',
          collection: part.name,
          name: variable.name,
          type: variable.type,
          valuesByMode,
          // The stamp records what THIS part holds, in host mode names — a split part holds
          // one mode, and drift is measured against exactly that.
          stamp: stampFor(
            part.name,
            variable.name,
            model.version,
            appliedForm(valuesByMode, alias),
          ),
        });
        for (const [mode, target] of Object.entries(alias)) {
          aliases.push({
            op: 'bindAlias',
            collection: part.name,
            name: variable.name,
            mode,
            target,
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
