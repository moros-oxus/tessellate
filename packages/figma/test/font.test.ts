import { expect, test } from 'vitest';
import {
  facesToLoad,
  fontStyleFor,
  letterSpacingOf,
  lineHeightOf,
  weightOf,
} from '../src/font';

const openSans = [
  'Light',
  'Regular',
  'Italic',
  'Medium',
  'SemiBold',
  'SemiBold Italic',
  'Bold',
  'ExtraBold',
];

test('a weight picks the family’s own upright style name', () => {
  expect(fontStyleFor(400, openSans)).toBe('Regular');
  expect(fontStyleFor(600, openSans)).toBe('SemiBold');
  expect(fontStyleFor(700, openSans)).toBe('Bold');
  // Families spell styles differently; matching ignores spaces and dashes.
  expect(fontStyleFor(600, ['Regular', 'Semi Bold', 'Bold'])).toBe('Semi Bold');
  expect(fontStyleFor(600, ['Book', 'Demibold'])).toBe('Demibold');
});

test('a weight the family lacks falls to the nearest one it has — ties go heavier', () => {
  expect(fontStyleFor(900, openSans)).toBe('ExtraBold');
  expect(fontStyleFor(100, openSans)).toBe('Light');
  expect(fontStyleFor(500, ['Regular', 'SemiBold'])).toBe('SemiBold');
});

test('never an italic face; no weight means regular; unknown families fall back to Regular', () => {
  expect(fontStyleFor(600, ['Regular', 'SemiBold Italic'])).toBe('Regular');
  expect(fontStyleFor(undefined, openSans)).toBe('Regular');
  expect(fontStyleFor(700, [])).toBe('Regular');
});

test('font weights read as numbers, numeric strings or DTCG keywords', () => {
  expect(weightOf(600)).toBe(600);
  expect(weightOf('700')).toBe(700);
  expect(weightOf('semi-bold')).toBe(600);
  expect(weightOf('extra-black')).toBe(950);
  expect(weightOf('{font.weight.bold}')).toBeUndefined();
  expect(weightOf(undefined)).toBeUndefined();
});

test('a letter spacing in px or em becomes a host letter spacing', () => {
  expect(letterSpacingOf('-0.96px')).toEqual({ unit: 'PIXELS', value: -0.96 });
  expect(letterSpacingOf('0px')).toEqual({ unit: 'PIXELS', value: 0 });
  expect(letterSpacingOf('0.02em')).toEqual({ unit: 'PERCENT', value: 2 });
  // Unitless zero is still zero; anything else is not guessed at.
  expect(letterSpacingOf(0)).toEqual({ unit: 'PIXELS', value: 0 });
  expect(letterSpacingOf('1rem')).toBeUndefined();
  expect(letterSpacingOf('wide')).toBeUndefined();
});

test('a line height is px when the model gives px, a percentage when it gives a multiplier', () => {
  expect(lineHeightOf('68px')).toEqual({ unit: 'PIXELS', value: 68 });
  expect(lineHeightOf('19.43px')).toEqual({ unit: 'PIXELS', value: 19.43 });
  expect(lineHeightOf(1.5)).toEqual({ unit: 'PERCENT', value: 150 });
  expect(lineHeightOf(1.2143)).toEqual({ unit: 'PERCENT', value: 121.43 });
  // Units it can't place are not guessed at.
  expect(lineHeightOf('1.5rem')).toBeUndefined();
  expect(lineHeightOf('normal')).toBeUndefined();
});

test('binding loads every face the bound family and weight can resolve to', () => {
  const available: Record<string, string[]> = {
    'Open Sans': openSans,
    Lora: ['Regular', 'Medium', 'Bold'],
    Fraunces: ['Book', 'Black'],
  };
  const faces = facesToLoad({
    // The plain family first, then every family the bound variable takes in any mode.
    families: ['Lora', 'Open Sans', 'Fraunces', 'Not Installed'],
    weights: [500, 700, 900, 0],
    keepStyle: 'Medium',
    stylesOf: (family) => available[family] ?? [],
  });
  // Each installed family, at each weight, by its own style names — plus the plain style
  // name wherever the family has it (a bound family keeps the style until weight resolves).
  expect(faces).toContainEqual({ family: 'Open Sans', style: 'Medium' });
  expect(faces).toContainEqual({ family: 'Open Sans', style: 'Bold' });
  expect(faces).toContainEqual({ family: 'Fraunces', style: 'Black' });
  expect(faces).toContainEqual({ family: 'Lora', style: 'Medium' });
  // A family that isn't installed has nothing to load; duplicates are dropped.
  expect(faces.some((f) => f.family === 'Not Installed')).toBe(false);
  expect(new Set(faces.map((f) => `${f.family}/${f.style}`)).size).toBe(
    faces.length,
  );
});
