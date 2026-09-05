import type { FigmaModel, FigmaVariable } from '@vertekum/ext-export-figma';
import {
  appliedForm,
  type CollectionDiff,
  type HostSnapshot,
  type ModelDiff,
  normalizeNumbers,
  type SnapshotVariable,
  type StyleDiff,
  stable,
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

function held(variable: SnapshotVariable): string {
  return appliedForm(variable.valuesByMode, variable.alias);
}

function variableState(
  wanted: FigmaVariable,
  hostVar: SnapshotVariable | undefined,
): { state: VariableState; details: string[] } {
  if (!hostVar) return { state: 'add', details: [] };
  const want = desired(wanted);
  const have = held(hostVar);
  const drifted = hostVar.stamp !== undefined && have !== hostVar.stamp.applied;
  if (want === have) {
    return drifted
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
  if (stable(wanted.alias ?? {}) !== stable(hostVar.alias ?? {})) {
    details.push('alias binding changes');
  }
  if (drifted) {
    details.push(
      'edited in the host since the last apply — applying overwrites it',
    );
    return { state: 'drift', details };
  }
  return { state: 'update', details };
}

export function diff(model: FigmaModel, snapshot: HostSnapshot): ModelDiff {
  const counts: Record<VariableState, number> = {
    add: 0,
    update: 0,
    unchanged: 0,
    drift: 0,
  };
  const collections: CollectionDiff[] = model.collections.map((wanted) => {
    const hostCollection = snapshot.collections.find(
      (c) => c.name === wanted.name,
    );
    const variables: VariableDiff[] = wanted.variables.map((variable) => {
      const hostVar = hostCollection?.variables.find(
        (v) => v.name === variable.name,
      );
      const { state, details } = variableState(variable, hostVar);
      counts[state]++;
      return { name: variable.name, type: variable.type, state, details };
    });
    return {
      name: wanted.name,
      exists: hostCollection !== undefined,
      missingModes: wanted.modes.filter(
        (mode) => !(hostCollection?.modes ?? []).includes(mode),
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
