// A build-plan step's edit form with typed text not saved yet (#969, StepEditForm.vue). As for
// the "Made on site" picker (#930), nothing that takes the form away may drop that text without a
// word or save it by itself: Done editing (the page's toggle, the sticky bar's Done, Escape
// outside a field) keeps edit mode on and the form open, which says so in a live region and
// focuses Save step, with Cancel beside it (holdUnsavedChoices in api.ts); leaving the page or
// changing the phase asks first (allowSwitch); closing the tab warns (listeners.ts). A form whose
// fields are the saved step holds nothing back, and Edit on another step is held back too
// (#1029). Escape inside the form stays Cancel (#601).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeAll, beforeEach, test, vi } from 'vitest';
import { acceptRoute } from '../../public/app/api.ts';
import {
  editingTask,
  planEditing,
  setEditingTask,
  setHideDone,
  setPlanEditing,
  setQuery,
  state,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import {
  $,
  answerConfirms,
  applyUpdate,
  evil,
  go,
  openMigrated,
  page,
  stubFetch,
} from './setup.ts';
import type { UpdateOp } from '../../public/types/index.ts';

const id = 'phase-3-iron';
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const form = () => $<HTMLFormElement>(`#main [data-task-edit="${id}"]`);
const field = (name: string) => form()!.querySelector<HTMLInputElement>(`[name=${name}]`)!;
const saveStep = () => form()!.querySelector<HTMLButtonElement>('[type=submit]')!;
const cancelButton = () => form()!.querySelector<HTMLButtonElement>('[data-cancel-task-edit]')!;
const heldRegion = () => form()!.querySelector('[data-task-edit-held]')!;
const editButton = () => $<HTMLButtonElement>(`#main [data-edit-task="${id}"]`)!;
const toggleButton = () => $<HTMLButtonElement>('#main [data-toggle-plan-edit]')!;
const barDone = () => $<HTMLButtonElement>('#main [data-edit-bar-done]')!;
const type = (name: string, value: string) => {
  const input = field(name);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const esc = (target: Element = document.body) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
const unload = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};
// The updates sent: a test checks that nothing was saved by itself.
let sent: UpdateOp[] = [];
const sentTypes = () => sent.map(update => update.type);
const scrolled: Element[] = [];
let savedTitle = '';

beforeAll(async () => {
  page();
  // The close-tab warning is page-wide (listeners.ts), registered once on import.
  await import('../../public/app/listeners.ts');
});

// The build plan in edit mode with the step's form open, focus in its Step title field. With
// `title`, the step was renamed to it before.
async function show(title?: string) {
  page();
  history.replaceState(null, '', '#plan');
  const titles: Record<string, string> = title ? { [id]: title } : {};
  openMigrated({ state: { taskEdits: { order: {}, removed: [], titles, bodies: {}, links: {} } } });
  setQuery('');
  setHideDone(false);
  go('plan');
  setPlanEditing(true);
  render();
  await settle();
  editButton().focus();
  editButton().click();
  await settle();
  assert.ok(form(), 'the edit form opened');
  savedTitle = field('title').value;
  // The address the page was drawn for, as the hashchange listener records it.
  assert.equal(acceptRoute(), true);
  sent = [];
  stubFetch<UpdateOp>({
    '/api/update': (update: UpdateOp) => {
      sent.push(update);
      return applyUpdate(update);
    },
  });
  scrolled.length = 0;
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (
    this: HTMLElement,
  ) {
    scrolled.push(this);
  });
}

