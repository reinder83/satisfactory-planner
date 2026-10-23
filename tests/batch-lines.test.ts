// Batch tasks (#1211, batchLine in public/app/delivered.ts): a line that only makes a Space
// Elevator part fills a fixed total, so its step says how many to make, how long that takes at the
// plan's delivery rate and the power switching it off then frees. A line whose part or byproduct
// feeds another line, or that makes power fuel, keeps running and is no batch task. Nothing is
// recalculated: the plan's own rates and power give the figures. Numbers are written as in en-US.
import './helpers/en-us-numbers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { batchLine, batchLineText, type BatchLine } from '../public/app/delivered.ts';
import { calculate } from '../planner.ts';
import type { CalcRow, StoredCalculatedPlan, StoredStage } from '../public/types/index.ts';

// A whole-machine plan from Phase 1, made once.
let wholePlan: StoredCalculatedPlan | undefined;
const whole = (): StoredCalculatedPlan => (wholePlan ??= calculate({ wholeMachines: true }));

const SMART_PLATING = 'Recipe_SpaceElevatorPart_1_C';
const ADAPTIVE_CONTROL_UNIT = 'Recipe_SpaceElevatorPart_5_C';
const NUCLEAR_PASTA = 'Recipe_SpaceElevatorPart_9_C';

// A row with only what batchLine reads; the rest are the neutral values a real row carries.
const row = (id: string, inputs: CalcRow['inputs'], outputs: CalcRow['outputs']): CalcRow => ({
  id,
  name: id,
  phase: 1,
  machine: 'Assembler',
  power: 15,
  inputs,
  outputs,
  equivalent: 1,
  machines: 1,
  lastClock: 100,
  peakMW: 15,
  generationMW: 0,
});

// A plan of one Phase 2 stage, made by hand on the whole-machine plan's frame: its settings at
// power factor 1, and no rows in any other phase.
const planOf = (stage: StoredStage): StoredCalculatedPlan => {
  const base = whole();
  const none = { feasible: false };
  return {
    ...base,
    settings: { ...base.settings, powerFactor: 1 },
    stages: { '1': { feasible: true }, '2': stage, '3': none, '4': none, '5': none },
  };
};

test('a line that only makes an elevator part is a batch task (#1211)', () => {
  // Phase 1: one Assembler makes 2 Smart Plating/min, so the 50 parts take 25 minutes, and its
  // 15 MW are freed once it is switched off. Phase 2 builds the same line again.
  const one = batchLine(whole(), '1', SMART_PLATING);
  assert.deepEqual(one, {
    part: 'Smart Plating',
    amount: 50,
    minutes: 25,
    freedMW: 15,
    upTo: false,
    later: '2',
  });
  assert.equal(
    batchLineText(one!),
    'Make 50 × Smart Plating (about 25 minutes at this rate), then switch the line off until Phase 2 needs it again: frees 15 MW.',
  );
  // Phase 3: the Adaptive Control Units are done in 1 h 40 min, well before the phase's 4 h 10 min.
  assert.equal(
    batchLineText(batchLine(whole(), '3', ADAPTIVE_CONTROL_UNIT)!),
    'Make 100 × Adaptive Control Unit (about 1 h 40 min at this rate), then switch the line off until Phase 4 needs it again: frees 55 MW.',
  );
  // Phase 4's Nuclear Pasta is made in Particle Accelerators, whose draw follows the recipe.
  assert.match(
    batchLineText(batchLine(whole(), '4', NUCLEAR_PASTA)!),
    /^Make 100 × Nuclear Pasta \(about 3 h 20 min at this rate\), then switch the line off until Phase 5 needs it again: frees up to 1\.5 GW\.$/,
  );
});

test('a part line that also feeds a running line keeps running', () => {
  // Phase 5's Nuclear Pasta goes to the elevator and into another line.
  const five = whole().stages['5'];
  assert.ok(five.rows!.some(other => (other.inputs['Nuclear Pasta'] ?? 0) > 0));
  assert.equal(batchLine(whole(), '5', NUCLEAR_PASTA), null);
  // By hand: half the Smart Plating goes into another line, so the line runs on.
  const fed = planOf({
    feasible: true,
    delivery: { 'Smart Plating': { target: 1000, rate: 2 } },
    rows: [
      row('plating', {}, { 'Smart Plating': 4 }),
      row('other', { 'Smart Plating': 2 }, { 'Modular Frame': 1 }),
    ],
  });
  assert.equal(batchLine(fed, '2', 'plating'), null);
  // So does a part line whose byproduct another line takes.
  const byproduct = planOf({
    feasible: true,
    delivery: { 'Smart Plating': { target: 1000, rate: 4 } },
    rows: [
      row('plating', {}, { 'Smart Plating': 4, 'Heavy Oil Residue': 2 }),
      row('other', { 'Heavy Oil Residue': 2 }, { Rubber: 1 }),
    ],
  });
  assert.equal(batchLine(byproduct, '2', 'plating'), null);
  // Protected storage, drone fuel and vehicle fuel are taken all along too.
  for (const demand of ['storage', 'drone', 'transport'] as const) {
    const kept = planOf({
      feasible: true,
      delivery: { 'Smart Plating': { target: 1000, rate: 4 } },
      [demand]: { 'Smart Plating': 1 },
      rows: [row('plating', {}, { 'Smart Plating': 5 })],
    });
    assert.equal(batchLine(kept, '2', 'plating'), null, demand);
  }
});

