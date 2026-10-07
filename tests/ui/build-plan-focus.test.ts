// The build plan's focus on the page (#1070): "Required steps only" hides the research only a
// later phase needs and the storage-only lines, a view preference remembered in this browser like
// "Hide completed", never saved with the profile; and a step done by its own condition (the
// delivery with every counter at its target, the hard-drive hunt with every recipe unlocked)
// shows as done, says why, and counts as done, while nothing is ticked or written.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setHideDone, setRequiredOnly, state } from '../../public/app/session.ts';
import { phaseToOpen } from '../../public/app/opening-phase.ts';
import { render } from '../../public/app/shell.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { calcTasks } from '../../public/app/views/calculated.ts';
import { phaseTrack } from '../../public/app/views/phase-track.ts';
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

// A Phase 4 profile saved before #1070 (every step of Phases 1-3 ticked, as main listed them, and
// no delivery counts) opens on Phase 4 with Phases 1-3 full: working in a later phase marks their
// elevator and delivery steps done, with the reason, and writes no tick.
test('a profile saved before these steps opens on its later working phase, earlier phases done', async () => {
  const recorded: Record<string, Record<string, string[]>> = JSON.parse(
    fs.readFileSync('tests/fixtures/step-ids-before-1070.json', 'utf8'),
  );
  const checks = Object.fromEntries(
    ['1', '2', '3'].flatMap(phase => recorded['phase 1']![phase]!).map(id => [id, true]),
  );
  open({ calculated: phaseOne(), phase: '4', state: { checks } });
  assert.equal(phaseToOpen(), '4');
  const track = phaseTrack();
  for (const phase of ['1', '2', '3'])
    assert.equal(track.find(segment => segment.phase === phase)!.pct, 100, 'Phase ' + phase);
  const one = calcTasks('1');
  for (const id of ['space-elevator', 'deliver-1'])
    assert.equal(
      one.find(step => step.id === id)!.satisfied,
      'Done: you are working in a later phase.',
    );
  assert.equal(state.checks['space-elevator'], undefined, 'no tick written');
  assert.equal(state.checks['deliver-1'], undefined, 'no tick written');
});

test('with "Required steps only" on and only optional steps left, the list says so', async () => {
  await show();
  const required = planTasks().filter(step => !step.optional);
  await show({ checks: Object.fromEntries(required.map(step => [step.id, true])) });
  assert.equal($('[data-optional-left]'), null, 'the optional steps are listed');
  setRequiredOnly(true);
  render();
  await nextTick();
  assert.equal($('[data-open-steps]'), null, 'no step left to lead');
  assert.match($('[data-optional-left]')!.textContent!, /^\s*Only optional steps are left\./);
});
