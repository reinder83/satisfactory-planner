// A ticked build-plan step stays in its place for a few seconds before it goes to "Done (n)"
// (#1054, ui/plan/tick-hold.ts): the next step no longer slides under the pointer, so a second
// click lands on the step the user sees there; the toast says what changed ("Iron Plate done,
// 4 of 35 steps. Next: …") and offers Undo, reachable by keyboard; focus stays on the control
// pressed while the step is held, then goes to the same control in the step that took its place.
// Mark done behaves the same, and under prefers-reduced-motion the step leaves without a fade.
// The tick itself is saved at once, as before; Undo unticks through the same save path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { toastShortcut } from '../../public/app/api.ts';
import { state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { HOLD_MS, LEAVE_MS, setHoldDelay } from '../../public/app/ui/plan/tick-hold.ts';
import { $, $$, applyUpdate, go, openMigrated, page, stubFetch } from './setup.ts';
import type { UpdateOp } from '../../public/types/index.ts';

// Lets a save's reply and the redraw after it land; timers stay where they are.
async function flush() {
  for (let i = 0; i < 3; i++) {
    await vi.advanceTimersByTimeAsync(0);
    await nextTick();
  }
}
const wait = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
};

const openIds = () => $$('#main [data-open-steps] > .task [data-check]').map(e => e.dataset.check!);
const doneIds = () => $$('#main .done-group [data-check]').map(e => e.dataset.check!);
const openBox = (at: number) =>
  $$<HTMLInputElement>('#main [data-open-steps] > .task input[data-check]')[at]!;
const focusedKey = () =>
  (document.activeElement as HTMLElement | null)
    ?.closest('.task')
    ?.querySelector<HTMLElement>('[data-check]')?.dataset.check;
const titleOf = (id: string) => planTasks().find(step => step.id === id)!.title;
// A click on a checkbox: it takes focus, then changes.
async function click(box: HTMLInputElement) {
  box.focus();
  box.checked = !box.checked;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
}
const markDone = () => $<HTMLButtonElement>('#main [data-open-steps] [data-mark-done]')!;
const undo = () => $<HTMLButtonElement>('#toast [data-toast-action]');

let updates: [string, UpdateOp][];
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  setHoldDelay(HOLD_MS, LEAVE_MS);
  page();
  openMigrated();
  go('plan');
  render();
  await nextTick();
  updates = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('a ticked step stays in its place during the delay, then goes to Done', async () => {
  const [first, second] = openIds();
  assert.ok(first && second);
  await click(openBox(0));
  // Saved at once, as before.
  assert.deepEqual(updates.at(-1), ['/api/update', { type: 'check', key: first, value: true }]);
  assert.equal(state.checks[first], true);
  assert.equal(openIds()[0], first, 'still first among the unfinished steps');
  assert.equal(openBox(0).checked, true, 'drawn ticked');
  assert.ok(openBox(0).closest('.task')!.classList.contains('is-held'));
  assert.deepEqual(doneIds(), [], 'not in Done yet');
  await wait(HOLD_MS - 1);
  assert.equal(openIds()[0], first, 'still there just before the delay ends');
  await wait(1 + LEAVE_MS);
  assert.equal(openIds()[0], second, 'the next step leads now');
  assert.deepEqual(doneIds(), [first]);
});

test('a second click during the delay lands on the step the user sees there', async () => {
  const [first, second, third] = openIds();
  assert.ok(first && second && third);
  await click(openBox(0));
  // The pointer moves down one row and clicks again: that row is still the second step.
  await click(openBox(1));
  assert.equal(state.checks[second], true, 'the second step is ticked');
  assert.ok(!state.checks[third], 'the third step is not');
  assert.deepEqual(openIds().slice(0, 3), [first, second, third], 'both stay in place');
  // Both leave together, after the delay from the last tick.
  await wait(HOLD_MS - 1000);
  assert.deepEqual(openIds().slice(0, 2), [first, second]);
  await wait(1000 + LEAVE_MS);
  assert.equal(openIds()[0], third);
  assert.deepEqual(doneIds(), [first, second]);
});

test('focus stays on the ticked checkbox while it is held, then goes to the step in its place', async () => {
  const [first, second] = openIds();
  await click(openBox(0));
  assert.equal(focusedKey(), first);
  assert.ok((document.activeElement as HTMLElement).matches('input[data-check]'));
  await wait(HOLD_MS / 2);
  assert.equal(focusedKey(), first, 'focus has not moved');
  await wait(HOLD_MS / 2 + LEAVE_MS);
  assert.equal(document.activeElement, openBox(0), 'the next step’s checkbox');
  assert.equal(focusedKey(), second);
});

