// The pieces of a calculated row's flow model (public/app/flow.ts, #528): its destinations
// (flowOutputs, generatorOutputs), its inputs (flowInputs) and its notes (flowNotes), on small
// hand-made rows and stages. calcFlowModel assembles the factory dialog's model from them; the
// dialog itself is tested in factories.test.ts.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  beltTxt,
  flowInputs,
  flowNotes,
  flowOutputs,
  generatorOutputs,
  itemBelts,
  lanePlan,
  rowEquivalent,
  splitMachines,
} from '../../public/app/flow.ts';
import type { CalcFlowContext, FlowOutput, LanePlan } from '../../public/app/flow.ts';
import type { CalcRow, StoredSettings, StoredStage } from '../../public/types/index.ts';
import { setState } from '../../public/app/session.ts';
import { initialState } from '../../public/state.ts';
import { power } from '../../public/app/wizard/fields.ts';
import './setup.ts';

// The lane marks read the ticked milestones: none here.
setState(initialState());

// A row making `outputs` from `inputs` on four whole machines at 100%.
const row = (id: string, inputs: CalcRow['inputs'], outputs: CalcRow['outputs']): CalcRow => ({
  id,
  name: id,
  phase: 1,
  machine: 'Constructor',
  power: 4,
  inputs,
  outputs,
  equivalent: 4,
  machines: 4,
  lastClock: 100,
  peakMW: 16,
  generationMW: 0,
});
const context = (
  storedStage: Partial<StoredStage>,
  stageKey = '3',
  settings?: Partial<StoredSettings>,
): CalcFlowContext => ({
  storedStage: { feasible: true, ...storedStage },
  stageKey,
  // A partial settings fixture: the reserves only read the augmenter and cell fields.
  settings: settings as StoredSettings | undefined,
});
const labels = (outputs: FlowOutput[]) => outputs.map(o => `${o.label} ${o.rate ?? ''}`.trim());

const plates = row('plates', { 'Iron Ingot': 120 }, { 'Iron Plate': 80 });
const screws = row('screws', { 'Iron Plate': 30 }, { Screw: 60 });
const frames = row('frames', { 'Iron Plate': 50, Screw: 60 }, { 'Modular Frame': 5 });

test('beltTxt names the lanes a lane plan counts, plural past one', () => {
  const lanes = (count: number, word: 'belt' | 'pipe') =>
    ({ count, word, lane: { mark: 'Mk.3' } }) as LanePlan;
  assert.equal(beltTxt(lanes(1, 'belt')), '1 × Mk.3 belt');
  assert.equal(beltTxt(lanes(3, 'pipe')), '3 × Mk.3 pipes');
});

test('itemBelts words the belts or pipes of an item’s rate as the factory dialog does (#893)', () => {
  // An item that travels by pipe gets pipes, any other item belts, of the mark lanePlan picks.
  assert.equal(itemBelts('Iron Plate', 130, '1'), beltTxt(lanePlan(130, false, '1')));
  assert.equal(itemBelts('Water', 700, '1'), beltTxt(lanePlan(700, true, '1')));
  assert.match(itemBelts('Water', 700, '1'), / pipes$/);
  assert.match(itemBelts('Screw', 50, '3'), /^1 × Mk\.\d belt$/);
});

test('rowEquivalent takes the planner figure, else the machines with the last clock', () => {
  assert.equal(rowEquivalent(plates), 4);
  assert.equal(rowEquivalent({ ...plates, equivalent: 0, machines: 3, lastClock: 50 }), 2.5);
  assert.equal(rowEquivalent({ ...plates, equivalent: 0, machines: 0, lastClock: 100 }), 1);
});

test('flowOutputs lists the consuming rows with belts and machine shares, largest first', () => {
  const stage = context({ rows: [plates, screws, frames] });
  const outputs = flowOutputs(plates, stage);
  assert.deepEqual(labels(outputs), ['frames 50', 'screws 30']);
  // 80/min on 4 machines is 20/min per machine: 50/min takes 2.5 of them.
  assert.deepEqual(outputs[0], {
    kind: 'consumer',
    label: 'frames',
    icon: 'Modular Frame',
    link: { calcFactory: 'frames' },
    rate: 50,
    unit: '/min',
    pre: '',
    mach: 2.5,
    beltTxt: beltTxt(lanePlan(50, false, '3')),
  });
  assert.deepEqual(flowOutputs(frames, stage), [], 'nothing consumes the frames');
});

