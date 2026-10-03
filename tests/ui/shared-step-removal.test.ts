// A step one id shares between phases is one step in every phase that lists it: one checkmark,
// and taskEdits.removed holds step ids, so removing it in one phase removes it in the others too.
// The build plan says so where it happens (#744, public/app/shared-steps.ts): the Remove
// confirmation names the other phases, and "Removed steps in this phase" notes them under the
// step. A step only this phase lists keeps the old wording and no note. Since each milestone
// (#758), alternate unlock (#870) and biomass start-up step (#872) is listed in one phase only,
// the steps shared are post-game's: it plans Phase 5's stage, so it lists Phase 5's steps.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { generatedStepIds } from '../../public/app/opening-phase.ts';
import { setHideDone, setPlanEditing, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { sharedStepPhases } from '../../public/app/shared-steps.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { $, answerConfirms, generated, go, open, page } from './setup.ts';
import type { Phase, StageKey, TaskEdits } from '../../public/types/index.ts';

// Tier 6: Industrial Manufacturing, which the plan's Phase 3 and later rows need. It is a Phase 3
// milestone, so a profile that starts in Phase 3 lists it in Phase 3 only (#758). (A Phase 1
// milestone such as Base Building is listed in the milestone-only Phase 1 since #759.)
const MILESTONE = 'unlock-Schematic_5-2_C';
// The biomass start-up, which the start phase lists until a power unlock is ticked (#872).
const BIOMASS = 'startup-biomass';
const PLAIN =
  'Remove this step from your build plan? Its checkmark is kept and you can restore the step while editing.';

beforeEach(() => page());

// A calculated profile that starts in `start` (Phase 3 unless given), on the build plan of
// `phase` in edit mode, with `removed` steps removed.
async function editPlan(phase: Phase, removed: string[] = [], start: StageKey = '3') {
  const plan = generated();
  plan.settings.phase = start;
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

test('the biomass start-up, a milestone and a phase-numbered step are listed in one phase', async () => {
  await editPlan('3');
  const ids = planTasks().map(t => t.id);
  assert.ok(ids.includes(MILESTONE), 'Phase 3 lists Tier 6: Industrial Manufacturing');
  assert.ok(ids.includes(BIOMASS), 'and the biomass start-up');
  assert.ok(ids.includes('calc-3-storage'), 'and its own storage step');
  const shared = sharedStepPhases([MILESTONE, BIOMASS, 'calc-3-storage']);
  assert.deepEqual([...shared.keys()], [], 'no other phase lists them');
  for (const phase of ['4', '5', 'post'] as const)
    assert.ok(!generatedStepIds(phase).includes(BIOMASS), phase + ' lists no biomass start-up');
});

test('post-game shares Phase 5 steps, and phases before the start phase are not counted', async () => {
  await editPlan('5', [], '5');
  const shared = sharedStepPhases(['calc-5-storage', BIOMASS]);
  assert.deepEqual(shared.get('calc-5-storage'), ['Post Phase 5']);
  assert.deepEqual(shared.get(BIOMASS), ['Post Phase 5'], 'Phase 5 is the start phase');
  await editPlan('post', [], '5');
  assert.deepEqual(sharedStepPhases([BIOMASS]).get(BIOMASS), ['Phase 5']);
});

test('Removed steps notes the other phases under a shared step only', async () => {
  await editPlan('3', [BIOMASS, MILESTONE, 'calc-3-storage', 'calc-4-storage']);
  for (const id of [BIOMASS, MILESTONE, 'calc-3-storage'])
    assert.equal(sharedNote(id), undefined, id + ' is listed in Phase 3 only');
  assert.equal(
    $('#main .removed-steps summary')!.textContent,
    'Removed steps in this phase (3)',
    'a step only Phase 4 lists is not listed on Phase 3',
  );
  await editPlan('5', [BIOMASS], '5');
  assert.equal(sharedNote(BIOMASS), 'Also in Post Phase 5: removed and restored there too.');
});

test('the Remove confirmation names the phases a shared step also goes from', async () => {
  await editPlan('3');
  let asked = answerConfirms(false);
  for (const id of [BIOMASS, MILESTONE, 'calc-3-storage']) {
    $(`#main [data-remove-step="${id}"]`)!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.deepEqual(asked, [PLAIN, PLAIN, PLAIN]);
  await editPlan('5', [], '5');
  asked = answerConfirms(false);
  $(`#main [data-remove-step="${BIOMASS}"]`)!.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(asked, [
    'Remove this step from your build plan? Post Phase 5 lists the same step, so it is removed there too. Its checkmark is kept and you can restore the step while editing.',
  ]);
});
