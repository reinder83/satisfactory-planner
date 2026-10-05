// Why a line's output goes to the AWESOME Sink (#1063, public/app/sink-cause.ts): the factory
// dialog captioned every sink "whole-machine rounding surplus", also the 480 Petroleum Coke/min a
// whole-machine Phase 3 on coal power makes only to use up the Heavy Oil Residue of its Plastic
// and Rubber lines. Rounding up adds less than one machine per line, so only a sink that small
// may say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../planner.ts';
import { exactClocksKeep, sinkCaption, sinkCause } from '../public/app/sink-cause.ts';
import type { CalcRow, StoredStage } from '../public/types/index.ts';

const FLUIDS = new Set(['Heavy Oil Residue', 'Crude Oil', 'Fuel', 'Water']);
const fluid = (item: string) => FLUIDS.has(item);

// A line of `machines` whole machines at 100% making `outputs` from `inputs` (per minute in all).
const line = (
  id: string,
  machines: number,
  inputs: CalcRow['inputs'],
  outputs: CalcRow['outputs'],
): CalcRow => ({
  id,
  name: id,
  phase: 3,
  machine: 'Refinery',
  power: 30,
  inputs,
  outputs,
  equivalent: machines,
  machines,
  lastClock: 100,
  peakMW: 30 * machines,
  generationMW: 0,
});
const stageOf = (rows: CalcRow[], extra: Partial<StoredStage> = {}): StoredStage => ({
  feasible: true,
  rows,
  ...extra,
});

const plastic = line('plastic', 8, { 'Crude Oil': 240 }, { Plastic: 160, 'Heavy Oil Residue': 80 });
const coke = line('coke', 2, { 'Heavy Oil Residue': 80 }, { 'Petroleum Coke': 240 });
const plates = line('plates', 4, { 'Iron Ingot': 120 }, { 'Iron Plate': 80 });
const fuel = line('fuel', 3, { 'Crude Oil': 180 }, { Fuel: 120, 'Polymer Resin': 90 });
const generators = line('power', 2, { Fuel: 120 }, {});

test('a line that uses up a fluid byproduct says so, whatever it sinks', () => {
  const stage = stageOf([plastic, coke], { surplus: { 'Petroleum Coke': 240, Plastic: 5 } });
  const cause = sinkCause(coke, 'Petroleum Coke', 240, stage, true, fluid);
  assert.deepEqual(cause, { kind: 'uses-up', item: 'Heavy Oil Residue' });
  assert.equal(sinkCaption(cause), 'left over from using up Heavy Oil Residue');
  // Also below one machine's output, and without whole machines.
  assert.equal(sinkCause(coke, 'Petroleum Coke', 20, stage, false, fluid).kind, 'uses-up');
  // A fluid the line takes that no other line makes as a byproduct is no reason.
  const alone = stageOf([coke], { surplus: { 'Petroleum Coke': 240 } });
  assert.equal(sinkCause(coke, 'Petroleum Coke', 240, alone, true, fluid).kind, 'unused');
});

test('whole-machine rounding is the cause only below one machine of each line making it', () => {
  const stage = stageOf([plates], { surplus: { 'Iron Plate': 15 } });
  const cause = sinkCause(plates, 'Iron Plate', 15, stage, true, fluid);
  assert.deepEqual(cause, { kind: 'rounding' });
  assert.equal(sinkCaption(cause), 'whole-machine rounding surplus');
  // 20/min per machine: 20 or more is not rounding, nor is any sink without whole machines.
  assert.equal(sinkCause(plates, 'Iron Plate', 20, stage, true, fluid).kind, 'unused');
  assert.equal(sinkCause(plates, 'Iron Plate', 15, stage, false, fluid).kind, 'unused');
  assert.equal(sinkCaption({ kind: 'unused' }), 'more than this phase uses');
  // Two lines making it: up to one machine of each.
  const twice = stageOf([plates, { ...plates, id: 'plates2' }]);
  assert.equal(sinkCause(plates, 'Iron Plate', 39, twice, true, fluid).kind, 'rounding');
});

test('a byproduct names the main product the phase uses', () => {
  const stage = stageOf([fuel, generators], { surplus: { 'Polymer Resin': 90 } });
  const cause = sinkCause(fuel, 'Polymer Resin', 90, stage, true, fluid);
  assert.deepEqual(cause, { kind: 'alongside', item: 'Fuel' });
  assert.equal(sinkCaption(cause), 'made alongside Fuel, which this phase uses');
  // Even below one machine's output: the line runs for its Fuel.
  assert.equal(sinkCause(fuel, 'Polymer Resin', 10, stage, true, fluid).kind, 'alongside');
  // A main product beyond rounding, made for a byproduct the phase uses (here by storage).
  const resin = stageOf([fuel], { storage: { 'Polymer Resin': 90 }, surplus: { Fuel: 0 } });
  assert.deepEqual(sinkCause(fuel, 'Fuel', 60, resin, true, fluid), {
    kind: 'alongside',
    item: 'Polymer Resin',
  });
});

test("the issue's plan: Phase 3 on coal power sinks all its Petroleum Coke to use up Heavy Oil Residue", () => {
  const plan = calculate({
    phase: '3',
    wholeMachines: true,
    mainPower: 'coal',
    limitsConfirmed: true,
  });
  const stage = plan.stages['3'];
  const cokeLine = (stage.rows || []).find(row => row.id === 'Recipe_PetroleumCoke_C')!;
  assert.ok(cokeLine, 'a Petroleum Coke line');
  const made = cokeLine.outputs['Petroleum Coke']!;
  assert.ok(made >= 120, `${made} Petroleum Coke/min`);
  assert.ok(Math.abs(stage.surplus!['Petroleum Coke']! - made) < 1e-6, 'all of it to the sink');
  assert.ok(stage.raw!.Coal! > 0, 'while Coal is mined');
  assert.deepEqual(sinkCause(cokeLine, 'Petroleum Coke', made, stage, true, fluid), {
    kind: 'uses-up',
    item: 'Heavy Oil Residue',
  });
});

test("the exact-clocks note says exact clocks remove only rounding's overflow", () => {
  // Rounding: exact clocks remove it, and the note keeps its own sentence.
  assert.equal(exactClocksKeep({ kind: 'rounding' }), undefined);
  // Anything else: exact clocks would not remove it, and the note says why.
  assert.equal(
    exactClocksKeep({ kind: 'uses-up', item: 'Heavy Oil Residue' }),
    'It is left over from using up Heavy Oil Residue, so exact clocks would not remove it: they only underclock the last machine to the exact remainder.',
  );
  assert.equal(
    exactClocksKeep({ kind: 'alongside', item: 'Fuel' }),
    'It is made alongside Fuel, which this phase uses, so exact clocks would not remove it: they only underclock the last machine to the exact remainder.',
  );
  assert.equal(
    exactClocksKeep({ kind: 'unused' }),
    'That is more than rounding to whole machines explains, so exact clocks would remove at most part of it: they only underclock the last machine to the exact remainder.',
  );
});
