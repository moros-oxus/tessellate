import type {
  FigmaCollection,
  FigmaVariable,
} from '@vertekum/ext-export-figma';
import type { PlanPolicy } from './types';

/**
 * How a model collection lands in a host with a known mode capacity — ONE rule shared by diff
 * and plan, so what the plan writes is exactly what the next diff looks for. A collection
 * within capacity lands whole; over it, the `split-collections` fallback lands one
 * single-mode sibling per mode (`color-mode/dark`). Mode names are the model's either way.
 */
export interface Part {
  /** The host collection name. */
  name: string;
  /** The model modes this part holds. */
  modes: string[];
}

export function fit(
  collection: FigmaCollection,
  capacity: number | undefined,
  policy: PlanPolicy,
): { parts: Part[]; note?: string } {
  if (capacity === undefined || collection.modes.length <= capacity) {
    return { parts: [{ name: collection.name, modes: collection.modes }] };
  }
  if (policy.modeFallback === 'fail') {
    throw new Error(
      `collection '${collection.name}' needs ${collection.modes.length} modes; the seat allows ${capacity}`,
    );
  }
  // A merged collection's modes belong to compositions — say which, from `modeSources`.
  const compositions = [
    ...new Set(
      Object.values(collection.modeSources ?? {}).map((s) => s.composition),
    ),
  ];
  const from =
    compositions.length > 0
      ? ` (modes of compositions ${compositions.join(', ')})`
      : '';
  return {
    parts: collection.modes.map((mode) => ({
      name: `${collection.name}/${mode}`,
      modes: [mode],
    })),
    note: `collection '${collection.name}' exceeds the seat's ${capacity} mode(s) — split into ${collection.modes
      .map((m) => `'${collection.name}/${m}'`)
      .join(', ')}${from}`,
  };
}

/** A variable as one part holds it: that part's modes only; an alias wins its mode. */
export function partOf(
  variable: FigmaVariable,
  part: Part,
): { valuesByMode: Record<string, unknown>; alias: Record<string, string> } {
  const valuesByMode: Record<string, unknown> = {};
  const alias: Record<string, string> = {};
  for (const mode of part.modes) {
    const target = variable.alias?.[mode];
    if (target !== undefined) {
      alias[mode] = target;
      continue;
    }
    if (variable.valuesByMode[mode] !== undefined) {
      valuesByMode[mode] = variable.valuesByMode[mode];
    }
  }
  return { valuesByMode, alias };
}
