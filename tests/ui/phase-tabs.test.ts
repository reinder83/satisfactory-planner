// The phase tabs of a factory's build order page (#1317, ui/PhaseTabs.vue in GroupFlowPage.vue):
// one tab per phase, opening on the phase on screen and marked "· current"; another phase's tab
// shows that phase's lines without switching the profile's phase or saving anything, read-only;
// the tab open is in the address (?view=) with a fallback for a bad value; and the tab list is a
// WAI-ARIA tab list (arrow keys, Home and End skip a phase with no lines, only the open tab is in
// the Tab order). The profile is the planner's default, made for Phase 3: Phases 1 and 2 are
// milestone-only, and fg-oilcp1 has 5 lines in Phase 3 and 8 in Phase 5, fg-quant1 none until
// Phase 5.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { flowRoute, flowViewOf, phase, setQuery, state, viewOf } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { $, $$, generated, go, open, page } from './setup.ts';
import type { FactoryGroups, Phase } from '../../public/types/index.ts';

const plan = generated();
const groups: FactoryGroups = defaultFactoryGroups(plan);
const OIL = 'fg-oilcp1',
  QUANT = 'fg-quant1';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 10));
  await nextTick();
};
// Opens the flow page of `groupId` as an address, a link or a reload does.
async function show(groupId: string, query = '', phaseShown: Phase = '3') {
  open({ calculated: structuredClone(plan), phase: phaseShown, state: { factoryGroups: groups } });
  location.hash = '#' + flowRoute(groupId, phaseShown) + query;
  go(viewOf(location.hash.slice(1)));
  render();
  await settle();
}
const tabs = () => $$<HTMLButtonElement>('#main [data-phase-tabs="gf"] [role="tab"]');
const tab = (id: string) => $<HTMLButtonElement>(`#main [data-phase-tab="${id}"]`)!;
const labels = () =>
  tabs().map(el =>
    el
      .textContent!.replace(/\s+/g, ' ')
      .replace(/, no lines.*/, '')
      .trim(),
  );
const openTabKey = () =>
  tabs().find(el => el.getAttribute('aria-selected') === 'true')?.dataset.phaseTab;
