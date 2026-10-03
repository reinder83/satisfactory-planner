// The sticky bar each edit mode shows while it is on (SP-13, #248, ui/EditBar.vue): Edit steps
// on both plan pages, Edit groups on both factories pages, and Edit layout in the storage room.
// It sits right under the page header as a child of <main> (what position: sticky needs), says
// which mode is on, and its Done or Esc leaves the mode with focus back on the page's toggle.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import {
  factoryEditing,
  layoutEditing,
  planEditing,
  setFactoryEditing,
  setLayoutEditing,
  setPlanEditing,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import type { View } from '../../public/app/session.ts';
import { $, generated, go, open, openMigrated, page } from './setup.ts';

beforeEach(() => {
  setPlanEditing(false);
  setFactoryEditing(false);
  setLayoutEditing(false);
  page();
});

const esc = (target: EventTarget = document.body) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
const tick = async () => {
  await nextTick();
  await nextTick();
};

const MODES: {
  name: string;
  view: View;
  calculated: boolean;
  // A profile migrated from the handbook (#387) rather than the default plan.
  migrated?: true;
  toggle: string;
  label: string;
  on: () => boolean;
}[] = [
  {
    name: 'migrated steps',
    view: 'plan',
    calculated: true,

    toggle: '[data-toggle-plan-edit]',
    label: 'Editing steps',
    on: () => planEditing,
  },
  {
    name: 'calculated steps',
    view: 'plan',
    calculated: true,
    toggle: '[data-toggle-plan-edit]',
    label: 'Editing steps',
    on: () => planEditing,
  },
  {
    name: 'migrated groups',
    view: 'factories',
    calculated: true,

    toggle: '[data-toggle-factory-edit]',
    label: 'Editing groups',
    on: () => factoryEditing,
  },
  {
    name: 'calculated groups',
    view: 'factories',
    calculated: true,
    toggle: '[data-toggle-factory-edit]',
    label: 'Editing groups',
    on: () => factoryEditing,
  },
  {
    name: 'storage layout',
    view: 'storage',
    calculated: true,

    toggle: '[data-toggle-layout]',
    label: 'Editing the layout',
    on: () => layoutEditing,
  },
];

for (const mode of MODES)
  test(`${mode.name}: the edit bar shows while editing, and Done leaves with focus on the toggle (SP-13)`, async () => {
    if (mode.migrated) openMigrated();
    else open(mode.calculated ? { calculated: generated() } : {});
    go(mode.view);
    render();
    assert.equal($('[data-edit-bar]'), null, 'no bar before editing');
    $<HTMLButtonElement>(mode.toggle)!.click();
    await tick();
    assert.equal(mode.on(), true);
    const bar = $('[data-edit-bar]')!;
    assert.ok(bar, 'the bar shows');
    assert.equal(bar.parentElement, $('#main'), 'a child of <main>, so it sticks to the page');
    assert.ok(bar.previousElementSibling!.matches('.heading-row'), 'right under the page header');
    assert.equal(bar.getAttribute('role'), 'region');
    assert.equal(bar.getAttribute('aria-label'), mode.label);
    assert.equal(bar.querySelector('.edit-bar-label')!.textContent, mode.label);
    $<HTMLButtonElement>('[data-edit-bar-done]')!.click();
    await tick();
    assert.equal(mode.on(), false, 'Done leaves edit mode');
    assert.equal($('[data-edit-bar]'), null);
    assert.equal(document.activeElement, $(mode.toggle), 'focus goes to the toggle');
  });

test('Esc leaves edit mode, except while typing or with a dialog open (SP-13)', async () => {
  open({ calculated: generated() });
  go('factories');
  render();
  $<HTMLButtonElement>('[data-toggle-factory-edit]')!.click();
  await tick();
  // Typing a group's name: Esc is the field's.
  const field = $<HTMLInputElement>('#main input')!;
  field.focus();
  esc(field);
  await tick();
  assert.equal(factoryEditing, true, 'not while typing in a field');
  // A dialog open over the page: its Esc.
  const dialog = document.createElement('dialog');
  document.body.append(dialog);
  dialog.setAttribute('open', '');
  esc();
  await tick();
  assert.equal(factoryEditing, true, 'not while a dialog is open');
  dialog.remove();
  // Handled already (a menu, a step's own form): left alone.
  const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  handled.preventDefault();
  document.body.dispatchEvent(handled);
  await tick();
  assert.equal(factoryEditing, true, 'not when something else handled it');
  esc();
  await tick();
  assert.equal(factoryEditing, false, 'Esc on the page leaves edit mode');
  assert.equal(document.activeElement, $('[data-toggle-factory-edit]'));
  // Out of edit mode the key does nothing more.
  esc();
  await tick();
  assert.equal(factoryEditing, false);
});
