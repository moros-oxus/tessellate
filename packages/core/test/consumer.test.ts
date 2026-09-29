import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FigmaModel } from '@vertekum/ext-export-figma';
import { expect, test } from 'vitest';
import { apply } from '../src/apply';
import { bindingFor, mismatch, parseBinding } from '../src/binding';
import { compositionReadout } from '../src/compositions';
import { diff, hostDrift } from '../src/diff';
import { FakeHost } from '../src/fake-host';
import { readModel } from '../src/model';
import { plan } from '../src/plan';

/**
 * The consumer half of several-compositions-in-one-model: the file's binding, status without
 * a model, the composition read-out, and seat splitting of merged collections. `brands` is
 * two compositions (default, alt) merged — `color-mode` differs and carries composition
 * modes; `base` and `density` resolve identically and stay as they are.
 */
async function fixture(name: string): Promise<FigmaModel> {
  const raw = readFileSync(
    join(import.meta.dirname, `fixtures/${name}.model.json`),
    'utf8',
  );
  const read = await readModel(raw);
  if ('issues' in read) throw new Error(JSON.stringify(read.issues));
  return read.model;
}

async function applied(model: FigmaModel, host: FakeHost): Promise<void> {
  const capacity = host.modeCapacity();
  const report = await apply(
    plan(model, diff(model, await host.snapshot(), capacity), capacity),
    host,
  );
  expect(report.failed).toEqual([]);
}

test('a binding names the artifact, its compositions, version and time', async () => {
  const brands = await fixture('brands');
  const binding = bindingFor(brands, new Date('2026-09-23T12:00:00Z'));
  expect(binding).toEqual({
    target: 'figma-brands',
    compositions: ['default', 'alt'],
    modelVersion: 'draft.04',
    appliedAt: '2026-09-23T12:00:00.000Z',
    label: 'figma-brands · default + alt',
  });

  // Stored serialized at document level; unreadable storage is no binding, not a crash.
  const host = new FakeHost();
  expect(await host.readBinding()).toBeUndefined();
  await host.writeBinding(binding);
  expect(await host.readBinding()).toEqual(binding);
  expect(parseBinding('{not json')).toBeUndefined();
  expect(parseBinding('{"target":"x"}')).toBeUndefined();
});

test('a different artifact is a mismatch, named on both sides', async () => {
  const brands = await fixture('brands');
  const native = await fixture('showcase');
  const bound = bindingFor(brands);

  expect(mismatch(undefined, native)).toBeUndefined();
  expect(mismatch(bound, brands)).toBeUndefined();
  expect(mismatch(bound, native)).toBe(
    "this file tracks 'figma-brands'; the dropped model is 'figma-native'",
  );

  // A model built outside a target: its compositions are its identity.
  const untargeted: FigmaModel = {
    ...brands,
    source: { ...brands.source, target: undefined },
  };
  expect(mismatch(bindingFor(untargeted), untargeted)).toBeUndefined();
  expect(mismatch(bound, untargeted)).toMatch(/'default \+ alt'/);
});

test('status needs no model: drift is read from the stamps alone', async () => {
  const brands = await fixture('brands');
  const host = new FakeHost();
  await applied(brands, host);
  expect(hostDrift(await host.snapshot())).toEqual({ count: 0, variables: [] });

  host.edit('color-mode', 'color/accent', 'alt/dark', { r: 1, g: 0, b: 0 });
  expect(hostDrift(await host.snapshot())).toEqual({
    count: 1,
    variables: ['color-mode/color/accent'],
  });
});

test('a mode the model left empty and the host filled is neither a change nor drift', async () => {
  const brands = await fixture('brands');
  // A variable one composition lacks: no value in that composition's modes.
  const accent = brands.collections
    .find((c) => c.name === 'color-mode')
    ?.variables.find((v) => v.name === 'color/accent');
  if (!accent) throw new Error('fixture lost color/accent');
  delete accent.valuesByMode['alt/dark'];

  const host = new FakeHost();
  await applied(brands, host);
  // Figma holds a value in EVERY mode — simulate the fill.
  host.edit('color-mode', 'color/accent', 'alt/dark', { r: 0, g: 0, b: 0 });

  const after = diff(brands, await host.snapshot());
  expect(after.counts.drift + after.counts.update).toBe(0);
  expect(hostDrift(await host.snapshot()).count).toBe(0);
});

