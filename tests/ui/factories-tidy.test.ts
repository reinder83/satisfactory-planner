// The factories page's tidy-up (#1342): Held back as a sub-filter of Running (FAC-1), one next
// action on a factory with held-back lines (FAC-2), one factory open at a time while editing
// (FAC-3) and "Next up" with the not started factories folded (FAC-4).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test, vi } from 'vitest';
import { heldBack } from '../../public/app/views/calculated.ts';
import { factoryWaiting } from '../../public/app/factory-waiting.ts';
import {
  flowRoute,
  setFactoryEditing,
  setFactoryFilter,
  setQuery,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, generated, go, open, page } from './setup.ts';
import type { FactoryGroups } from '../../public/types/index.ts';

const STATORS = 'fg-stator1';
const WIRES = 'fg-wires01';
const PLATES = 'fg-plates1';
const phase = '3';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

// The Stator line is ticked running without anything that feeds it: it is held back, short of an
// input. `makerId` is the line that makes that input, which a factory of its own holds.
const stored = generated();
const rows = stored.stages[phase].rows!;
const stator = rows.find(row => row.id === 'Recipe_Stator_C')!;
let short = '';
let makerId = '';
beforeEach(() => {
  page();
  setQuery('');
  setFactoryFilter('all');
  setFactoryEditing(false);
  open({ calculated: stored, phase, state: { checks: { ['calc-3-' + stator.id]: true } } });
  const hold = heldBack(stator.id);
  assert.ok(hold, 'a lone Stator line is held back');
  short = hold.shortOf;
  makerId = rows.find(row => (row.outputs[short] ?? 0) > 0)!.id;
});

// Stators, the Stator line; Wire works, the line that makes what it is short of; Plates, one more
// factory, so the page has three.
const factoryGroups = (): FactoryGroups => ({
  groups: [
    { id: STATORS, name: 'Stators' },
    { id: WIRES, name: 'Wire works' },
    { id: PLATES, name: 'Plates' },
  ],
  assignments: {
    [stator.id]: [{ group: STATORS, rate: null }],
    [makerId]: [{ group: WIRES, rate: null }],
    Recipe_IronPlate_C: [{ group: PLATES, rate: null }],
  },
});

async function show(checks: Record<string, boolean> = {}, groups = factoryGroups()) {
  open({ calculated: stored, phase, state: { checks, factoryGroups: groups } });
  go('factories');
  render();
  await settle();
}
const ticked = (...ids: string[]) =>
  Object.fromEntries(ids.map(id => [`calc-${phase}-${id}`, true] as const));
const toggle = (id: string) => $<HTMLButtonElement>(`[data-collapse="${id}"]`)!;
const folded = (id: string) => toggle(id).getAttribute('aria-expanded') === 'false';
const chips = () =>
  $$('#factory-filter [role="radio"]').map(chip => ({
    value: chip.dataset.filter,
    text: text(chip),
    sub: chip.classList.contains('sub'),
  }));
const noScroll = () =>
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});

test('FAC-1: Held back is drawn as part of Running, and All is Not running plus Running', async () => {
  await show(ticked(stator.id));
  const list = chips();
  assert.deepEqual(
    list.map(chip => chip.value),
    ['all', 'todo', 'done', 'held'],
    'Held back comes right after Running',
  );
  const count = (value: string) =>
    Number(/(\d+)/.exec(list.find(c => c.value === value)!.text)![1]);
  assert.equal(count('all'), count('todo') + count('done'));
  assert.equal(list[3]!.text, 'Held back 1 of running');
  assert.equal(list[3]!.sub, true, 'drawn as a sub-filter');
  assert.equal(list[2]!.sub, false);
  assert.ok(count('held') <= count('done'));
});

test('FAC-2: a factory with held-back lines says how many wait and what to fix first', async () => {
  await show(ticked(stator.id));
  const banner = $(`#section-${STATORS} [data-waiting]`)!;
  assert.ok(banner, 'the banner is under the factory heading');
  assert.equal(text(banner.querySelector('[data-waiting-count]')), '1 line waiting on inputs');
  assert.equal(
    text(banner.querySelector('[data-waiting-fix]')),
    `Fix first: ${short} → Wire works`,
  );
  assert.equal($(`#section-${WIRES} [data-waiting]`), null, 'nothing is held back there');
  assert.equal($(`#section-${PLATES} [data-waiting]`), null);
});

test('FAC-2: Show focuses the factory that makes the input, unfolding it first', async () => {
  noScroll();
  // Plates comes before Wire works, so Plates is Next up and Wire works is folded.
  const groups = factoryGroups();
  groups.groups.push(groups.groups.splice(1, 1)[0]!);
  await show(ticked(stator.id), groups);
  assert.equal(folded(WIRES), true, 'Wire works has nothing running: folded');
  $<HTMLButtonElement>(`#section-${STATORS} [data-waiting-show]`)!.click();
  await settle();
  assert.equal(folded(WIRES), false, 'unfolded to be shown');
  assert.equal(document.activeElement, $(`#section-${WIRES} [data-section-heading]`));
});

