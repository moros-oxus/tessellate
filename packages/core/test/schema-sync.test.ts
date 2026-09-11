import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { SUPPORTED_MODEL_VERSIONS } from '../src/model';

/**
 * The model schema is vendored (the upstream package's exports map does not expose it as a
 * subpath). This pins the copies together: when `@vertekum/ext-export-figma` ships a new
 * schema, this fails instead of validation silently skewing — and the intake's version list
 * is pinned to the vendored copy, so it can't lag a re-vendor.
 */
const vendored = readFileSync(
  join(import.meta.dirname, '../src/model.schema.json'),
  'utf8',
);

test('the vendored model schema matches the upstream package', () => {
  const require = createRequire(import.meta.url);
  const upstream = readFileSync(
    join(require.resolve('@vertekum/ext-export-figma'), '../model.schema.json'),
    'utf8',
  );
  expect(JSON.parse(vendored)).toEqual(JSON.parse(upstream));
});

test('intake supports exactly the vendored schema version', () => {
  const schema = JSON.parse(vendored);
  expect(SUPPORTED_MODEL_VERSIONS).toEqual([schema.properties.version.const]);
});
