// The build plan's Edit steps mode (BP-9, #1340; public/app/ui/plan/PlanStep.vue,
// EditStepsToggle.vue, PlanEditBar.vue): one "Done editing" (the sticky bar's, the toggle is gone
// while the mode is on), ↑ and ↓ as buttons, Edit and Remove in a ⋯ menu (ui/ActionMenu.vue) that
// opens and closes from the keyboard, and Alt+↑ / Alt+↓ on a focused step to move it. Removing a
// step still toasts Undo instead of asking (#1334).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { planEditing, setHideDone, setPlanEditing, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, applyUpdate, go, openMigrated, page, stubFetch } from './setup.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const order = () =>
  $$<HTMLElement>('#main .checklist .task [data-move-task][data-dir="-1"]').map(
    el => el.dataset.moveTask!,
  );
const key = (target: Element, init: KeyboardEventInit) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

let calls: [string, unknown][];
beforeEach(() => {
  page();
  openMigrated();
  setQuery('');
  setHideDone(false);
  calls = stubFetch({ '/api/update': applyUpdate });
  go('plan');
  render();
});

test('one Done editing: the toggle is gone and the bar’s Done leaves the mode', async () => {
  $<HTMLButtonElement>('[data-toggle-plan-edit]')!.click();
  await nextTick();
  assert.equal(planEditing, true);
  assert.equal($('[data-toggle-plan-edit]'), null);
  const done = $$('button').filter(b => b.textContent.trim() === 'Done editing');
  assert.equal(done.length, 1, 'exactly one Done editing');
  assert.ok(done[0]!.matches('[data-edit-bar-done]'));
  assert.ok(done[0]!.closest('.edit-bar'), 'it is the sticky bar’s');
  done[0]!.click();
  await settle();
  assert.equal(planEditing, false);
  assert.ok($('[data-toggle-plan-edit]'), 'the toggle is back');
  assert.equal($$('button').filter(b => b.textContent.trim() === 'Done editing').length, 0);
});

test('a step’s ⋯ menu opens, closes with Escape and gives focus back', async () => {
  setPlanEditing(true);
  render();
  await nextTick();
  const id = order()[1]!;
  const button = $<HTMLButtonElement>(`[data-step-menu="${id}"]`)!;
  assert.ok(button, 'the step has a ⋯ button');
  assert.equal(button.getAttribute('aria-haspopup'), 'menu');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.match(button.getAttribute('aria-label')!, /^More actions for /);
  const menu = $<HTMLElement>(`#step-menu-${id}`)!;
  assert.equal(menu.hidden, true);
  assert.deepEqual(
    [...menu.querySelectorAll('[role="menuitem"]')].map(item => item.textContent.trim()),
    ['Edit', 'Remove'],
  );
  button.focus();
  button.click();
  await nextTick();
  assert.equal(menu.hidden, false);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(document.activeElement?.getAttribute('data-edit-task'), id, 'focus is on Edit');
  key(document.activeElement!, { key: 'ArrowDown' });
  assert.equal(document.activeElement?.getAttribute('data-remove-step'), id);
  key(document.activeElement!, { key: 'Escape' });
  await nextTick();
  assert.equal(menu.hidden, true);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, button, 'focus returns to ⋯');
  assert.equal(planEditing, true, 'Escape closed the menu only, not the mode');
});

test('Edit opens the step’s form from the menu', async () => {
  setPlanEditing(true);
  render();
  await nextTick();
  const id = order()[0]!;
  $<HTMLButtonElement>(`[data-step-menu="${id}"]`)!.click();
  await nextTick();
  $<HTMLButtonElement>(`[data-edit-task="${id}"]`)!.click();
  await settle();
  assert.ok($(`[data-task-edit="${id}"]`), 'the form shows');
  assert.equal(document.activeElement?.getAttribute('name'), 'title', 'focus is on its title');
});

test('Remove from the menu hides the step and offers Undo, with no confirmation', async () => {
  setPlanEditing(true);
  render();
  await nextTick();
  const id = order().find(step => !step.startsWith('custom-'))!;
  $<HTMLButtonElement>(`[data-step-menu="${id}"]`)!.click();
  await nextTick();
  $<HTMLButtonElement>(`[data-remove-step="${id}"]`)!.click();
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'taskRemove', id });
  assert.ok(!order().includes(id), 'the step is gone from the list');
  assert.match($('#toast, .toast')!.textContent, /Undo/);
});

test('Alt+↑ and Alt+↓ on a focused step move it, and focus stays on it', async () => {
  setPlanEditing(true);
  render();
  await nextTick();
  const before = order();
  const id = before[2]!;
  const summary = $<HTMLElement>(`#main [data-task="${CSS.escape(id)}"] summary`)!;
  summary.focus();
  key(summary, { key: 'ArrowUp', altKey: true });
  await settle();
  assert.equal(order().indexOf(id), 1, 'Alt+↑ moved it up');
  assert.equal(
    document.activeElement,
    $(`#main [data-task="${CSS.escape(id)}"] summary`),
    'focus is on the moved step’s title',
  );
  key(document.activeElement!, { key: 'ArrowDown', altKey: true });
  await settle();
  assert.equal(order().indexOf(id), 2, 'Alt+↓ moved it back');
  // Without Alt the arrow keys do nothing to the order.
  key(document.activeElement!, { key: 'ArrowUp' });
  await settle();
  assert.equal(order().indexOf(id), 2);
  // Outside edit mode Alt+↑ moves nothing.
  setPlanEditing(false);
  render();
  await nextTick();
  const list = $$<HTMLElement>('#main .checklist .task [data-check]').map(el => el.dataset.check);
  key($(`#main [data-task="${CSS.escape(id)}"] summary`)!, { key: 'ArrowUp', altKey: true });
  await settle();
  assert.deepEqual(
    $$<HTMLElement>('#main .checklist .task [data-check]').map(el => el.dataset.check),
    list,
  );
});

test('↑ and ↓ are buttons that name the step and the shortcut', async () => {
  setPlanEditing(true);
  render();
  await nextTick();
  const id = order()[0]!;
  const up = $(`[data-move-task="${id}"][data-dir="-1"]`)!;
  assert.equal(up.tagName, 'BUTTON');
  assert.equal(up.getAttribute('aria-keyshortcuts'), 'Alt+ArrowUp');
  assert.equal(
    $(`[data-move-task="${id}"][data-dir="1"]`)!.getAttribute('aria-keyshortcuts'),
    'Alt+ArrowDown',
  );
});