const cards = () => $$('#main .gf-card').length;
const press = (target: Element, name: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

beforeEach(() => {
  page();
  setQuery('');
});

test('one tab per phase, opening on the phase on screen and marking it current', async () => {
  await show(OIL);
  const list = $('#main [data-phase-tabs="gf"]')!;
  assert.equal(list.getAttribute('role'), 'tablist');
  assert.equal(list.getAttribute('aria-label'), 'Phase');
  assert.deepEqual(labels(), ['Phase 1', 'Phase 2', 'Phase 3 · current', 'Phase 4', 'Phase 5']);
  assert.equal(openTabKey(), '3');
  assert.equal(tab('3').dataset.current, 'true');
  assert.equal(tab('4').dataset.current, undefined);
  assert.equal(cards(), 5, 'the current phase draws its 5 lines');
  // The milestone-only phases have no lines: unavailable, with the reason in title and name.
  for (const early of ['1', '2']) {
    assert.equal(tab(early).getAttribute('aria-disabled'), 'true');
    assert.equal(tab(early).title, `No lines in Phase ${early}`);
    assert.match(tab(early).textContent!, new RegExp(`no lines in Phase ${early}`));
  }
  assert.equal(tab('4').getAttribute('aria-disabled'), null);
  // The panel is labelled by the open tab.
  const panel = $('#main [role="tabpanel"]')!;
  assert.equal(panel.getAttribute('aria-labelledby'), tab('3').id);
  assert.equal(tab('3').getAttribute('aria-controls'), panel.id);
  assert.equal(panel.querySelector('[data-gf-readonly]'), null, 'the current tab has no note');
});

test('Post Phase 5 labels Phase 5 as the current tab, with no tab of its own', async () => {
  await show(OIL, '', 'post');
  assert.deepEqual(labels(), [
    'Phase 1',
    'Phase 2',
    'Phase 3',
    'Phase 4',
    'Post Phase 5 · current',
  ]);
  assert.equal(openTabKey(), '5');
});

test('another phase’s tab shows its lines without switching the phase or saving anything', async () => {
  await show(OIL);
  const before = JSON.stringify(state);
  let requests = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => {
    requests++;
    return Promise.reject(new Error('no request expected'));
  };
  try {
    tab('5').click();
    await settle();
    assert.equal(openTabKey(), '5');
    assert.equal(cards(), 8, 'Phase 5 draws its 8 lines, not the current 5');
    assert.match($('#main .subtitle')!.textContent!, /^Phase 5 · 8 lines/);
    assert.equal(phase(), '3', 'the profile’s phase is as it was');
    assert.equal(JSON.stringify(state), before, 'nothing saved changed');
    assert.equal(requests, 0, 'no request was made');
    tab('3').click();
    await settle();
    assert.equal(cards(), 5, 'back on the current phase');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('another phase’s tab is read-only: no line links, no running state, a note says so', async () => {
  await show(OIL);
  assert.equal(cards(), 5);
  assert.equal($$('#main .gf-card .rail-link').length, 5, 'the current tab links its lines');
  assert.equal($$('#main .gf-card .gf-run').length, 5, 'and says whether they run');
  tab('5').click();
  await settle();
  assert.equal($$('#main .gf-card .rail-link').length, 0, 'no link to a line’s dialog');
  assert.equal($$('#main [data-calc-factory]').length, 0);
  assert.equal($$('#main .gf-card .gf-run').length, 0, 'no running or built state');
  assert.equal($$('#main .gf-card [data-gf-name]').length, 8, 'the names stay as text');
  const note = $('#main [data-gf-readonly]')!;
  assert.match(note.textContent!, /Viewing Phase 5 — switch phase to tick or edit/);
  assert.match(note.textContent!, /Your phase is Phase 3/);
  assert.equal($$('#main .gf-card input').length, 0, 'no checkbox on either tab');
});

test('the open tab is in the address without a history entry, and the address opens it', async () => {
  await show(OIL);
  const entries = history.length;
  assert.equal(flowViewOf(location.hash.slice(1)), null, 'the current tab names no view');
  tab('4').click();
  await settle();
  assert.equal(location.hash, `#factories/${OIL}/flow?phase=3&view=4`);
  assert.equal(history.length, entries, 'a tab adds no history entry');
  tab('3').click();
  await settle();
  assert.equal(location.hash, `#factories/${OIL}/flow?phase=3`, 'the current tab drops it');
  // A reload, a bookmark or Back draws the page from the address.
  await show(OIL, '&view=5');
  assert.equal(openTabKey(), '5');
  assert.equal(cards(), 8);
  assert.equal(location.hash, `#factories/${OIL}/flow?phase=3&view=5`, 'the address is kept');
});

test('a bad or empty view falls back to the phase on screen', async () => {
  for (const view of ['9', 'abc', '', '1', '2', 'post', '%E0%A4%A']) {
    await show(OIL, `&view=${view}`);
    assert.equal(openTabKey(), '3', `view=${view} opens the current phase`);
    assert.equal(cards(), 5);
  }
  // A phase where the factory has no lines is no tab to open on either.
  await show(QUANT, '&view=4');
  assert.equal(openTabKey(), '3');
  // …though Phase 5 has lines of it.
  await show(QUANT, '&view=5');
  assert.equal(openTabKey(), '5');
  assert.equal(cards(), 11);
});

test('a factory with no lines in the phase on screen still opens on its tab', async () => {
  await show(QUANT);
  assert.equal(openTabKey(), '3');
  assert.equal(tab('3').getAttribute('aria-disabled'), null, 'the open tab is never unavailable');
  assert.equal(tab('4').getAttribute('aria-disabled'), 'true');
  assert.equal(tab('4').title, 'No lines in Phase 4');
  assert.equal(tab('5').getAttribute('aria-disabled'), null);
  assert.ok($('#main [data-gf-empty]'), 'the empty notice names the phase');
  // An unavailable tab does nothing when pressed.
  tab('4').click();
  await settle();
  assert.equal(openTabKey(), '3');
});

test('arrow keys, Home and End move between the tabs and skip the ones with no lines', async () => {
  await show(QUANT);
  // Phases 1, 2 and 4 have no lines of this factory; 3 is open and 5 has lines.
  tab('3').focus();
  assert.equal(tab('3').tabIndex, 0);
  for (const other of ['1', '2', '4', '5']) assert.equal(tab(other).tabIndex, -1);
  press(tab('3'), 'ArrowRight');
  await settle();
  assert.equal(openTabKey(), '5', 'Phase 4 is skipped');
  assert.equal(document.activeElement, tab('5'), 'focus follows');
  assert.equal(tab('5').tabIndex, 0);
  assert.equal(tab('3').tabIndex, -1);
  press(tab('5'), 'ArrowRight');
  await settle();
  assert.equal(openTabKey(), '3', 'it wraps past the end, and the unavailable first tabs');
  press(tab('3'), 'ArrowLeft');
  await settle();
  assert.equal(openTabKey(), '5', 'and past the start');
  press(tab('5'), 'Home');
  await settle();
  assert.equal(openTabKey(), '3', 'Home is the first available tab');
  press(tab('3'), 'End');
  await settle();
  assert.equal(openTabKey(), '5', 'End the last');
  press(tab('5'), 'a');
  await settle();
  assert.equal(openTabKey(), '5', 'other keys do nothing');
});

test('on a later phase the address keeps both: the phase on screen and the tab open', async () => {
  await show(OIL, '', '4');
  assert.equal(openTabKey(), '4');
  assert.equal(tab('4').dataset.current, 'true');
  tab('5').click();
  await settle();
  assert.equal(location.hash, `#factories/${OIL}/flow?phase=4&view=5`);
  assert.equal(phase(), '4');
});
