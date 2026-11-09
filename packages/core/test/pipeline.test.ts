import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { apply } from '../src/apply';
import { diff } from '../src/diff';
import { FakeHost } from '../src/fake-host';
import { readModel } from '../src/model';
import { plan } from '../src/plan';
import { stable } from '../src/types';

const FIXTURE = readFileSync(
  join(import.meta.dirname, 'fixtures/showcase.model.json'),
  'utf8',
);

async function model() {
  const read = await readModel(FIXTURE);
  if ('issues' in read) throw new Error(JSON.stringify(read.issues));
  return read.model;
}

test('intake validates and pins the version', async () => {
  const preDraft = await readModel('{"version": 1}');
  expect('issues' in preDraft && preDraft.issues[0]?.message).toMatch(
    /version 1 predates versioned drafts — re-export/,
  );
  const unsupported = await readModel('{"version": "draft.03"}');
  expect('issues' in unsupported && unsupported.issues[0]?.message).toMatch(
    /version "draft\.03" is not supported \(supported: draft\.06\)/,
  );
  // draft.05 line heights are multipliers; draft.06 gives px — a draft.05 model is re-exported.
  const previous = await readModel('{"version": "draft.05"}');
  expect('issues' in previous && previous.issues[0]?.message).toMatch(
    /version "draft\.05" is not supported/,
  );
  const notJson = await readModel('nope');
  expect('issues' in notJson && notJson.issues[0]?.message).toMatch(/not JSON/);
  expect('model' in (await readModel(FIXTURE))).toBe(true);
});

test('empty host: everything is an add; apply then re-diff is a no-op', async () => {
  const m = await model();
  const host = new FakeHost();

  const first = diff(m, await host.snapshot());
  expect(first.counts.add).toBeGreaterThan(0);
  expect(first.counts.update + first.counts.drift).toBe(0);

  const p = plan(m, first, host.modeCapacity());
  const report = await apply(p, host);
  expect(report.failed).toEqual([]);

  // Idempotence — the demo that sells the tool.
  const second = diff(m, await host.snapshot());
  expect(second.counts.add).toBe(0);
  expect(second.counts.update).toBe(0);
  expect(second.counts.drift).toBe(0);
  const again = plan(m, second, host.modeCapacity());
  expect(again.ops).toEqual([]);
});

test('aliases become real bindings, in order, cross-collection', async () => {
  const m = await model();
  const host = new FakeHost();
  await apply(plan(m, diff(m, await host.snapshot()), undefined), host);

  const base = host.collections.get('base');
  const text = base?.variables.find((v) => v.name === 'color/text');
  // color/text aliases color/accent, which lives in the color-mode COLLECTION.
  expect(text?.alias?.default).toBe('color/accent');
});

test('a host edit is DRIFT, named as such, and applying overwrites it', async () => {
  const m = await model();
  const host = new FakeHost();
  await apply(plan(m, diff(m, await host.snapshot()), undefined), host);

  host.edit('density', 'space/gap', 'compact', 999);
  const drifted = diff(m, await host.snapshot());
  expect(drifted.counts.drift).toBe(1);
  const entry = drifted.collections
    .find((c) => c.name === 'density')
    ?.variables.find((v) => v.name === 'space/gap');
  expect(entry?.state).toBe('drift');
  expect(entry?.details.join(' ')).toMatch(/edited in the host/);

  await apply(plan(m, drifted, undefined), host);
  const settled = diff(m, await host.snapshot());
  expect(settled.counts.drift).toBe(0);
});

test('seat-aware modes: over-capacity collections split, and the plan says so', async () => {
  const m = await model();
  const host = new FakeHost({ modeCapacity: 1 });

  const p = plan(m, diff(m, await host.snapshot(), 1), 1);
  expect(p.notes.join(' ')).toMatch(
    /split into 'color-mode\/light', 'color-mode\/dark'/,
  );
  const report = await apply(p, host);
  expect(report.failed).toEqual([]);
  expect(host.collections.has('color-mode/dark')).toBe(true);
  expect(host.collections.get('color-mode/dark')?.modes).toEqual(['dark']);

  // Idempotent in split form: diff looks for the split siblings the plan wrote, so the
  // re-diff is clean and there is nothing left to apply.
  const again = diff(m, await host.snapshot(), 1);
  expect(again.counts.add + again.counts.update + again.counts.drift).toBe(0);
  expect(plan(m, again, 1).ops).toEqual([]);

  // …and a host edit inside one split part is drift, named by part.
  host.edit('color-mode/dark', 'color/accent', 'dark', { r: 1, g: 1, b: 1 });
  const drifted = diff(m, await host.snapshot(), 1);
  const accent = drifted.collections
    .find((c) => c.name === 'color-mode')
    ?.variables.find((v) => v.name === 'color/accent');
  expect(accent?.state).toBe('drift');
  expect(accent?.details.join(' ')).toMatch(/^color-mode\/dark: /);
});

test('text styles apply with their bindings; the policy states its deletes', async () => {
  const m = await model();
  const host = new FakeHost();
  const p = plan(m, diff(m, await host.snapshot()), undefined);
  expect(p.notes[0]).toBe('deletes: retired entities (policy)');
  await apply(p, host);
  const style = host.styles.get('typography/body');
  expect(style?.properties.some((prop) => prop.property === 'font-size')).toBe(
    true,
  );
});

