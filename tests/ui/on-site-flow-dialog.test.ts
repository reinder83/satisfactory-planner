// Lines made on site in the factory dialog's flow (#956, after #868, #876 and #896): on the plan
// where Alpha (Stator) and Beta (half of Cable) both mark Wire as made on site and Gamma holds the
// rest of Cable and the central Wire line, calcFlowModel shares Wire out as the Logistics page's
// books do (itemBooks): Stator's Wire input links to "Wire for Alpha", Alpha's own line delivers
// to Stator alone (and its excess, if any, to the sink), the central line leaves Stator out, and
// every Wire line's deliveries add up to what it makes. A plan without such lines keeps exactly
// the flow it had before (tests/fixtures/flow-model-2026-10-04.json, recorded before the change
// from the plan a released planner froze). The plans are the planner's own, calculated in Node
// (generatedWith), as in on-site-flow-cards.test.ts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { beforeEach, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { calcFlowModel, flowNotes, flowOutputs, siteBooks } from '../../public/app/flow.ts';
import type { CalcFlowContext, FlowModel, FlowOutput } from '../../public/app/flow.ts';
import { onSiteSettings } from '../../public/app/on-site.ts';
import { calcStage } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, generatedWith, open, page } from './setup.ts';
import type {
  CalcRow,
  FactoryGroups,
  StoredCalculatedPlan,
  StoredStage,
} from '../../public/types/index.ts';

const BASE = { phase: '3', wholeMachines: true, limitsConfirmed: true };
const ALPHA = 'fg-alpha1',
  BETA = 'fg-beta22',
  GAMMA = 'fg-gamma3';
const WIRE = 'Recipe_Wire_C',
  STATOR = 'Recipe_Stator_C',
  CABLE = 'Recipe_Cable_C';
// A group's own Wire line (`<recipeId>:<groupId>`).
const ownLine = (groupId: string) => `${WIRE}:${groupId}`;
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
const total = (outputs: FlowOutput[]) =>
  outputs.reduce((sum, output) => sum + (output.rate || 0), 0);
const consumers = (model: FlowModel) =>
  model.outputs
    .filter(output => output.kind === 'consumer')
    .map(output => output.link?.calcFactory);

// Alpha builds Stator and Beta half of Cable, both marking Wire; Gamma holds the rest of Cable
// and the central Wire line. The plan is recalculated with those marks, as the Factories page
// does, so Alpha and Beta each get a Wire line of their own.
const plain = generatedWith(BASE);
const cableRate = plain.stages['3'].rows!.find(row => row.id === CABLE)!.outputs.Cable!;
const groups: FactoryGroups = {
  groups: [
    { id: ALPHA, name: 'Alpha' },
    { id: BETA, name: 'Beta' },
    { id: GAMMA, name: 'Gamma' },
  ],
  assignments: {
    [STATOR]: [{ group: ALPHA, rate: null }],
    [CABLE]: [
      { group: BETA, rate: cableRate / 2 },
      { group: GAMMA, rate: null },
    ],
    [WIRE]: [{ group: GAMMA, rate: null }],
  },
  local: { [ALPHA]: ['Wire'], [BETA]: ['Wire'] },
};
const plan = generatedWith({ ...BASE, onSite: onSiteSettings(plain, groups) });

// Opens `calculated` at Phase 3 with `factoryGroups`, and returns the dialog's flow model of row
// `id`.
function modelOf(
  id: string,
  calculated: StoredCalculatedPlan = plan,
  factoryGroups: FactoryGroups = groups,
): FlowModel {
  open({ calculated: structuredClone(calculated), phase: '3', state: { factoryGroups } });
  const row = calcStage()!.rows!.find(candidate => candidate.id === id);
  assert.ok(row, `the phase has row ${id}`);
  return calcFlowModel(row);
}
const rowOf = (id: string): CalcRow => plan.stages['3'].rows!.find(row => row.id === id)!;

beforeEach(() => page());

test('the plan has a Wire line of its own for Alpha and Beta beside the central one', () => {
  assert.ok(plan.stages['3'].feasible);
  assert.deepEqual(rowOf(ownLine(ALPHA)).onSite, { group: ALPHA, recipe: WIRE });
  assert.deepEqual(rowOf(ownLine(BETA)).onSite, { group: BETA, recipe: WIRE });
  assert.ok(!rowOf(WIRE).onSite);
});

