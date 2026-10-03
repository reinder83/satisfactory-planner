import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { formatNumber, phaseSteps } from '../public/progression.ts';
import { calculate } from '../planner.ts';
import type { Progression, StoredCalculatedPlan } from '../public/types/index.ts';

// #772: formatNumber shares one Intl.NumberFormat instead of calling toLocaleString with
// options, which built a new formatter per call. The text must not change at all.
const old = (value: unknown) =>
  Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });

test('formatNumber matches toLocaleString with at most 2 decimals for every kind of value', () => {
  const values: unknown[] = [
    0,
    -0,
    1,
    -1,
    0.005,
    0.015,
    1.005,
    2.675,
    999.995,
    -0.001,
    0.1 + 0.2,
    1234567.891,
    -1234.5678,
    1e21,
    1e-7,
    Number.MAX_VALUE,
    Number.MIN_VALUE,
    NaN,
    Infinity,
    -Infinity,
    '12.345',
    '1e3',
    '',
    ' ',
    'abc',
    undefined,
    null,
    true,
    false,
    [],
    [5],
    {},
    10n,
  ];
  for (let i = 0; i < 2000; i++) values.push((Math.sin(i) * 10) ** (i % 9));
  for (const value of values) assert.equal(formatNumber(value), old(value), String(value));
});

test('phaseSteps text is byte-identical to the per-call toLocaleString version', async () => {
  // The module as it was before #772, loaded from a temporary copy. progression.ts imports
  // types only, so the copy runs on its own.
  const source = fs.readFileSync(new URL('../public/progression.ts', import.meta.url), 'utf8');
  const shared = /const numberFormat = [^\n]*\n(export const formatNumber = [^\n]*)\n/;
  assert.match(source, shared);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'number-format-'));
  try {
    const file = path.join(dir, 'progression-old.ts');
    fs.writeFileSync(
      file,
      source.replace(
        shared,
        'export const formatNumber = (value: unknown): string =>\n' +
          '  Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });\n',
      ),
    );
    const before = (await import(pathToFileURL(file).href)) as { phaseSteps: typeof phaseSteps };
    const data: Progression = JSON.parse(
      fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
    );
    const plans: Pick<StoredCalculatedPlan, 'settings' | 'stages' | 'guide'>[] = [
      calculate({}),
      calculate({ recipes: 'all' }),
      calculate({ phase: '1', recipes: 'all', goal: 'timed', hours: 10, multiplier: 5 }),
      JSON.parse(
        fs.readFileSync(
          new URL('./fixtures/calculated-plan-2026-09-12.json', import.meta.url),
          'utf8',
        ),
      ),
    ];
    let compared = 0;
    for (const plan of plans)
      for (const phase of ['1', '2', '3', '4', '5', 'post']) {
        const steps = phaseSteps(plan, { checks: {} }, data, phase);
        assert.deepEqual(steps, before.phaseSteps(plan, { checks: {} }, data, phase));
        compared += steps.length;
      }
    assert.ok(compared > 100);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
