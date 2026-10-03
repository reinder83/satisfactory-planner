// The build plan goes group by group (#869): with factory groups, a calculated phase's production
// steps are ordered by group (groupedRows in public/app/group-order.ts), and only their order changes.
// Ticks stay on their steps, a phase the user reordered keeps its saved order, and a personal
// task stays beside the step it was put after.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { setHideDone, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { calcTasks, currentBuildStatus } from '../../public/app/views/calculated.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { $, $$, generated, go, open, page } from './setup.ts';
import type { FactoryGroups, Phase, ProgressState, TaskEdits } from '../../public/types/index.ts';

const plan = generated();
const rows = plan.stages['3'].rows!;
// Every other row in each of two groups, so the planner's order switches group at every step.
const factoryGroups: FactoryGroups = {
  groups: [
    { id: 'fg-a', name: 'Site A' },
    { id: 'fg-b', name: 'Site B' },
  ],
  assignments: Object.fromEntries(
    rows.map((row, i) => [row.id, [{ group: i % 2 ? 'fg-b' : 'fg-a', rate: null }]]),
  ),
};
const groupOf = (id: string) =>
  factoryGroups.assignments[id.replace(/^calc-3-/, '')]?.[0]?.group ?? '';
const ids = () => planTasks().map(t => t.id);
const shown = () => $$('#main .checklist [data-check]').map(e => e.dataset.check);
const show = async (state: Partial<ProgressState> = {}) => {
  open({ calculated: structuredClone(plan), state });
  render();
  await nextTick();
};
// How often the row steps switch group, in the order given.
const switches = (list: string[]) => {
  const groupsInOrder = list
    .filter(id => id.startsWith('calc-3-'))
    .map(groupOf)
    .filter(Boolean);
  return groupsInOrder.filter((group, i) => i && group !== groupsInOrder[i - 1]).length;
};

beforeEach(() => {
  page();
  setQuery('');
  setHideDone(false);
  go('plan');
  setAdaIndex(0);
  adaClearFault();
});

test('with groups the build plan lists the same steps, fewer group switches apart', async () => {
  await show();
  const plain = ids();
  await show({ factoryGroups });
  assert.deepEqual([...ids()].sort(), [...plain].sort(), 'the same steps');
  assert.notDeepEqual(ids(), plain, 'in another order');
  assert.ok(switches(ids()) < switches(plain), 'fewer switches between sites');
  assert.deepEqual(shown(), ids(), 'the checklist draws that order');
});

test('a ticked step keeps its tick when the groups reorder it', async () => {
  const ticked = `calc-3-${rows[1]!.id}`;
  await show({ checks: { [ticked]: true }, factoryGroups });
  const box = $<HTMLInputElement>(`#main .checklist [data-check="${ticked}"]`)!;
  assert.equal(box.checked, true);
});

test('a personal task stays after the step it was put after, and a saved order stays', async () => {
  const anchor = `calc-3-${rows[2]!.id}`;
  // The user put a personal task right after the anchor, which saved the phase's order.
  await show();
  const saved = ids().flatMap(id => (id === anchor ? [id, 'custom-1'] : [id]));
  const state = {
    customTasks: [{ id: 'custom-1', title: 'Pave the yard', phase: '3' as const }],
    taskEdits: { order: { '3': saved } } as TaskEdits,
  };
  await show(state);
  assert.deepEqual(ids(), saved);
  await show({ ...state, factoryGroups });
  assert.deepEqual(ids(), saved, 'a reordered phase keeps the order the user saved');
  assert.equal(ids()[ids().indexOf(anchor) + 1], 'custom-1');
  assert.deepEqual(shown(), ids(), 'the checklist draws that order');
});

test('a personal task in a phase never reordered stays last', async () => {
  const customTasks = [{ id: 'custom-1', title: 'Pave the yard', phase: '3' as const }];
  await show({ customTasks, factoryGroups });
  assert.equal(ids().at(-1), 'custom-1');
});

test('with nothing built, the build status names the first production step the plan shows', async () => {
  // The copper lines in a group listed first, which needs nothing from the other: the plan starts
  // there rather than with the planner's first row, Iron Ingot.
  const copper = [
    'Recipe_IngotCopper_C',
    'Recipe_CopperSheet_C',
    'Recipe_Wire_C',
    'Recipe_Cable_C',
  ];
  assert.ok(copper.every(id => rows.some(row => row.id === id)) && rows[0]!.id !== copper[0]);
  await show({
    factoryGroups: {
      groups: factoryGroups.groups,
      assignments: Object.fromEntries(
        rows.map(row => [
          row.id,
          [{ group: copper.includes(row.id) ? 'fg-a' : 'fg-b', rate: null }],
        ]),
      ),
    },
  });
  const first = ids().find(id => id.startsWith('calc-3-'));
  assert.equal(first, 'calc-3-Recipe_IngotCopper_C');
  assert.equal('calc-3-' + currentBuildStatus()?.next?.id, first);
});

// ADA's remarks on the build plan of `phase` of the plan above, by id.
function planRemarks(phase: Phase, state: Partial<ProgressState>) {
  open({ calculated: structuredClone(plan), phase, state });
  go('plan');
  const remarks = new Set<string>();
  for (let i = 0; i < 40; i++) {
    setAdaIndex(i);
    const id = adaCurrent()?.id;
    if (id) remarks.add(id);
  }
  return remarks;
}

test('ADA says the steps follow the groups only when the groups change their order', () => {
  const defaults = defaultFactoryGroups(plan);
  // Default groups keep the planner's order in Phases 1 and 2 of this plan, and change it in 3.
  for (const phase of ['1', '2'] as const) {
    const plain = calcTasks(phase).map(t => t.id);
    open({ calculated: structuredClone(plan), phase, state: { factoryGroups: defaults } });
    assert.deepEqual(
      calcTasks(phase).map(t => t.id),
      plain,
      `Phase ${phase} keeps the planner's order`,
    );
    assert.equal(planRemarks(phase, { factoryGroups: defaults }).has('grouped-steps'), false);
  }
  assert.ok(planRemarks('3', { factoryGroups: defaults }).has('grouped-steps'));
  // Groups with no rows assigned change nothing either.
  const empty = { groups: factoryGroups.groups, assignments: {} };
  assert.equal(planRemarks('3', { factoryGroups: empty }).has('grouped-steps'), false);
  assert.ok(planRemarks('3', { factoryGroups }).has('grouped-steps'));
});
