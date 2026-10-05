// Pooled fluid advice (#1067, public/app/recycle.ts): a fluid that several lines of a factory make
// as a byproduct and several take is one pool, given once with its total in and each part out,
// rounded so the parts add up, with each part's share as a simple fraction, rather than every
// maker's share of every user (0.01 m³ a pair). On a small hand-made stage: three lines make
// Heavy Oil Residue, three take it, one of them hardly any.
import test from 'node:test';
import assert from 'node:assert/strict';
import { num } from '../public/app/format.ts';
import { adviceSentence, adviceText, lineAdvice, recycleModel } from '../public/app/recycle.ts';
import type { AdviceWords } from '../public/app/recycle.ts';
import type { CalcRow, FactoryGroups, StoredStage } from '../public/types/index.ts';

// The numbers read as in en-US whatever this machine's locale is.
const toLocale = Number.prototype.toLocaleString;
Number.prototype.toLocaleString = function (
  this: number,
  _locale?: unknown,
  options?: Intl.NumberFormatOptions,
) {
  return toLocale.call(this, 'en-US', options);
};

const FLUIDS = new Set(['Heavy Oil Residue', 'Crude Oil', 'Water']);
const words: AdviceWords = {
  name: row => row.name,
  fluid: item => FLUIDS.has(item),
  itemRate: (item, rate) => num(rate) + (FLUIDS.has(item) ? ' m³/min' : '/min'),
};
const row = (id: string, inputs: CalcRow['inputs'], outputs: CalcRow['outputs']): CalcRow => ({
  id,
  name: id,
  phase: 3,
  machine: 'Refinery',
  power: 30,
  inputs,
  outputs,
  equivalent: 1,
  machines: 1,
  lastClock: 100,
  peakMW: 30,
  generationMW: 0,
});
const HOR = 'Heavy Oil Residue';
const rows = [
  row('Plastic', { 'Crude Oil': 90 }, { Plastic: 60, [HOR]: 30 }),
  row('Rubber', { 'Crude Oil': 90 }, { Rubber: 60, [HOR]: 60 }),
  row('Polymer Resin', { 'Crude Oil': 60 }, { 'Polymer Resin': 130, [HOR]: 20 }),
  row('Petroleum Coke', { [HOR]: 60 }, { 'Petroleum Coke': 72 }),
  row('Residual Fuel', { [HOR]: 49.95 }, { Fuel: 33.3 }),
  row('Coated Cable', { [HOR]: 0.05, Wire: 5 }, { Cable: 5 }),
];
const stage: StoredStage = { feasible: true, rows, raw: { 'Crude Oil': 240, Wire: 5 } };
const ungrouped: FactoryGroups = { groups: [], assignments: {} };
// A rate's no-break space (as the pages write it) as a plain one.
const plain = (text: string) => text.replace(/ /g, ' ');
const adviceOf = (name: string, groups = ungrouped) =>
  lineAdvice(rows.find(candidate => candidate.id === name)!, recycleModel(stage, groups), words)
    .filter(line => line.item === HOR)
    .map(line => [line.kind, line.lead, plain(adviceSentence(line))]);

const POOL =
  '110 m³ in from Rubber, Plastic and Polymer Resin; out 60 m³ to Petroleum Coke (6/11), 50 m³ to Residual Fuel (5/11) and < 1 m³ to Coated Cable (< 1/16).';

test('a fluid several lines make and several take is one pool, given once (#1067)', () => {
  // Each maker's sentence had every user's part of its own Heavy Oil Residue, down to 0.01 m³.
  assert.deepEqual(adviceOf('Plastic'), [
    [
      'byproduct',
      'Heavy Oil Residue 30 m³/min',
      'Pool it with the others: ' + POOL.replace('Plastic', 'this line'),
    ],
  ]);
  assert.deepEqual(adviceOf('Rubber'), [
    [
      'byproduct',
      'Heavy Oil Residue 60 m³/min',
      'Pool it with the others: ' + POOL.replace('Rubber', 'this line'),
    ],
  ]);
  // Each user takes it from the same pool.
  assert.deepEqual(adviceOf('Coated Cable'), [
    [
      'input',
      'Heavy Oil Residue 0.05 m³/min',
      'From one pool: ' + POOL.replace('to Coated Cable', 'to this line'),
    ],
  ]);
  for (const name of ['Plastic', 'Rubber', 'Polymer Resin', 'Petroleum Coke', 'Residual Fuel'])
    for (const [, , sentence] of adviceOf(name))
      assert.ok(!/0\.0\d m³/.test(sentence!), `${name}: no hundredths of a m³: ${sentence}`);
});

test('a pool’s parts out add up to its total in, at the precision it is written to', () => {
  const sentence = adviceOf('Plastic')[0]![2]!;
  const total = Number(/: ([\d,.]+) m³ in from/.exec(sentence)![1]!.replace(/,/g, ''));
  const parts = [...sentence.matchAll(/(?:out |, | and )(<\s)?([\d,.]+) m³ to/g)].map(match =>
    match[1] ? 0 : Number(match[2]!.replace(/,/g, '')),
  );
  assert.equal(parts.length, 3);
  assert.equal(
    parts.reduce((sum, part) => sum + part, 0),
    total,
  );
});

test('a pool reaches lines in other factories by name, and the build plan writes it after its lead', () => {
  const groups: FactoryGroups = {
    groups: [
      { id: 'fg-oil', name: 'Oil' },
      { id: 'fg-wire', name: 'Wire works' },
    ],
    assignments: {
      ...Object.fromEntries(rows.map(r => [r.id, [{ group: 'fg-oil', rate: null }]])),
      'Coated Cable': [{ group: 'fg-wire', rate: null }],
    },
  };
  const [byproduct] = adviceOf('Plastic', groups);
  assert.equal(
    byproduct![2],
    'Pool it with the others: ' +
      POOL.replace('Plastic', 'this line').replace(
        'Coated Cable (< 1/16)',
        'Coated Cable in Wire works (< 1/16)',
      ),
  );
  const plastic = rows[0]!;
  assert.match(
    plain(adviceText(lineAdvice(plastic, recycleModel(stage, groups), words))),
    /^Byproduct Heavy Oil Residue 30 m³\/min: pool it with the others: 110 m³ in from /,
  );
});

test('one line sending a fluid, or a solid, keeps the line-by-line advice', () => {
  // Rubber alone makes it now: its sentence names each user's part, as before #1067.
  const single: StoredStage = {
    ...stage,
    rows: rows.map(r =>
      r.id === 'Plastic' || r.id === 'Polymer Resin'
        ? { ...r, outputs: { [Object.keys(r.outputs)[0]!]: 60 } }
        : r.id === 'Rubber'
          ? { ...r, outputs: { Rubber: 60, [HOR]: 110 } }
          : r,
    ),
  };
  const rubber = single.rows!.find(r => r.id === 'Rubber')!;
  const [line] = lineAdvice(rubber, recycleModel(single, ungrouped), words);
  assert.equal(
    plain(adviceSentence(line!)),
    'Send 60 m³ to Petroleum Coke, 49.95 m³ to Residual Fuel and 0.05 m³ to Coated Cable.',
  );
});
