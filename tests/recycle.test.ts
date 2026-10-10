// Byproduct recycling advice (#1022, public/app/recycle.ts): where each byproduct of a line goes
// and where an input a byproduct covers comes from, read from the same books and links as the
// Logistics page and a group's flow page, in the wording the owner approved. Numbers are the
// planner's own (a new profile with every alternate recipe, from Phase 3, default factory groups),
// written as in en-US.
// The numbers read as in en-US whatever this machine's locale is.
import './helpers/en-us-numbers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { num } from '../public/app/format.ts';
import {
  adviceSentence,
  adviceText,
  byproductAdvice,
  byproductCount,
  byproductsOf,
  feeds,
  inputAdvice,
  lineAdvice,
  recycleModel,
} from '../public/app/recycle.ts';
import { defaultFactoryGroups } from '../public/state/factory-groups.ts';
import { calculate } from '../planner.ts';
import { adaRemarks } from '../public/ada.ts';
import type { AdviceWords } from '../public/app/recycle.ts';
import type { CalcRow, FactoryGroups, StoredStage } from '../public/types/index.ts';

const items: Record<string, { fluid: boolean }> = JSON.parse(
  fs.readFileSync(new URL('../recipes.json', import.meta.url), 'utf8'),
).items;
const fluid = (item: string) => !!items[item]?.fluid;
// As the pages word them (itemRate in flow.ts), with a plain space for the no-break one.
const words: AdviceWords = {
  name: row => row.name,
  fluid,
  itemRate: (item, rate) => num(rate) + (fluid(item) ? ' m³/min' : '/min'),
};
const plain = (text: string) => text.replace(/ /g, ' ');

const plan = calculate({ phase: '3', recipes: 'all' });
const groups = defaultFactoryGroups(plan);
const models = new Map<string, ReturnType<typeof recycleModel>>();
const modelOf = (phase: '3' | '4' | '5') =>
  models.get(phase) ?? models.set(phase, recycleModel(plan.stages[phase], groups)).get(phase)!;
const rowNamed = (phase: '3' | '4' | '5', name: string): CalcRow => {
  const row = plan.stages[phase].rows!.find(candidate => candidate.name === name);
  assert.ok(row, `${name} in Phase ${phase}`);
  return row;
};
// A line's advice as [kind, lead, sentence].
const adviceOf = (phase: '3' | '4' | '5', name: string) =>
  lineAdvice(rowNamed(phase, name), modelOf(phase), words).map(line => [
    line.kind,
    plain(line.lead),
    plain(adviceSentence(line)),
  ]);

test('a byproduct sent back to the line that feeds its maker is a loop', () => {
  const solution = rowNamed('4', 'Alumina Solution'),
    scrap = rowNamed('4', 'Aluminum Scrap'),
    ingot = rowNamed('4', 'Aluminum Ingot');
  assert.equal(feeds(solution, scrap), true, 'Alumina Solution feeds Aluminum Scrap');
  // Aluminum Scrap feeds Alumina Solution only the Water being recycled, which does not count.
  assert.equal(feeds(scrap, solution), true, 'by its Water');
  assert.equal(feeds(scrap, solution, 'Water'), false, 'not by anything but the Water');
  assert.equal(feeds(solution, scrap, 'Water'), true);
  assert.equal(feeds(solution, ingot), true, 'its Silica feeds Aluminum Ingot');
  assert.equal(feeds(solution, solution), false, 'a line is not its own loop');
  assert.equal(feeds(undefined, scrap), false);
  // A byproduct is an output after the first; a generator's waste is its first.
  assert.deepEqual(byproductsOf(solution), ['Silica']);
  assert.deepEqual(byproductsOf(ingot), []);
});

test('a byproduct all of which goes back to the line that feeds this one', () => {
  assert.deepEqual(adviceOf('4', 'Aluminum Scrap'), [
    [
      'byproduct',
      'Water 116.18 m³/min',
      'Send all of it back to Alumina Solution, which feeds this line.',
    ],
  ]);
});

