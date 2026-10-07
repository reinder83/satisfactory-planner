// The build plan's focus on the page (#1070): "Required steps only" hides the research only a
// later phase needs and the storage-only lines, a view preference remembered in this browser like
// "Hide completed", never saved with the profile; and a step done by its own condition (the
// delivery with every counter at its target, the hard-drive hunt with every recipe unlocked)
// shows as done, says why, and counts as done, while nothing is ticked or written.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setHideDone, setRequiredOnly, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, generatedWith, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan, ProgressState } from '../../public/types/index.ts';

let phaseOnePlan: CurrentCalculatedPlan | undefined;
const phaseOne = () => structuredClone((phaseOnePlan ??= generatedWith({ phase: '1' })));

const CATERIUM = 'unlock-Research_Caterium_0_C';
const listed = () => $$('#main [data-check]').map(box => box.dataset.check);
const box = (id: string) => $<HTMLInputElement>(`#main [data-check="${id}"]`);

async function show(progress: Partial<ProgressState> = {}) {
  open({ calculated: phaseOne(), phase: '1', state: progress });
  go('plan');
  render();
  await nextTick();
}

beforeEach(() => {
  page();
  setHideDone(false);
  setRequiredOnly(false);
});

test('"Required steps only" hides the optional research and is remembered in this browser', async () => {
  await show();
  const toggle = $<HTMLInputElement>('[data-required-only]')!;
  assert.ok(toggle, 'the phase has optional steps, so the toggle is there');
  assert.equal(toggle.checked, false);
  assert.ok(listed().includes(CATERIUM));
  const all = listed().length;
  // Research only a later phase needs is marked so in its title.
  assert.match(
    box(CATERIUM)!.closest('.task')!.querySelector('summary')!.textContent!,
    /MAM: Caterium \(optional\)/,
  );
  const before = JSON.stringify(state);
  toggle.checked = true;
  toggle.dispatchEvent(new Event('change'));
  await nextTick();
  assert.ok(!listed().includes(CATERIUM));
  assert.equal(all - listed().length, 7, 'the seven optional research steps');
  assert.ok(listed().includes('calc-1-Recipe_IngotIron_C'));
  assert.equal($('.checklist-tools .muted')!.textContent, `${listed().length} of ${all} steps`);
  // The progress bar still counts every step.
  assert.match($('[data-plan-progress]')!.textContent!, new RegExp(`of ${all} done`));
  // View state only: remembered in this browser, nothing in the profile.
  assert.equal(localStorage.getItem('planner-required-only'), 'on');
  assert.equal(JSON.stringify(state), before);
  await show();
  assert.equal($<HTMLInputElement>('[data-required-only]')!.checked, true);
  assert.ok(!listed().includes(CATERIUM));
});

test('a phase without optional steps has no toggle', async () => {
  // Phase 5 of a Phase 1 profile: research is all needed by then.
  open({ calculated: phaseOne(), phase: '5', state: {} });
  go('plan');
  render();
  await nextTick();
  assert.equal($('[data-required-only]'), null);
});

test('the delivery step shows as done once every counter is full, without a tick', async () => {
  const target = phaseOne().stages['1']?.delivery?.['Smart Plating']?.target ?? 0;
  assert.ok(target > 0);
  await show();
  assert.ok(listed().includes('space-elevator'));
  const open = box('deliver-1')!;
  assert.equal(open.checked, false);
  assert.equal(open.closest('.done-group'), null);
  await show({ deliveries: { '1-smart-plating': target } });
  const done = box('deliver-1')!;
  assert.equal(done.checked, true);
  assert.equal(done.disabled, true, 'nothing to untick');
  assert.ok(done.closest('.done-group'), 'listed with the done steps');
  const note = done.closest('.task')!.querySelector('[data-satisfied-note]')!;
  assert.equal(note.textContent, 'Done: every delivery counter is at its target.');
  assert.equal(done.getAttribute('aria-describedby'), note.id);
  assert.equal(state.checks['deliver-1'], undefined, 'no tick written');
  assert.match($('[data-plan-progress]')!.textContent!, /^1 of \d+ done$/);
  // "Hide completed" hides it like a ticked step.
  setHideDone(true);
  render();
  await nextTick();
  assert.equal(box('deliver-1'), null);
});
