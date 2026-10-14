// Why a line's output goes to the AWESOME Sink (#1063, public/app/sink-cause.ts): the factory
// dialog captioned every sink "whole-machine rounding surplus", also the 480 Petroleum Coke/min a
// whole-machine Phase 3 on coal power makes only to use up the Heavy Oil Residue of its Plastic
// and Rubber lines. Rounding up adds less than one machine per line, so only a sink that small
// may say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  burnNote,
  exactClocksKeep,
  mainPowerWords,
  sinkCaption,
  sinkCause,
} from '../public/app/sink-cause.ts';
import type { CalcRow, StoredCalculatedPlan, StoredStage } from '../public/types/index.ts';

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

// The issue's plan as it was stored before #1055 (Phase 3 on coal power, whole machines, recorded
// on main f292a25d): a recalculation now burns its Petroleum Coke in Coal Generators
// (tests/generator-fuels.test.ts), but the stored plan keeps its sink and its caption.
test("the issue's plan: Phase 3 on coal power sinks all its Petroleum Coke to use up Heavy Oil Residue", () => {
  const plan: StoredCalculatedPlan = JSON.parse(
    fs.readFileSync(new URL('./fixtures/coal-power-plan-2026-10-10.json', import.meta.url), 'utf8'),
  );
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

// Why the plan sinks spare Petroleum Coke or Compacted Coal rather than burning it (#1063, the
// owner's decision): only under a main power that builds no Coal Generators, and never for a sink
// that rounding explains or a fuel a generator line of the phase already burns.
test('the burn note says why the coke is sunk and points at coal power', () => {
  const stage = stageOf([plastic, coke], { surplus: { 'Petroleum Coke': 240 } });
  const note = (mainPower: string | undefined, phase = 4, on = stage, row = coke, sunk = 240) =>
    burnNote(row, 'Petroleum Coke', sunk, on, { mainPower: mainPower as 'rocket' }, phase, fluid);
  assert.equal(
    note('rocket'),
    'The plan sinks its spare Petroleum Coke: burning it in Coal Generators would need more machines than it saves in the rocket fuel power chain. With coal power, the plan burns it in Coal Generators instead.',
  );
  assert.match(note('nuclear')!, /in the nuclear power chain\./);
  assert.match(note('rocket-nuclear')!, /in the rocket fuel and nuclear power chain\./);
  assert.match(note('turbofuel-nuclear')!, /in the turbofuel and nuclear power chain\./);
  assert.match(note('fuel', 5)!, /in the fuel power chain\./);
  // Phase 3 runs the rocket and nuclear choices on Turbofuel (generators() in planner/recipes.ts).
  assert.match(note('rocket', 3)!, /in the turbofuel power chain\./);
  assert.match(note('nuclear', 3)!, /in the turbofuel power chain\./);
  // Coal, auto, a plan stored without the setting and Phase 2 may build Coal Generators for it.
  for (const mainPower of ['coal', 'auto', undefined]) assert.equal(note(mainPower), undefined);
  assert.equal(note('rocket', 2), undefined);
  // A phase that already burns it, and nothing sunk.
  const burner = {
    ...coke,
    id: 'power-petroleum-coke',
    generationMW: 75,
    inputs: { 'Petroleum Coke': 25 },
  };
  assert.equal(note('rocket', 4, stageOf([plastic, coke, burner])), undefined);
  assert.equal(note('rocket', 4, stage, coke, 0), undefined);
  // Any other item.
  assert.equal(
    burnNote(plates, 'Iron Plate', 60, stageOf([plates]), { mainPower: 'rocket' }, 4, fluid),
    undefined,
  );
  // Compacted Coal made alongside Rocket Fuel, which the phase burns: the same note.
  const rocketFuel = line(
    'rocket',
    3,
    { Turbofuel: 300 },
    { 'Rocket Fuel': 300, 'Compacted Coal': 30 },
  );
  const rocketPower = line('power', 72, { 'Rocket Fuel': 300 }, {});
  const rocketStage = stageOf([rocketFuel, rocketPower], { surplus: { 'Compacted Coal': 4 } });
  assert.match(
    burnNote(rocketFuel, 'Compacted Coal', 4, rocketStage, { mainPower: 'rocket' }, 4, fluid)!,
    /^The plan sinks its spare Compacted Coal: /,
  );
  // A whole-machine rounding sink of a Compacted Coal line: rounding explains it, no note.
  const enriched = line('enriched', 5, { Coal: 125, Sulfur: 125 }, { 'Compacted Coal': 125 });
  assert.equal(
    burnNote(
      enriched,
      'Compacted Coal',
      18,
      stageOf([enriched], { surplus: { 'Compacted Coal': 18 } }),
      { mainPower: 'rocket', wholeMachines: true },
      4,
      fluid,
    ),
    undefined,
  );
  // The rounding check reads the phase's whole sink, not the line's part (#1155): beside a Rocket
  // Fuel line, the Compacted Coal line's 30/min is its part of 40/min sunk, more than one machine
  // of each line together (25 + 10), so rounding does not explain it and the note stays.
  const sharedStage = stageOf([enriched, rocketFuel, rocketPower], {
    surplus: { 'Compacted Coal': 40 },
  });
  const sharedNote = (sunk: number) =>
    burnNote(
      enriched,
      'Compacted Coal',
      sunk,
      sharedStage,
      { mainPower: 'rocket', wholeMachines: true },
      4,
      fluid,
    );
  assert.match(sharedNote(30)!, /^The plan sinks its spare Compacted Coal: /);
  assert.equal(sharedNote(30), sharedNote(40));
  assert.equal(mainPowerWords('coal', 4), undefined);
});
