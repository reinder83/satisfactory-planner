// A build-plan step of a production line has two actions (#1047): "Open factory: <factory> →",
// a link to the flow page of the factory the build plan builds the line with (homeGroup, the
// rule that places the step), and "Production line ↗", the line's dialog. A line in no factory
// has only the second; a line split over several factories links its home factory and says so
// under the links. Followed, the link opens the flow page focused on the line's card. The other
// links that open a line ("Open production line →" in a storage container's dialog) open the
// line's dialog. Planner's default Phase 3 plan with the default factory groups.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeAll, beforeEach, test, vi } from 'vitest';
import { homeGroup, UNGROUPED } from '../../public/app/group-order.ts';
import { flowRoute, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { openSlot, storageBays } from '../../public/app/views/storage.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { $, $$, evil, generated, go, open, page } from './setup.ts';
import type { FactoryGroups } from '../../public/types/index.ts';

const plan = generated();
const groups: FactoryGroups = defaultFactoryGroups(plan);
const rows = plan.stages['3']!.rows!;
const WIRE = rows.find(row => row.outputs.Wire && !row.id.startsWith('amp:'))!.id;
const nameOf = (id: string) => groups.groups.find(group => group.id === id)!.name;
const HOME = groups.assignments[WIRE]![0]!.group;
// Another default group than Wire's.
const OTHER = groups.groups.find(group => group.id !== HOME)!.id;

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const stepOf = (rowId: string) => $(`#main details[data-task="calc-3-${rowId}"]`)!;
const factoryLinkOf = (rowId: string) =>
  stepOf(rowId).querySelector<HTMLAnchorElement>('.task-link[data-step-factory]');
const lineButtonOf = (rowId: string) =>
  stepOf(rowId).querySelector<HTMLButtonElement>('.task-link[data-calc-factory]');
const describeFocus = () => document.activeElement?.outerHTML.slice(0, 120) ?? 'null';

// The build plan of Phase 3 with `factoryGroups`, as the app draws it at #plan.
async function showPlan(factoryGroups: FactoryGroups = groups) {
  page();
  setQuery('');
  open({ calculated: structuredClone(plan), phase: '3', state: { factoryGroups } });
  history.replaceState(null, '', '#plan');
  go('plan');
  render();
  await settle();
}
// `groups` with Wire's memberships replaced by `memberships`.
const withWire = (
  memberships: FactoryGroups['assignments'][string],
  base: FactoryGroups = groups,
): FactoryGroups => ({ ...base, assignments: { ...base.assignments, [WIRE]: memberships } });

let scrolled: Element[] = [];
beforeAll(async () => {
  page();
  // The page-wide hashchange listener draws the page a followed link opens (listeners.ts).
  await import('../../public/app/listeners.ts');
});
beforeEach(() => {
  scrolled = [];
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (
    this: HTMLElement,
  ) {
    scrolled.push(this);
  });
});
afterEach(() => vi.restoreAllMocks());

test('a grouped line’s step opens its factory’s flow page and, separately, its dialog', async () => {
  await showPlan();
  const link = factoryLinkOf(WIRE)!;
  assert.ok(link, 'the step links its factory');
  assert.equal(link.tagName, 'A', 'a real link: Enter follows it, and it opens in a new tab too');
  assert.equal(link.textContent!.trim(), `Open factory: ${nameOf(HOME)} →`);
  assert.equal(link.getAttribute('href'), '#' + flowRoute(HOME, '3'));
  assert.equal(link.getAttribute('href'), `#factories/${HOME}/flow?phase=3`);
  assert.equal(link.getAttribute('aria-describedby'), null, 'a whole line has no split note');
  assert.equal(stepOf(WIRE).querySelector('[data-step-split]'), null);

  const button = lineButtonOf(WIRE)!;
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.textContent!.trim(), 'Production line ↗');
  assert.equal(button.getAttribute('aria-label'), 'Production line: Wire');
  assert.ok(
    link.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    'the factory first, then the line',
  );
  button.click();
  await nextTick();
  assert.ok($<HTMLDialogElement>('#detail')!.open, 'the production line dialog opens');
  assert.equal($('#detail h2')!.textContent, 'Wire');
  $<HTMLDialogElement>('#detail')!.close();
});