test("flowOutputs adds the phase's books, then the sinks above the threshold", () => {
  const stage = context({
    rows: [plates, screws],
    storage: { 'Iron Plate': 5 },
    delivery: { 'Iron Plate': { target: 100, rate: 10 } },
    drone: { 'Iron Plate': 2 },
    surplus: { 'Iron Plate': 40 },
  });
  const outputs = flowOutputs(plates, stage);
  assert.deepEqual(labels(outputs), [
    'AWESOME Sink 40',
    'screws 30',
    'Space Elevator delivery 10',
    'Protected storage 5',
    'Drone fuel contract 2',
  ]);
  assert.equal(outputs.find(o => o.kind === 'drone')!.mach, 0.1);
  assert.equal(outputs.find(o => o.kind === 'sink')!.mach, undefined, 'a sink takes no share');
  const noise = context({ rows: [plates], surplus: { 'Iron Plate': 0.002 } });
  assert.deepEqual(flowOutputs(plates, noise), [], 'floating-point leftovers are not sunk');
});

test('flowOutputs prefixes every destination of a row with byproducts, without machine shares', () => {
  const refinery = row('plastic', { 'Crude Oil': 30 }, { Plastic: 20, 'Heavy Oil Residue': 10 });
  const fuel = row('fuel', { 'Heavy Oil Residue': 60 }, { Fuel: 40 });
  const outputs = flowOutputs(
    refinery,
    context({ rows: [refinery, fuel], storage: { Plastic: 20 } }),
  );
  assert.deepEqual(
    outputs.map(o => [o.pre, o.label, o.unit, o.mach]),
    [
      ['Heavy Oil Residue', 'fuel', ' m³/min', undefined],
      ['Plastic', 'Protected storage', '/min', undefined],
    ],
  );
});

test('flowOutputs captions the sink by its cause, rounding only where rounding explains it (#1063)', () => {
  const whole = { wholeMachines: true };
  const sinkOf = (line: CalcRow, books: Partial<StoredStage>, settings?: Partial<StoredSettings>) =>
    flowOutputs(line, context(books, '3', settings)).find(output => output.kind === 'sink')?.subTxt;
  // A Petroleum Coke line runs to use up the Plastic line's Heavy Oil Residue.
  const plastic = row('plastic', { 'Crude Oil': 120 }, { Plastic: 80, 'Heavy Oil Residue': 40 });
  const coke = row('coke', { 'Heavy Oil Residue': 40 }, { 'Petroleum Coke': 120 });
  assert.equal(
    sinkOf(coke, { rows: [plastic, coke], surplus: { 'Petroleum Coke': 120 } }, whole),
    'left over from using up Heavy Oil Residue',
  );
  // Four Iron Plate machines make 20/min each: less than that sunk is rounding, more is not, and
  // nothing is rounding without whole machines.
  assert.equal(
    sinkOf(plates, { rows: [plates], surplus: { 'Iron Plate': 15 } }, whole),
    'whole-machine rounding surplus',
  );
  assert.equal(
    sinkOf(plates, { rows: [plates], surplus: { 'Iron Plate': 40 } }, whole),
    'more than this phase uses',
  );
  assert.equal(
    sinkOf(plates, { rows: [plates], surplus: { 'Iron Plate': 15 } }),
    'more than this phase uses',
  );
  // A byproduct names the main product the phase uses.
  const fuel = row('fuel', { 'Crude Oil': 240 }, { Fuel: 160, 'Polymer Resin': 120 });
  const generator = { ...row('power', { Fuel: 160 }, {}), power: -250 };
  assert.equal(
    sinkOf(fuel, { rows: [fuel, generator], surplus: { 'Polymer Resin': 120 } }, whole),
    'made alongside Fuel, which this phase uses',
  );
});

test('flowOutputs reserves augmenter matrix and extra cells in Phase 5 only', () => {
  const matrix = row('matrix', {}, { 'Alien Power Matrix': 10 });
  const cells = row('cells', {}, { 'Singularity Cell': 10 });
  const books = { rows: [matrix, cells], matrixRate: 6 };
  const settings = { fueledAugmenters: 2, cellsPerMinute: 4 };
  const phase5 = context(books, '5', settings);
  assert.deepEqual(
    flowOutputs(matrix, phase5).map(o => [o.label, o.shipSub, o.rate]),
    [['Alien Power Augmenter fuel', '2 fueled augmenters', 6]],
  );
  assert.equal(
    flowOutputs(matrix, context(books, '5', { fueledAugmenters: 1, cellsPerMinute: 4 }))[0]!
      .shipSub,
    '1 fueled augmenter',
  );
  assert.deepEqual(
    flowOutputs(cells, phase5).map(o => [o.label, o.shipSub, o.rate]),
    [['Extra Singularity Cells', 'configured portal supply', 4]],
  );
  assert.deepEqual(flowOutputs(matrix, context(books, '4', settings)), []);
  assert.deepEqual(flowOutputs(cells, context(books, '4', settings)), []);
});

