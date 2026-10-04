// Water Extractor counts (#1024): the figures (public/preferences/extraction.ts), the owner's two
// options with the clocks adding up to exactly the Water needed, the shards and the MW, and the
// advice for the Water no byproduct covers (public/app/recycle.ts), on the planner's own plans.
// Numbers are written as in en-US.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { num } from '../public/app/format.ts';
import {
  EXTRACTOR_MIN_RATE,
  EXTRACTOR_RATE_STEP,
  WATER_EXTRACTOR,
  extractorClocks,
  extractorMW,
  extractorOption,
  extractorShards,
  settableRate,
  waterExtractors,
} from '../public/preferences.ts';
import {
  adviceSentence,
  adviceText,
  extractorAdvice,
  lineAdvice,
  recycleModel,
} from '../public/app/recycle.ts';
import { defaultFactoryGroups } from '../public/state/factory-groups.ts';
import { calculate } from '../planner.ts';
import type { AdviceWords } from '../public/app/recycle.ts';
import type { CalcRow } from '../public/types/index.ts';

const toLocale = Number.prototype.toLocaleString;
Number.prototype.toLocaleString = function (
  this: number,
  _locale?: unknown,
  options?: Intl.NumberFormatOptions,
) {
  return toLocale.call(this, 'en-US', options);
};

type ExtractorOption = NonNullable<ReturnType<typeof waterExtractors>>['plain'];