test("Stator's Wire input links to Alpha's own line, which feeds it, not the central one", () => {
  const model = modelOf(STATOR);
  const wire = model.inputs.find(input => input.name === 'Wire')!;
  assert.deepEqual(wire.link, { calcFactory: ownLine(ALPHA) });
  // The recipe panel's Wire cell links there too.
  assert.deepEqual(model.recipe!.ins.find(([name]) => name === 'Wire')![2], {
    calcFactory: ownLine(ALPHA),
  });
  // Cable takes half its Wire from Beta's own line and half from the central one: a tie goes to
  // the group its memberships list first, Beta, as its build-plan step does.
  assert.deepEqual(modelOf(CABLE).inputs.find(input => input.name === 'Wire')!.link, {
    calcFactory: ownLine(BETA),
  });
});

test("Alpha's own Wire line delivers to Stator only, and the sink", () => {
  const model = modelOf(ownLine(ALPHA));
  assert.deepEqual(consumers(model), [STATOR]);
  assert.deepEqual(
    model.outputs.filter(output => output.kind !== 'consumer').map(output => output.kind),
    model.outputs.filter(output => output.kind !== 'consumer').map(() => 'sink'),
    'no storage, delivery or reserve: those draw on the central line',
  );
  const stator = model.outputs.find(output => output.kind === 'consumer')!;
  assert.ok(near(stator.rate!, rowOf(STATOR).inputs.Wire!), 'all of Stator’s Wire');
  // One delivery: no split across consumers it never feeds.
  assert.doesNotMatch(model.bar!.sub, /split/);
  assert.deepEqual(model.bankNote, { shared: false, ownLine: 'Alpha' });
  // Beta's own line delivers Beta's half of Cable.
  const beta = modelOf(ownLine(BETA));
  assert.deepEqual(consumers(beta), [CABLE]);
  assert.ok(near(beta.outputs[0]!.rate!, rowOf(CABLE).inputs.Wire! / 2));
});

test('the central Wire line leaves out the consumers the own lines feed', () => {
  const model = modelOf(WIRE);
  assert.deepEqual(consumers(model), [CABLE], 'Stator is not among its deliveries');
  const cable = model.outputs.find(output => output.kind === 'consumer')!;
  assert.ok(near(cable.rate!, rowOf(CABLE).inputs.Wire! / 2), 'only Gamma’s half of Cable');
  // Storage and the plan's surplus stay with the central line.
  assert.ok(model.outputs.some(output => output.kind === 'store'));
  assert.ok(
    near(
      total(model.outputs.filter(output => output.kind === 'sink')),
      plan.stages['3'].surplus!.Wire!,
    ),
  );
  assert.deepEqual(model.bankNote, { shared: false, lessOnSite: true });
});

test("each Wire line's deliveries add up to what it makes, and so does the split", () => {
  for (const id of [WIRE, ownLine(ALPHA), ownLine(BETA)]) {
    const model = modelOf(id);
    const made = rowOf(id).outputs.Wire!;
    assert.ok(near(total(model.outputs), made), `${id}: ${total(model.outputs)} of ${made}`);
    // The split counts the machines of each delivery but the sink, and those cover the line's.
    const split = model.outputs.filter(o => o.mach !== undefined && o.kind !== 'sink');
    const sunk = total(model.outputs.filter(o => o.kind === 'sink'));
    const machines = split.reduce((sum, output) => sum + output.mach!, 0);
    assert.ok(near(machines, ((made - sunk) / made) * model.equivalent), id);
  }
  assert.match(modelOf(WIRE).bar!.sub, / · split ≈ 5 \/ 1 across the deliveries below$/);
});

test("LaneAdvice's other consumers on the same belt are those the feeding line delivers to", () => {
  // Stator's Wire comes from Alpha's line, which feeds nothing else.
  assert.deepEqual(modelOf(STATOR).sameItemConsumers('Wire'), []);
  // Cable's comes from Beta's line, which feeds nothing else either; the central line's Cable
  // half is not on that belt.
  assert.deepEqual(modelOf(CABLE).sameItemConsumers('Wire'), []);
});

