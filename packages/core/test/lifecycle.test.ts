import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FigmaModel } from '@vertekum/ext-export-figma';
import { expect, test } from 'vitest';
import { apply } from '../src/apply';
import { diff } from '../src/diff';
import { FakeHost } from '../src/fake-host';
import { readModel } from '../src/model';
import { plan } from '../src/plan';

const FIXTURE = readFileSync(
  join(import.meta.dirname, 'fixtures/typography.model.json'),
  'utf8',
);

async function model(): Promise<FigmaModel> {
  const read = await readModel(FIXTURE);
  if ('issues' in read) throw new Error(JSON.stringify(read.issues));
  return read.model;
}

async function drop(m: FigmaModel, host: FakeHost) {
  const diffed = diff(m, await host.snapshot());
  const planned = plan(m, diffed, undefined);
  return { diffed, planned, report: await apply(planned, host) };
}

const without = (m: FigmaModel, variable: string): FigmaModel => ({
  ...m,
  collections: m.collections.map((c) => ({
    ...c,
    variables: c.variables.filter((v) => v.name !== variable),
  })),
});

/** The style-split shape: `typography/heading` emitted once per composition. */
const perComposition = (m: FigmaModel): FigmaModel => {
  const heading = m.styles.find((s) => s.name === 'typography/heading');
  if (!heading) throw new Error('fixture');
  return {
    ...m,
    styles: [
      ...m.styles.filter((s) => s !== heading),
      { ...heading, name: 'acme/typography/heading' },
      { ...heading, name: 'globex/typography/heading' },
    ],
  };
};

test('a token removed from the source is removed from the file — after everything else', async () => {
  const before = await model();
  const host = new FakeHost();
  await drop(before, host);

  const after = without(before, 'font/tracking/tight');
  const { diffed, planned, report } = await drop(after, host);
  expect(diffed.counts.remove).toBe(1);
  expect(
    diffed.collections
      .find((c) => c.name === 'core')
      ?.variables.find((v) => v.name === 'font/tracking/tight')?.state,
  ).toBe('remove');
  expect(planned.notes[0]).toBe('deletes: retired entities (policy)');
  expect(planned.ops.at(-1)).toEqual({
    op: 'removeVariable',
    collection: 'core',
    name: 'font/tracking/tight',
  });
  expect(report.removed).toEqual(['core/font/tracking/tight']);
  expect(
    host.collections
      .get('core')
      ?.variables.some((v) => v.name === 'font/tracking/tight'),
  ).toBe(false);

  const settled = diff(after, await host.snapshot());
  expect(settled.counts.remove).toBe(0);
  expect(plan(after, settled, undefined).ops).toEqual([]);
});

test('a style split per composition, now shared: usages move to the shared style, then the copies go', async () => {
  const m = await model();
  const host = new FakeHost();
  await drop(perComposition(m), host);
  host.useStyle('acme/typography/heading', 'title');
  host.useStyle('globex/typography/heading', 'subtitle');

  const { diffed, planned, report } = await drop(m, host);
  expect(
    diffed.styles
      .filter((s) => s.state === 'remove')
      .map((s) => [s.name, s.replacement]),
  ).toEqual([
    ['acme/typography/heading', 'typography/heading'],
    ['globex/typography/heading', 'typography/heading'],
  ]);
  const ops = planned.ops.map((o) => o.op);
  // The replacement is written before anything moves onto it; usages move before the removal.
  expect(ops.indexOf('migrateStyleUsages')).toBeGreaterThan(
    ops.lastIndexOf('upsertTextStyle'),
  );
  expect(ops.indexOf('removeTextStyle')).toBeGreaterThan(
    ops.lastIndexOf('migrateStyleUsages'),
  );
  expect(report.migrated).toEqual([
    { from: 'acme/typography/heading', to: 'typography/heading', layers: 1 },
    { from: 'globex/typography/heading', to: 'typography/heading', layers: 1 },
  ]);
  expect(host.layerStyle('title')).toBe('typography/heading');
  expect(host.styles.has('acme/typography/heading')).toBe(false);
  expect(host.styles.has('typography/heading')).toBe(true);
});

test('a collection emptied of tessellate’s variables goes with them', async () => {
  const before = await model();
  const host = new FakeHost();
  await drop(before, host);
  const after: FigmaModel = {
    ...before,
    collections: before.collections.filter((c) => c.name !== 'NOT_AVAILABLE'),
  };
  // The sentinel's last user goes too, or the alias would dangle.
  const core = after.collections.find((c) => c.name === 'core');
  if (core) {
    core.variables = core.variables.filter(
      (v) => v.name !== 'font/weight/black',
    );
  }
  const { report } = await drop(after, host);
  expect(host.collections.has('NOT_AVAILABLE')).toBe(false);
  expect(report.removed).toContain('collection NOT_AVAILABLE');
});

test('policy never: retired entities are listed and kept', async () => {
  const before = await model();
  const host = new FakeHost();
  await drop(before, host);
  const after = without(before, 'font/tracking/tight');
  const diffed = diff(after, await host.snapshot());
  const planned = plan(after, diffed, undefined, {
    deletes: 'never',
    modeFallback: 'split-collections',
  });
  expect(planned.ops.some((o) => o.op === 'removeVariable')).toBe(false);
  expect(planned.notes).toContain(
    'deletes: never (policy) — 1 retired entity kept',
  );
});

test('a deprecated variable is marked in its description, kept, and unmarked when lifted', async () => {
  const before = await model();
  const host = new FakeHost();
  await drop(before, host);
  const variable = host.collections
    .get('core')
    ?.variables.find((v) => v.name === 'font/size/200');
  if (!variable) throw new Error('missing');
  variable.description = 'Body copy size.'; // the designer's own words

  const marked = structuredClone(before);
  const size = marked.collections[0]?.variables.find(
    (v) => v.name === 'font/size/200',
  );
  if (size) size.deprecated = 'Use {font.size.300}';
  const first = await drop(marked, host);
  expect(
    first.diffed.collections[0]?.variables.find(
      (v) => v.name === 'font/size/200',
    )?.details,
  ).toContain('marked deprecated');
  expect(first.report.deprecated).toEqual(['core/font/size/200']);
  expect(variable.description).toBe(
    'Deprecated: Use {font.size.300}\nBody copy size.',
  );
  // Kept, and settled.
  expect(diff(marked, await host.snapshot()).counts.update).toBe(0);

  const lifted = await drop(before, host);
  expect(
    lifted.diffed.collections[0]?.variables.find(
      (v) => v.name === 'font/size/200',
    )?.details,
  ).toContain('deprecation lifted');
  expect(variable.description).toBe('Body copy size.');
});

test('a deprecated style re-applies and is marked', async () => {
  const before = await model();
  const host = new FakeHost();
  await drop(before, host);
  const marked = structuredClone(before);
  const heading = marked.styles.find((s) => s.name === 'typography/heading');
  if (heading) heading.deprecated = '';
  const { diffed, report } = await drop(marked, host);
  expect(
    diffed.styles.find((s) => s.name === 'typography/heading')?.state,
  ).toBe('update');
  expect(report.deprecated).toEqual(['style typography/heading']);
  expect(host.styles.get('typography/heading')?.description).toBe(
    'Deprecated.',
  );
});
