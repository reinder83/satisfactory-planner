// A "Made on site" choice ticked but not saved yet (#930, OnSitePicker.vue). Only Save stores it
// (#854, #856), so nothing that takes the picker away may drop it without a word or save it by
// itself: Done editing (the page's toggle, the sticky bar's Done, Escape) and folding the group
// keep the picker, which says so in a live region and focuses Save, with Discard beside it
// (holdUnsavedChoices in api.ts); leaving the page or changing the phase asks first, as for an
// unsaved note (allowSwitch); closing the tab warns (listeners.ts). Save then stores the list as
// one factoryLocal update; Discard puts the saved choice back and sends nothing.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeAll, beforeEach, test, vi } from 'vitest';
import { acceptRoute } from '../../public/app/api.ts';
import {
  factoryEditing,
  sectionCollapsed,
  setFactoryEditing,
  setFactoryFilter,
  setQuery,
  setSectionCollapsed,
  state,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import {
  $,
  answerConfirms,
  applyUpdate,
  evil,
  generated,
  go,
  open,
  page,
  stubFetch,
} from './setup.ts';
import type { FactoryGroups, UpdateOp } from '../../public/types/index.ts';

const MOTORS = 'fg-motors1';
const PLATES = 'fg-plates1';

// Motors holds the Stator and Cable lines (Wire and Steel Pipe in), Plates the Iron Ingot line.
const groups = (name = 'Motors'): FactoryGroups => ({
  groups: [
    { id: MOTORS, name },
    { id: PLATES, name: 'Plates' },
  ],
  assignments: {
    Recipe_Stator_C: [{ group: MOTORS, rate: null }],
    Recipe_Cable_C: [{ group: MOTORS, rate: null }],
    Recipe_IngotIron_C: [{ group: PLATES, rate: null }],
  },
});
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const picker = () => $(`[data-on-site-picker="${MOTORS}"]`)!;
const box = (item: string) =>
  picker().querySelector<HTMLInputElement>(`[data-on-site-item="${item}"]`)!;
const saveButton = () => $<HTMLButtonElement>(`[data-on-site-save="${MOTORS}"]`)!;
const discardButton = () => $<HTMLButtonElement>(`[data-on-site-discard="${MOTORS}"]`);
const heldRegion = () => picker().querySelector('[data-on-site-held]')!;
const status = () => text(picker().querySelector('[data-on-site-saved]'));
const toggleButton = () => $<HTMLButtonElement>('#main [data-toggle-factory-edit]')!;
const barDone = () => $<HTMLButtonElement>('#main [data-edit-bar-done]')!;
const tick = (input: HTMLInputElement, on: boolean) => {
  input.checked = on;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
const esc = () =>
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
// The updates sent, by type: a test checks that nothing was saved by itself.
let sent: UpdateOp[] = [];
// Read through a function: an assertion that `sent` is empty narrows the variable itself.
const sentTypes = () => sent.map(update => update.type);
const scrolled: Element[] = [];

beforeAll(async () => {
  page();
  // The close-tab warning is page-wide (listeners.ts), registered once on import.
  await import('../../public/app/listeners.ts');
});

async function show(name = 'Motors') {
  page();
  setQuery('');
  setFactoryFilter('all');
  history.replaceState(null, '', '#factories');
  go('factories');
  open({ calculated: generated(), state: { factoryGroups: groups(name) } });
  setFactoryEditing(true);
  render();
  await settle();
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

// Ticks Wire under Motors, unsaved.
async function tickWire() {
  tick(box('Wire'), true);
  await nextTick();
  assert.ok(discardButton(), 'Discard is offered beside Save while there is something to save');
  assert.equal(text($('[data-on-site-unsaved]')), 'Not saved yet.');
}

// What the picker shows once leaving edit mode was held back by its unsaved choice.
async function assertHeld(how: string) {
  await settle();
  assert.equal(factoryEditing, true, how + ': edit mode stays on');
  assert.ok(box('Wire').checked, how + ': the choice is kept');
  assert.equal(
    text(heldRegion()),
    'This choice is not saved yet. Save it or discard it first.',
    how + ': the picker says why',
  );
  assert.equal(heldRegion().getAttribute('role'), 'status', 'announced to screen readers');
  assert.ok(heldRegion().querySelector('.notice.warn'), 'a warning: the user should act');
  assert.equal(document.activeElement, saveButton(), how + ': focus goes to Save');
  assert.equal(saveButton().getAttribute('aria-describedby'), heldRegion().id);
  assert.ok(scrolled.includes(heldRegion()), how + ': the message comes into view');
  assert.ok(discardButton(), 'Discard is beside Save');
  assert.equal($('[data-on-site-unsaved]'), null, 'the message says it, not twice');
  assert.deepEqual(sent, [], how + ': nothing is saved by itself');
}

beforeEach(() => show());
afterEach(() => {
  setFactoryEditing(false);
  setSectionCollapsed(MOTORS, false);
  setSectionCollapsed(PLATES, false);
  vi.restoreAllMocks();
});

test('Done editing with an unsaved tick keeps edit mode and the choice, and says so', async () => {
  await tickWire();
  toggleButton().click();
  await assertHeld('the page toggle');
  // Pressed again while it is still unsaved: the same, and still nothing saved.
  toggleButton().click();
  await assertHeld('the page toggle again');
});

test('the sticky bar’s Done and Escape are held back the same way', async () => {
  await tickWire();
  barDone().click();
  await assertHeld('the bar’s Done');
  // Escape outside a field (the edit bar's own key), with focus left on the page.
  (document.activeElement as HTMLElement).blur();
  esc();
  await assertHeld('Escape');
});

test('Save from there stores the list as one factoryLocal update; then Done editing leaves', async () => {
  await tickWire();
  barDone().click();
  await settle();
  saveButton().click();
  await settle();
  assert.deepEqual(sent, [{ type: 'factoryLocal', id: MOTORS, items: ['Wire'] }]);
  assert.deepEqual(state.factoryGroups?.local, { [MOTORS]: ['Wire'] });
  assert.equal(text(heldRegion()), '', 'saved: nothing left to say');
  assert.equal(discardButton(), null);
  assert.equal(status(), 'Saved. This plan now needs a recalculation.');
  assert.equal(document.activeElement, box('Steel Pipe'), 'focus goes on to the first box');
  barDone().click();
  await settle();
  assert.equal(factoryEditing, false, 'nothing unsaved: Done leaves');
  assert.equal(document.activeElement, toggleButton(), 'focus on the page’s toggle, as before');
  assert.equal(sent.length, 1, 'Done saves nothing more');
});

test('Discard drops the choice and sends nothing; then Done editing leaves', async () => {
  await tickWire();
  toggleButton().click();
  await settle();
  const discard = discardButton()!;
  assert.ok(discard.classList.contains('btn') && !discard.classList.contains('quiet'));
  assert.equal(discard.getAttribute('aria-label'), 'Discard made on site for Motors');
  // A keyboard user tabs to it from Save; a click focuses it too.
  discard.focus();
  discard.click();
  await settle();
  assert.equal(box('Wire').checked, false, 'the saved choice is back');
  assert.equal(discardButton(), null);
  assert.equal(text(heldRegion()), '');
  assert.equal(status(), 'Discarded. The saved choice is back.');
  assert.equal(
    picker().querySelector('[data-on-site-saved]')!.getAttribute('role'),
    'status',
    'announced to screen readers',
  );
  assert.equal(document.activeElement, box('Steel Pipe'), 'focus goes on to the first box');
  assert.ok(saveButton().disabled, 'nothing left to save');
  toggleButton().click();
  await settle();
  assert.equal(factoryEditing, false);
  assert.deepEqual(sent, [], 'nothing was saved');
  assert.equal(state.factoryGroups?.local, undefined);
});

test('without an unsaved choice Done editing leaves at once', async () => {
  // Ticked and cleared again: the choice is the saved one.
  tick(box('Wire'), true);
  await nextTick();
  tick(box('Wire'), false);
  await nextTick();
  assert.equal(discardButton(), null);
  barDone().click();
  await settle();
  assert.equal(factoryEditing, false);
  assert.equal(document.activeElement, toggleButton());
  assert.deepEqual(sent, []);
});

test('folding the group keeps it open while its choice is unsaved; another group folds', async () => {
  await tickWire();
  $<HTMLButtonElement>(`[data-collapse="${MOTORS}"]`)!.click();
  await settle();
  assert.equal(sectionCollapsed(MOTORS), false, 'Motors stays open');
  assert.equal(text(heldRegion()), 'This choice is not saved yet. Save it or discard it first.');
  assert.equal(document.activeElement, saveButton());
  $<HTMLButtonElement>(`[data-collapse="${PLATES}"]`)!.click();
  await settle();
  assert.equal(sectionCollapsed(PLATES), true, 'Plates has nothing unsaved: it folds');
  assert.deepEqual(sent, []);
});

test('leaving the page asks first; kept, the choice stays; left anyway, nothing is saved', async () => {
  await show(evil);
  await tickWire();
  const asked = answerConfirms(false);
  // A sidebar link, a typed address or Back (the hashchange listener calls acceptRoute).
  history.replaceState(null, '', '#plan');
  assert.equal(acceptRoute(), false, 'the page stays while it asks');
  await settle();
  assert.equal(location.hash, '#factories');
  assert.equal(asked.length, 1);
  assert.equal(
    asked[0],
    `Your choice in "Made on site in ${evil}" is not saved yet. Leave without saving it?`,
  );
  assert.equal(document.querySelector('x-evil'), null, 'the group name is drawn as text');
  assert.ok(box('Wire').checked, 'kept: the choice is still there to save');
  assert.equal(factoryEditing, true);
  // Leaving anyway goes to the address asked for, and saves nothing.
  const agreed = answerConfirms(true);
  history.replaceState(null, '', '#plan');
  assert.equal(acceptRoute(), false);
  await settle();
  assert.equal(location.hash, '#plan');
  assert.equal(agreed.length, 1);
  assert.deepEqual(sent, []);
  assert.equal(state.factoryGroups?.local, undefined);
});

test('changing the phase asks too, and a choice left behind shows the saved one again', async () => {
  await tickWire();
  const asked = answerConfirms(false);
  const phasePicker = $<HTMLSelectElement>('#phase-picker')!;
  phasePicker.value = '4';
  phasePicker.dispatchEvent(new Event('change'));
  await settle();
  assert.equal(asked.length, 1);
  assert.equal(phasePicker.value, '3', 'kept: the phase stays');
  assert.ok(box('Wire').checked);
  assert.deepEqual(sent, []);
  answerConfirms(true);
  phasePicker.value = '4';
  phasePicker.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(sentTypes(), ['phase'], 'only the phase is saved, never the choice');
  assert.equal(box('Wire').checked, false, 'the picker shows the saved choice again');
  assert.equal(status(), 'Discarded. The saved choice is back.');
});

test('closing the tab warns while a choice is unsaved', async () => {
  const unload = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(unload(), false, 'nothing unsaved');
  await tickWire();
  assert.equal(unload(), true, 'an unsaved choice');
  discardButton()!.click();
  await settle();
  assert.equal(unload(), false, 'discarded');
  assert.deepEqual(sent, []);
});
