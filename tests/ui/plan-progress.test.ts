// The build plan's progress bar on a phase without steps (#725, public/app/ui/plan/PlanProgress.vue):
// an empty bar, not a full one, with a valid range for the progressbar role.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setHideDone, setQuery, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { $, go, migratedPlan, openMigrated, page } from './setup.ts';

beforeEach(() => {
  page();
  setQuery('');
  setHideDone(false);
});

test('a phase without steps draws an empty bar with a valid range', async () => {
  // A profile migrated from the handbook (#387) whose guide has no steps for the phase.
  const plan = migratedPlan();
  plan.guide = { ...plan.guide!, phases: {} };
  openMigrated({ calculated: plan });
  assert.equal(planTasks().length, 0);
  go('plan');
  render();
  await nextTick();
  const bar = $('#main .plan-progress [role=progressbar]')!;
  assert.equal(bar.querySelector('span')!.style.width, '0%', 'nothing is filled');
  assert.equal(bar.getAttribute('aria-valuemin'), '0');
  assert.equal(bar.getAttribute('aria-valuemax'), '1', 'the maximum is above the minimum');
  assert.equal(bar.getAttribute('aria-valuenow'), '0');
  assert.equal(bar.getAttribute('aria-valuetext'), 'No steps in this phase');
  assert.equal($('[data-plan-progress]')!.textContent, '0 of 0 done');
});

test('a phase with steps keeps its count as the range', async () => {
  openMigrated();
  const tasks = planTasks();
  assert.ok(tasks.length > 1);
  state.checks[tasks[0]!.id] = true;
  go('plan');
  render();
  await nextTick();
  const bar = $('#main .plan-progress [role=progressbar]')!;
  assert.equal(bar.getAttribute('aria-valuemax'), String(tasks.length));
  assert.equal(bar.getAttribute('aria-valuenow'), '1');
  assert.equal(bar.getAttribute('aria-valuetext'), `1 of ${tasks.length} steps done`);
  assert.equal(bar.querySelector('span')!.style.width, Math.round(100 / tasks.length) + '%');
});
