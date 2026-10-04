// Esc leaves an edit mode while focus is on a checkbox or radio (#981): those take no typing, so
// the edit bar (ui/EditBar.vue) only leaves Esc to text fields, selects, dialogs and menus. An
// unsaved "Made on site" choice still holds Done back (#930), and a handled Esc stays handled.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { factoryEditing, setFactoryEditing } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, generated, go, open, page } from './setup.ts';

beforeEach(() => {
  setFactoryEditing(false);
  page();
});

const esc = (target: EventTarget) => {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};
const tick = async () => {
  await nextTick();
  await nextTick();
};
async function editGroups() {
  open({ calculated: generated() });
  go('factories');
  render();
  $<HTMLButtonElement>('[data-toggle-factory-edit]')!.click();
  await tick();
  assert.equal(factoryEditing, true);
}
// A box inside the page, as the "Made on site" picker or the storage layout has them.
function box(type: 'checkbox' | 'radio'): HTMLInputElement {
  const input = document.createElement('input');
  input.type = type;
  $('#main')!.append(input);
  input.focus();
  return input;
}

test('Esc on a checkbox leaves edit mode, with focus back on the toggle', async () => {
  await editGroups();
  esc(box('checkbox'));
  await tick();
  assert.equal(factoryEditing, false);
  assert.equal(document.activeElement, $('[data-toggle-factory-edit]'));
});

test('Esc on a radio leaves edit mode too', async () => {
  await editGroups();
  esc(box('radio'));
  await tick();
  assert.equal(factoryEditing, false);
});

test('Esc in a text field, or one already handled, still stays', async () => {
  await editGroups();
  const field = $<HTMLInputElement>('#main input:not([type="checkbox"]):not([type="radio"])')!;
  field.focus();
  esc(field);
  await tick();
  assert.equal(factoryEditing, true, 'a text field keeps its Esc');
  const checkbox = box('checkbox');
  checkbox.addEventListener('keydown', event => event.preventDefault());
  esc(checkbox);
  await tick();
  assert.equal(factoryEditing, true, 'an Esc something else handled is left alone');
});