test('a power fuel line keeps running', () => {
  // The fuel plan's Phase 4 burns Fuel and Rocket Fuel in Fuel Generators: no line making it is a
  // batch task, and no line that is not a part's.
  const fuel: StoredCalculatedPlan = JSON.parse(
    fs.readFileSync('tests/fixtures/fuel-plan-2026-10-05.json', 'utf8'),
  );
  const four = fuel.stages['4'];
  const fuels = four.rows!.filter(line => line.id.startsWith('power-'));
  assert.ok(fuels.length >= 2, 'the phase runs generator lines');
  for (const line of four.rows!) {
    const batch = batchLine(fuel, '4', line.id);
    if (Object.keys(line.outputs).some(item => fuels.some(gen => (gen.inputs[item] ?? 0) > 0)))
      assert.equal(batch, null, line.name + ' makes power fuel');
    if (!Object.keys(line.outputs).some(item => four.delivery?.[item]))
      assert.equal(batch, null, line.name + ' makes no part');
  }
  // By hand: a part line whose byproduct a generator burns.
  const burnt = planOf({
    feasible: true,
    delivery: { 'Smart Plating': { target: 1000, rate: 4 } },
    rows: [
      row('plating', {}, { 'Smart Plating': 4, 'Compacted Coal': 3 }),
      { ...row('power-coal', { 'Compacted Coal': 3 }, {}), power: -75, generationMW: 75 },
    ],
  });
  assert.equal(batchLine(burnt, '2', 'plating'), null);
});

test('several lines of one part share its target, and the time follows the delivery rate', () => {
  const shared = planOf({
    feasible: true,
    delivery: { 'Smart Plating': { target: 1000, rate: 5 } },
    grid: {} as StoredStage['grid'],
    rows: [
      row('plating', {}, { 'Smart Plating': 4 }),
      { ...row('amp:plating', {}, { 'Smart Plating': 1 }), machines: 1, lastClock: 50 },
    ],
  });
  const main = batchLine(shared, '2', 'plating')!,
    twin = batchLine(shared, '2', 'amp:plating')!;
  assert.equal(main.amount, 800);
  assert.equal(twin.amount, 200);
  assert.equal(main.minutes, 200);
  assert.equal(twin.minutes, 200);
  // A plan with a grid frees the line's clocked draw: the last machine at 50% draws 0.5^1.32.
  assert.ok(Math.abs(twin.freedMW - 15 * 0.5 ** 1.321929) < 1e-9);
  assert.equal(main.later, null);
  assert.equal(
    batchLineText(main),
    'Make 800 × Smart Plating (about 3 h 20 min at this rate), then switch the line off: frees 15 MW.',
  );
});

test('a plan without delivery rates has no batch tasks', () => {
  // A plan migrated from the handbook hands its parts in at no rate.
  const handbook = planOf({
    feasible: true,
    delivery: { 'Smart Plating': { target: 1000, rate: 0 } },
    rows: [row('plating', {}, { 'Smart Plating': 4 })],
  });
  assert.equal(batchLine(handbook, '2', 'plating'), null);
  assert.equal(batchLine(handbook, '2', 'missing'), null);
  assert.equal(batchLine(null, '2', 'plating'), null);
});

test('the wording rounds the time as the pages do', () => {
  const words = (minutes: number, extra: Partial<BatchLine> = {}) =>
    batchLineText({
      part: 'Smart Plating',
      amount: 1000,
      minutes,
      freedMW: 34,
      upTo: false,
      later: null,
      ...extra,
    });
  assert.equal(
    words(50),
    'Make 1,000 × Smart Plating (about 50 minutes at this rate), then switch the line off: frees 34 MW.',
  );
  assert.match(words(200.2), /\(about 3 h 20 min at this rate\)/);
  assert.match(words(120), /\(about 2 h at this rate\)/);
  assert.match(words(0.5), /\(less than a minute at this rate\)/);
  assert.match(words(50, { freedMW: 1500, upTo: true }), /: frees up to 1\.5 GW\.$/);
});
