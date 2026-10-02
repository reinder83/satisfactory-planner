// A step one id shares between phases (a milestone, an alternate's unlock, the biomass
// start-up) is one step in every phase that lists it: one checkmark, and taskEdits.removed holds
// step ids, so removing it in Phase 3 removes it in Phase 4 too. The build plan says so where it
// happens (#744, public/app/shared-steps.ts): the Remove confirmation names the other phases, and
// "Removed steps in this phase" notes them under the step. A step only this phase lists keeps the
// old wording and no note.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setHideDone, setPlanEditing, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { sharedStepPhases } from '../../public/app/shared-steps.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { $, answerConfirms, generated, go, open, page } from './setup.ts';
import type { Phase, TaskEdits } from '../../public/types/index.ts';

// Tier 1: Base Building, which requiredMilestones (progression.ts) adds to every phase.
const MILESTONE = 'unlock-Schematic_1-1_C';

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

test('a milestone is shared with the later phases; a phase-numbered step is not', async () => {
  await editPlan('3');
  const ids = planTasks().map(t => t.id);
  assert.ok(ids.includes(MILESTONE), 'Phase 3 lists Tier 1: Base Building');
  assert.ok(ids.includes('calc-3-storage'), 'and its own storage step');
  const shared = sharedStepPhases([MILESTONE, 'calc-3-storage']);
  assert.deepEqual(shared.get(MILESTONE), ['Phase 4', 'Phase 5', 'Post Phase 5']);
  assert.equal(shared.has('calc-3-storage'), false, 'calc-3-… is Phase 3 only');
});

test('post-game shares Phase 5 steps, and phases before the start phase are not counted', async () => {
  await editPlan('5');
  const shared = sharedStepPhases(['calc-5-storage', MILESTONE]);
  assert.deepEqual(shared.get('calc-5-storage'), ['Post Phase 5']);
  assert.deepEqual(shared.get(MILESTONE), ['Phase 3', 'Phase 4', 'Post Phase 5']);
});

test('Removed steps notes the other phases under a shared step only', async () => {
  await editPlan('4', [MILESTONE, 'calc-4-storage', 'calc-3-storage']);
  assert.equal(
    sharedNote(MILESTONE),
    'Also in Phase 3, Phase 5 and Post Phase 5: removed and restored there too.',
  );
  assert.equal(sharedNote('calc-4-storage'), undefined, 'a Phase 4 step has no note');
  assert.equal(
    $('#main .removed-steps summary')!.textContent,
    'Removed steps in this phase (2)',
    'a step only Phase 3 lists is not listed on Phase 4',
  );
});

test('the Remove confirmation names the phases a shared step also goes from', async () => {
  await editPlan('3');
  const asked = answerConfirms(false);
  $(`#main [data-remove-step="${MILESTONE}"]`)!.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  $('#main [data-remove-step="calc-3-storage"]')!.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(asked, [
    'Remove this step from your build plan? Phase 4, Phase 5 and Post Phase 5 list the same step, so it is removed there too. Its checkmark is kept and you can restore the step while editing.',
    'Remove this step from your build plan? Its checkmark is kept and you can restore the step while editing.',
  ]);
});
