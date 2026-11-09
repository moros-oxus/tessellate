/**
 * Font weight → the font STYLE name a family actually has. Figma addresses a face by
 * `{ family, style }`, and families name their styles freely (`SemiBold`, `Semi Bold`,
 * `Demibold`), so the weight is matched against what the family offers — never assumed.
 * Pure: the adapter supplies the family's available style names.
 */

/** The style names families commonly use per CSS weight (compared without spaces/dashes). */
const NAMES: Record<number, string[]> = {
  100: ['thin', 'hairline'],
  200: ['extralight', 'ultralight'],
  300: ['light'],
  400: ['regular', 'normal', 'book', 'roman'],
  500: ['medium'],
  600: ['semibold', 'demibold'],
  700: ['bold'],
  800: ['extrabold', 'ultrabold'],
  900: ['black', 'heavy'],
};

/** DTCG `fontWeight` keywords (the spec's aliases) → numeric weight. */
const KEYWORDS: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  normal: 400,
  regular: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
  extrablack: 950,
  ultrablack: 950,
};

const normalize = (name: string): string =>
  name.toLowerCase().replace(/[\s_-]/g, '');

/** A `fontWeight` value (number, numeric string, or DTCG keyword) as a number; else undefined. */
export function weightOf(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const numeric = Number(value);
  if (value.trim() !== '' && Number.isFinite(numeric)) return numeric;
  return KEYWORDS[normalize(value)];
}

/** A style's weight, read from its name; `undefined` for names that say nothing (e.g. `Italic`). */
function weightOfStyle(style: string): number | undefined {
  const name = normalize(style);
  for (const [weight, names] of Object.entries(NAMES)) {
    if (names.includes(name)) return Number(weight);
  }
  return undefined;
}

/**
 * The family's upright style for `weight`: the exact weight when the family has it, else the
 * nearest one it has (ties go heavier), else `Regular`. Italic/oblique faces are never chosen.
 */
export function fontStyleFor(
  weight: number | undefined,
  available: string[],
): string {
  const upright = available.filter((s) => !/italic|oblique/i.test(s));
  const target = weight ?? 400;
  let best: { style: string; distance: number; weight: number } | undefined;
  for (const style of upright) {
    const own = weightOfStyle(style);
    if (own === undefined) continue;
    const distance = Math.abs(own - target);
    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance && own > best.weight)
    ) {
      best = { style, distance, weight: own };
    }
  }
  return best?.style ?? 'Regular';
}

/** A host line height: pixels, or a percentage of the font size. */
export interface LineHeightValue {
  unit: 'PIXELS' | 'PERCENT';
  value: number;
}

/**
 * A style's `line-height` as a host line height: a px string (`68px`, the exporter's
 * translation of a line-height token) stays pixels; a unitless multiplier (`1.5`) is a
 * percentage of the font size. Units it can't place are not guessed at.
 */
export function lineHeightOf(value: unknown): LineHeightValue | undefined {
  if (typeof value === 'number') {
    return {
      unit: 'PERCENT',
      value: Math.round(value * 100 * 10_000) / 10_000,
    };
  }
  if (typeof value !== 'string') return undefined;
  const match = /^\s*(\d*\.?\d+)\s*px\s*$/.exec(value);
  return match ? { unit: 'PIXELS', value: Number(match[1]) } : undefined;
}

/** A host letter spacing: pixels, or a percentage of the font size. */
export interface LetterSpacingValue {
  unit: 'PIXELS' | 'PERCENT';
  value: number;
}

/**
 * A style's `letter-spacing` (`-0.96px`, `0.02em`) as a host letter spacing; `em` is a fraction
 * of the font size, so it becomes a percentage. Units it can't place are not guessed at.
 */
export function letterSpacingOf(
  value: unknown,
): LetterSpacingValue | undefined {
  if (value === 0) return { unit: 'PIXELS', value: 0 };
  if (typeof value !== 'string') return undefined;
  const match = /^\s*(-?\d*\.?\d+)\s*(px|em)\s*$/.exec(value);
  if (!match) return undefined;
  const amount = Number(match[1]);
  return match[2] === 'em'
    ? { unit: 'PERCENT', value: Math.round(amount * 100 * 10_000) / 10_000 }
    : { unit: 'PIXELS', value: amount };
}

/**
 * Every face a bound style can resolve to. A host resolves a bound family or weight on its
 * own (in the variable's default mode, and in each mode the style is used in), and refuses
 * to bind into a face that isn't loaded — so each family the style can take, at each weight
 * it can take, is loaded before binding. `keepStyle` covers the step in between: a family
 * bound before the weight keeps the plain style name. Families not installed load nothing.
 */
export function facesToLoad(input: {
  families: string[];
  weights: Array<number | undefined>;
  keepStyle: string | undefined;
  stylesOf: (family: string) => string[];
}): Array<{ family: string; style: string }> {
  const faces = new Map<string, { family: string; style: string }>();
  for (const family of new Set(input.families)) {
    const available = input.stylesOf(family);
    if (available.length === 0) continue;
    const styles = new Set(
      input.weights.map((weight) => fontStyleFor(weight, available)),
    );
    if (input.keepStyle && available.includes(input.keepStyle)) {
      styles.add(input.keepStyle);
    }
    for (const style of styles) {
      if (available.includes(style)) {
        faces.set(`${family}\u0000${style}`, { family, style });
      }
    }
  }
  return [...faces.values()];
}
