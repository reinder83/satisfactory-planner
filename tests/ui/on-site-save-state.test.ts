// The "Made on site" picker's Save in each state (#939): with nothing to save (before a box is
// ticked, and after a successful save) it is disabled, which style.css draws as having nothing
// to do rather than as busy (a normal cursor, not the wait cursor, #948); only while its save is
// on its way is it busy (aria-disabled, app/busy.ts). After a
// save the picker says so and, while the plan needs a recalculation, offers "Go to the
// recalculation", which brings OnSiteRecalc.vue's notice into view and focuses its button.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { setFactoryEditing, setFactoryFilter, setQuery, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import {
  $,
  applyUpdate,
  cursorOf,
  generated,
  go,
  open,
  page,
  stubFetch,
  useStylesheet,
} from './setup.ts';
import type { FactoryGroups, UpdateOp } from '../../public/types/index.ts';

const MOTORS = 'fg-motors1';

// Motors holds the Stator and Cable lines, which take Wire and Steel Pipe, both made by plan rows.
const groups = (): FactoryGroups => ({
  groups: [{ id: MOTORS, name: 'Motors' }],
  assignments: {
    Recipe_Stator_C: [{ group: MOTORS, rate: null }],
    Recipe_Cable_C: [{ group: MOTORS, rate: null }],
  },
});
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const picker = () => $(`[data-on-site-picker="${MOTORS}"]`)!;
const box = (item: string) =>
  picker().querySelector<HTMLInputElement>(`[data-on-site-item="${item}"]`)!;
const saveButton = () => $<HTMLButtonElement>(`[data-on-site-save="${MOTORS}"]`)!;
const status = () =>
  picker().querySelector('[data-on-site-saved]')?.textContent?.replace(/\s+/g, ' ').trim();
const next = () => picker().querySelector<HTMLButtonElement>('[data-on-site-next]');
const tick = (input: HTMLInputElement, on: boolean) => {
  input.checked = on;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
// Save's state in the words of the issue: unavailable (nothing to do), busy (saving), or ready,
// with the cursor style.css draws it with.
function look(button: HTMLButtonElement) {
  return {
    disabled: button.disabled,
    cursor: cursorOf(button),
    busy: button.getAttribute('aria-disabled') === 'true',
  };
}
const NOTHING_TO_DO = { disabled: true, cursor: 'default', busy: false };
const READY = { disabled: false, cursor: 'pointer', busy: false };
const SAVING = { disabled: false, cursor: 'wait', busy: true };

beforeEach(async () => {
  page();
  useStylesheet();
  setQuery('');
  setFactoryFilter('all');
  go('factories');
  open({ calculated: generated(), state: { factoryGroups: groups() } });
  setFactoryEditing(true);
  render();
  await settle();
});
afterEach(() => {
  setFactoryEditing(false);
  vi.restoreAllMocks();
});

test('with nothing ticked, Save has nothing to do: unavailable, not busy', () => {
  assert.deepEqual(look(saveButton()), NOTHING_TO_DO);
  assert.equal(status(), '');
  assert.equal(next(), null);
});

test('Save is busy only while its save is on its way, and unavailable once it is saved', async () => {
  // The update waits until the test lets it through, so Save can be seen while it saves.
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  const sent: UpdateOp[] = [];
  globalThis.fetch = async (_path: RequestInfo | URL, options: RequestInit = {}) => {
    const update = JSON.parse(String(options.body)) as UpdateOp;
    sent.push(update);
    await gate;
    return new Response(JSON.stringify(applyUpdate(update)), { status: 200 });
  };
  tick(box('Wire'), true);
  await nextTick();
  assert.deepEqual(look(saveButton()), READY, 'something to save');
  saveButton().click();
  await settle();
  assert.deepEqual(look(saveButton()), SAVING, 'busy while it saves');
  assert.equal(sent.length, 1);
  release();
  await settle();
  assert.deepEqual(state.factoryGroups?.local, { [MOTORS]: ['Wire'] });
  assert.ok(box('Wire').checked);
  assert.deepEqual(
    look(saveButton()),
    NOTHING_TO_DO,
    'saved: nothing left to save, drawn as unavailable rather than as stuck saving',
  );
  assert.equal($('[data-on-site-unsaved]'), null);
});

test('after a save the picker says so and leads to the recalculation it calls for', async () => {
  stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  const scrolled: string[] = [];
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (
    this: HTMLElement,
  ) {
    scrolled.push(this.hasAttribute('data-on-site-recalc') ? 'notice' : this.tagName);
  });
  tick(box('Wire'), true);
  await nextTick();
  saveButton().click();
  await settle();
  assert.deepEqual(look(saveButton()), NOTHING_TO_DO);
  assert.equal(status(), 'Saved. This plan now needs a recalculation.');
  assert.equal(picker().querySelector('[data-on-site-saved]')!.getAttribute('role'), 'status');
  assert.ok($('[data-on-site-recalc]'), 'the page shows the notice');
  // The next step, a .btn (a 44px target on a phone), described by the saved line.
  const way = next()!;
  assert.ok(way.classList.contains('btn'));
  assert.match(way.textContent!, /Go to the recalculation/);
  assert.equal(
    way.getAttribute('aria-describedby'),
    picker().querySelector('[data-on-site-saved]')!.id,
  );
  way.click();
  await nextTick();
  assert.deepEqual(scrolled, ['notice'], 'the notice comes into view');
  assert.equal(document.activeElement, $('[data-on-site-recalc] [data-recalc-on-site]'));
  // A new choice is unsaved again: the saved line and the way on go until it is saved.
  tick(box('Steel Pipe'), true);
  await nextTick();
  assert.deepEqual(look(saveButton()), READY);
  assert.equal(status(), '');
  assert.equal(next(), null);
});

test('a save back to the marks the plan was made with needs no recalculation', async () => {
  stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  tick(box('Wire'), true);
  await nextTick();
  saveButton().click();
  await settle();
  tick(box('Wire'), false);
  await nextTick();
  saveButton().click();
  await settle();
  assert.deepEqual(state.factoryGroups?.local, undefined);
  assert.deepEqual(look(saveButton()), NOTHING_TO_DO);
  assert.equal(status(), 'Saved.');
  assert.equal(next(), null);
  assert.equal($('[data-on-site-recalc]'), null);
});

test('a refused save keeps the choice, and Save ready to try again', async () => {
  stubFetch({});
  tick(box('Wire'), true);
  await nextTick();
  saveButton().click();
  await settle();
  assert.ok(box('Wire').checked);
  assert.deepEqual(look(saveButton()), READY);
  assert.equal(status(), '');
});
