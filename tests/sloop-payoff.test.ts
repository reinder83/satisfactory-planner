// Where one somersloop pays off most (#1215, public/app/sloop-payoff.ts): what one amplified
// machine saves on each line that could take somersloops, at the plan's own rates, best first by
// raw resources saved per somersloop. Presentation only: nothing is solved or stored.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sloopPayoffs,
  sloopUpstream,
  takesSloops,
  type SloopStage,
} from '../public/app/sloop-payoff.ts';
import { AMPLIFY_SLOTS as PLANNER_SLOTS } from '../planner.ts';
import { AMPLIFY_SLOTS } from '../public/somersloops.ts';
import type { CalcRow, StoredSettings } from '../public/types/index.ts';

// A production line as the planner stores it, at `equivalent` machines at 100%.
function line(
  id: string,
  machine: string,
  power: number,
  equivalent: number,
  inputs: Record<string, number>,
  outputs: Record<string, number>,
  extra: Partial<CalcRow> = {},
): CalcRow {
  const machines = Math.ceil(equivalent - 1e-9);
  return {
    id,
    name: id,
    phase: 1,
    machine,
    power,
    inputs,
    outputs,
    equivalent,
    machines,
    lastClock: (equivalent - machines + 1) * 100,
    peakMW: machines * power,
    generationMW: 0,
    ...extra,
  };
}

// A small Phase 3 plan: 120 Iron Ore/min (extraction 0.1 MW per ore) into 4 Smelters, whose
// Iron Ingot feeds 2 Iron Plate and 4 Iron Rod Constructors, and a Packager (no somersloop slots)
// filling Water into 60 Empty Canisters/min that no line here makes (existing production, say).
const stage = (): SloopStage => ({
  feasible: true,
  rows: [
    line('Iron Ingot', 'Smelter', 4, 4, { 'Iron Ore': 120 }, { 'Iron Ingot': 120 }),
    line('Iron Plate', 'Constructor', 4, 2, { 'Iron Ingot': 60 }, { 'Iron Plate': 40 }),
    line('Iron Rod', 'Constructor', 4, 4, { 'Iron Ingot': 60 }, { 'Iron Rod': 60 }),
    line(
      'Packaged Water',
      'Packager',
      10,
      1,
      { Water: 60, 'Empty Canister': 60 },
      { 'Packaged Water': 60 },
    ),
  ],
  raw: { 'Iron Ore': 120, Water: 60 },
  grid: { extraction: { 'Iron Ore': 12, Water: 6 } },
});
const settings = { powerFactor: 1 } as StoredSettings;
// Rounded to 9 decimals, so the exact figures compare without floating-point dust.
const round = (value: number) => Math.round(value * 1e9) / 1e9;
const summary = (entries: ReturnType<typeof sloopPayoffs>) =>
  entries.map(entry => ({
    id: entry.id,
    sloops: entry.sloops,
    machinesSaved: entry.machinesSaved,
    raw: entry.raw.map(([item, rate]) => [item, round(rate)]),
    rawSaved: round(entry.rawSaved),
    perSloop: round(entry.perSloop),
    netMW: round(entry.netMW),
  }));

test('one amplified machine saves a machine, its input upstream and the power behind it', () => {
  // Iron Ingot costs 1 ore and 16/120 MW of Smelters + 0.1 MW of extraction per unit.
  // Iron Plate: 2 machines at 30 ingots each; one amplified does both: −1 Constructor, −30 ingots
  // = −30 ore and −7 MW upstream, +8 MW for the amplified Constructor (4 × 4 − 2 × 4): +1 MW.
  // Iron Ingot: −30 ore, −3 MW of extraction, +8 MW: +5 MW, and ranks after Iron Plate's tie.
  // Iron Rod: 15 ingots a machine: −15 ore, −3.5 MW, +8 MW: +4.5 MW.
  assert.deepEqual(summary(sloopPayoffs(stage(), '3', settings)), [
    {
      id: 'Iron Plate',
      sloops: 1,
      machinesSaved: 1,
      raw: [['Iron Ore', 30]],
      rawSaved: 30,
      perSloop: 30,
      netMW: 1,
    },
    {
      id: 'Iron Ingot',
      sloops: 1,
      machinesSaved: 1,
      raw: [['Iron Ore', 30]],
      rawSaved: 30,
      perSloop: 30,
      netMW: 5,
    },
    {
      id: 'Iron Rod',
      sloops: 1,
      machinesSaved: 1,
      raw: [['Iron Ore', 15]],
      rawSaved: 15,
      perSloop: 15,
      netMW: 4.5,
    },
  ]);
});

