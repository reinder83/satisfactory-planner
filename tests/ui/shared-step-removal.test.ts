// A step one id shares between phases (the biomass start-up) is one step
// in every phase that lists it: one checkmark, and taskEdits.removed holds step ids, so removing
// it in Phase 3 removes it in Phase 4 too. The build plan says so where it happens (#744,
// public/app/shared-steps.ts): the Remove confirmation names the other phases, and "Removed
// steps in this phase" notes them under the step. A step only this phase lists keeps the old
// wording and no note. A milestone is such a step no longer: each is listed once, under its own
// phase (#758).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setHideDone, setPlanEditing, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { sharedStepPhases } from '../../public/app/shared-steps.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { $, answerConfirms, generated, go, open, page } from './setup.ts';
import type { Phase, TaskEdits } from '../../public/types/index.ts';

// Tier 6: Industrial Manufacturing, which the plan's Phase 3 and later rows need. It is a Phase 3
// milestone, so a profile that starts in Phase 3 lists it in Phase 3 only (#758). (A Phase 1
// milestone such as Base Building is listed in the milestone-only Phase 1 since #759.)
const MILESTONE = 'unlock-Schematic_5-2_C';
// The biomass start-up, which every phase lists until Coal Power is ticked.
const SHARED = 'startup-biomass';

beforeEach(() => page());

// A calculated profile that starts in Phase 3, on the build plan of `phase` in edit mode, with
// `removed` steps removed.
async function editPlan(phase: Phase, removed: string[] = []) {
  const plan = generated();
  plan.settings.phase = '3';
  const taskEdits: TaskEdits = { order: {}, removed, titles: {}, bodies: {}, links: {} };
  open({ calculated: plan, phase, state: { taskEdits } });
  setQuery('');
  setHideDone(false);
  go('plan');
  setPlanEditing(true);
  render();
  await nextTick();
}

const sharedNote = (id: string) =>
  $(`#main .removed-steps [data-restore-task="${id}"]`)!
    .closest('.removed-step')!
    .querySelector('[data-shared-step]')
    ?.textContent?.trim();

test('the biomass start-up is shared with the later phases; a milestone and a phase-numbered step are not', async () => {
  await editPlan('3');
  const ids = planTasks().map(t => t.id);
  assert.ok(ids.includes(MILESTONE), 'Phase 3 lists Tier 6: Industrial Manufacturing');
  assert.ok(ids.includes(SHARED), 'and the biomass start-up');
  assert.ok(ids.includes('calc-3-storage'), 'and its own storage step');
  const shared = sharedStepPhases([MILESTONE, SHARED, 'calc-3-storage']);
  assert.deepEqual(shared.get(SHARED), ['Phase 4', 'Phase 5', 'Post Phase 5']);
  assert.equal(shared.has(MILESTONE), false, 'a milestone is listed in one phase only');
  assert.equal(shared.has('calc-3-storage'), false, 'calc-3-… is Phase 3 only');
});

test('post-game shares Phase 5 steps, and phases before the start phase are not counted', async () => {
  await editPlan('5');
  const shared = sharedStepPhases(['calc-5-storage', SHARED]);
  assert.deepEqual(shared.get('calc-5-storage'), ['Post Phase 5']);
  assert.deepEqual(shared.get(SHARED), ['Phase 3', 'Phase 4', 'Post Phase 5']);
});

test('Removed steps notes the other phases under a shared step only', async () => {
  await editPlan('4', [SHARED, MILESTONE, 'calc-4-storage', 'calc-3-storage']);
  assert.equal(
    sharedNote(SHARED),
    'Also in Phase 3, Phase 5 and Post Phase 5: removed and restored there too.',
  );
  assert.equal(sharedNote('calc-4-storage'), undefined, 'a Phase 4 step has no note');
  assert.equal(
    $('#main .removed-steps summary')!.textContent,
    'Removed steps in this phase (2)',
    'a step only Phase 3 lists (its storage and the milestone) is not listed on Phase 4',
  );
});

test('a removed milestone has no note in the one phase that lists it', async () => {
  await editPlan('3', [MILESTONE]);
  assert.equal(sharedNote(MILESTONE), undefined);
});

test('the Remove confirmation names the phases a shared step also goes from', async () => {
  await editPlan('3');
  const asked = answerConfirms(false);
  for (const id of [SHARED, MILESTONE, 'calc-3-storage']) {
    $(`#main [data-remove-step="${id}"]`)!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const plain =
    'Remove this step from your build plan? Its checkmark is kept and you can restore the step while editing.';
  assert.deepEqual(asked, [
    'Remove this step from your build plan? Phase 4, Phase 5 and Post Phase 5 list the same step, so it is removed there too. Its checkmark is kept and you can restore the step while editing.',
    plain,
    plain,
  ]);
});
