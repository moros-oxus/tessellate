import type { FigmaModel, FigmaVariable } from '@vertekum/ext-export-figma';
import { fit, partOf } from './layout';
import {
  appliedForm,
  type CollectionDiff,
  DEFAULT_POLICY,
  formModes,
  type HostSnapshot,
  type ModelDiff,
  normalizeNumbers,
  type PlanPolicy,
  type SnapshotVariable,
  type StyleDiff,
  stable,
  stampModes,
  type VariableDiff,
  type VariableState,
} from './types';

/**
 * Model vs host, per variable — the preview that writes nothing.
 *
 * State per variable:
 *  - `add`       — no such variable in the host;
 *  - `unchanged` — host already holds exactly what the model wants;
 *  - `update`    — host differs and was last written by tessellate (or is untouched-by-us
 *                  with a different value);
 *  - `drift`     — the host value differs from what tessellate LAST APPLIED (someone edited
 *                  it in the host). An
 *                  apply will overwrite it toward the model, and the diff says so first.
 */

/** What the model wants a variable's stored comparison form to be. */
function desired(variable: FigmaVariable): string {
  return appliedForm(variable.valuesByMode, variable.alias);
}

/** What the host holds, over the modes the model speaks for (see `appliedForm`). */
function held(variable: SnapshotVariable, wanted: FigmaVariable): string {
  return appliedForm(
    variable.valuesByMode,
    variable.alias,
    formModes(wanted.valuesByMode, wanted.alias),
  );
}

/**
 * Whether the host edited a variable since tessellate last applied it: its held form, over
 * the modes the stamp covers, is no longer the stamp's. Needs no model.
 */
function drifted(variable: SnapshotVariable): boolean {
  if (variable.stamp === undefined) return false;
  const have = appliedForm(
    variable.valuesByMode,
    variable.alias,
    stampModes(variable.stamp),
  );
  return have !== variable.stamp.applied;
}

function variableState(
  wanted: FigmaVariable,
  hostVar: SnapshotVariable | undefined,
): { state: VariableState; details: string[] } {
  if (!hostVar) return { state: 'add', details: [] };
  const want = desired(wanted);
  const have = held(hostVar, wanted);
  const isDrift = drifted(hostVar);
  if (want === have) {
    return isDrift
      ? {
          state: 'drift',
          details: ['host edits match the model — stamp refresh only'],
        }
      : { state: 'unchanged', details: [] };
  }
  const details: string[] = [];
  for (const mode of Object.keys(wanted.valuesByMode)) {
    if (wanted.alias?.[mode] !== undefined) continue;
    const a = stable(normalizeNumbers(wanted.valuesByMode[mode]));
    const b = stable(normalizeNumbers(hostVar.valuesByMode[mode]));
    if (a !== b) details.push(`mode '${mode}' changes`);
  }
  const wantedModes = formModes(wanted.valuesByMode, wanted.alias);
  const hostAlias = Object.fromEntries(
    Object.entries(hostVar.alias ?? {}).filter(([mode]) =>
      wantedModes.has(mode),
    ),
  );
  if (stable(wanted.alias ?? {}) !== stable(hostAlias)) {
    details.push('alias binding changes');
  }
  if (isDrift) {
    details.push(
      'edited in the host since the last apply — applying overwrites it',
    );
    return { state: 'drift', details };
  }
  return { state: 'update', details };
}

/** One variable's state across the parts it lands in — the worst part speaks for it. */
function combine(
  states: Array<{ part: string; state: VariableState; details: string[] }>,
  split: boolean,
): { state: VariableState; details: string[] } {
  const details = states.flatMap((s) =>
    split ? s.details.map((d) => `${s.part}: ${d}`) : s.details,
  );
  if (states.every((s) => s.state === 'add')) return { state: 'add', details };
  if (states.some((s) => s.state === 'drift')) {
    return { state: 'drift', details };
  }
  if (states.some((s) => s.state !== 'unchanged')) {
    return { state: 'update', details };
  }
  return { state: 'unchanged', details };
}

/**
 * `capacity` must be the one the plan will use: a collection over it is compared against the
 * split siblings the plan writes (see `fit`), not against a whole collection that never lands.
 */
export function diff(
  model: FigmaModel,
  snapshot: HostSnapshot,
  capacity?: number,
  policy: PlanPolicy = DEFAULT_POLICY,
): ModelDiff {
  const counts: Record<VariableState, number> = {
    add: 0,
    update: 0,
    unchanged: 0,
    drift: 0,
  };
  const collections: CollectionDiff[] = model.collections.map((wanted) => {
    const { parts } = fit(wanted, capacity, policy);
    const hosts = parts.map((part) => ({
      part,
      host: snapshot.collections.find((c) => c.name === part.name),
    }));
    const variables: VariableDiff[] = wanted.variables.map((variable) => {
      const { state, details } = combine(
        hosts.map(({ part, host }) => ({
          part: part.name,
          ...variableState(
            { ...variable, ...partOf(variable, part) },
            host?.variables.find((v) => v.name === variable.name),
          ),
        })),
        parts.length > 1,
      );
      counts[state]++;
      return { name: variable.name, type: variable.type, state, details };
    });
    return {
      name: wanted.name,
      exists: hosts.every(({ host }) => host !== undefined),
      missingModes: hosts.flatMap(({ part, host }) =>
        part.modes.filter((mode) => !(host?.modes ?? []).includes(mode)),
      ),
      variables,
    };
  });

  // Styles compare BY STAMP, not by property shape: a host cannot round-trip every property
  // in authored form (Figma reads back a subset), so the stamp — what tessellate last
  // applied — is the only honest equality. No stamp (foreign style) means update.
  const styles: StyleDiff[] = model.styles.map((wanted) => {
    const hostStyle = snapshot.styles.find(
      (s) => s.name === wanted.name && s.kind === wanted.kind,
    );
    const want = appliedForm({ default: wanted.properties }, undefined);
    let state: VariableState;
    if (!hostStyle) state = 'add';
    else if (hostStyle.stamp?.applied === want) state = 'unchanged';
    else state = 'update';
    counts[state]++;
    return { name: wanted.name, kind: wanted.kind, state };
  });

  return { collections, styles, counts };
}

export interface HostDrift {
  count: number;
  /** Each drifted variable, as `collection/name`. */
  variables: string[];
}

/**
 * Drift with no model in hand — what a bound file shows on open: every stamped variable whose
 * host value is no longer what tessellate last applied. Styles are not counted: a host reads
 * them back lossily, so their equality is the stamp's alone and a host edit is invisible.
 */
export function hostDrift(snapshot: HostSnapshot): HostDrift {
  const variables: string[] = [];
  for (const collection of snapshot.collections) {
    for (const variable of collection.variables) {
      if (drifted(variable))
        variables.push(`${collection.name}/${variable.name}`);
    }
  }
  return { count: variables.length, variables };
}