test('an own line sends what it makes beyond its group’s demand to the sink', () => {
  // A hand-made phase: Alpha's own line makes 100 Wire for Stator's 80, the central line 60 for
  // Cable's 50; the plan sinks 30, 20 of them from Alpha's line.
  const row = (id: string, inputs: CalcRow['inputs'], outputs: CalcRow['outputs']): CalcRow => ({
    id,
    name: id,
    phase: 3,
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
  const own = { ...row(ownLine(ALPHA), {}, { Wire: 100 }), onSite: { group: ALPHA, recipe: WIRE } };
  const central = row(WIRE, {}, { Wire: 60 });
  const stator = row(STATOR, { Wire: 80 }, { Stator: 10 });
  const cable = row(CABLE, { Wire: 50 }, { Cable: 25 });
  const storedStage: StoredStage = {
    feasible: true,
    rows: [own, central, stator, cable],
    surplus: { Wire: 30 },
  };
  const handGroups: FactoryGroups = {
    groups: [{ id: ALPHA, name: 'Alpha' }],
    assignments: { [STATOR]: [{ group: ALPHA, rate: null }] },
    local: { [ALPHA]: ['Wire'] },
  };
  const context: CalcFlowContext = {
    storedStage,
    stageKey: '3',
    settings: undefined,
    site: siteBooks(storedStage, handGroups)!,
  };
  const rates = (outputs: FlowOutput[]) => outputs.map(output => [output.label, output.rate]);
  assert.deepEqual(rates(flowOutputs(own, context)), [
    [STATOR, 80],
    ['AWESOME Sink', 20],
  ]);
  assert.deepEqual(rates(flowOutputs(central, context)), [
    [CABLE, 50],
    ['AWESOME Sink', 10],
  ]);
  // The sink takes no machines of the split.
  assert.equal(flowNotes(own, flowOutputs(own, context), context).split, '');
  // Without a line made on site there are no books, and the flow is shared plan-wide.
  assert.equal(siteBooks({ feasible: true, rows: [central, cable] }, handGroups), undefined);
});

test('the dialogs draw it: Stator links to "Wire for Alpha", whose deliveries are Stator', () => {
  open({ calculated: structuredClone(plan), phase: '3', state: { factoryGroups: groups } });
  render();
  openCalculatedFactory(STATOR);
  const tile = $('#detail .rail-grid .rail-tile[data-calc-factory]');
  assert.ok(
    $$('#detail .rail-tile').some(el => el.dataset.calcFactory === ownLine(ALPHA)),
    `Wire's tile opens Alpha's own line (${tile?.dataset.calcFactory})`,
  );
  assert.ok(!$$('#detail .rail-tile').some(el => el.dataset.calcFactory === WIRE));
  openCalculatedFactory(ownLine(ALPHA));
  assert.deepEqual(
    $$('#detail .rail-row.consumer .rail-link').map(el => el.dataset.calcFactory),
    [STATOR],
  );
  assert.match($('#detail')!.textContent || '', /Demand of Alpha's lines/);
});

// The flow models of a few rows of a plan without lines made on site, recorded before #956
// (the dialog's model with each input's sameItemConsumers called), from the Phase 3 plan a
// released planner froze. Its rows cover a shared item (Plastic), byproducts, many
// destinations (Screws), Wire, Stator, Cable and a generator.
const frozen: StoredCalculatedPlan = JSON.parse(
  fs.readFileSync('tests/fixtures/calculated-plan-2026-09-12.json', 'utf8'),
);
const recorded: Record<string, unknown> = JSON.parse(
  fs.readFileSync('tests/fixtures/flow-model-2026-10-04.json', 'utf8'),
);
const snapshot = (model: FlowModel) =>
  JSON.parse(
    JSON.stringify({
      ...model,
      sameItemConsumers: Object.fromEntries(
        model.inputs.map(input => [input.name, model.sameItemConsumers(input.name)]),
      ),
    }),
  );

test('a plan without lines made on site keeps exactly the flow it had', () => {
  const noGroups: FactoryGroups = { groups: [], assignments: {} };
  // Groups with split rows and marks still count for nothing until a recalculation makes the
  // lines (#868).
  const marked: FactoryGroups = {
    groups: [
      { id: ALPHA, name: 'Alpha' },
      { id: BETA, name: 'Beta' },
    ],
    assignments: {
      [STATOR]: [{ group: ALPHA, rate: null }],
      [CABLE]: [
        { group: ALPHA, rate: 20 },
        { group: BETA, rate: null },
      ],
      [WIRE]: [{ group: BETA, rate: null }],
    },
    local: { [ALPHA]: ['Wire'], [BETA]: ['Wire', 'Copper Ingot'] },
  };
  assert.equal(Object.keys(recorded).length, 8);
  // The recording's numbers read as in en-US ("420.25"): num() formats in the machine's locale,
  // so it is pinned here, or the comparison would depend on where the tests run.
  const toLocale = Number.prototype.toLocaleString;
  Number.prototype.toLocaleString = function (
    _locale?: unknown,
    options?: Intl.NumberFormatOptions,
  ) {
    return toLocale.call(this, 'en-US', options);
  };
  try {
    for (const factoryGroups of [noGroups, marked])
      for (const [id, model] of Object.entries(recorded))
        assert.deepEqual(snapshot(modelOf(id, frozen, factoryGroups)), model, id);
  } finally {
    Number.prototype.toLocaleString = toLocale;
  }
});