test('a byproduct shared by several lines, some in another group, and an input it partly covers', () => {
  assert.deepEqual(adviceOf('4', 'Alumina Solution'), [
    [
      'byproduct',
      'Silica 105.99/min',
      'Send 88.78 to Aluminum Ingot, 10.21 to Alternate: Silicon Circuit Board in Electronics and 7 to Alternate: Silicon High-Speed Connector in Electronics.',
    ],
    [
      'input',
      'Water 381.55 m³/min',
      '116.18 m³ recycled from Aluminum Scrap, 7.5 m³ recycled from Battery in Industrial parts; extract the other 257.87 m³.',
    ],
  ]);
  assert.deepEqual(adviceOf('4', 'Rubber'), [
    [
      'byproduct',
      'Heavy Oil Residue 85.42 m³/min',
      'Send 53.58 m³ to Alternate: Diluted Fuel, 31.62 m³ to Petroleum Coke and 0.22 m³ to Alternate: Coated Cable in Copper & caterium.',
    ],
  ]);
});

test('a loop that crosses groups, and a comma after it when another destination follows', () => {
  assert.deepEqual(adviceOf('4', 'Battery'), [
    [
      'byproduct',
      'Water 16.5 m³/min',
      'Send 9 m³ to Cooling System and 7.5 m³ back to Alumina Solution in Aluminum campus, which feeds this line.',
    ],
  ]);
  assert.deepEqual(adviceOf('5', 'Battery'), [
    [
      'byproduct',
      'Water 16.88 m³/min',
      'Send 9.38 m³ back to Alumina Solution in Aluminum campus, which feeds this line, and 7.5 m³ to Cooling System.',
    ],
  ]);
});

test('a solid partly used is stored or sunk; one no line uses is stored or sent to the sink', () => {
  assert.deepEqual(adviceOf('3', 'Fuel'), [
    [
      'byproduct',
      'Polymer Resin 43/min',
      'Send 39.52 to Residual Plastic and store or sink the other 3.48.',
    ],
  ]);
  assert.deepEqual(adviceOf('4', 'Alternate: Nitro Rocket Fuel'), [
    [
      'byproduct',
      'Compacted Coal 11.85/min',
      'No line uses it: store it or send it to the AWESOME Sink.',
    ],
  ]);
});

test('a line that uses its own byproduct pipes it back into itself first', () => {
  // Distilled Silica is a milestone recipe, planned under its own name since #1044.
  assert.deepEqual(adviceOf('4', 'Distilled Silica'), [
    ['byproduct', 'Water 29.96 m³/min', 'Pipe all of it back into this line’s own Water input.'],
    [
      'input',
      'Dissolved Silica 44.93 m³/min',
      'All of it from the byproduct of Alternate: Quartz Purification.',
    ],
    [
      'input',
      'Water 37.44 m³/min',
      '29.96 m³ from this line’s own byproduct; extract the other 7.49 m³.',
    ],
  ]);
});

test('Dark Matter Residue in Phase 5 crosses groups to the trap, which names every source', () => {
  assert.deepEqual(adviceOf('5', 'AI Expansion Server'), [
    [
      'byproduct',
      'Dark Matter Residue 15 m³/min',
      'Send all of it to Alternate: Dark Matter Trap in Quantum & SAM.',
    ],
  ]);
  assert.deepEqual(adviceOf('5', 'Alternate: Dark Matter Trap'), [
    [
      'input',
      'Dark Matter Residue 86.5 m³/min',
      '40 m³ recycled from Superposition Oscillator, 16.5 m³ from Dark Matter Residue, 15 m³ from the byproduct of AI Expansion Server in Project assembly, 15 m³ from the byproduct of Neural-Quantum Processor.',
    ],
  ]);
});

test('a receiving line covered fully, in part, and a line with neither', () => {
  // Its Water, which no byproduct covers, has a paragraph of its own (#1024).
  assert.deepEqual(adviceOf('4', 'Alternate: Diluted Fuel'), [
    ['input', 'Heavy Oil Residue 53.58 m³/min', 'All of it from the byproduct of Rubber.'],
    ['input', 'Water 107.16 m³/min', 'No byproduct covers it: extract all of it.'],
  ]);
  assert.deepEqual(adviceOf('4', 'Alternate: Coated Cable'), [
    [
      'input',
      'Heavy Oil Residue 0.22 m³/min',
      'All of it from the byproduct of Rubber in Oil & fuel campus.',
    ],
  ]);
  assert.deepEqual(adviceOf('4', 'Alternate: Silicon Circuit Board'), [
    [
      'input',
      'Silica 70.18/min',
      '59.97 from Distilled Silica in Concrete & quartz, 10.21 from the byproduct of Alumina Solution in Aluminum campus.',
    ],
  ]);
  // Wet Concrete takes Water no byproduct covers: it is extracted, with the extractors (#1024).
  assert.deepEqual(adviceOf('4', 'Alternate: Wet Concrete'), [
    ['input', 'Water 253.75 m³/min', 'No byproduct covers it: extract all of it.'],
  ]);
  // A line with neither a byproduct nor an input a byproduct covers, nor Water, has none.
  assert.deepEqual(adviceOf('4', 'Alclad Aluminum Sheet'), []);
});

