// Where focus goes when a build-plan step's edit form opens and closes (#562,
// public/app/ui/plan/PlanStep.vue and StepEditForm.vue): Edit swaps the step for its form, so
// focus goes to the form's Step title field; Cancel and Save step swap the form back for the
// step, so focus goes to that step's Edit button, never to <body>. A control is focused before
// it is pressed, as the keyboard does. The focused element is compared by what identifies it
// (a boolean, never two elements with assert.equal: #287).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setHideDone, setPlanEditing, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, applyUpdate, go, openMigrated, page, stubFetch } from './setup.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const press = (selector: string) => {
  const el = $(selector);
  assert.ok(el, selector);
  el.focus();
  el.click();
};
const focusedOn = (selector: string) => {
  const want = $(selector);
  assert.ok(want, 'expected ' + selector + ' on the page');
  return document.activeElement === want;
};
const describeFocus = () => document.activeElement?.outerHTML.slice(0, 120) ?? 'null';

const id = 'phase-3-iron';
const edit = `#main [data-edit-task="${id}"]`;
const title = `#main [data-task-edit="${id}"] [name=title]`;

beforeEach(() => {
  page();
  openMigrated();
  setQuery('');
  setHideDone(false);
  stubFetch({ '/api/update': applyUpdate });
  go('plan');
  setPlanEditing(true);
  render();
});

test('Edit puts focus in the step’s Step title field', async () => {
  press(edit);
  await settle();
  assert.ok(focusedOn(title), describeFocus());
});

test('Cancel gives focus back to the step’s Edit button', async () => {
  press(edit);
  await settle();
  press(`#main [data-task-edit="${id}"] [data-cancel-task-edit]`);
  await settle();
  assert.equal($(`#main [data-task-edit="${id}"]`), null, 'the form closed');
  assert.ok(focusedOn(edit), describeFocus());
});

test('Save step gives focus back to the step’s Edit button', async () => {
  press(edit);
  await settle();
  const form = $<HTMLFormElement>(`#main [data-task-edit="${id}"]`)!;
  form.querySelector<HTMLButtonElement>('[type=submit]')!.focus();
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.equal($(`#main [data-task-edit="${id}"]`), null, 'the form closed');
  assert.ok(focusedOn(edit), describeFocus());
});
