import { expect, test } from 'vitest';
import { deprecationIn, withDeprecation } from '../src/deprecation';

test('a deprecation is the description’s first line; the designer’s text stays below it', () => {
  expect(withDeprecation('', 'Use {color.new}')).toBe(
    'Deprecated: Use {color.new}',
  );
  expect(withDeprecation('Brand red.', '')).toBe('Deprecated.\nBrand red.');
  // Re-applying replaces the line it wrote; it never stacks.
  const once = withDeprecation('Brand red.', 'Going in 2.0');
  expect(withDeprecation(once, 'Use {color.new}')).toBe(
    'Deprecated: Use {color.new}\nBrand red.',
  );
  // Un-deprecated: the line goes, the designer's text stays.
  expect(withDeprecation(once, undefined)).toBe('Brand red.');
  expect(withDeprecation('Brand red.', undefined)).toBe('Brand red.');
});

test('the line reads back as the model’s deprecation', () => {
  expect(deprecationIn(withDeprecation('x', 'Use {a}'))).toBe('Use {a}');
  expect(deprecationIn(withDeprecation('', ''))).toBe('');
  expect(deprecationIn('Brand red.')).toBeUndefined();
  expect(deprecationIn(undefined)).toBeUndefined();
});