test('FAC-2: when the same factory makes the input, Show focuses that line', async () => {
  noScroll();
  const groups = factoryGroups();
  groups.assignments[makerId] = [{ group: STATORS, rate: null }];
  await show(ticked(stator.id), groups);
  assert.equal(
    text($(`#section-${STATORS} [data-waiting-fix]`)),
    `Fix first: ${short} → ${rows.find(row => row.id === makerId)!.name}`,
  );
  $<HTMLButtonElement>(`#section-${STATORS} [data-waiting-show]`)!.click();
  await settle();
  assert.equal(
    document.activeElement,
    $(`#section-${STATORS} [data-calc-factory="${makerId}"]`),
    "the maker's card",
  );
});

test('FAC-2: Fix first is the input that holds back the most lines', () => {
  open({
    calculated: stored,
    phase,
    state: { checks: ticked(stator.id), factoryGroups: factoryGroups() },
  });
  const waiting = factoryWaiting(STATORS, [stator.id]);
  assert.deepEqual([waiting?.count, waiting?.item, waiting?.blocked], [1, short, 1]);
  assert.equal(waiting?.target?.section, WIRES);
  assert.equal(factoryWaiting(WIRES, [makerId]), null, 'nothing is held back in a factory at rest');
});

test('FAC-2: no banner while the factories are edited', async () => {
  await show(ticked(stator.id));
  setFactoryEditing(true);
  render();
  await settle();
  assert.equal($('[data-waiting]'), null);
});

test('FAC-3: editing opens one factory, the first, and the chip row switches it', async () => {
  noScroll();
  await show();
  setFactoryEditing(true);
  render();
  await settle();
  const pickers = () => $$('[data-on-site-picker]').map(el => el.dataset.onSitePicker);
  assert.deepEqual(pickers(), [STATORS], 'only the first factory is open');
  const chip = (id: string) => $<HTMLButtonElement>(`.jump-bar [data-jump="${id}"]`)!;
  assert.equal(chip(STATORS).getAttribute('aria-current'), 'true');
  assert.equal(chip(PLATES).getAttribute('aria-current'), null);
  chip(PLATES).click();
  await settle();
  assert.deepEqual(pickers(), [PLATES], 'the chip opens its factory and folds the other');
  assert.equal(chip(PLATES).getAttribute('aria-current'), 'true');
  assert.equal(chip(STATORS).getAttribute('aria-current'), null);
  assert.equal(document.activeElement, $(`#section-${PLATES} [data-section-heading]`));
  // The fold button of a factory does the same, and folding the open one leaves none open.
  assert.equal(toggle(PLATES).getAttribute('aria-expanded'), 'true');
  toggle(WIRES).click();
  await settle();
  assert.deepEqual(pickers(), [WIRES]);
  toggle(WIRES).click();
  await settle();
  assert.deepEqual(pickers(), []);
  // Nothing is saved: a new visit to edit mode starts on the first factory again.
  setFactoryEditing(false);
  setFactoryEditing(true);
  render();
  await settle();
  assert.deepEqual(pickers(), [STATORS]);
});

test('FAC-4: the page leads with Next up, and the factories not started are folded', async () => {
  await show(ticked(makerId));
  const next = $('[data-next-up]')!;
  assert.ok(next);
  // Wire works is started and runs completely; Stators is the first one not done.
  assert.equal(text(next.querySelector('[data-next-up-name]')), 'Stators');
  assert.equal(text(next.querySelector('[data-next-up-count]')), '0/1 lines');
  assert.ok(
    next.compareDocumentPosition($('#factory-search')!) & Node.DOCUMENT_POSITION_FOLLOWING,
    'above the toolbar',
  );
  assert.equal(folded(WIRES), false, 'started: open');
  assert.equal(folded(STATORS), false, 'Next up stays open');
  assert.equal(folded(PLATES), true, 'not started: folded');
  assert.equal(toggle(PLATES).tagName, 'BUTTON');
  assert.equal(toggle(PLATES).getAttribute('aria-controls'), `cards-${PLATES}`);
  // Opening it is the user's choice for this visit.
  toggle(PLATES).click();
  await settle();
  assert.equal(folded(PLATES), false);
  toggle(PLATES).click();
  await settle();
  assert.equal(folded(PLATES), true);
});

test('FAC-4: Next up links to the build order of a factory with several lines', async () => {
  const groups = factoryGroups();
  groups.assignments[makerId] = [{ group: STATORS, rate: null }];
  await show({}, groups);
  const link = $<HTMLAnchorElement>('[data-next-up-order]')!;
  assert.ok(link, 'Stators has two lines now');
  assert.equal(link.getAttribute('href'), '#' + flowRoute(STATORS));
  assert.equal(text($('[data-next-up-count]')), '0/2 lines');
});

test('FAC-4: with every factory running there is no Next up; the jump bar unfolds a folded one', async () => {
  noScroll();
  await show(ticked(stator.id, makerId, 'Recipe_IronPlate_C'));
  assert.equal($('[data-next-up]'), null);
  await show();
  assert.equal(folded(PLATES), true);
  $<HTMLButtonElement>(`.jump-bar [data-jump="${PLATES}"]`)!.click();
  await settle();
  assert.equal(folded(PLATES), false);
  assert.equal(document.activeElement, $(`#section-${PLATES} [data-section-heading]`));
});
