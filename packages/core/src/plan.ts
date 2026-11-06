import type { FigmaModel } from '@vertekum/ext-export-figma';
import { fit, partOf } from './layout';
import { styleForm } from './style-form';
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
 *
 * Text styles bind their members to the model's variables where `styleForm` (shared with diff)
 * allows; a reference it can't bind is applied as a plain value, and the notes say why.
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
  const gone = diffed.retired;
  const retiredCount = gone.variables.length + gone.styles.length;
  const notes: string[] = [
    policy.deletes === 'retired'
      ? 'deletes: retired entities (policy)'
      : `deletes: never (policy)${
          retiredCount > 0
            ? ` — ${retiredCount} retired entit${retiredCount === 1 ? 'y' : 'ies'} kept`
            : ''
        }`,
  ];
  const ops: Op[] = [];
  const aliases: Op[] = [];

  for (const collection of model.collections) {
    const diffCollection = diffed.collections.find(
      (c) => c.name === collection.name,
    );
    const changed = new Set(
      (diffCollection?.variables ?? [])
        .filter((v) => v.state !== 'unchanged' && v.state !== 'remove')
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
          ...(variable.deprecated !== undefined
            ? { deprecated: variable.deprecated }
            : {}),
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
    const form = styleForm(style, model, capacity, policy);
    for (const note of form.notes) if (!notes.includes(note)) notes.push(note);
    ops.push({
      op: 'upsertTextStyle',
      name: style.name,
      properties: form.properties,
      bindings: form.bindings,
      ...(style.deprecated !== undefined
        ? { deprecated: style.deprecated }
        : {}),
      stamp: stampFor('styles', style.name, model.version, form.applied),
    });
  }

  // Retirement LAST: every replacement exists by now, usages move onto it, then the old goes.
  for (const note of gone.notes) if (!notes.includes(note)) notes.push(note);
  if (policy.deletes === 'retired' && retiredCount > 0) {
    for (const style of gone.styles) {
      if (style.replacement !== undefined) {
        ops.push({
          op: 'migrateStyleUsages',
          from: style.name,
          to: style.replacement,
        });
      }
    }
    for (const style of gone.styles) {
      ops.push({ op: 'removeTextStyle', name: style.name });
    }
    for (const { collection, name } of gone.variables) {
      ops.push({ op: 'removeVariable', collection, name });
    }
    for (const collection of gone.collections) {
      ops.push({ op: 'removeCollection', collection });
    }
    if (gone.variables.length > 0) {
      notes.push(
        `removing ${gone.variables.length} variable(s) the model no longer holds — layers bound to them keep their last values, unlinked, here and in files using the published library`,
      );
    }
  }

  return { ops, notes };
}