test('host float precision (32-bit colour round-trip) is not drift', async () => {
  const m = await model();
  const host = new FakeHost();
  await apply(plan(m, diff(m, await host.snapshot()), undefined), host);

  // Simulate what Figma does: written 64-bit floats read back at 32-bit precision.
  const fround = (value: unknown): unknown =>
    typeof value === 'number'
      ? Math.fround(value)
      : value && typeof value === 'object'
        ? Array.isArray(value)
          ? value.map(fround)
          : Object.fromEntries(
              Object.entries(value).map(([k, v]) => [k, fround(v)]),
            )
        : value;
  for (const collection of host.collections.values()) {
    for (const variable of collection.variables) {
      variable.valuesByMode = fround(variable.valuesByMode) as Record<
        string,
        unknown
      >;
    }
  }

  const after = diff(m, await host.snapshot());
  expect(after.counts.drift).toBe(0);
  expect(after.counts.update).toBe(0);
});

test('a lossy host read of style properties is not a pending change', async () => {
  const m = await model();
  const host = new FakeHost();
  await apply(plan(m, diff(m, await host.snapshot()), undefined), host);

  // Figma reads back only a subset of a text style's properties — equality is the stamp's.
  const style = host.styles.get('typography/body');
  if (!style) throw new Error('style missing');
  style.properties = style.properties.slice(0, 2);

  const after = diff(m, await host.snapshot());
  expect(after.styles[0]?.state).toBe('unchanged');
  const planned = plan(m, after, undefined);
  expect(planned.ops).toEqual([]);
});

const TYPOGRAPHY = readFileSync(
  join(import.meta.dirname, 'fixtures/typography.model.json'),
  'utf8',
);

async function typography() {
  const read = await readModel(TYPOGRAPHY);
  if ('issues' in read) throw new Error(JSON.stringify(read.issues));
  return read.model;
}

test('text styles bind to the model variables; re-diff is a no-op', async () => {
  const m = await typography();
  const host = new FakeHost();
  const p = plan(m, diff(m, await host.snapshot()), undefined);
  expect(p.notes).toContain(
    "style 'typography/heading': line-height not bound to 'font/leading/snug' — a host reads a bound line height as pixels; the model gives a multiplier (1.25)",
  );
  const report = await apply(p, host);
  expect(report.failed).toEqual([]);
  // A line height the model gives in px binds, like every other member.
  expect(host.styles.get('typography/title')?.bindings).toContainEqual({
    property: 'line-height',
    collection: 'core',
    variable: 'font/leading/title',
  });
  expect(host.styles.get('typography/heading')?.bindings).toEqual([
    {
      property: 'font-family',
      collection: 'core',
      variable: 'font/family/sans',
    },
    { property: 'font-size', collection: 'core', variable: 'font/size/200' },
    {
      property: 'font-weight',
      collection: 'core',
      variable: 'font/weight/bold',
    },
    {
      property: 'letter-spacing',
      collection: 'core',
      variable: 'font/tracking/tight',
    },
  ]);
  expect(host.styles.get('typography/body')?.bindings).toEqual([]);

  const after = diff(m, await host.snapshot());
  expect(after.styles.every((s) => s.state === 'unchanged')).toBe(true);
  expect(plan(m, after, undefined).ops).toEqual([]);
});

test('a style stamped before bindings existed re-applies once', async () => {
  const m = await typography();
  const host = new FakeHost();
  await apply(plan(m, diff(m, await host.snapshot()), undefined), host);

  // What the previous plugin stamped: the properties only, nothing bound.
  for (const style of host.styles.values()) {
    if (!style.stamp) continue;
    style.stamp = {
      ...style.stamp,
      applied: stable({ values: { default: style.properties }, alias: {} }),
    };
    style.bindings = [];
  }

  const stale = diff(m, await host.snapshot());
  expect(stale.styles.every((s) => s.state === 'update')).toBe(true);
  await apply(plan(m, stale, undefined), host);
  expect(host.styles.get('typography/heading')?.bindings?.length).toBe(4);
  const settled = diff(m, await host.snapshot());
  expect(settled.styles.every((s) => s.state === 'unchanged')).toBe(true);
});

test('a seat that splits the collection binds nothing, says so, and re-applies when it changes', async () => {
  const m = await typography();
  const host = new FakeHost();
  const p = plan(m, diff(m, await host.snapshot(), 1), 1);
  expect(p.notes).toContain(
    "style 'typography/heading': not bound to 'core' variables — the collection is split for this seat",
  );
  await apply(p, host);
  expect(host.styles.get('typography/heading')?.bindings).toEqual([]);

  // The whole-collection seat binds — the stamp carried the bindings, so the styles update.
  const roomier = diff(m, await host.snapshot());
  expect(
    roomier.styles.find((s) => s.name === 'typography/heading')?.state,
  ).toBe('update');
  await apply(plan(m, roomier, undefined), host);
  expect(host.styles.get('typography/heading')?.bindings?.length).toBe(4);
});
