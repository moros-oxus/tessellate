import type { FigmaModel } from '@vertekum/ext-export-figma';

/**
 * Which modes belong to which composition — read straight from each collection's
 * `modeSources`, never parsed from mode names. Only merged collections carry them; a
 * collection that resolves identically across compositions is shared and not listed.
 */
export interface CompositionReadout {
  compositions: string[];
  collections: Array<{
    name: string;
    /** composition → its modes in this collection, in model order. */
    modes: Record<string, string[]>;
  }>;
}

export function compositionReadout(model: FigmaModel): CompositionReadout {
  const collections: CompositionReadout['collections'] = [];
  for (const collection of model.collections) {
    if (!collection.modeSources) continue;
    const modes: Record<string, string[]> = {};
    for (const mode of collection.modes) {
      const from = collection.modeSources[mode];
      if (!from) continue;
      modes[from.composition] ??= [];
      modes[from.composition]?.push(mode);
    }
    collections.push({ name: collection.name, modes });
  }
  return { compositions: model.source.compositions, collections };
}
