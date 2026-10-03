// A factory group's own line made on site (#876, part of #868): its factory card sits in its group
// and names it, the group editor is not offered for it, its build-plan step names the group and
// ticks like any other, and ticks a recalculation kept for review are listed on the Notes page.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setFactoryEditing, setFactoryFilter, setQuery, state } from '../../public/app/session.ts';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { render } from '../../public/app/shell.ts';
import { factoryGroupsState, membershipsOf } from '../../public/app/views/factories.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { $, $$, applyUpdate, generated, go, open, page, stubFetch } from './setup.ts';
import type {
  CalcRow,
  CurrentCalculatedPlan,
  FactoryGroups,
  ProgressState,
  UpdateOp,
} from '../../public/types/index.ts';

const WIRE = 'Recipe_Wire_C';
const SITE = 'fg-sitea1';
const LINE = `${WIRE}:${SITE}`;

// Phase 3 of a generated plan with Site A's own Wire line beside the central one.
function sitePlan(): CurrentCalculatedPlan {
  const plan = generated();
  const rows = plan.stages['3'].rows!;
  const wire = rows.find(row => row.id === WIRE)!;
  const line: CalcRow = { ...wire, id: LINE, onSite: { group: SITE, recipe: WIRE } };
  rows.splice(rows.indexOf(wire) + 1, 0, line);
  return plan;
}
const groups = (): FactoryGroups => ({
  groups: [{ id: SITE, name: 'Site A' }],
  assignments: { Recipe_Stator_C: [{ group: SITE, rate: null }] },
  local: { [SITE]: ['Wire'] },
});
const show = async (progress: Partial<ProgressState> = {}) => {
  open({ calculated: sitePlan(), state: { factoryGroups: groups(), ...progress } });
  render();
  await nextTick();
};
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};

beforeEach(() => {
  page();
  setQuery('');
  setFactoryFilter('all');
  setFactoryEditing(false);
});

test('the factories page puts a group line in its group and names it', async () => {
  go('factories');
  await show();
  assert.deepEqual(factoryGroupsState().local, { [SITE]: ['Wire'] }, 'local is kept');
  assert.deepEqual(membershipsOf(LINE), [{ group: SITE, rate: null }]);
  assert.deepEqual(membershipsOf(WIRE), [], 'the central line has its own memberships');
  const group = $$('#main .user-group').find(g => g.querySelector('h2')!.textContent === 'Site A')!;
  const card = group.querySelector(`[data-calc-factory="${LINE}"]`)!.closest('.factory-card')!;
  assert.equal(card.querySelector('[data-on-site]')!.textContent, 'Made on site for Site A');
  assert.equal(card.querySelector('.allocation:not([data-on-site])'), null, 'wholly here');
  // The central line stays out of the group.
  assert.equal(group.querySelector(`[data-calc-factory="${WIRE}"]`), null);
  // In edit mode its membership is the plan's, so no group editor; the central line keeps one.
  setFactoryEditing(true);
  render();
  await nextTick();
  assert.equal($(`[data-assign-add="${LINE}"]`), null);
  assert.ok($(`[data-assign-add="${WIRE}"]`));
});

test('a group line has a build-plan step named for its group, and ticks like any other', async () => {
  go('plan');
  await show();
  const step = planTasks().find(task => task.id === 'calc-3-' + LINE)!;
  assert.equal(step.title, 'Wire for Site A');
  assert.match(step.body ?? '', /^Made on site for Site A: /);
  const central = planTasks().find(task => task.id === 'calc-3-' + WIRE)!;
  assert.equal(central.title, 'Wire');
  stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  const box = $<HTMLInputElement>(`#main [data-check="calc-3-${LINE}"]`)!;
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.equal(state.checks['calc-3-' + LINE], true);
  assert.equal(state.checks['calc-3-' + WIRE], undefined, 'the central line stays unticked');
});

test('the Notes page lists ticks kept for review, and nothing without them', async () => {
  go('notes');
  await show({ onSiteReview: { checks: { ['calc-3-' + WIRE]: true } } });
  const panel = $('#main [data-site-review]')!;
  assert.equal($('#site-review-title')!.textContent, 'Ticks kept for review');
  const entry = panel.querySelector(`[data-site-review-check="calc-3-${WIRE}"]`)!;
  assert.match(entry.textContent!, /Wire, Phase 3/);
  assert.match(entry.textContent!, /Ticked/);
  assert.match(entry.textContent!, /Now made on site for Site A, and on a central line\./);
  await show();
  assert.equal($('#main [data-site-review]'), null);
});

test('the build status and ADA name a ticked group line for its group (#911)', async () => {
  go('plan');
  await show({ checks: { ['calc-3-' + LINE]: true } });
  const waiting = $('#main [data-build-waiting]')!;
  const names = [...waiting.querySelectorAll('li button')].map(button => button.textContent);
  assert.deepEqual(names, ['Wire for Site A']);
  setAdaIndex(0);
  adaClearFault();
  let remark = '';
  for (let i = 0; i < 40 && !remark; i++) {
    setAdaIndex(i);
    const line = adaCurrent();
    if (line?.id === 'build-waiting') remark = line.text;
  }
  assert.match(remark, /^Wire for Site A is marked running but short of /);
});
