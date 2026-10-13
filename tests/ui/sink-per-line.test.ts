// Each line's own part of the sink in the production line dialog's flow (#1155): two lines making
// one item each showed the phase's whole sink of it. In the issue's plan (Phase 3 start, whole
// machines, standard recipes, rocket fuel main power; Phase 4) the Compacted Coal line and the
// Rocket Fuel line both make Compacted Coal, and both flows sent all 22.24/min to the AWESOME
// Sink, while the Rocket Fuel line's byproduct advice said "store or sink the other 3.96". The
// flow now reads each line's part from the books, as the advice and the burn note do
// (recycleModel), so the parts add up to the phase's surplus, and the caption's cause is worked
// out from the part. A line that alone makes an item it sinks keeps the whole sink.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { calcFlowModel, flowOutputs, FLUIDS } from '../../public/app/flow.ts';
import type { CalcFlowContext, FlowModel } from '../../public/app/flow.ts';
import { num } from '../../public/app/format.ts';
import { OUTSIDE } from '../../public/app/group-links.ts';
import { recycleModel } from '../../public/app/recycle.ts';
import { calcStage } from '../../public/app/session.ts';
import { sinkCaption, sinkCause } from '../../public/app/sink-cause.ts';
import { $, catalog, generatedWith, open, page } from './setup.ts';
import type { CalcRow, FactoryGroups, StoredStage } from '../../public/types/index.ts';

const COAL = 'Compacted Coal';
const COAL_LINE = 'Recipe_Alternate_EnrichedCoal_C',
  ROCKET_LINE = 'Recipe_RocketFuel_C',
  COKE_LINE = 'Recipe_PetroleumCoke_C';
const NO_GROUPS: FactoryGroups = { groups: [], assignments: {} };
// The two lines in factories of their own, so each factory sends its own leftover to the sink.
const SPLIT: FactoryGroups = {
  groups: [
    { id: 'fg-coal01', name: 'Coal' },
    { id: 'fg-rocket', name: 'Rocket' },
  ],
  assignments: {
    [COAL_LINE]: [{ group: 'fg-coal01', rate: null }],
    [ROCKET_LINE]: [{ group: 'fg-rocket', rate: null }],
  },
};
const plan = generatedWith({
  phase: '3',
  wholeMachines: true,
  limitsConfirmed: true,
  mainPower: 'rocket',
});
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());

// The dialog's flow model of row `id` at Phase 4 with `factoryGroups`.
function modelOf(id: string, factoryGroups: FactoryGroups): FlowModel {
  open({ calculated: structuredClone(plan), phase: '4', state: { factoryGroups } });
  const row = calcStage()!.rows!.find(candidate => candidate.id === id);
  assert.ok(row, `the phase has row ${id}`);
  return calcFlowModel(row);
}
const sinkOf = (model: FlowModel, item: string) =>
  model.outputs.filter(output => output.kind === 'sink' && (output.pre || item) === item);
// What the books send from line `id` to the sink (recycleModel, as the byproduct advice reads it).
const booksPart = (stage: StoredStage, groups: FactoryGroups, id: string, item: string) =>
  recycleModel(stage, groups)
    .transfers.filter(
      transfer =>
        transfer.item === item &&
        transfer.from.kind === 'line' &&
        transfer.from.id === id &&
        transfer.to.kind === 'place' &&
        transfer.to.id === OUTSIDE.surplus,
    )
    .reduce((total, transfer) => total + transfer.rate, 0);

beforeEach(() => page());

for (const [label, groups] of [
  ['without factories', NO_GROUPS],
  ['with the two lines in factories of their own', SPLIT],
] as const)
  test(`each Compacted Coal line's flow sends its own part of the sink, ${label}`, () => {
    const stage = plan.stages['4'];
    const surplus = stage.surplus![COAL]!;
    assert.ok(surplus > 1, 'the phase sinks Compacted Coal');
    const makers = stage.rows!.filter(row => (row.outputs[COAL] || 0) > 0);
    assert.deepEqual(
      makers.map(row => row.id),
      [COAL_LINE, ROCKET_LINE],
    );
    let shown = 0;
    for (const row of makers) {
      const sinks = sinkOf(modelOf(row.id, groups), COAL);
      const part = booksPart(stage, groups, row.id, COAL);
      assert.ok(part < surplus - 1, `${row.id}: a part, not the whole ${surplus}`);
      assert.equal(sinks.length, 1, row.id);
      assert.ok(near(sinks[0]!.rate!, part), `${row.id}: ${sinks[0]!.rate} against ${part}`);
      // The caption's cause is worked out from the line's part.
      assert.equal(
        sinks[0]!.subTxt,
        sinkCaption(sinkCause(row, COAL, part, stage, true, item => FLUIDS.has(item))),
      );
      shown += sinks[0]!.rate!;
    }
    assert.ok(near(shown, surplus), `the parts add up to the surplus: ${shown} of ${surplus}`);
  });

test("the Rocket Fuel line's flow sinks what its byproduct advice says it sinks", async () => {
  open({
    calculated: structuredClone(plan),
    phase: '4',
    state: { factoryGroups: NO_GROUPS },
    workspace: { catalog: catalog() },
  });
  openCalculatedFactory(ROCKET_LINE);
  await settle();
  const row = calcStage()!.rows!.find(candidate => candidate.id === ROCKET_LINE)!;
  const sink = sinkOf(calcFlowModel(row), COAL)[0]!;
  assert.ok(sink.rate! < 5, `${sink.rate}`);
  assert.equal(sink.subTxt, 'made alongside Rocket Fuel, which this phase uses');
  const text = ($('#detail')!.textContent || '').replace(/\s+/g, ' ');
  assert.ok(text.includes(`store or sink the other ${num(sink.rate)}`), text);
});

test('a line that alone makes an item it sinks keeps the whole sink of it', () => {
  const stage = plan.stages['4'];
  const coke = stage.rows!.filter(row => (row.outputs['Petroleum Coke'] || 0) > 0);
  assert.deepEqual(
    coke.map(row => row.id),
    [COKE_LINE],
  );
  for (const groups of [NO_GROUPS, SPLIT]) {
    const sinks = sinkOf(modelOf(COKE_LINE, groups), 'Petroleum Coke');
    assert.equal(sinks.length, 1);
    assert.equal(sinks[0]!.rate, stage.surplus!['Petroleum Coke']);
  }
});

// The cause follows the part (#1155): two lines make X as their main product, 10/min a machine
// each, and nothing uses it. Together they sink 25/min, more than one machine of each (20/min),
// which rounding cannot explain; each line's own part (15 and 10) is less, so rounding can.
test("the sink caption's cause is worked out from the line's part", () => {
  const line = (id: string, made: number): CalcRow => ({
    id,
    name: id,
    machine: 'Constructor',
    machines: Math.ceil(made / 10),
    equivalent: made / 10,
    lastClock: 100,
    power: 4,
    inputs: { 'Iron Ore': made },
    outputs: { X: made },
  });
  const first = line('a', 15),
    second = line('b', 10);
  const storedStage: StoredStage = { feasible: true, rows: [first, second], surplus: { X: 25 } };
  const context: CalcFlowContext = {
    storedStage,
    stageKey: '3',
    settings: { wholeMachines: true },
  };
  const sinks = [first, second].map(row => flowOutputs(row, context).find(o => o.kind === 'sink')!);
  assert.deepEqual(
    sinks.map(sink => [sink.rate, sink.subTxt]),
    [
      [15, 'whole-machine rounding surplus'],
      [10, 'whole-machine rounding surplus'],
    ],
  );
});
