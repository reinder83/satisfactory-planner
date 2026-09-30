// Escape in a build-plan step's edit form acts as Cancel (#601,
// public/app/ui/plan/StepEditForm.vue): wherever focus is in the form, the form closes without
// saving and focus goes back to that step's Edit button, as Cancel does (#562). Edit mode stays
// on: the edit bar's own Escape (ui/EditBar.vue) leaves this one alone. An Escape something
// already handled is left alone too. The focused element is compared by what identifies it
// (a boolean, never two elements with assert.equal: #287).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { planEditing, setHideDone, setPlanEditing, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, applyUpdate, go, open, page, stubFetch } from './setup.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const focusedOn = (selector: string) => {
  const want = $(selector);
  assert.ok(want, 'expected ' + selector + ' on the page');
  return document.activeElement === want;
};
const describeFocus = () => document.activeElement?.outerHTML.slice(0, 120) ?? 'null';
const escape = (target: Element, handled = false) => {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  if (handled) target.addEventListener('keydown', e => e.preventDefault(), { once: true });
  target.dispatchEvent(event);
};

const id = 'phase-3-iron';
const edit = `#main [data-edit-task="${id}"]`;
const form = `#main [data-task-edit="${id}"]`;

let calls: ReturnType<typeof stubFetch>;
beforeEach(async () => {
  page();
  open();
  setQuery('');
  setHideDone(false);
  calls = stubFetch({ '/api/update': applyUpdate });
  go('plan');
  setPlanEditing(true);
  render();
  const button = $(edit)!;
  button.focus();
  button.click();
  await settle();
  assert.ok($(form), 'the edit form opened');
});

for (const [where, control] of [
  ['the Step title field', '[name=title]'],
  ['the Details field', '[name=body]'],
  ['the Linked factory list', '[name=link]'],
  ['the Save step button', '[type=submit]'],
  ['the Cancel button', '[data-cancel-task-edit]'],
] as const) {
  test(`Escape in ${where} closes the form unsaved, focus on Edit, edit mode on`, async () => {
    const title = $<HTMLInputElement>(`${form} [name=title]`)!;
    title.value = 'Typed but not saved';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    const el = $<HTMLElement>(`${form} ${control}`)!;
    el.focus();
    escape(el);
    await settle();
    assert.equal($(form), null, 'the form closed');
    assert.ok(focusedOn(edit), describeFocus());
    assert.equal(planEditing, true, 'edit mode is still on');
    assert.deepEqual(
      calls.filter(([path]) => path.startsWith('/api/update')),
      [],
      'nothing was saved',
    );
  });
}

test('an Escape already handled leaves the form open', async () => {
  const title = $<HTMLElement>(`${form} [name=title]`)!;
  title.focus();
  escape(title, true);
  await settle();
  assert.ok($(form), 'the form is still open');
  assert.ok(focusedOn(`${form} [name=title]`), describeFocus());
});