test('the read-out groups modes by composition from modeSources', async () => {
  const brands = await fixture('brands');
  expect(compositionReadout(brands)).toEqual({
    compositions: ['default', 'alt'],
    // base and density resolve identically — shared, so not listed.
    collections: [
      {
        name: 'color-mode',
        modes: {
          default: ['default/light', 'default/dark'],
          alt: ['alt/light', 'alt/dark'],
        },
      },
    ],
  });
  expect(compositionReadout(await fixture('showcase')).collections).toEqual([]);
});

test('capacity 1: the merged collection splits per composition/context, and says so', async () => {
  const brands = await fixture('brands');
  const host = new FakeHost({ modeCapacity: 1 });
  const p = plan(brands, diff(brands, await host.snapshot(), 1), 1);
  expect(p.notes).toContain(
    "collection 'color-mode' exceeds the seat's 1 mode(s) — split into " +
      "'color-mode/default/light', 'color-mode/default/dark', 'color-mode/alt/light', " +
      "'color-mode/alt/dark' (modes of compositions default, alt)",
  );
  // An unmerged collection over capacity names no compositions.
  expect(p.notes.find((n) => n.includes("'density'"))).not.toMatch(
    /compositions/,
  );

  const report = await apply(p, host);
  expect(report.failed).toEqual([]);
  expect(host.collections.get('color-mode/alt/dark')?.modes).toEqual([
    'alt/dark',
  ]);
  // Each split part is stamped with what IT holds — so a split file reads as clean…
  expect(hostDrift(await host.snapshot()).count).toBe(0);
  // …and re-dropping the same model at the same capacity has nothing left to apply (QA 17).
  const again = diff(brands, await host.snapshot(), 1);
  expect(again.counts).toEqual({ add: 0, update: 0, drift: 0, unchanged: 5 });
  expect(plan(brands, again, 1).ops).toEqual([]);
});

test('capacity 4: the merged collection fits whole', async () => {
  const brands = await fixture('brands');
  const host = new FakeHost({ modeCapacity: 4 });
  const p = plan(brands, diff(brands, await host.snapshot(), 4), 4);
  expect(p.notes.join(' ')).not.toMatch(/exceeds/);
  await applied(brands, host);
  expect(host.collections.get('color-mode')?.modes).toEqual([
    'default/light',
    'default/dark',
    'alt/light',
    'alt/dark',
  ]);
  const again = diff(brands, await host.snapshot(), 4);
  expect(plan(brands, again, 4).ops).toEqual([]);
});

test('a "not available" sentinel applies like any alias, and re-diffs clean', async () => {
  // The reference model: acme's berry ramp has no globex counterpart, so globex's modes alias
  // the NOT_AVAILABLE/COLOR sentinel, which lives in its own collection.
  const reference = await fixture('reference');
  expect(reference.source.notAvailable?.variables.COLOR).toBe(
    'NOT_AVAILABLE/COLOR',
  );
  const host = new FakeHost();
  await applied(reference, host);

  const berry = host.collections
    .get('palette')
    ?.variables.find((v) => v.name === 'color/berry/500');
  expect(berry?.alias).toEqual({ globex: 'NOT_AVAILABLE/COLOR' });
  expect(host.collections.get('NOT_AVAILABLE')?.variables[0]?.name).toBe(
    'NOT_AVAILABLE/COLOR',
  );

  const again = diff(reference, await host.snapshot());
  expect(again.counts.add + again.counts.update + again.counts.drift).toBe(0);
  expect(plan(reference, again, undefined).ops).toEqual([]);
});
