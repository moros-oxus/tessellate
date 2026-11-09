import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FigmaModel } from '@vertekum/ext-export-figma';
import { expect, test } from 'vitest';
import { readModel } from '../src/model';
import { styleForm } from '../src/style-form';
import { DEFAULT_POLICY } from '../src/types';

const FIXTURE = readFileSync(
  join(import.meta.dirname, 'fixtures/typography.model.json'),
  'utf8',
);

async function model(): Promise<FigmaModel> {
  const read = await readModel(FIXTURE);
  if ('issues' in read) throw new Error(JSON.stringify(read.issues));
  return read.model;
}

function styleOf(m: FigmaModel, name: string) {
  const style = m.styles.find((s) => s.name === `typography/${name}`);
  if (!style) throw new Error(`no style ${name}`);
  return style;
}

test('family, size, weight and px letter-spacing bind, addressed by collection', async () => {
  const m = await model();
  const form = styleForm(styleOf(m, 'heading'), m, undefined);
  expect(form.bindings).toEqual([
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
  // Plain values are always carried — the host applies them, then binds over them.
  expect(form.properties).toBe(styleOf(m, 'heading').properties);
});

test('a multiplier line height never binds: a bound line height is read as pixels', async () => {
  const m = await model();
  const form = styleForm(styleOf(m, 'heading'), m, undefined);
  expect(form.bindings.some((b) => b.property === 'line-height')).toBe(false);
  expect(form.notes).toEqual([
    "style 'typography/heading': line-height not bound to 'font/leading/snug' — a host reads a bound line height as pixels; the model gives a multiplier (1.25)",
  ]);
});

test('a px line height binds to its FLOAT variable', async () => {
  const m = await model();
  const form = styleForm(styleOf(m, 'title'), m, undefined);
  expect(form.bindings).toContainEqual({
    property: 'line-height',
    collection: 'core',
    variable: 'font/leading/title',
  });
  expect(form.notes).toEqual([]);
});

test('a px line height with a variable of another type is refused', async () => {
  const m = await model();
  const form = styleForm(styleOf(m, 'subtitle'), m, undefined);
  expect(form.bindings.some((b) => b.property === 'line-height')).toBe(false);
  expect(form.notes).toEqual([
    "style 'typography/subtitle': line-height not bound to 'font/family/sans' — it needs a FLOAT variable, not STRING",
  ]);
});

test('a variable the model lacks, an em letter-spacing, a type mismatch: plain values, with notes', async () => {
  const m = await model();
  const display = styleForm(styleOf(m, 'display'), m, undefined);
  expect(display.bindings.map((b) => b.property)).toEqual([
    'font-family',
    'font-size',
    'font-weight',
  ]);
  expect(display.notes).toEqual([
    "style 'typography/display': letter-spacing not bound to 'font/tracking/wide' — the model has no such variable",
  ]);

  const caption = styleForm(styleOf(m, 'caption'), m, undefined);
  expect(caption.bindings.map((b) => b.property)).toEqual(['font-size']);
  expect(caption.notes).toEqual([
    "style 'typography/caption': font-family not bound to 'font/size/200' — it needs a STRING variable, not FLOAT",
    "style 'typography/caption': letter-spacing not bound to 'font/tracking/tight' — only a px letter spacing binds (the value is 0.05em)",
  ]);
});

test('a style without references has no bindings and no notes', async () => {
  const m = await model();
  expect(styleForm(styleOf(m, 'body'), m, undefined)).toMatchObject({
    bindings: [],
    notes: [],
  });
});

test('a collection split for the seat binds nothing: no part follows a mode', async () => {
  const m = await model();
  const form = styleForm(styleOf(m, 'heading'), m, 1, DEFAULT_POLICY);
  expect(form.bindings).toEqual([]);
  expect(form.notes).toContain(
    "style 'typography/heading': not bound to 'core' variables — the collection is split for this seat",
  );
  // One note per collection, not one per property.
  expect(form.notes.filter((n) => n.includes('split')).length).toBe(1);
});

test('the stamp form carries the bindings, so a binding change re-applies', async () => {
  const m = await model();
  const style = styleOf(m, 'heading');
  const whole = styleForm(style, m, undefined);
  const split = styleForm(style, m, 1);
  expect(whole.applied).not.toBe(split.applied);
  expect(JSON.parse(whole.applied).bindings).toEqual(whole.bindings);
});
