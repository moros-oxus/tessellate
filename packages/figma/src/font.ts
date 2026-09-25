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
