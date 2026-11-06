import type {
  FigmaModel,
  FigmaStyle,
  FigmaType,
} from '@vertekum/ext-export-figma';
import { fit } from './layout';
import {
  DEFAULT_POLICY,
  normalizeNumbers,
  type PlanPolicy,
  type StyleBinding,
  stable,
} from './types';

/**
 * A text style as it lands in a host: its plain values, plus the members bound to the model's
 * variables, so the style follows the mode of whatever uses it. ONE rule shared by diff and
 * plan (like `fit`), so what the plan binds is exactly what the next diff expects.
 */

export interface StyleForm {
  /** The plain values, always applied: a host writes them, then binds over them. */
  properties: FigmaStyle['properties'];
  bindings: StyleBinding[];
  /** Each reference the style names but does not bind, and why. */
  notes: string[];
  /** The stamp's `applied` form: values AND bindings, so a change in either re-applies. */
  applied: string;
}

/**
 * The variable type each bindable member takes. A bound value has to mean what the member
 * means, so `line-height` is absent: a token line height is a unitless multiplier, while a
 * host reads a line height bound to a variable as pixels.
 */
const BINDABLE: Record<string, FigmaType> = {
  'font-family': 'STRING',
  'font-size': 'FLOAT',
  'font-weight': 'FLOAT',
  'letter-spacing': 'FLOAT',
};

export function styleForm(
  style: FigmaStyle,
  model: FigmaModel,
  capacity: number | undefined,
  policy: PlanPolicy = DEFAULT_POLICY,
): StyleForm {
  const bindings: StyleBinding[] = [];
  const notes: string[] = [];
  const splitNoted = new Set<string>();
  const refuse = (property: string, variable: string, why: string) =>
    notes.push(
      `style '${style.name}': ${property} not bound to '${variable}' — ${why}`,
    );

  for (const { property, value, variable } of style.properties) {
    if (variable === undefined) continue;
    const held = model.collections
      .map((collection) => ({
        collection,
        found: collection.variables.find((v) => v.name === variable),
      }))
      .find(({ found }) => found !== undefined);
    if (!held?.found) {
      refuse(property, variable, 'the model has no such variable');
      continue;
    }
    if (property === 'line-height') {
      refuse(
        property,
        variable,
        'a host reads a bound line height as pixels, the token is a multiplier',
      );
      continue;
    }
    const wants = BINDABLE[property];
    if (wants === undefined) {
      refuse(property, variable, 'a text style cannot bind it');
      continue;
    }
    if (held.found.type !== wants) {
      refuse(
        property,
        variable,
        `it needs a ${wants} variable, not ${held.found.type}`,
      );
      continue;
    }
    if (
      property === 'letter-spacing' &&
      !(typeof value === 'string' && value.trim().endsWith('px'))
    ) {
      refuse(
        property,
        variable,
        `only a px letter spacing binds (the value is ${String(value)})`,
      );
      continue;
    }
    const { collection } = held;
    if (fit(collection, capacity, policy).parts.length > 1) {
      if (!splitNoted.has(collection.name)) {
        splitNoted.add(collection.name);
        notes.push(
          `style '${style.name}': not bound to '${collection.name}' variables — the collection is split for this seat`,
        );
      }
      continue;
    }
    bindings.push({ property, collection: collection.name, variable });
  }

  return {
    properties: style.properties,
    bindings,
    notes,
    applied: stable({
      values: { default: normalizeNumbers(style.properties) },
      alias: {},
      bindings,
      // Only when set, so a style that isn't deprecated keeps the stamp it already has.
      ...(style.deprecated !== undefined
        ? { deprecated: style.deprecated }
        : {}),
    }),
  };
}