const close = (actual: number, expected: number, epsilon = 1e-9, message?: string) =>
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${message ?? ''} ${actual} is not within ${epsilon} of ${expected}`,
  );
// An option's runs as "2 at 100 + 1 at 15.03".
const runs = (option: ExtractorOption | undefined) =>
  option?.runs.map(run => `${run.count} at ${run.clock}`).join(' + ');
const options = (rate: number) => {
  const both = waterExtractors(rate);
  return both && [runs(both.plain), runs(both.sharded)];
};

test('the Water Extractor figures match the game data and the wiki', () => {
  assert.deepEqual(WATER_EXTRACTOR, {
    rate: 120,
    mw: 20,
    exponent: 1.321929,
    minClock: 1,
    maxClock: 250,
  });
  assert.equal(EXTRACTOR_MIN_RATE, 1.2);
  close(EXTRACTOR_RATE_STEP, 0.012);
  // The wiki's table of clock against power, to its one decimal.
  const table: [number, number][] = [
    [25, 3.2],
    [50, 8],
    [75, 13.7],
    [100, 20],
    [150, 34.2],
    [200, 50],
    [250, 67.2],
  ];
  for (const [clock, mw] of table) close(Math.round(extractorMW(clock) * 10) / 10, mw);
  // The exponent is log2 2.5, as the game data rounds it.
  close(WATER_EXTRACTOR.exponent, Math.log2(2.5), 1e-6);
});

test('Power Shards per clock band: none up to 100%, then one per 50% started', () => {
  const bands: [number, number][] = [
    [1, 0],
    [15.03, 0],
    [100, 0],
    [100.01, 1],
    [150, 1],
    [150.01, 2],
    [200, 2],
    [200.01, 3],
    [250, 3],
  ];
  for (const [clock, shards] of bands) assert.equal(extractorShards(clock), shards, `${clock}%`);
});

test("the owner's examples: whole extractors, the last one underclocked, at the in-game clock", () => {
  const water = waterExtractors(258.04)!;
  assert.equal(runs(water.plain), '2 at 100 + 1 at 15.03');
  assert.equal(water.plain.extractors, 3);
  assert.equal(water.plain.shards, 0);
  close(water.plain.mw, 40 + extractorMW(15.03));
  assert.equal(num(water.plain.mw), '41.63');
  assert.equal(runs(water.sharded), '1 at 215.03');
  assert.equal(water.sharded.extractors, 1);
  assert.equal(water.sharded.shards, 3);
  assert.equal(num(water.sharded.mw), '55.03');
  const more = waterExtractors(700)!;
  assert.equal(runs(more.sharded), '2 at 250 + 1 at 83.33');
  assert.equal(more.sharded.shards, 6, 'three for each full one, none for the last');
  close(more.sharded.mw, 2 * extractorMW(250) + extractorMW(83.33));
  assert.equal(runs(more.plain), '5 at 100 + 1 at 83.33');
});

test('exact multiples of 120 and 300 need no underclocked extractor', () => {
  assert.deepEqual(options(120), ['1 at 100', '1 at 100']);
  assert.deepEqual(options(240), ['2 at 100', '1 at 200']);
  assert.deepEqual(options(300), ['2 at 100 + 1 at 50', '1 at 250']);
  assert.deepEqual(options(600), ['5 at 100', '2 at 250']);
  assert.deepEqual(options(1200), ['10 at 100', '4 at 250']);
  assert.equal(waterExtractors(600)!.sharded.shards, 6);
  assert.equal(waterExtractors(240)!.sharded.shards, 2, 'one at 200% takes two');
});

test('just above and just below a whole extractor: never rounded up to a whole one', () => {
  assert.deepEqual(options(119.99), ['1 at 99.99', '1 at 99.99']);
  assert.deepEqual(options(121.2), ['1 at 100 + 1 at 1', '1 at 101']);
  assert.deepEqual(options(299.988), ['2 at 100 + 1 at 49.99', '1 at 249.99']);
  assert.deepEqual(options(301.2), ['2 at 100 + 1 at 51', '1 at 250 + 1 at 1']);
  // Less than one written step (0.012 m³/min) over a whole extractor is that extractor alone.
  assert.deepEqual(options(120.01), ['1 at 100', '1 at 100']);
  assert.deepEqual(options(240 + 1e-9), ['2 at 100', '1 at 200']);
  assert.deepEqual(options(240 - 1e-9), ['2 at 100', '1 at 200']);
});

test("a remainder below the game's 1% minimum takes it from the extractor before it", () => {
  // 0.5 m³/min over two at 100% is 0.42%, which the game cannot set.
  assert.deepEqual(options(240.5), ['1 at 100 + 1 at 99.41 + 1 at 1', '1 at 200.41']);
  assert.deepEqual(options(300.5), ['2 at 100 + 1 at 50.41', '1 at 249.41 + 1 at 1']);
  assert.equal(waterExtractors(300.5)!.sharded.shards, 3, 'the 1% one needs none');
});

test('tiny rates and none', () => {
  assert.deepEqual(options(1.2), ['1 at 1', '1 at 1']);
  assert.deepEqual(options(7.49), ['1 at 6.24', '1 at 6.24']);
  assert.equal(waterExtractors(1.19), null, 'below what one extractor gives at 1%');
  assert.equal(waterExtractors(0.004), null);
  assert.equal(waterExtractors(0), null);
  assert.deepEqual(extractorClocks(0, 100), []);
  assert.equal(extractorClocks(1, 100), null);
});

test('the clocks add up to exactly the Water needed, over many rates (property)', () => {
  // A fixed pseudo-random sequence, plus the edges around each whole extractor.
  let seed = 1024;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 3000;
  const rates = [
    ...Array.from({ length: 4000 }, random),
    ...[120, 240, 300, 600, 900].flatMap(edge => [
      edge - 0.6,
      edge - 1e-7,
      edge,
      edge + 1e-7,
      edge + 0.6,
    ]),
    1.2,
    1.21,
    2.5,
  ];
  for (const rate of rates) {
    if (rate < EXTRACTOR_MIN_RATE) continue;
    for (const full of [100, 250]) {
      const label = `${rate} m³/min at ${full}%`;
      // The exact clocks make exactly the rate, none above the full clock or below 1%.
      const exact = extractorClocks(rate, full)!;
      // Within the rounding noise a whole extractor absorbs (a millionth of a m³/min).
      close(exact.reduce((sum, clock) => sum + clock, 0) * 1.2, rate, 2e-6, label);
      for (const clock of exact) assert.ok(clock >= 1 - 1e-9 && clock <= full + 1e-9, label);
      // As written: whole steps of 0.01%, adding up to exactly the rate rounded down to a whole
      // number of steps, which is never more than the rate and less than one step under it.
      const option = extractorOption(rate, full)!;
      const clocks = option.runs.flatMap(run => Array<number>(run.count).fill(run.clock));
      for (const clock of clocks) close(clock * 100, Math.round(clock * 100), 1e-7, label);
      const made = clocks.reduce((sum, clock) => sum + clock, 0) * 1.2;
      close(made, option.rate, 1e-7, label);
      close(option.rate, settableRate(rate), 1e-12, label);
      assert.ok(option.rate <= rate + 1e-7, `${label}: never more than needed`);
      assert.ok(rate - option.rate < EXTRACTOR_RATE_STEP + 1e-9, label);
      // As few extractors as the full clock allows, all but the last one or two at it.
      assert.equal(option.extractors, Math.ceil(option.rate / ((120 * full) / 100) - 1e-9), label);
      assert.equal(clocks.length, option.extractors, label);
      const slower = clocks.filter(clock => clock < full);
      assert.ok(slower.length <= 2, label);
      if (slower.length === 2) assert.equal(clocks.at(-1), 1, `${label}: the split ends at 1%`);
      assert.equal(
        option.shards,
        clocks.reduce((sum, clock) => sum + extractorShards(clock), 0),
        label,
      );
      close(
        option.mw,
        clocks.reduce((sum, clock) => sum + extractorMW(clock), 0),
        1e-9,
        label,
      );
    }
  }
});

test('the extractor advice: both options with extractors, shards and MW; one when they agree', () => {
  const plain = (text: string) => text.replace(/ /g, ' ');
  assert.equal(
    plain(extractorAdvice(258.04)),
    'Water Extractors at 100%: 2 at 100% + 1 at 15.03% (3 extractors, 41.63 MW). Or up to 250% with Power Shards: 1 at 215.03% (1 extractor, 3 Power Shards, 55.03 MW).',
  );
  assert.equal(
    plain(extractorAdvice(700)),
    'Water Extractors at 100%: 5 at 100% + 1 at 83.33% (6 extractors, 115.72 MW). Or up to 250% with Power Shards: 2 at 250% + 1 at 83.33% (3 extractors, 6 Power Shards, 150.03 MW).',
  );
  assert.equal(
    plain(extractorAdvice(121.2)),
    'Water Extractors at 100%: 1 at 100% + 1 at 1% (2 extractors, 20.05 MW). Or up to 250% with Power Shards: 1 at 101% (1 extractor, 1 Power Shard, 20.26 MW).',
  );
  assert.equal(
    plain(extractorAdvice(7.49)),
    'Water Extractors: 1 at 6.24% (0.51 MW); no Power Shards needed.',
  );
  assert.equal(
    plain(extractorAdvice(120)),
    'Water Extractors: 1 at 100% (20 MW); no Power Shards needed.',
  );
  assert.equal(
    plain(extractorAdvice(0.5)),
    "That is less than one Water Extractor gives at its lowest clock (1%, 1.2 m³/min): take it from another Water line's extractors.",
  );
  // GW above 1,000 MW, as the pages write power.
  assert.match(extractorAdvice(12000), /\(100 extractors, 2 GW\)/);
});

// --- On the planner's plans ---

const items: Record<string, { fluid: boolean }> = JSON.parse(
  fs.readFileSync(new URL('../recipes.json', import.meta.url), 'utf8'),
).items;
const fluid = (item: string) => !!items[item]?.fluid;
const words: AdviceWords = {
  name: row => row.name,
  fluid,
  itemRate: (item, rate) => num(rate) + (fluid(item) ? ' m³/min' : '/min'),
};
const plainText = (text: string) => text.replace(/ /g, ' ');
const alternates = calculate({ phase: '3', recipes: 'all' });
const standard = calculate({ phase: '2' });
type Plan = typeof alternates;
const rowNamed = (plan: Plan, phase: '2' | '4' | '5', name: string): CalcRow => {
  const row = plan.stages[phase].rows!.find(candidate => candidate.name === name);
  assert.ok(row, `${name} in Phase ${phase}`);
  return row;
};
// A line's Water paragraph in a plan's phase, with the default factory groups.
const waterOf = (plan: Plan, phase: '2' | '4' | '5', name: string) => {
  const model = recycleModel(plan.stages[phase], defaultFactoryGroups(plan));
  return lineAdvice(rowNamed(plan, phase, name), model, words).find(
    line => line.kind === 'input' && line.item === 'Water',
  );
};

test('only the Water no byproduct covers is extracted, and counted in extractors', () => {
  // Alumina Solution takes 381.81 m³/min, of which byproducts cover 116.27 + 7.5.
  const solution = waterOf(alternates, '4', 'Alumina Solution')!;
  assert.match(plainText(adviceSentence(solution)), /; extract the other 258\.04 m³\.$/);
  assert.equal(
    plainText(solution.extractors!),
    'Water Extractors at 100%: 2 at 100% + 1 at 15.03% (3 extractors, 41.63 MW). Or up to 250% with Power Shards: 1 at 215.03% (1 extractor, 3 Power Shards, 55.03 MW).',
  );
  assert.notEqual(solution.extractors, extractorAdvice(381.81), 'not the whole input');
  // Its own byproduct covers most of Distilled Silica's (a milestone recipe, named without
  // "Alternate: " since #1044).
  const distilled = waterOf(alternates, '4', 'Distilled Silica')!;
  assert.equal(
    plainText(distilled.extractors!),
    'Water Extractors: 1 at 6.24% (0.51 MW); no Power Shards needed.',
  );
  // Phase 5's Alumina Solution needs two shard-boosted extractors.
  assert.match(
    plainText(waterOf(alternates, '5', 'Alumina Solution')!.extractors!),
    /Or up to 250% with Power Shards: 1 at 250% \+ 1 at 239\.42% \(2 extractors, 6 Power Shards, [\d.]+ MW\)\.$/,
  );
});

test('a line fully covered by byproducts gets no extractors', () => {
  const cooling = waterOf(alternates, '4', 'Cooling System')!;
  assert.equal(plainText(adviceSentence(cooling)), 'All of it from the byproduct of Battery.');
  assert.equal(cooling.extractors, undefined);
});

test('Water no byproduct covers is extracted in full, coal generators included', () => {
  const concrete = waterOf(alternates, '4', 'Alternate: Wet Concrete')!;
  assert.equal(
    plainText(adviceText([concrete])),
    'Water 253.75 m³/min. No byproduct covers it: extract all of it. Water Extractors at 100%: 2 at 100% + 1 at 11.46% (3 extractors, 41.14 MW). Or up to 250% with Power Shards: 1 at 211.46% (1 extractor, 3 Power Shards, 53.82 MW).',
  );
  const coal = waterOf(standard, '2', 'Coal power')!;
  assert.equal(
    plainText(adviceText([coal])),
    'Water 139.36 m³/min. No byproduct covers it: extract all of it. Water Extractors at 100%: 1 at 100% + 1 at 16.13% (2 extractors, 21.79 MW). Or up to 250% with Power Shards: 1 at 116.13% (1 extractor, 1 Power Shard, 24.37 MW).',
  );
  // A line taking no Water gets no Water paragraph.
  assert.equal(waterOf(alternates, '4', 'Aluminum Scrap'), undefined);
});