test('the advice reads the stage it is given, so each phase gets its own numbers', () => {
  assert.notDeepEqual(adviceOf('4', 'Aluminum Scrap'), adviceOf('5', 'Aluminum Scrap'));
  assert.match(adviceOf('5', 'Aluminum Scrap')[0]![1]!, /^Water 281.47 m³\/min$/);
});

test('without factory groups every line is in one place, and the advice names lines only', () => {
  const none = recycleModel(plan.stages['4'], { groups: [], assignments: {} });
  const row = rowNamed('4', 'Alumina Solution');
  const text = lineAdvice(row, none, words).map(adviceSentence).join(' ');
  assert.match(text, /Aluminum Ingot/);
  assert.doesNotMatch(text, / in [A-Z]|\(ungrouped\)/);
});

// A hand-made stage: a scrap line in group A whose water a solution line uses, a distiller that
// gives back more water than it takes, and a fuel line whose resin a plastic line uses in part.
const row = (id: string, inputs: CalcRow['inputs'], outputs: CalcRow['outputs']): CalcRow => ({
  id,
  name: id,
  phase: 1,
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
const stage: StoredStage = {
  feasible: true,
  rows: [
    row('scrap', { Ore: 10 }, { Scrap: 10, Water: 6 }),
    row('solution', { Water: 16 }, { Solution: 16 }),
    row('distill', { Water: 20 }, { Silica: 10, Water: 24 }),
    row('cool', { Water: 4 }, { Steam: 4 }),
    row('fuel', { Oil: 10 }, { Fuel: 10, Resin: 5 }),
    row('plastic', { Resin: 3 }, { Plastic: 3 }),
  ],
  raw: { Ore: 10, Water: 10, Oil: 10 },
  storage: { Resin: 1 },
  surplus: { Resin: 1 },
  delivery: {
    Scrap: { target: 100, rate: 10 },
    Solution: { target: 100, rate: 16 },
    Silica: { target: 100, rate: 10 },
    Steam: { target: 100, rate: 4 },
    Fuel: { target: 100, rate: 10 },
    Plastic: { target: 100, rate: 3 },
  },
};
const handGroups: FactoryGroups = {
  groups: [
    { id: 'fg-a', name: 'Group A' },
    { id: 'fg-b', name: 'Group B' },
  ],
  assignments: {
    scrap: [{ group: 'fg-a', rate: null }],
    distill: [{ group: 'fg-b', rate: null }],
    cool: [{ group: 'fg-b', rate: null }],
  },
};
const handModel = recycleModel(stage, handGroups);
const handAdvice = (id: string) =>
  lineAdvice(stage.rows!.find(candidate => candidate.id === id)!, handModel, words).map(line =>
    plain(adviceSentence(line)),
  );

test('a line in no group, seen from a group, is named as ungrouped, and the other way round', () => {
  assert.deepEqual(handAdvice('scrap'), ['Send all of it to solution (ungrouped).']);
  assert.deepEqual(handAdvice('solution'), [
    '6 m³ from the byproduct of scrap in Group A; extract the other 10 m³.',
  ]);
});

test('a line that gives back more than it takes pipes its own use back, then sends the rest', () => {
  assert.deepEqual(handAdvice('distill'), [
    'Pipe 20 m³ back into this line’s own Water input and 4 m³ to cool.',
    'All of it from this line’s own byproduct.',
  ]);
  assert.deepEqual(handAdvice('cool'), ['All of it from the byproduct of distill.']);
});

test('a solid stored and sunk in part is one instruction; a fluid never gets sink advice', () => {
  assert.deepEqual(handAdvice('fuel'), ['Send 3 to plastic and store or sink the other 2.']);
  // A fluid byproduct the books leave over (a hand-made stage; the planner balances fluids
  // exactly) is not sent to the sink.
  const leftover: StoredStage = {
    ...stage,
    rows: [
      row('scrap', { Ore: 10 }, { Scrap: 10, Water: 6 }),
      row('cool', { Water: 4 }, { Steam: 4 }),
    ],
    surplus: { Water: 2 },
  };
  const text = byproductAdvice(leftover.rows![0]!, recycleModel(leftover, handGroups), words).map(
    adviceSentence,
  );
  assert.deepEqual(text.map(plain), ['Send 4 m³ to cool in Group B.']);
});

test('the build plan writes the advice after the outputs, as text', () => {
  const scrap = rowNamed('4', 'Aluminum Scrap'),
    nitro = rowNamed('4', 'Alternate: Nitro Rocket Fuel'),
    diluted = rowNamed('4', 'Alternate: Diluted Fuel');
  assert.equal(
    plain(adviceText(lineAdvice(scrap, modelOf('4'), words))),
    'Byproduct Water 116.18 m³/min: send all of it back to Alumina Solution, which feeds this line.',
  );
  assert.equal(
    plain(adviceText(lineAdvice(nitro, modelOf('4'), words))),
    'Byproduct Compacted Coal 11.85/min. No line uses it: store it or send it to the AWESOME Sink.',
  );
  // Its extracted Water follows, with the Water Extractors for it (#1024).
  assert.equal(
    plain(adviceText(inputAdvice(diluted, modelOf('4'), words))),
    'Heavy Oil Residue 53.58 m³/min: all of it from the byproduct of Rubber. Water 107.16 m³/min. No byproduct covers it: extract all of it. Water Extractors: 1 at 89.3% (17.22 MW); no Power Shards needed.',
  );
  assert.equal(adviceText([]), '');
});

test('a phase counts its byproducts once per line and byproduct', () => {
  const count = (plan.stages['4'].rows || []).filter(
    candidate => byproductsOf(candidate).length,
  ).length;
  assert.ok(count > 5);
  assert.equal(byproductCount(plan.stages['4']), count);
  assert.equal(byproductCount({ feasible: false }), 0);
});

test("ADA's byproduct count, which includes a byproduct no line uses, says to route them, not recycle them", () => {
  // Nitro Rocket Fuel's Compacted Coal: no line uses it, and it still counts.
  const nitro = rowNamed('4', 'Alternate: Nitro Rocket Fuel');
  assert.equal(
    plain(adviceText(byproductAdvice(nitro, modelOf('4'), words))),
    'Byproduct Compacted Coal 11.85/min. No line uses it: store it or send it to the AWESOME Sink.',
  );
  const count = byproductCount(plan.stages['4']);
  assert.ok(count >= 1);
  const line = adaRemarks({ view: 'factories', phaseLabel: 'Phase 4', byproducts: count }).find(
    remark => remark.id === 'recycle-byproducts',
  )!;
  assert.match(line.text, new RegExp(`^${count} byproducts to route in Phase 4\. `));
  assert.doesNotMatch(line.text, /recycle/);
});

test('the rest of an input names extraction and existing supply when the item has both', () => {
  // A hand-made stage: the planner refuses existing supply of a raw resource, so its own plans
  // never have both.
  const both: StoredStage = {
    feasible: true,
    rows: [
      row('fuel', { Oil: 10 }, { Fuel: 10, Resin: 5 }),
      row('plastic', { Resin: 8 }, { Plastic: 8 }),
    ],
    raw: { Oil: 10, Resin: 2 },
    supplied: { Resin: 1 },
    delivery: { Fuel: { target: 100, rate: 10 }, Plastic: { target: 100, rate: 8 } },
  };
  const advice = (stage: StoredStage) =>
    inputAdvice(stage.rows![1]!, recycleModel(stage, { groups: [], assignments: {} }), words).map(
      line => plain(adviceSentence(line)),
    );
  assert.deepEqual(advice(both), [
    '5 from the byproduct of fuel; the other 3 from extraction and existing supply.',
  ]);
  // With only one of them, as before.
  assert.deepEqual(advice({ ...both, raw: { Oil: 10, Resin: 3 }, supplied: {} }), [
    '5 from the byproduct of fuel; extract the other 3.',
  ]);
  assert.deepEqual(advice({ ...both, raw: { Oil: 10 }, supplied: { Resin: 3 } }), [
    '5 from the byproduct of fuel; the other 3 from existing supply.',
  ]);
});