test('every linked step names the factory the build plan builds its line with', async () => {
  await showPlan();
  let grouped = 0;
  for (const row of rows) {
    const step = $(`#main details[data-task="calc-3-${row.id}"]`);
    if (!step) continue;
    const home = homeGroup(row, groups);
    const link = step.querySelector<HTMLAnchorElement>('.task-link[data-step-factory]');
    assert.ok(step.querySelector('.task-link[data-calc-factory]'), row.id + ': Production line ↗');
    if (home === UNGROUPED) {
      assert.equal(link, null, row.id + ' is in no factory');
      continue;
    }
    grouped++;
    assert.equal(link?.getAttribute('href'), '#' + flowRoute(home, '3'), row.id);
    assert.equal(link?.textContent!.trim(), `Open factory: ${nameOf(home)} →`, row.id);
  }
  assert.ok(grouped > 10, 'the default groups place the plan’s lines: ' + grouped);
});

test('an Ungrouped line’s step has only "Production line ↗"', async () => {
  // No membership, or only one of a factory removed since: both are Ungrouped.
  for (const memberships of [[], [{ group: 'fg-gone', rate: null }]]) {
    await showPlan(withWire(memberships));
    assert.equal(factoryLinkOf(WIRE), null, JSON.stringify(memberships));
    assert.equal(lineButtonOf(WIRE)!.textContent!.trim(), 'Production line ↗');
    assert.equal(stepOf(WIRE).querySelector('[data-step-split]'), null);
  }
});

test('a split line links the factory it is built with and says so', async () => {
  const total = rows.find(row => row.id === WIRE)!.outputs.Wire!;
  // The other factory listed first with a small fixed rate: the build plan builds the line with
  // the factory that has the larger share, not the first membership.
  const small = withWire([
    { group: OTHER, rate: Math.round(total * 0.1) },
    { group: HOME, rate: null },
  ]);
  assert.equal(homeGroup(rows.find(row => row.id === WIRE)!, small), HOME);
  await showPlan(small);
  let link = factoryLinkOf(WIRE)!;
  assert.equal(link.textContent!.trim(), `Open factory: ${nameOf(HOME)} →`);
  assert.equal(link.getAttribute('href'), '#' + flowRoute(HOME, '3'));
  let note = stepOf(WIRE).querySelector<HTMLElement>('[data-step-split]')!;
  assert.equal(
    note.textContent!.replace(/\s+/g, ' ').trim(),
    `Split over ${nameOf(HOME)} and ${nameOf(OTHER)}; this step builds it with ${nameOf(HOME)}.`,
  );
  assert.equal(link.getAttribute('aria-describedby'), note.id, 'the note describes the link');

  // The other way round: most of it in the other factory.
  const large = withWire([
    { group: HOME, rate: Math.round(total * 0.1) },
    { group: OTHER, rate: null },
  ]);
  assert.equal(homeGroup(rows.find(row => row.id === WIRE)!, large), OTHER);
  await showPlan(large);
  link = factoryLinkOf(WIRE)!;
  assert.equal(link.textContent!.trim(), `Open factory: ${nameOf(OTHER)} →`);
  assert.equal(link.getAttribute('href'), '#' + flowRoute(OTHER, '3'));
  note = stepOf(WIRE).querySelector<HTMLElement>('[data-step-split]')!;
  assert.equal(
    note.textContent!.replace(/\s+/g, ' ').trim(),
    `Split over ${nameOf(OTHER)} and ${nameOf(HOME)}; this step builds it with ${nameOf(OTHER)}.`,
  );

  // A part no factory takes counts as Ungrouped.
  await showPlan(withWire([{ group: HOME, rate: Math.round(total * 0.6) }]));
  note = stepOf(WIRE).querySelector<HTMLElement>('[data-step-split]')!;
  assert.equal(
    note.textContent!.replace(/\s+/g, ' ').trim(),
    `Split over ${nameOf(HOME)} and Ungrouped; this step builds it with ${nameOf(HOME)}.`,
  );
});