test('the toast says what the tick did, in the live region', async () => {
  const [first, second] = openIds();
  const steps = planTasks();
  await click(openBox(0));
  const done = steps.filter(step => state.checks[step.id] || step.satisfied).length;
  assert.equal(
    $('#toast')!.firstChild!.textContent,
    `${titleOf(first!)} done, ${done} of ${steps.length} steps. Next: ${titleOf(second!)}.`,
  );
  assert.ok($('#toast')!.classList.contains('show'));
  // The strip is a polite live region in the page itself.
  const html = fs.readFileSync('public/index.html', 'utf8');
  assert.match(html, /<div id="toast" role="status" aria-live="polite"><\/div>/);
  // Unticking says so too.
  await click(openBox(0));
  assert.equal(
    $('#toast')!.textContent,
    `${titleOf(first!)} not done, ${done - 1} of ${steps.length} steps.`,
  );
  assert.equal(undo(), null, 'no Undo for an untick');
});

test('the toast’s Undo is a focusable button that unticks the step through the normal save', async () => {
  const [first] = openIds();
  await click(openBox(0));
  const button = undo()!;
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.textContent, 'Undo');
  button.focus();
  assert.equal(document.activeElement, button);
  // Focused, it outlasts its time.
  await wait(9000);
  assert.ok($('#toast')!.classList.contains('show'), 'still up while focused');
  button.click();
  await flush();
  assert.deepEqual(updates.at(-1), ['/api/update', { type: 'check', key: first, value: false }]);
  assert.equal(state.checks[first!], false);
  assert.equal(openIds()[0], first, 'back among the unfinished steps, in its place');
  assert.equal(openBox(0).checked, false);
  assert.equal(focusedKey(), first, 'focus on its checkbox');
  assert.ok((document.activeElement as HTMLElement).matches('input[data-check]'));
});

test('Ctrl+Z presses Undo wherever focus is, except while typing', async () => {
  const [first] = openIds();
  await click(openBox(0));
  const search = $<HTMLInputElement>('#plan-search')!;
  search.focus();
  const typing = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true });
  search.dispatchEvent(typing);
  toastShortcut(typing);
  await flush();
  assert.equal(state.checks[first!], true, 'Ctrl+Z in the search box is left to the box');
  openBox(0).focus();
  toastShortcut(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
  await flush();
  assert.equal(state.checks[first!], false, 'unticked');
  assert.equal(focusedKey(), first);
});

test('Mark done holds the step in place the same way, and a second press does nothing', async () => {
  const [first, second] = openIds();
  const button = markDone();
  button.focus();
  button.click();
  await flush();
  assert.equal(state.checks[first!], true);
  assert.equal(openIds()[0], first, 'still leading');
  assert.equal(markDone().textContent!.trim(), 'Marked done');
  assert.equal(markDone().getAttribute('aria-disabled'), 'true');
  assert.equal(document.activeElement, markDone(), 'focus stays on it');
  assert.match($('#toast')!.textContent!, new RegExp(`^${titleOf(first!)} done, `));
  const saves = updates.length;
  markDone().click();
  await flush();
  assert.equal(updates.length, saves, 'the second press sends nothing');
  assert.ok(!state.checks[second!], 'and ticks nothing else');
  await wait(HOLD_MS + LEAVE_MS);
  assert.equal(openIds()[0], second);
  assert.equal(document.activeElement, markDone(), 'the next lead’s Mark done');
  assert.equal(focusedKey(), second);
});

test('with motion the held step fades before it goes; with reduced motion it goes at once', async () => {
  const [first] = openIds();
  await click(openBox(0));
  await wait(HOLD_MS);
  assert.ok(openBox(0).closest('.task')!.classList.contains('is-leaving'), 'fading');
  assert.equal(openIds()[0], first);
  await wait(LEAVE_MS);
  assert.notEqual(openIds()[0], first);

  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion: reduce'),
  }));
  const [next] = openIds();
  await click(openBox(0));
  await wait(HOLD_MS);
  assert.equal($$('#main .task.is-leaving').length, 0, 'no fade');
  assert.notEqual(openIds()[0], next, 'gone at once');
  assert.ok(doneIds().includes(next!));
  // The stylesheet's fade is off under reduced motion too.
  const css = fs.readFileSync('public/style.css', 'utf8');
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.task\.is-leaving \{\s*transition: none;/,
  );
});