// What the form shows once leaving edit mode was held back by its unsaved text.
async function assertHeld(how: string) {
  await settle();
  assert.equal(planEditing, true, how + ': edit mode stays on');
  assert.ok(form(), how + ': the form stays open');
  assert.equal(field('title').value, 'Typed but not saved', how + ': the typed text is kept');
  assert.equal(
    text(heldRegion()),
    'These edits are not saved yet. Save the step or cancel first.',
    how + ': the form says why',
  );
  assert.equal(heldRegion().getAttribute('role'), 'status', 'announced to screen readers');
  assert.ok(heldRegion().querySelector('.notice.warn'), 'a warning: the user should act');
  assert.equal(document.activeElement, saveStep(), how + ': focus goes to Save step');
  assert.equal(saveStep().getAttribute('aria-describedby'), heldRegion().id);
  assert.ok(scrolled.includes(heldRegion()), how + ': the message comes into view');
  assert.deepEqual(sent, [], how + ': nothing is saved by itself');
}

beforeEach(() => show());
afterEach(() => {
  setPlanEditing(false);
  setEditingTask(null);
  vi.restoreAllMocks();
});

test('Done editing with typed text keeps edit mode and the form, and says so', async () => {
  type('title', 'Typed but not saved');
  assert.equal(text(heldRegion()), '', 'nothing to say before Done is pressed');
  toggleButton().click();
  await assertHeld('the page toggle');
  // Pressed again while it is still unsaved: the same, and still nothing saved.
  toggleButton().click();
  await assertHeld('the page toggle again');
});

test('the sticky bar’s Done and Escape outside a field are held back the same way', async () => {
  type('title', 'Typed but not saved');
  barDone().click();
  await assertHeld('the bar’s Done');
  (document.activeElement as HTMLElement).blur();
  esc();
  await assertHeld('Escape');
});

test('a form showing the saved step holds nothing back: Done closes it as before', async () => {
  // Typed and put back, with a space the save would trim anyway.
  type('title', 'Typed but not saved');
  type('title', savedTitle + ' ');
  // The details are the plan's own text, which a cleared field stands for.
  assert.ok(field('body').value.trim(), 'the step has details of its own');
  type('body', '');
  barDone().click();
  await settle();
  assert.equal(planEditing, false, 'Done leaves edit mode');
  assert.equal(editingTask, null);
  assert.equal(form(), null);
  assert.equal(document.activeElement, toggleButton(), 'focus on the page’s toggle, as before');
  assert.deepEqual(sent, []);
});

test('changed details or linked factory are held back too', async () => {
  type('body', 'New details');
  toggleButton().click();
  await settle();
  assert.equal(planEditing, true);
  assert.equal(document.activeElement, saveStep());
  type('body', field('body').defaultValue);
  const link = form()!.querySelector<HTMLSelectElement>('[name=link]')!;
  const other = [...link.options].find(option => !option.selected)!;
  link.value = other.value;
  link.dispatchEvent(new Event('change', { bubbles: true }));
  toggleButton().click();
  await settle();
  assert.equal(planEditing, true, 'a new link is held back');
  assert.deepEqual(sent, []);
});

test('a cleared title on a renamed step would restore the plan’s text: held back', async () => {
  await show('Renamed step');
  type('title', '');
  toggleButton().click();
  await settle();
  assert.equal(planEditing, true);
  assert.equal(document.activeElement, saveStep());
  assert.deepEqual(sent, []);
});

test('Edit on another step is held back too; with no typed text it opens that step (#1029)', async () => {
  const other = () => $<HTMLButtonElement>('#main [data-edit-task="phase-3-survey"]')!;
  type('title', 'Typed but not saved');
  other().click();
  await assertHeld('Edit on another step');
  assert.equal(editingTask, id, 'the open form stays the one being edited');
  assert.equal($('#main [data-task-edit="phase-3-survey"]'), null);
  // Put back to the saved text: Edit on the other step opens it, as before.
  type('title', savedTitle);
  other().click();
  await settle();
  assert.equal(editingTask, 'phase-3-survey');
  assert.equal(form(), null, 'the first form closed');
  assert.ok($('#main [data-task-edit="phase-3-survey"] [name=title]'));
  assert.deepEqual(sent, []);
});

