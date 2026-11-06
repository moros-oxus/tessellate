import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FigmaModel } from '@vertekum/ext-export-figma';
import { expect, test } from 'vitest';
import { apply } from '../src/apply';
import { diff } from '../src/diff';
import { FakeHost } from '../src/fake-host';
import { readModel } from '../src/model';
import { plan } from '../src/plan';
import { retired } from '../src/retire';

const FIXTURE = readFileSync(
  join(import.meta.dirname, 'fixtures/typography.model.json'),
  'utf8',
);

async function model(): Promise<FigmaModel> {
  const read = await readModel(FIXTURE);
  if ('issues' in read) throw new Error(JSON.stringify(read.issues));
  return read.model;
}

/** A host that applied `m` — every entity stamped, as the plugin leaves a file. */
async function appliedHost(m: FigmaModel, capacity?: number) {
  const host = new FakeHost();
  await apply(
    plan(m, diff(m, await host.snapshot(), capacity), capacity),
    host,
  );
  return host;
}

const without = (m: FigmaModel, variable: string): FigmaModel => ({
  ...m,
  collections: m.collections.map((c) => ({
    ...c,
    variables: c.variables.filter((v) => v.name !== variable),
  })),
});

test('a stamped variable the model no longer holds is retired; a foreign one never is', async () => {
  const before = await model();
  const host = await appliedHost(before);
  // A designer's own variable, in tessellate's collection: no stamp, never touched.
  host.collections.get('core')?.variables.push({
    name: 'mine/hand-made',
    type: 'FLOAT',
    valuesByMode: { acme: 1, globex: 1 },
  });
  const after = without(before, 'font/tracking/tight');
  const found = retired(after, await host.snapshot(), undefined);
  expect(found.variables).toEqual([
    { collection: 'core', name: 'font/tracking/tight' },
  ]);
  expect(found.collections).toEqual([]); // core still holds variables
});

test('a collection whose every variable retires goes with them', async () => {
  const before = await model();
  const host = await appliedHost(before);
  const after: FigmaModel = {
    ...before,
    collections: before.collections.filter((c) => c.name !== 'NOT_AVAILABLE'),
  };
  const found = retired(after, await host.snapshot(), undefined);
  expect(found.variables).toEqual([
    { collection: 'NOT_AVAILABLE', name: 'NOT_AVAILABLE/FLOAT' },
  ]);
  expect(found.collections).toEqual(['NOT_AVAILABLE']);
});

test('a seat change is not a retirement: the other layout is kept, and said so', async () => {
  const m = await model();
  const split = await appliedHost(m, 1); // core/acme, core/globex
  const whole = retired(m, await split.snapshot(), undefined);
  expect(whole.variables).toEqual([]);
  expect(whole.notes).toContain(
    "collection 'core/acme' is 'core' split for another seat — kept",
  );
  const unsplit = await appliedHost(m);
  const parts = retired(m, await unsplit.snapshot(), 1);
  expect(parts.variables).toEqual([]);
  expect(parts.notes).toContain(
    "collection 'core' is 'core' whole, for another seat — kept",
  );
});

test('a per-composition style that became shared is retired, its usages bound for the shared one', async () => {
  const m = await model();
  const heading = m.styles.find((s) => s.name === 'typography/heading');
  if (!heading) throw new Error('fixture');
  // Before: the exporter split the style per composition.
  const before: FigmaModel = {
    ...m,
    styles: [
      ...m.styles.filter((s) => s !== heading),
      { ...heading, name: 'acme/typography/heading' },
      { ...heading, name: 'globex/typography/heading' },
    ],
  };
  const host = await appliedHost(before);
  const found = retired(m, await host.snapshot(), undefined);
  expect(found.styles).toEqual([
    { name: 'acme/typography/heading', replacement: 'typography/heading' },
    { name: 'globex/typography/heading', replacement: 'typography/heading' },
  ]);
});

test('a shared style that became split has no single replacement — retired, with a note', async () => {
  const m = await model();
  const heading = m.styles.find((s) => s.name === 'typography/heading');
  if (!heading) throw new Error('fixture');
  const host = await appliedHost(m);
  const after: FigmaModel = {
    ...m,
    styles: [
      ...m.styles.filter((s) => s !== heading),
      { ...heading, name: 'acme/typography/heading' },
      { ...heading, name: 'globex/typography/heading' },
    ],
  };
  const found = retired(after, await host.snapshot(), undefined);
  expect(found.styles).toEqual([{ name: 'typography/heading' }]);
  expect(found.notes).toContain(
    "style 'typography/heading' is now one per composition — no single replacement; layers using it keep their values, unlinked",
  );
});