test("flowOutputs sinks the waste strategy's plutonium rods", () => {
  const rods = row('rods', {}, { 'Plutonium Fuel Rod': 1 });
  assert.deepEqual(flowOutputs(rods, context({ rows: [rods], plutoniumSink: 0.5 })), [
    {
      kind: 'sink',
      label: 'AWESOME Sink',
      subTxt: 'waste strategy — sink these rods',
      icon: 'Plutonium Fuel Rod',
      rate: 0.5,
      unit: '/min',
      pre: '',
    },
  ]);
});

test('generatorOutputs gives a generator the power grid, and any other row nothing', () => {
  assert.deepEqual(generatorOutputs({ ...plates, generationMW: 1500 }), [
    {
      kind: 'ship',
      label: 'Power grid',
      shipSub: 'generation',
      rateTxt: power(1500),
      noItem: true,
    },
  ]);
  assert.deepEqual(generatorOutputs(plates), []);
});

test('flowInputs links each input to the first other row making it', () => {
  const morePlates = row('more-plates', { 'Iron Ingot': 60 }, { 'Iron Plate': 40 });
  const inputs = flowInputs(frames, context({ rows: [frames, plates, morePlates, screws] }));
  assert.deepEqual(
    inputs.map(i => [i.name, i.rate, i.link]),
    [
      ['Iron Plate', 50, { calcFactory: 'plates' }],
      ['Screw', 60, { calcFactory: 'screws' }],
    ],
  );
  assert.deepEqual(inputs[0]!.plan, lanePlan(50, false, '3'));
  assert.equal(flowInputs(plates, context({ rows: [plates] }))[0]!.link, null, 'mined ore');
});

test('flowNotes splits the machines across deliveries, and says when the item is shared', () => {
  const stage = context({ rows: [plates, screws, frames] });
  // Frames take 2.5 of the 4 machines and Screws 1.5: by largest remainder 3 and 1, which add up
  // to the 4 (rounding each up said 3 / 2, five machines, before #1067).
  const outputs = splitMachines(plates, flowOutputs(plates, stage));
  assert.deepEqual(flowNotes(plates, outputs, stage), {
    split: ' · split ≈ 3 / 1 across the deliveries below',
    clock: '@ 100%',
    bankNote: { shared: false },
  });
  const morePlates = row('more-plates', {}, { 'Iron Plate': 40 });
  assert.equal(
    flowNotes(plates, outputs, context({ rows: [plates, morePlates] })).bankNote!.shared,
    true,
  );
  // One delivery gives no split, nor does a sink without its whole machines; no destinations, no
  // bank note.
  const sink: FlowOutput = { kind: 'sink', label: 'AWESOME Sink', rate: 1, mach: 1 };
  assert.equal(flowNotes(plates, [outputs[0]!], stage).split, '');
  assert.equal(flowNotes(plates, [outputs[0]!, sink], stage).split, '');
  assert.equal(flowNotes(plates, [], stage).bankNote, null);
  // A fractional equivalent is whole machines plus one adjustable machine.
  const clocked = { ...plates, equivalent: 3.5 };
  assert.equal(flowNotes(clocked, [], stage).clock, '@ 100% + 1 adjustable');
});

test('flowNotes gives no bank note when the power grid is the only destination (#560)', () => {
  const fuelPlant = { ...row('fuel-power', { Fuel: 96 }, {}), generationMW: 1250 };
  const stage = context({ rows: [fuelPlant] });
  const grid = generatorOutputs(fuelPlant);
  assert.equal(flowNotes(fuelPlant, grid, stage).bankNote, null, 'the grid is no item demand');
  // A nuclear plant belts its waste on as well: that destination is item demand.
  const nuclear = {
    ...row('nuclear', { 'Uranium Fuel Rod': 1 }, { 'Uranium Waste': 50 }),
    generationMW: 2500,
  };
  const recycle = row('recycle', { 'Uranium Waste': 50 }, { 'Non-Fissile Uranium': 75 });
  const books = context({ rows: [nuclear, recycle] });
  const outputs = [...generatorOutputs(nuclear), ...flowOutputs(nuclear, books)];
  assert.deepEqual(labels(outputs), ['Power grid', 'recycle 50']);
  assert.deepEqual(flowNotes(nuclear, outputs, books).bankNote, { shared: false });
});