test('a hostile factory name stays text in the link and the split note', async () => {
  const renamed: FactoryGroups = {
    ...groups,
    groups: groups.groups.map(group => (group.id === HOME ? { ...group, name: evil } : group)),
  };
  await showPlan(
    withWire(
      [
        { group: HOME, rate: null },
        { group: OTHER, rate: 1 },
      ],
      renamed,
    ),
  );
  assert.equal(factoryLinkOf(WIRE)!.textContent!.trim(), `Open factory: ${evil} →`);
  assert.match(stepOf(WIRE).querySelector('[data-step-split]')!.textContent!, /x-evil/);
  assert.equal($$('x-evil').length, 0);
});

test('followed, "Open factory" opens the flow page focused on the line’s card', async () => {
  await showPlan();
  const link = factoryLinkOf(WIRE)!;
  link.focus();
  assert.equal(document.activeElement, link, 'the link takes keyboard focus');
  // Enter on a focused link is a click on it; the browser then follows its address.
  link.click();
  if (location.hash !== link.getAttribute('href')) location.hash = link.getAttribute('href')!;
  await settle();
  assert.ok($('[data-gf-back]'), 'the flow page is shown');
  assert.equal($('#main .eyebrow')?.textContent, 'FACTORY · BUILD ORDER');
  assert.equal($('#main h1')?.textContent, nameOf(HOME));
  const card = $(`#main .gf-card[data-line="${WIRE}"]`)!;
  assert.ok(card, 'the line has a card on its factory’s flow page');
  const name = card.querySelector('.rail-link')!;
  assert.equal(document.activeElement, name, 'its name link takes focus: ' + describeFocus());
  assert.ok(scrolled.includes(name), 'and is brought into view');
});

test('a link opened another way, or another page change, leaves the flow page’s heading focused', async () => {
  await showPlan();
  const link = factoryLinkOf(WIRE)!;
  // Ctrl+click opens a new tab: nothing is aimed here.
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  link.focus();
  location.hash = link.getAttribute('href')!;
  await settle();
  assert.equal(document.activeElement, $('#main h1'), describeFocus());

  // Aimed, then a different page drawn first: the aim is dropped with that page change.
  await showPlan();
  factoryLinkOf(WIRE)!.click();
  location.hash = '#notes';
  await settle();
  location.hash = '#' + flowRoute(HOME, '3');
  await settle();
  assert.equal(document.activeElement, $('#main h1'), describeFocus());
});

test('a storage container’s "Open production line →" opens the line that makes its item', async () => {
  page();
  open({ calculated: structuredClone(plan), phase: '3', state: { factoryGroups: groups } });
  go('storage');
  render();
  await settle();
  const slot = storageBays()
    .flatMap(bay => bay.items)
    .find(item => item.name && rows.some(row => row.outputs[item.name!]))!;
  assert.ok(slot, 'a container holds an item the plan makes');
  const maker = rows.find(row => row.outputs[slot.name!])!;
  openSlot(slot.id);
  await nextTick();
  const button = $<HTMLButtonElement>('#detail .detail-actions [data-calc-factory]')!;
  assert.equal(button.textContent!.trim(), 'Open production line →');
  assert.equal(button.dataset.calcFactory, maker.id);
  button.click();
  await nextTick();
  assert.equal($('#detail h2')!.textContent, maker.name, 'the line’s dialog takes its place');
  $<HTMLDialogElement>('#detail')!.close();
});
