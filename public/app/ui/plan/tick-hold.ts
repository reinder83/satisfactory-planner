// A ticked build-plan step stays where it was for a few seconds before it folds into "Done (n)"
// (#1054). Moving at once slid the next step under the pointer, so a second click ticked a step
// the user never meant (a tester mis-ticked about 25 that way), and keyboard focus landed on
// another, unticked step without a word. Now the tick is saved at once, as before, but the step
// is held in place, drawn ticked, until HOLD_MS after the last held step's save landed; every
// held step then leaves together, so one leaving never shifts another under the pointer. The
// hold is view state of this tab only, never saved: a page change, another phase or a reload
// drops it, and the steps are simply drawn where their saved ticks put them.
//
// Each tick says what happened through the #toast strip (role="status"), "Iron Plate done, 4 of
// 35 steps. Next: Copper Ingot.", with an Undo button (Ctrl+Z or ⌘Z too, toastShortcut in
// api.ts) that unticks the step through the normal save path. Focus stays on the control that
// was pressed while the step is held; when it leaves, focus goes to the same control in the step
// that took its place (refocusAfterRemoval), the next lead's Mark done after Mark done. With
// motion allowed, the held steps fade for LEAVE_MS before they go (`leaving`); under
// prefers-reduced-motion they go at once.
import { nextTick } from 'vue';
import { save, toast } from '../../api.ts';
import { checked, stage } from '../../session.ts';
import { render } from '../../shell.ts';
import { filteredPlanTasks, idleStepNotes, planTasks, stepDone } from '../../tasks.ts';
import { refocusAfterRemoval } from '../refocus.ts';

export const HOLD_MS = 4500;
export const LEAVE_MS = 200;

// The component tests that only check where a step ends up set both to 0 (tests/ui/setup.ts):
// the hold then ends as soon as the save lands, with no fade, which is how a tick behaved
// before #1054. tests/ui/tick-hold.test.ts puts the real delays back.
let holdMs = HOLD_MS;
let leaveMs = LEAVE_MS;
export function setHoldDelay(hold: number, leave: number) {
  holdMs = hold;
  leaveMs = leave;
}

// The steps held in place, of the phase `heldPhase`; those fading out; saves still on their way.
const held = new Set<string>();
let heldPhase = '';
let leavingNow = false;
let saving = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

// Whether a step of the phase on screen is held in place, or fading out of it.
export const isHeld = (id: string) => heldPhase === stage() && held.has(id);
export const isLeaving = (id: string) => leavingNow && isHeld(id);

// The rows of the unfinished steps (Checklist.vue), which the held steps stay among, and where
// focus goes when the focused one leaves (ui/refocus.ts): known by checklist key (#822).
const openRows = {
  row: '#main [data-open-steps] > .task',
  fallback: ['#main .done-group > summary', '#plan-search'],
  key: (row: Element) => row.querySelector<HTMLElement>('[data-check]')?.dataset.check,
};

// Where focus goes when the held steps leave: worked out when the last one was ticked, from the
// control pressed (its checkbox or Mark done) and the steps around it then (ui/refocus.ts).
// `refocusId` is that step's.
let refocus: (() => Promise<void>) | null = null;
let refocusId = '';

// Holds `id` in place from its tick until its save is answered (settled) and HOLD_MS after.
// `trigger` is the control pressed, `control` its selector in a step.
export function holdStep(id: string, trigger: EventTarget | null, control: string) {
  if (heldPhase !== stage()) held.clear();
  heldPhase = stage();
  held.add(id);
  saving++;
  leavingNow = false;
  clearTimeout(timer);
  refocus = refocusAfterRemoval(trigger, { ...openRows, control });
  refocusId = id;
}

// The save of a held step was answered: `saved`, or refused and the step let go. Once no held
// step's save is on its way, the hold runs HOLD_MS from now; with no delay it ends here.
export async function settled(id: string, saved: boolean) {
  saving = Math.max(0, saving - 1);
  if (!saved) held.delete(id);
  if (saving) return;
  clearTimeout(timer);
  if (!holdMs) return release();
  timer = setTimeout(() => void release(), holdMs);
}

// An unticked step needs no hold: it stays among the unfinished steps where it is, and so does
// focus on it when the others leave.
export function letGo(id: string) {
  held.delete(id);
  if (refocusId === id) refocus = null;
}

// Drops the hold without drawing anything: the checklist is leaving the page.
export function dropHold() {
  clearTimeout(timer);
  held.clear();
  leavingNow = false;
  refocus = null;
}

const reducedMotion = () =>
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

// The held steps leave for "Done (n)" together. Focus still on the control pressed last, or lost
// (a step that came back above the lead took Mark done away, #841), goes to the same control in
// the step that takes its place; focus the user moved elsewhere stays there.
async function release() {
  clearTimeout(timer);
  if (!held.size || saving) return;
  if (leaveMs && !reducedMotion() && heldPhase === stage()) {
    leavingNow = true;
    render();
    await new Promise(resolve => setTimeout(resolve, leaveMs));
    // A tick meanwhile holds the steps again, from its own save.
    if (saving || !leavingNow) return;
  }
  const refocusNow = refocus;
  dropHold();
  render();
  await refocusNow?.();
}

// Focuses `control` in the step `id` wherever it is drawn now, when focus was lost (the toast's
// Undo hid with it) or is on the step's old control.
export async function focusStep(id: string, control: string) {
  await nextTick();
  const current = document.activeElement;
  if (current && current !== document.body && current.isConnected && !current.closest('#toast'))
    return;
  [...document.querySelectorAll<HTMLElement>('#main .task')]
    .find(row => openRows.key(row) === id)
    ?.querySelector<HTMLElement>(control)
    ?.focus();
}

// What the tick or untick of `title` did, for the toast: "Iron Plate done, 4 of 35 steps. Next:
// Copper Ingot." The count is over the whole phase; the next step is the one that leads the list
// once the held steps leave, as the search and "Required steps only" show it.
export function tickNews(id: string, title: string, done: boolean) {
  const steps = planTasks();
  const count = `${steps.filter(stepDone).length} of ${steps.length} steps`;
  if (!done) return `${title} not done, ${count}.`;
  if (steps.every(stepDone)) return `${title} done, ${count}. Phase checklist complete.`;
  const shown = filteredPlanTasks(steps).filter(step => !stepDone(step) && step.id !== id);
  const idle = idleStepNotes(shown);
  const next = shown.find(step => !idle.has(step.id)) ?? shown[0];
  return `${title} done, ${count}.` + (next ? ` Next: ${next.title}.` : '');
}

// Says what a tick did and offers Undo: the step unticked through the normal save path, focus on
// its checkbox, wherever it is drawn by then.
export function announceTick(id: string, title: string) {
  toast(tickNews(id, title, true), false, {
    label: 'Undo',
    run: () => void undoTick(id, title),
  });
}

async function undoTick(id: string, title: string) {
  if (!checked(id)) return;
  letGo(id);
  try {
    await save({ type: 'check', key: id, value: false });
  } catch {
    return;
  }
  render();
  toast(tickNews(id, title, false));
  await focusStep(id, 'input[data-check]');
}
