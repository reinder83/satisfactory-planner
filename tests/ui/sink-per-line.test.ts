// Each line's own part of the sink in the production line dialog's flow (#1155): two lines making
// one item each showed the phase's whole sink of it. In the issue's plan (Phase 3 start, whole
// machines, standard recipes, rocket fuel main power; Phase 4) the Compacted Coal line and the
// Rocket Fuel line both make Compacted Coal, and both flows sent all 22.24/min to the AWESOME
// Sink, while the Rocket Fuel line's byproduct advice said "store or sink the other 3.96". The
// flow now reads each line's part from the books, as the advice and the burn note do
// (recycleModel), so the parts add up to the phase's surplus. The caption's cause stays worked out
// from the phase's whole sink: rounding explains a sink only when all the lines making the item
// together sink less than one machine's output of each, which a part alone cannot tell.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { calcFlowModel, flowOutputs } from '../../public/app/flow.ts';
import type { CalcFlowContext, FlowModel } from '../../public/app/flow.ts';
import { num } from '../../public/app/format.ts';
import { OUTSIDE } from '../../public/app/group-links.ts';
import { recycleModel } from '../../public/app/recycle.ts';
import { calcStage } from '../../public/app/session.ts';
import { $, catalog, generatedWith, open, page } from './setup.ts';
import type { CalcRow, FactoryGroups, StoredStage } from '../../public/types/index.ts';

const COAL = 'Compacted Coal';
const COAL_LINE = 'Recipe_Alternate_EnrichedCoal_C',
  ROCKET_LINE = 'Recipe_RocketFuel_C',
  COKE_LINE = 'Recipe_PetroleumCoke_C';
const NO_GROUPS: FactoryGroups = { groups: [], assignments: {} };
// The two lines in factories of their own: each factory uses its own lines first and sends its
// leftover on, so the books may give one line all of the sink and the other none.
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
const CAPTIONS: Record<string, string> = {
  [COAL_LINE]: 'whole-machine rounding surplus',
  [ROCKET_LINE]: 'made alongside Rocket Fuel, which this phase uses',
};

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

test("the issue's Compacted Coal lines each send their own part of the 22.24/min", () => {
  const stage = plan.stages['4']!;
  const surplus = stage.surplus![COAL]!;
  assert.equal(num(surplus), '22.24');
  const makers = stage.rows!.filter(row => (row.outputs[COAL] || 0) > 0);
  assert.deepEqual(
    makers.map(row => row.id),
    [COAL_LINE, ROCKET_LINE],
  );
  const shown = makers.map(row => {
    const sinks = sinkOf(modelOf(row.id, NO_GROUPS), COAL);
    assert.equal(sinks.length, 1, row.id);
    assert.ok(sinks[0]!.rate! < surplus - 1, `${row.id}: a part, not the whole ${surplus}`);
    assert.equal(sinks[0]!.subTxt, CAPTIONS[row.id], row.id);
    return sinks[0]!.rate!;
  });
  assert.deepEqual(shown.map(num), ['18.29', '3.96']);
  assert.ok(near(shown[0]! + shown[1]!, surplus), `the parts add up to the surplus: ${shown}`);
});

for (const [label, groups] of [
  ['without factories', NO_GROUPS],
  ['with the two lines in factories of their own', SPLIT],
] as const)
  test(`each Compacted Coal line's flow sinks what the books give it, ${label}`, () => {
    const stage = plan.stages['4']!;
    let shown = 0;
    for (const id of [COAL_LINE, ROCKET_LINE]) {
      const sinks = sinkOf(modelOf(id, groups), COAL);
      const part = booksPart(stage, groups, id, COAL);
      if (part > 0.002) {
        assert.equal(sinks.length, 1, id);
        assert.ok(near(sinks[0]!.rate!, part), `${id}: ${sinks[0]!.rate} against ${part}`);
        // The cause is the phase's, whichever line shows it.
        assert.equal(sinks[0]!.subTxt, CAPTIONS[id], id);
        shown += sinks[0]!.rate!;
      } else assert.equal(sinks.length, 0, `${id} sinks none of it`);
    }
    assert.ok(near(shown, stage.surplus![COAL]!), `the parts add up to the surplus: ${shown}`);
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
  assert.equal(num(sink.rate), '3.96');
  assert.equal(sink.subTxt, CAPTIONS[ROCKET_LINE]);
  const text = ($('#detail')!.textContent || '').replace(/\s+/g, ' ');
  assert.ok(text.includes(`store or sink the other ${num(sink.rate)}`), text);
});

test('a line that alone makes an item it sinks keeps the whole sink of it', () => {
  const stage = plan.stages['4']!;
  const coke = stage.rows!.filter(row => (row.outputs['Petroleum Coke'] || 0) > 0);
  assert.deepEqual(
    coke.map(row => row.id),
    [COKE_LINE],
  );
  for (const groups of [NO_GROUPS, SPLIT]) {
    const sinks = sinkOf(modelOf(COKE_LINE, groups), 'Petroleum Coke');
    assert.equal(sinks.length, 1);
    assert.ok(near(sinks[0]!.rate!, stage.surplus!['Petroleum Coke']!));
  }
});

// The cause follows the phase's whole sink, not the part (#1155): two lines make X as their main
// product, one machine of 10/min each. When nothing uses X they sink 20/min together, which
// rounding up cannot explain (it adds less than one machine of each, under 20/min), so neither
// line says rounding, although each one's own part (10/min) is below 20. When a line uses 5/min,
// the 15/min sunk is rounding, and both lines say so.
test("the sink caption's cause is the phase's, shared by the lines that make the item", () => {
  const line = (id: string, inputs: CalcRow['inputs'], outputs: CalcRow['outputs']): CalcRow => ({
    id,
    name: id,
    machine: 'Constructor',
    machines: 1,
    equivalent: 1,
    lastClock: 100,
    power: 4,
    inputs,
    outputs,
  });
  const first = line('a', { 'Iron Ore': 10 }, { X: 10 }),
    second = line('b', { 'Iron Ore': 10 }, { X: 10 }),
    user = line('c', { X: 5 }, { Y: 5 });
  const sinks = (rows: CalcRow[], surplus: number) => {
    const context: CalcFlowContext = {
      storedStage: { feasible: true, rows, surplus: { X: surplus } },
      stageKey: '3',
      settings: { wholeMachines: true },
    };
    return [first, second].map(row => {
      const sink = flowOutputs(row, context).find(output => output.kind === 'sink')!;
      return [sink.rate, sink.subTxt];
    });
  };
  assert.deepEqual(sinks([first, second], 20), [
    [10, 'more than this phase uses'],
    [10, 'more than this phase uses'],
  ]);
  assert.deepEqual(sinks([first, second, user], 15), [
    [7.5, 'whole-machine rounding surplus'],
    [7.5, 'whole-machine rounding surplus'],
  ]);
});
