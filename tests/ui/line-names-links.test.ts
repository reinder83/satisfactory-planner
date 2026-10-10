// When an item has several production lines (a group's own line made on site, "Wire for Alpha",
// beside the central "Wire" line, #868), every place that names or links one tells them apart
// (#1020): a step's linked-line choices (taskLinkChoices, #954) and the factory dialog's
// deliveries and spare-belt suggestions (flow.ts, #964) name each line as its build-plan step
// (rowStepTitle), and an input links to the single line that gives the row the most of the item
// (inputSource, #972 and the #1033 review), compared line by line. The plan is the one of
// on-site-flow-dialog.test.ts: Alpha (Stator) and Beta (half of Cable) mark Wire, Gamma holds the
// rest of Cable and the central Wire line, recalculated so Alpha and Beta get a Wire line each.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { calcFlowModel, flowInputs, siteBooks } from '../../public/app/flow.ts';
import type { CalcFlowContext } from '../../public/app/flow.ts';
import { onSiteSettings } from '../../public/app/on-site.ts';
import { calcStage, setHideDone, setPlanEditing, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { taskLinkChoices } from '../../public/app/tasks.ts';
import { $, $$, generatedWith, go, open, page } from './setup.ts';
import type { CalcRow, FactoryGroups, StoredStage } from '../../public/types/index.ts';

const BASE = { phase: '3', wholeMachines: true, limitsConfirmed: true };
const ALPHA = 'fg-alpha1',
  BETA = 'fg-beta22',
  GAMMA = 'fg-gamma3';
const WIRE = 'Recipe_Wire_C',
  STATOR = 'Recipe_Stator_C',
  CABLE = 'Recipe_Cable_C';
const ownLine = (groupId: string) => `${WIRE}:${groupId}`;

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
const rows = plan.stages['3'].rows!;
// The central Copper Ingot line, which feeds all three Wire lines.
const COPPER = rows.find(row => row.outputs['Copper Ingot'] && !row.onSite && !row.stock)!.id;

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const openPlan = () =>
  open({ calculated: structuredClone(plan), phase: '3', state: { factoryGroups: groups } });

beforeEach(() => page());

test('the plan has the three Wire lines, all fed by one central Copper Ingot line', () => {
  for (const id of [WIRE, ownLine(ALPHA), ownLine(BETA)]) {
    const row = rows.find(candidate => candidate.id === id);
    assert.ok(row?.inputs['Copper Ingot'], `${id} takes Copper Ingot`);
  }
  assert.equal(rows.filter(row => row.outputs['Copper Ingot']).length, 1);
});

test("a step's linked-line choices name each Wire line as its step (#954)", async () => {
  openPlan();
  const choices = new Map(taskLinkChoices({ id: 'phase-3-iron' } as never).options);
  assert.equal(choices.get(WIRE), 'Wire');
  assert.equal(choices.get(ownLine(ALPHA)), 'Wire for Alpha');
  assert.equal(choices.get(ownLine(BETA)), 'Wire for Beta');
  // Every other line keeps its name.
  assert.equal(choices.get(STATOR), 'Stator');

  // The edit form draws them so.
  setQuery('');
  setHideDone(false);
  go('plan');
  setPlanEditing(true);
  render();
  const id = `calc-3-${ownLine(ALPHA)}`;
  $(`#main [data-edit-task="${id}"]`)!.click();
  await settle();
  const select = $<HTMLSelectElement>(`#main [data-task-edit="${id}"] [name=link]`)!;
  assert.ok(select, 'the edit form opened');
  const options = [...select.options].map(option => [option.value, option.textContent!.trim()]);
  assert.deepEqual(
    options.filter(([value]) => value.startsWith(WIRE)),
    [WIRE, ownLine(ALPHA), ownLine(BETA)]
      .map(value => [value, rows.findIndex(row => row.id === value)] as const)
      .sort((a, b) => a[1] - b[1])
      .map(([value]) => [
        value,
        value === WIRE ? 'Wire' : value === ownLine(ALPHA) ? 'Wire for Alpha' : 'Wire for Beta',
      ]),
  );
  assert.equal(select.value, ownLine(ALPHA), 'the step links its own line');
  setPlanEditing(false);
});

test('the dialog names each Wire line it delivers to as its step (#964)', () => {
  openPlan();
  const model = calcFlowModel(calcStage()!.rows!.find(row => row.id === COPPER)!);
  const deliveries = new Map(
    model.outputs
      .filter(output => output.kind === 'consumer')
      .map(output => [output.link!.calcFactory, output.label]),
  );
  assert.equal(deliveries.get(WIRE), 'Wire');
  assert.equal(deliveries.get(ownLine(ALPHA)), 'Wire for Alpha');
  assert.equal(deliveries.get(ownLine(BETA)), 'Wire for Beta');

  // The dialog draws them so, each a link to its own line.
  render();
  openCalculatedFactory(COPPER);
  const links = new Map(
    $$('#detail .rail-row.consumer .rail-link').map(el => [
      el.dataset.calcFactory,
      el.textContent!.replace(/\s+/g, ' ').trim(),
    ]),
  );
  assert.equal(links.get(ownLine(ALPHA)), 'Wire for Alpha ↗');
  assert.equal(links.get(ownLine(BETA)), 'Wire for Beta ↗');
  assert.equal(links.get(WIRE), 'Wire ↗');
});

test('the spare-belt advice names another Wire line as its step (#964)', () => {
  openPlan();
  // Alpha's own Wire line takes its Copper Ingot from the central line, which every Wire line
  // shares: the other two are the lines that could share its belt.
  const model = calcFlowModel(calcStage()!.rows!.find(row => row.id === ownLine(ALPHA))!);
  const others = new Map(
    model.sameItemConsumers('Copper Ingot').map(other => [other.link.calcFactory, other.label]),
  );
  assert.equal(others.get(WIRE), 'Wire');
  assert.equal(others.get(ownLine(BETA)), 'Wire for Beta');
  assert.ok(!others.has(ownLine(ALPHA)), 'not the line itself');
});

// A hand-made phase's row.
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
const linkOf = (consumer: CalcRow, item: string, context: CalcFlowContext) =>
  flowInputs(consumer, context).find(input => input.name === item)!.link?.calcFactory;

test('plan-wide, an input links to the line making the most of the item, not the first', () => {
  const small = row('Recipe_Plastic_C', {}, { Plastic: 30 });
  const large = row('Recipe_ResidualPlastic_C', {}, { Plastic: 90 });
  const computer = row('Recipe_Computer_C', { Plastic: 60 }, { Computer: 5 });
  const context: CalcFlowContext = {
    storedStage: { feasible: true, rows: [small, large, computer] },
    stageKey: '3',
    settings: undefined,
  };
  assert.equal(linkOf(computer, 'Plastic', context), large.id);
  // On a tie, the first in the phase's order.
  const even: StoredStage = {
    feasible: true,
    rows: [small, { ...large, outputs: { Plastic: 30 } }, computer],
  };
  assert.equal(linkOf(computer, 'Plastic', { ...context, storedStage: even }), small.id);
});

test('an input made on site links to the central line when it gives the row more than any own line (#972)', () => {
  // As in the issue: Computer takes 80 Plastic, half for Rand0 and half for Rand2. Rand0's two
  // own lines give its half together, 35 and 5; the central line gives Rand2's half, 40.
  const R0 = 'fg-rand0',
    R2 = 'fg-rand2';
  const ownPlastic = {
    ...row(`Recipe_Plastic_C:${R0}`, {}, { Plastic: 35 }),
    onSite: { group: R0, recipe: 'Recipe_Plastic_C' },
  };
  const ownResidual = {
    ...row(`Recipe_ResidualPlastic_C:${R0}`, {}, { Plastic: 5 }),
    onSite: { group: R0, recipe: 'Recipe_ResidualPlastic_C' },
  };
  const central = row('Recipe_Plastic_C', {}, { Plastic: 40 });
  const computer = row('Recipe_Computer_C', { Plastic: 80 }, { Computer: 10 });
  const storedStage: StoredStage = {
    feasible: true,
    rows: [ownPlastic, ownResidual, central, computer],
  };
  const handGroups: FactoryGroups = {
    groups: [
      { id: R0, name: 'Rand0' },
      { id: R2, name: 'Rand2' },
    ],
    assignments: {
      Recipe_Computer_C: [
        { group: R0, rate: 5 },
        { group: R2, rate: null },
      ],
    },
    local: { [R0]: ['Plastic'] },
  };
  const context: CalcFlowContext = {
    storedStage,
    stageKey: '3',
    settings: undefined,
    site: siteBooks(storedStage, handGroups)!,
  };
  assert.equal(linkOf(computer, 'Plastic', context), central.id);
  // When Rand0 holds three quarters of Computer, its first own line gives the most (52.5 of 60
  // of Rand0's part, against the central line's 20): the link goes there.
  const more: FactoryGroups = {
    ...handGroups,
    assignments: {
      Recipe_Computer_C: [
        { group: R0, rate: 7.5 },
        { group: R2, rate: null },
      ],
    },
  };
  const moreStage: StoredStage = {
    ...storedStage,
    rows: [
      { ...ownPlastic, outputs: { Plastic: 52.5 } },
      { ...ownResidual, outputs: { Plastic: 7.5 } },
      { ...central, outputs: { Plastic: 20 } },
      computer,
    ],
  };
  assert.equal(
    linkOf(computer, 'Plastic', {
      ...context,
      storedStage: moreStage,
      site: siteBooks(moreStage, more)!,
    }),
    ownPlastic.id,
  );
});

test('the input tile opens the line giving the row the most', () => {
  // Cable's Wire: half from Beta's own line, half from the central line. A tie goes to the own
  // line of the group the row's memberships list first, Beta, as its build-plan step does.
  openPlan();
  render();
  openCalculatedFactory(CABLE);
  const tile = $$('#detail .rail-tile[data-calc-factory]').find(el =>
    el.textContent!.includes('Wire'),
  );
  assert.equal(tile?.dataset.calcFactory, ownLine(BETA));
});
