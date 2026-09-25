import { expect, test } from 'vitest';
import { fontStyleFor, weightOf } from '../src/font';

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