test('a machine with more slots counts per somersloop, and a line under 2 machines saves none', () => {
  const plan = stage();
  // One Assembler (2 slots) at 100%: amplified, it runs at 50% for the same output, so it takes
  // half its input: 15 plates (1.5 ore and 0.55 MW each) and 30 screws (none made here).
  plan.rows!.push(
    line(
      'Reinforced Iron Plate',
      'Assembler',
      15,
      1,
      { 'Iron Plate': 30, Screw: 60 },
      { 'Reinforced Iron Plate': 5 },
    ),
  );
  const entry = summary(sloopPayoffs(plan, '4', settings)).find(
    e => e.id === 'Reinforced Iron Plate',
  );
  assert.deepEqual(entry, {
    id: 'Reinforced Iron Plate',
    sloops: 2,
    machinesSaved: 0,
    raw: [['Iron Ore', 22.5]],
    rawSaved: 22.5,
    perSloop: 11.25,
    // 4 × 15 MW at 50% against 15 MW: +15 MW, less 8.25 MW upstream.
    netMW: 6.75,
  });
});

test('only lines the planner would amplify are ranked, and only from Phase 3', () => {
  const plan = stage();
  const ingot = plan.rows![0]!;
  plan.rows!.push(
    // An amplified twin's machines are full; a factory's own line and a storage-only line are
    // never amplified; a generator draws no power.
    { ...ingot, id: 'amp:Iron Ingot', amplified: true, slots: 1, sloops: 2, equivalent: 2 },
    { ...ingot, id: 'Iron Ingot:fg-abcd', onSite: { group: 'fg-abcd', recipe: 'Iron Ingot' } },
    { ...ingot, id: 'Iron Ingot:stock', stock: { recipe: 'Iron Ingot' } },
    line('power-coal', 'Coal Generator', -75, 2, { Coal: 30 }, {}),
  );
  const ranked = sloopPayoffs(plan, '5', settings).map(entry => entry.id);
  assert.deepEqual(ranked, ['Iron Plate', 'Iron Ingot', 'Iron Rod']);
  assert.equal(takesSloops(plan.rows![3]!), false, 'a Packager has no somersloop slots');
  // Before the Production Amplifier research's phase, and for a plan that does not fit, nothing.
  assert.deepEqual(sloopPayoffs(stage(), '2', settings), []);
  assert.deepEqual(sloopPayoffs({ ...stage(), feasible: false }, '3', settings), []);
  assert.deepEqual(sloopPayoffs(undefined, '3', settings), []);
});

test('an amplified twin shares the ingots, and an item no line makes costs nothing', () => {
  const plan = stage();
  // Half the ingots from an amplified twin, which makes them at half the input per unit: the
  // marginal ingot now costs (1 + 0.5) / 2 ore.
  plan.rows!.push(
    line(
      'amp:Iron Ingot',
      'Smelter',
      16,
      2,
      { 'Iron Ore': 60 },
      { 'Iron Ingot': 120 },
      {
        amplified: true,
        slots: 1,
        sloops: 2,
      },
    ),
  );
  plan.raw!['Iron Ore'] = 180;
  plan.grid!.extraction['Iron Ore'] = 18;
  const costs = sloopUpstream(plan, settings);
  assert.equal(round(costs.get('Iron Ingot')!.raw.get('Iron Ore')!), 0.75);
  assert.equal(costs.get('Empty Canister'), undefined, 'an item no line makes costs nothing');
  assert.equal(round(costs.get('Water')!.mw), 0.1);
});

test('a loop between two lines settles at the plan’s rates', () => {
  // Plastic from Rubber and Fuel, Rubber from Plastic and Fuel (the recycled pair): each unit of
  // either takes half a unit of the other and half a unit of Fuel, so one unit of Fuel each.
  const plan: SloopStage = {
    feasible: true,
    rows: [
      line('Recycled Plastic', 'Refinery', 30, 1, { Rubber: 30, Fuel: 30 }, { Plastic: 60 }),
      line('Recycled Rubber', 'Refinery', 30, 1, { Plastic: 30, Fuel: 30 }, { Rubber: 60 }),
    ],
    raw: { Fuel: 60 },
    grid: { extraction: { Fuel: 0 } },
  };
  const costs = sloopUpstream(plan, settings);
  assert.equal(round(costs.get('Plastic')!.raw.get('Fuel')!), 1);
  assert.equal(round(costs.get('Rubber')!.raw.get('Fuel')!), 1);
  // 0.5 MW per unit of each line's own: 30 MW / 60, and the other's half: 1 MW each.
  assert.equal(round(costs.get('Plastic')!.mw), 1);
});

test('the slot table is the planner’s', () => {
  assert.equal(PLANNER_SLOTS, AMPLIFY_SLOTS);
  assert.equal(AMPLIFY_SLOTS.Manufacturer, 4);
});