test('Save step from there saves the edit; then Done editing leaves', async () => {
  type('title', 'Typed but not saved');
  barDone().click();
  await settle();
  form()!.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.deepEqual(sentTypes(), ['taskEdit']);
  assert.equal(state.taskEdits?.titles?.[id], 'Typed but not saved');
  assert.equal(form(), null, 'the form closed');
  assert.equal(document.activeElement, editButton(), 'focus on the step’s Edit, as before');
  barDone().click();
  await settle();
  assert.equal(planEditing, false, 'nothing unsaved: Done leaves');
  assert.equal(sent.length, 1, 'Done saves nothing more');
});

test('Cancel from there drops the text and sends nothing; then Done editing leaves', async () => {
  type('title', 'Typed but not saved');
  toggleButton().click();
  await settle();
  cancelButton().focus();
  cancelButton().click();
  await settle();
  assert.equal(form(), null, 'the form closed');
  assert.equal(document.activeElement, editButton());
  toggleButton().click();
  await settle();
  assert.equal(planEditing, false);
  assert.deepEqual(sent, [], 'nothing was saved');
  assert.equal(state.taskEdits?.titles?.[id], undefined);
});

test('Escape in the form is still Cancel (#601), also once Done was held back', async () => {
  type('title', 'Typed but not saved');
  toggleButton().click();
  await settle();
  const title = field('title');
  title.focus();
  esc(title);
  await settle();
  assert.equal(form(), null, 'the form closed');
  assert.equal(planEditing, true, 'edit mode is still on');
  assert.equal(document.activeElement, editButton());
  assert.deepEqual(sent, []);
});

test('leaving the page asks first; kept, the text stays; left anyway, nothing is saved', async () => {
  await show(evil);
  type('title', 'Typed but not saved');
  const asked = answerConfirms(false);
  // A sidebar link, a typed address or Back (the hashchange listener calls acceptRoute).
  history.replaceState(null, '', '#factories');
  assert.equal(acceptRoute(), false, 'the page stays while it asks');
  await settle();
  assert.equal(location.hash, '#plan');
  assert.equal(asked.length, 1);
  assert.equal(
    asked[0],
    `Your edits to the step "${evil}" are not saved yet. Leave without saving them?`,
  );
  assert.equal(document.querySelector('x-evil'), null, 'the step title is drawn as text');
  assert.equal(field('title').value, 'Typed but not saved', 'kept: the text is still there');
  const agreed = answerConfirms(true);
  history.replaceState(null, '', '#factories');
  assert.equal(acceptRoute(), false);
  await settle();
  assert.equal(location.hash, '#factories');
  assert.equal(agreed.length, 1);
  assert.deepEqual(sent, []);
});

// The phase picked is only shown since #1053 (it was saved before), so nothing is sent at all.
test('changing the phase asks too, and saves nothing', async () => {
  type('title', 'Typed but not saved');
  const asked = answerConfirms(false);
  const phasePicker = $<HTMLSelectElement>('#phase-picker')!;
  phasePicker.value = '4';
  phasePicker.dispatchEvent(new Event('change'));
  await settle();
  assert.equal(asked.length, 1);
  assert.equal(phasePicker.value, '3', 'kept: the phase stays');
  assert.equal(field('title').value, 'Typed but not saved');
  assert.deepEqual(sent, []);
  answerConfirms(true);
  phasePicker.value = '4';
  phasePicker.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(sentTypes(), [], 'the phase is only shown, and the step is not saved');
  assert.equal(phasePicker.value, '4', 'Phase 4 is shown');
  assert.equal(state.taskEdits?.titles?.[id], undefined);
});

test('closing the tab warns while the form holds typed text', async () => {
  assert.equal(unload(), false, 'an open form showing the saved step');
  type('title', 'Typed but not saved');
  assert.equal(unload(), true, 'typed text');
  cancelButton().click();
  await settle();
  assert.equal(unload(), false, 'cancelled');
  assert.deepEqual(sent, []);
});
