// The factories page (public/app/ui/pages/CalculatedFactoriesPage.vue, with its parts in
// public/app/ui/factories/), and the factory and group build-order dialogs
// (public/app/ui/detail/), mounted the way the app mounts them, in happy-dom: on a calculated
// profile and on one migrated from the retired handbook (#387, #797).
import assert from 'node:assert/strict';
import { RESOLVE_WARNING } from '../../public/handbook-migration.ts';
import fs from 'node:fs';
import { createApp, h, nextTick } from 'vue';
import { FLUIDS, itemRate, lanePlan } from '../../public/app/flow.ts';
import { groupLinks } from '../../public/app/group-links.ts';
import { num, num3, slug as slugOf } from '../../public/app/format.ts';
import { phaseStepIds } from '../../public/app/opening-phase.ts';
import { taskIcon } from '../../public/app/tasks.ts';
import { machineCounts, machineLine } from '../../public/app/views/factories.ts';
import { calcTasks } from '../../public/app/views/calculated.ts';
import { power } from '../../public/app/wizard/fields.ts';
import LaneAdvice from '../../public/app/ui/detail/LaneAdvice.vue';
import CalculatedFactoriesPage from '../../public/app/ui/pages/CalculatedFactoriesPage.vue';
import type { FlowModel } from '../../public/app/flow.ts';
import { beforeEach, onTestFinished, test, vi } from 'vitest';
import { openCalculatedFactory, openGroupChain } from '../../public/app/factory-detail.ts';
import {
  boot,
  calcStage,
  setFactoryEditing,
  setContext,
  setFactoryFilter,
  setQuery,
  setSectionCollapsed,
  state,
  viewOf,
  workspace,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { cancelDetail, closeDetail } from '../../public/app/ui/actions.ts';
import {
  answerConfirms,
  $,
  $$,
  applyUpdate,
  catalog,
  evil,
  generated,
  generatedWith,
  go,
  open,
  migratedPlan,
  migratedRow,
  openMigrated,
  page,
  stubFetch,
  transcribed,
} from './setup.ts';

import type { UpdateOp } from '../../public/types/index.ts';

const plan = generated();
// The open profile's calculated plan gone, as while render() swaps the page after the profile
// was left (the progress state stays).
const closePlan = () =>
  setContext({
    save: { id: 's', name: evil },
    profile: { id: 'p', kind: 'calculated', name: evil },
    state: structuredClone(state),
    plan: null,
  });

// A profile migrated from the retired handbook (#387, openMigrated in setup.ts): `row(id)` is the
// row a handbook factory became in a phase.
const transcription = transcribed();
const migrated = migratedPlan;
const row = migratedRow;
const migratedRows = (stage = '3') => transcription.plan.stages[stage as '3']!.rows!;

const noMarkup = () =>
  assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
// The dialog markup with runs of whitespace (template line breaks) as one space.
const detail = () => $('#detail')!.innerHTML.replace(/\s+/g, ' ');
const factoryIds = (selector: string) =>
  $$(`${selector} .factory-card button.name`).map(button => button.dataset.calcFactory);

// Two groups, with the migrated profile's Wire split between them.
const GROUPS = {
  groups: [
    { id: 'fg-cable01', name: 'Cable factory' },
    { id: 'fg-plates1', name: 'Stitched plates' },
  ],
  assignments: {
    [row('wire')]: [
      { group: 'fg-cable01', rate: 300 },
      { group: 'fg-plates1', rate: null },
    ],
  },
};

// The fields of the group ops this file reads from an /api/update body.
type GroupOp = { type: UpdateOp['type'] } & Partial<
  Omit<Extract<UpdateOp, { type: 'factoryGroupAdd' }>, 'type'> &
    Omit<Extract<UpdateOp, { type: 'factoryAssign' }>, 'type'>
>;

beforeEach(() => {
  page();
  openMigrated();
  setQuery('');
  setFactoryFilter('all');
  setFactoryEditing(false);
  answerConfirms(true);
  go('factories');
});

// SP-19 (#254): a card has one control for its dialog, the name, and one for the Running box; the
// name's hit area covering the card is CSS (tests/style.test.ts, and checked in a browser).
test('each factory card has one dialog button and one Running box (SP-19)', async () => {
  const tabStops = (card: Element) =>
    [...card.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea')].map(
      control =>
        control.matches('input[type=checkbox]')
          ? 'checkbox'
          : control.classList.contains('name')
            ? 'name'
            : control.outerHTML,
    );
  render();
  for (const card of $$('#main .factory-card')) {
    assert.deepEqual(tabStops(card), ['name', 'checkbox']);
    assert.doesNotMatch(card.textContent!, /Details/);
  }
  open({ calculated: generated() });
  render();
  await nextTick();
  const cards = $$('#main .factory-card');
  assert.ok(cards.length > 0);
  for (const card of cards) assert.deepEqual(tabStops(card), ['name', 'checkbox']);
});

test('shared sites group their outputs above the individual factory list', async () => {
  render();
  const sites = $$('#main .site-group');
  assert.equal(sites[0]!.querySelector('h2')!.textContent, 'Oil campus');
  assert.equal(sites[0]!.querySelector('.eyebrow')!.textContent, 'SHARED SITE · 3 OUTPUTS');
  // One card, whose name is its one dialog button (SP-19: no Details ↗ beside it).
  assert.equal(
    $$(`#main [data-calc-factory="${row('plastic')}"]`).length,
    1,
    'Plastic sits only in the campus',
  );
  assert.ok(sites[0]!.querySelector(`[data-calc-factory="${row('plastic')}"]`));
  assert.ok(!$$('#main .site-group h2').some(h => h.textContent === 'Nuclear site'));
  assert.equal($('#main > .eyebrow')!.textContent, 'UNGROUPED PRODUCTION LINES');
  openMigrated({ phase: '5' });
  render();
  await nextTick();
  assert.ok($$('#main .site-group h2').some(h => h.textContent === 'Nuclear site'));
  assert.ok($(`#main .site-group [data-calc-factory="${row('uranium-fuel-rod', '5')}"]`));
  $<HTMLInputElement>('#factory-search')!.value = 'plastic';
  $('#factory-search')!.dispatchEvent(new Event('input'));
  await nextTick();
  assert.deepEqual(
    $$('#main .site-group h2').map(h => h.textContent),
    ['Oil campus'],
    'a site with no match disappears',
  );
  assert.equal($('#main > .eyebrow'), null, 'so does the ungrouped label');
  assert.equal($('#main .empty-state'), null, 'no empty state while a site still matches');
  $<HTMLInputElement>('#factory-search')!.value = 'no-such-part';
  $('#factory-search')!.dispatchEvent(new Event('input'));
  await nextTick();
  assert.equal(
    $('#main .empty-state')!.textContent!.trim(),
    'No production lines match this search.',
  );
  assert.equal($('[data-show-all]'), null, 'All is already chosen: nothing to offer');
});

// The status chips of both factories pages (FilterChips.vue, SP-16, #251).
const chips = () =>
  $$('#factory-filter [role="radio"]').map(chip => [
    chip.dataset.filter,
    chip.textContent!.trim().replace(/\s+/g, ' '),
    chip.getAttribute('aria-checked'),
    chip.getAttribute('tabindex'),
  ]);
const chosen = () => $('#factory-filter [aria-checked="true"]')?.dataset.filter;
const statusChip = (value: string) =>
  $<HTMLButtonElement>(`#factory-filter [data-filter="${value}"]`)!;
const chipText = (value: string) => statusChip(value).textContent!.trim().replace(/\s+/g, ' ');
const press = (key: string) =>
  document.activeElement!.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
const find = async (text: string) => {
  $<HTMLInputElement>('#factory-search')!.value = text;
  $('#factory-search')!.dispatchEvent(new Event('input'));
  await nextTick();
};
const emptyText = () => $('[data-filter-empty]')!.firstChild!.textContent!.trim();

test('the status chips filter on the saved factory checks, and the Running boxes work', async () => {
  const wire = 'calc-3-' + row('wire');
  openMigrated({ state: { checks: { [wire]: true } } });
  render();
  assert.equal($<HTMLInputElement>(`[data-check="${wire}"]`)!.checked, true);
  assert.ok($(`[data-check="${wire}"]`)!.closest('.factory-card')!.classList.contains('done'));
  assert.equal($('#factory-filter')!.getAttribute('role'), 'radiogroup');
  assert.equal($('#factory-filter')!.getAttribute('aria-label'), 'Factory status');
  statusChip('done').click();
  await nextTick();
  assert.deepEqual(factoryIds('#main'), [row('wire')]);
  assert.equal($('#main .toolbar > span')!.textContent, '1 production lines');
  statusChip('todo').click();
  await nextTick();
  assert.ok(!factoryIds('#main').includes(row('wire')));
  assert.equal(chosen(), 'todo');
});

test('a migrated profile’s chips count what the search finds, Local included', async () => {
  const rows = migratedRows();
  const isLocal = (r: (typeof rows)[number]) => !!transcription.plan.guide!.factories![r.id]?.local;
  const local = rows.filter(isLocal).length;
  assert.ok(local > 0, 'the guide builds some rows locally');
  openMigrated({ state: { checks: { ['calc-3-' + row('wire')]: true } } });
  render();
  assert.deepEqual(chips(), [
    ['all', `All ${rows.length}`, 'true', '0'],
    ['todo', `Not running ${rows.length - 1}`, 'false', '-1'],
    ['done', 'Running 1', 'false', '-1'],
    ['local', `Local ${local}`, 'false', '-1'],
    // Wire is ticked while Copper Ingot, which feeds it, is not, so it is held back.
    ['held', 'Held back 1', 'false', '-1'],
  ]);
  // A search narrows every count, whichever chip is chosen.
  statusChip('done').click();
  await find('wire');
  const wires = rows.filter(r =>
    (r.name + ' ' + Object.keys(r.outputs).join(' ')).toLowerCase().includes('wire'),
  );
  assert.deepEqual(
    chips().map(c => c[1]),
    [
      `All ${wires.length}`,
      `Not running ${wires.length - 1}`,
      'Running 1',
      `Local ${wires.filter(isLocal).length}`,
      'Held back 1',
    ],
  );
  assert.deepEqual(factoryIds('#main'), [row('wire')]);
  // A chip the search leaves empty says so and offers All back, which takes focus.
  await find('plastic');
  assert.equal(chipText('done'), 'Running 0');
  assert.equal(emptyText(), 'No production lines match “Running” and this search.');
  assert.equal($$('#main .factory-card').length, 0);
  $<HTMLButtonElement>('[data-show-all]')!.click();
  await settle();
  assert.equal(chosen(), 'all');
  assert.equal(document.activeElement, statusChip('all'));
  assert.ok($$(`#main [data-calc-factory="${row('plastic')}"]`).length > 0);
  assert.equal($('[data-filter-empty]'), null);
});

test('the chips are a radio group: arrows, Home and End move and choose, one Tab stop', async () => {
  render();
  statusChip('all').focus();
  press('ArrowRight');
  await nextTick();
  assert.equal(document.activeElement, statusChip('todo'));
  assert.equal(chosen(), 'todo');
  assert.deepEqual(
    chips().map(c => c[3]),
    ['-1', '0', '-1', '-1', '-1'],
    'only the chosen chip is in the Tab order',
  );
  press('ArrowDown');
  await nextTick();
  assert.equal(chosen(), 'done');
  press('End');
  await nextTick();
  assert.equal(document.activeElement, statusChip('held'));
  assert.equal(chosen(), 'held');
  press('ArrowRight');
  await nextTick();
  assert.equal(document.activeElement, statusChip('all'), 'the arrows wrap around');
  press('ArrowLeft');
  await nextTick();
  assert.equal(chosen(), 'held');
  press('Home');
  await nextTick();
  assert.equal(chosen(), 'all');
  press('ArrowUp');
  await nextTick();
  assert.equal(chosen(), 'held');
  // Other keys are left alone.
  const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  statusChip('held').dispatchEvent(tab);
  assert.equal(tab.defaultPrevented, false);
  assert.equal(chosen(), 'held');
});

test('the chosen chip stays through redraws and pages, and older filter values still apply', async () => {
  render();
  statusChip('local').click();
  await nextTick();
  go('plan');
  render();
  await nextTick();
  go('factories');
  render();
  await nextTick();
  assert.equal(chosen(), 'local', 'kept in factoryFilter while the app is open');
  assert.ok(factoryIds('#main').length > 0);
  // The values the old status select stored each choose their chip.
  for (const value of ['all', 'todo', 'done', 'local', 'held']) {
    setFactoryFilter(value);
    render();
    await nextTick();
    assert.equal(chosen(), value);
  }
  // A value this page has no chip for, or none at all, shows All and lists every factory.
  for (const value of ['bogus', '']) {
    setFactoryFilter(value);
    render();
    await nextTick();
    assert.equal(chosen(), 'all', value);
    assert.equal($('[data-filter-empty]'), null);
  }
});

test('the calculated page has the chips too, with Held back for rows a missing supplier holds', async () => {
  const rows = plan.stages['3'].rows!;
  const consumer = rows.find(row =>
    Object.keys(row.inputs).some(n => rows.some(o => o.id !== row.id && o.outputs[n])),
  )!;
  open({ calculated: plan, state: { checks: { ['calc-3-' + consumer.id]: true } } });
  render();
  noMarkup();
  assert.deepEqual(chips(), [
    ['all', `All ${rows.length}`, 'true', '0'],
    ['todo', `Not running ${rows.length - 1}`, 'false', '-1'],
    ['done', 'Running 1', 'false', '-1'],
    ['held', 'Held back 1', 'false', '-1'],
  ]);
  statusChip('held').click();
  await nextTick();
  assert.equal($$('#main .factory-card').length, 1);
  assert.ok($(`#main .factory-card [data-calc-factory="${consumer.id}"]`));
  assert.equal($$('#main [data-build-held]').length, 1);
  assert.equal($('#main .toolbar > span')!.textContent, '1 production lines');
  // Counts follow the search here too.
  await find('no-such-part');
  assert.deepEqual(
    chips().map(c => c[1]),
    ['All 0', 'Not running 0', 'Running 0', 'Held back 0'],
  );
  assert.equal(emptyText(), 'No production lines match “Held back” and this search.');
  $<HTMLButtonElement>('[data-show-all]')!.click();
  await settle();
  assert.equal(document.activeElement, statusChip('all'));
  assert.equal(emptyText(), 'No production lines match this search.');
  assert.equal($('[data-show-all]'), null);
  await find('');
  // Nothing ticked: nothing is held back, and the chosen chip says so.
  open({ calculated: plan });
  setFactoryFilter('held');
  render();
  await nextTick();
  assert.equal(chosen(), 'held');
  assert.equal(chipText('held'), 'Held back 0');
  assert.equal(emptyText(), 'No production lines match “Held back”.');
  // Local is a plan guide's chip: without a guide it shows All.
  setFactoryFilter('local');
  render();
  await nextTick();
  assert.equal(chosen(), 'all');
  assert.equal($$('#main .factory-card').length, rows.length);
});

test('post-game lists the completion modules with their own checks', () => {
  openMigrated({ phase: 'post' });
  render();
  const modules = $$('#main .completion-item');
  assert.ok(modules.length > 0);
  assert.match(modules[0]!.querySelector('input')!.dataset.check!, /^completion-/);
  assert.match(modules[0]!.textContent, /Inputs:/);
  // The last machine is named only when it runs below 100%.
  assert.doesNotMatch(
    $(`[data-check="completion-portable-miner"]`)!.closest('.completion-item')!.querySelector('p')!
      .textContent,
    /last at/,
  );
  assert.match(
    $(`[data-check="completion-fabric"]`)!.closest('.completion-item')!.querySelector('p')!
      .textContent,
    /· last at 33[.,]33%/,
  );
});

test('groups show their share of a split factory, and edit mode offers the editor', async () => {
  openMigrated({ state: { factoryGroups: structuredClone(GROUPS) } });
  render();
  const groups = $$('#main .user-group');
  assert.deepEqual(
    groups.map(g => g.querySelector('h2')!.textContent),
    ['Cable factory', 'Stitched plates'],
  );
  assert.equal(groups[0]!.querySelector('.eyebrow')!.textContent, 'FACTORY GROUP · 1 FACTORY');
  assert.match(groups[0]!.querySelector('.allocation')!.textContent, /^Here: 300\/min of /);
  assert.match(groups[1]!.querySelector('.allocation')!.textContent, /^Remaining here: /);
  assert.ok(
    !factoryIds('#main > .cards').includes(row('wire')),
    'a grouped factory leaves the list',
  );
  assert.equal($('[data-group-chain]'), null, 'a one-factory group has no build order');
  $('[data-toggle-factory-edit]')!.click();
  await nextTick();
  assert.equal($('[data-toggle-factory-edit]')!.textContent.trim(), 'Done editing');
  assert.ok($('#add-group'));
  assert.equal($<HTMLInputElement>('[data-group-rename="fg-cable01"]')!.value, 'Cable factory');
  assert.equal(
    $<HTMLInputElement>(`[data-assign-rate="${row('wire')}"][data-group="fg-cable01"]`)!.value,
    '300',
  );
  assert.ok($(`[data-unassign="${row('wire')}"][data-group="fg-plates1"]`));
  assert.ok($(`[data-assign-add="${row('computer')}"]`), 'every card offers a group');
});

test('a factory in two groups without rates shows half in each, as Between groups counts it (#197)', async () => {
  openMigrated({
    state: {
      factoryGroups: {
        groups: [
          { id: 'fg-plates1', name: 'Plates' },
          { id: 'fg-remote1', name: 'Remote' },
        ],
        assignments: {
          [row('wire')]: [
            { group: 'fg-plates1', rate: null },
            { group: 'fg-remote1', rate: null },
          ],
        },
      },
    },
  });
  go('factories');
  render();
  await nextTick();
  const lines = $$('.allocation').map(allocation => allocation.textContent);
  assert.equal(lines.length, 2, JSON.stringify(lines));
  // Each group shows half of Wire's output, not all of it twice.
  for (const line of lines) assert.match(line, /^Remaining here, split 2 ways: /);
  const [here, total] = lines[0]!.match(/[\d.,]+(?=\/min)/g)!;
  assert.equal(lines[0], lines[1]);
  assert.ok(here !== total, 'a share, not the whole: ' + lines[0]);
});

test('the group editor saves groups and memberships', async () => {
  const calls = stubFetch<GroupOp>({ '/api/update': () => state });
  openMigrated({ state: { factoryGroups: structuredClone(GROUPS) } });
  setFactoryEditing(true);
  render();
  const form = $<HTMLFormElement>('#add-group')!;
  form.querySelector('input')!.value = evil;
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  assert.equal(calls.at(-1)![1].type, 'factoryGroupAdd');
  assert.equal(calls.at(-1)![1].name, evil);
  assert.match(calls.at(-1)![1].id!, /^fg-[0-9a-f]{12}$/);
  assert.equal(form.querySelector('input')!.value, '', 'the form empties after adding');
  const rename = $<HTMLInputElement>('[data-group-rename="fg-cable01"]')!;
  rename.value = 'Cables';
  rename.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(calls.at(-1)![1], {
    type: 'factoryGroupRename',
    id: 'fg-cable01',
    name: 'Cables',
  });
  const rate = $<HTMLInputElement>(`[data-assign-rate="${row('wire')}"][data-group="fg-cable01"]`)!;
  rate.value = '120';
  rate.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(calls.at(-1)![1], {
    type: 'factoryAssign',
    key: row('wire'),
    groups: [
      { group: 'fg-cable01', rate: 120 },
      { group: 'fg-plates1', rate: null },
    ],
  });
  const count = calls.length;
  rate.value = '-4';
  rate.dispatchEvent(new Event('change'));
  await settle();
  assert.equal(calls.length, count, 'an invalid rate is not saved');
  assert.equal(rate.value, '300', 'and shows the saved rate again');
  assert.match($('#toast')!.textContent, /Enter a rate above 0/);
  $(`[data-unassign="${row('wire')}"][data-group="fg-plates1"]`)!.click();
  await settle();
  assert.deepEqual(calls.at(-1)![1].groups, [{ group: 'fg-cable01', rate: 300 }]);
  const add = $<HTMLSelectElement>(`[data-assign-add="${row('computer')}"]`)!;
  add.value = 'fg-plates1';
  add.dispatchEvent(new Event('change'));
  await settle();
  $(`[data-assign-go="${row('computer')}"]`)!.click();
  await settle();
  assert.deepEqual(calls.at(-1)![1], {
    type: 'factoryAssign',
    key: row('computer'),
    groups: [{ group: 'fg-plates1', rate: null }],
  });
  assert.equal(
    $<HTMLSelectElement>(`[data-assign-add="${row('computer')}"]`)!.value,
    '',
    'the selector goes back to its prompt',
  );
  $('[data-remove-group="fg-plates1"]')!.click();
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'factoryGroupRemove', id: 'fg-plates1' });
  answerConfirms(false);
  const before = calls.length;
  $('[data-remove-group="fg-cable01"]')!.click();
  await settle();
  assert.equal(calls.length, before, 'a declined confirmation removes nothing');
});

test('"+ Add to group…" only picks a group; Add joins it, once, and a failed add keeps the pick (#856)', async () => {
  // The stub goes when the test ends: a later test that stubs nothing expects a write to fail.
  const original = globalThis.fetch;
  onTestFinished(() => {
    globalThis.fetch = original;
  });
  let fail = false;
  const calls = stubFetch<GroupOp>({
    '/api/update': (update: UpdateOp) => {
      if (fail) throw Error('Simulated failure');
      return applyUpdate(update);
    },
  });
  openMigrated({
    state: {
      factoryGroups: {
        groups: [
          { id: 'fg-cable01', name: 'Cable factory' },
          { id: 'fg-plates1', name: evil },
        ],
        assignments: {},
      },
    },
  });
  setFactoryEditing(true);
  render();
  await nextTick();
  const key = row('computer'),
    menu = () => $<HTMLSelectElement>(`[data-assign-add="${key}"]`)!,
    join = () => $<HTMLButtonElement>(`[data-assign-go="${key}"]`)!;
  assert.equal(join().disabled, true, 'Add has nothing to do before a group is picked');
  assert.equal(join().getAttribute('aria-label'), 'Add to a group');
  // An arrow key on the closed menu, as Chrome and Edge on Windows handle it: the value changes
  // and `change` fires. That only picks the group; the factory joins nothing.
  menu().focus();
  menu().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  menu().value = 'fg-cable01';
  menu().dispatchEvent(new Event('input', { bubbles: true }));
  menu().dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  // Browsing on to the next group still adds nothing.
  menu().value = 'fg-plates1';
  menu().dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.equal(calls.length, 0, 'browsing the groups saves nothing');
  assert.equal(menu().value, 'fg-plates1', 'the pick stays');
  assert.equal(join().disabled, false);
  assert.equal(join().getAttribute('aria-label'), 'Add to ' + evil);
  noMarkup();
  // A failed add: the factory stays out, the pick and focus stay.
  fail = true;
  join().focus();
  join().click();
  await settle();
  assert.equal(calls.length, 1);
  assert.deepEqual(state.factoryGroups?.assignments[key] ?? [], []);
  assert.equal(menu().value, 'fg-plates1', 'the pick stays after a failure');
  assert.equal(join().disabled, false);
  assert.ok(document.activeElement === join(), 'focus stays on Add');
  // Add saves once.
  fail = false;
  join().click();
  await settle();
  assert.equal(calls.length, 2, 'Add saves once');
  assert.deepEqual(calls.at(-1)![1], {
    type: 'factoryAssign',
    key,
    groups: [{ group: 'fg-plates1', rate: null }],
  });
  assert.deepEqual(state.factoryGroups?.assignments[key], [{ group: 'fg-plates1', rate: null }]);
});

test('group names are escaped on the page, in the editor and in the build order', async () => {
  openMigrated({
    state: {
      factoryGroups: {
        groups: [{ id: 'fg-a', name: evil }],
        assignments: {
          [row('wire')]: [{ group: 'fg-a', rate: null }],
          [row('cable')]: [{ group: 'fg-a', rate: null }],
        },
      },
      notes: { ['factory-' + row('computer')]: evil },
    },
  });
  render();
  noMarkup();
  assert.equal($('.user-group h2')!.textContent, evil);
  $('[data-group-chain="fg-a"]')!.click();
  await nextTick();
  assert.equal($('#detail h2')!.textContent, evil);
  noMarkup();
  setFactoryEditing(true);
  render();
  await nextTick();
  assert.equal($<HTMLInputElement>('[data-group-rename="fg-a"]')!.value, evil);
  assert.equal($(`[data-assign-add="${row('computer')}"] option:last-child`)!.textContent, evil);
  noMarkup();
  openCalculatedFactory(row('computer'));
  assert.equal($<HTMLTextAreaElement>('#detail-note')!.value, evil);
  noMarkup();
});

test('a migrated factory dialog shows its flow, destinations and inputs', () => {
  render();
  openCalculatedFactory(row('wire'));
  assert.ok($<HTMLDialogElement>('#detail')!.open);
  assert.match(detail(), /Delivers · Phase 3/);
  assert.match(detail(), /Machines per delivery/, 'delivery rows show machine counts');
  assert.ok(
    $(`#detail .rail-link[data-calc-factory="${row('cable')}"]`),
    'consumers link to their factory',
  );
  openCalculatedFactory(row('smart-plating'));
  assert.ok($(`#detail [data-calc-factory="${row('modular-engine')}"]`));
  openCalculatedFactory(row('modular-engine'));
  assert.match(detail(), /Space Elevator delivery/);
  openCalculatedFactory(row('reinforced-iron-plate'));
  assert.ok($(`#detail [data-calc-factory="${row('wire')}"]`), 'inputs link to their maker');
  assert.match(detail(), /Belts &amp; pipes/);
  assert.equal(
    $('#detail [data-save-note]')!.dataset.saveNote,
    'factory-' + row('reinforced-iron-plate'),
  );
});

test('every dialog opens at the top, not where the last one was left (#316)', async () => {
  render();
  const dialog = $<HTMLDialogElement>('#detail')!;
  openCalculatedFactory(row('wire'));
  // The <dialog> is the scroll container and keeps its offset while closed.
  dialog.scrollTop = 300;
  assert.equal(dialog.scrollTop, 300);
  void closeDetail();
  await settle();
  assert.equal(dialog.open, false);
  openCalculatedFactory(row('wire'));
  assert.equal(dialog.scrollTop, 0, 'reopened after closing a scrolled dialog');
  // A link inside the dialog replaces it while it stays open.
  dialog.scrollTop = 300;
  $<HTMLButtonElement>(`#detail .rail-link[data-calc-factory="${row('cable')}"]`)!.click();
  assert.equal($('#detail h2')!.textContent, 'Cable');
  assert.ok(dialog.open);
  assert.equal(dialog.scrollTop, 0, 'replaced by a link inside it');
});

// Focus when a link inside a dialog puts another one in its place (#319): the focused link
// goes with the old dialog, and showModal() does not run again. happy-dom's showModal() and
// close() move no focus, so a fresh open leaves focus on the opener here; in a browser it
// focuses the same first control.
const focused = (selector: string) => document.activeElement?.matches(selector) ?? false;
// Focuses `link` and presses it, as a keyboard user does, and checks that focus lands on the
// new dialog's first control, the Running box `key` in its sticky header.
const follow = (link: HTMLElement, key: string) => {
  const dialog = $<HTMLDialogElement>('#detail')!;
  const from = $('#detail h2')!.textContent;
  link.focus();
  dialog.scrollTop = 300;
  link.click();
  assert.notEqual($('#detail h2')!.textContent, from, 'another dialog took its place');
  assert.ok(dialog.open);
  assert.equal(link.isConnected, false, 'the link went with the old dialog');
  assert.equal(focused('body'), false, 'focus is not left on <body>');
  assert.equal(
    focused(`#detail .dialog-head [data-check="${key}"]`),
    true,
    'focus is on the new dialog’s first control, as on opening',
  );
  assert.equal(dialog.scrollTop, 0, 'and the dialog starts at its top');
};

test('a link inside a migrated factory dialog moves focus into the new one, and closing returns it to the opener (#319)', async () => {
  render();
  const dialog = $<HTMLDialogElement>('#detail')!;
  const cable = `#detail .rail-link[data-calc-factory="${row('cable')}"]`;
  const opener = $<HTMLButtonElement>(
    `#main .factory-card button.name[data-calc-factory="${row('wire')}"]`,
  )!;
  opener.focus();
  opener.click();
  assert.equal($('#detail h2')!.textContent, 'Wire');
  follow($(cable)!, 'calc-3-' + row('cable'));
  // A second hop, from the dialog that replaced the first.
  const next = $<HTMLElement>('#detail .dialog-body [data-calc-factory]')!;
  follow(next, 'calc-3-' + next.dataset.calcFactory);
  // Escape (the browser closes the dialog after the cancel event) goes back to the card's
  // name, however many dialogs came in between.
  const escape = new Event('cancel', { cancelable: true });
  cancelDetail(escape);
  assert.equal(escape.defaultPrevented, false);
  dialog.close();
  assert.equal(dialog.open, false);
  assert.equal(document.activeElement === opener, true, 'Escape returns focus to the opener');
  // The × does the same.
  opener.click();
  follow($(cable)!, 'calc-3-' + row('cable'));
  $<HTMLButtonElement>('#detail [data-close]')!.focus();
  void closeDetail();
  await settle();
  assert.equal(dialog.open, false);
  assert.equal(document.activeElement === opener, true, 'the × returns focus to the opener');
});

test('focus moves into the new dialog after the unsaved-note question too (#319)', async () => {
  render();
  const opener = $<HTMLButtonElement>(
    `#main .factory-card button.name[data-calc-factory="${row('wire')}"]`,
  )!;
  opener.focus();
  opener.click();
  const asked = answerConfirms(true);
  $<HTMLTextAreaElement>('#detail-note')!.value = 'Unsaved thought';
  const link = $<HTMLButtonElement>(`#detail .rail-link[data-calc-factory="${row('cable')}"]`)!;
  link.focus();
  link.click();
  await settle();
  assert.equal(asked.length, 1, 'the note was asked about');
  assert.equal($('#detail h2')!.textContent, 'Cable');
  assert.equal(focused(`#detail .dialog-head [data-check="calc-3-${row('cable')}"]`), true);
  void closeDetail();
  await settle();
  assert.equal(document.activeElement === opener, true);
});

// A browser fires a dialog's close event some milliseconds after close(), and a click can come
// in between: Escape and an immediate click on another card opened that card's dialog, and
// then the late close event emptied it (#322). happy-dom fires close at once, so the test
// holds that event back and delivers it after the reopening, as the browser does.
test('a late close event leaves a dialog opened in the meantime alone (#322)', async () => {
  render();
  const dialog = $<HTMLDialogElement>('#detail')!;
  const card = (id: string) =>
    $<HTMLButtonElement>(`#main .factory-card button.name[data-calc-factory="${row(id)}"]`)!;
  const first = card('wire');
  const second = card('cable');
  first.focus();
  first.click();
  assert.equal($('#detail h2')!.textContent, 'Wire');
  // Escape: the browser closes the dialog, but its close event is still on its way.
  const hold = (event: Event) => {
    if (event.target === dialog) event.stopImmediatePropagation();
  };
  document.addEventListener('close', hold, true);
  dialog.close();
  document.removeEventListener('close', hold, true);
  assert.equal(dialog.open, false);
  // The click on another card lands first.
  second.focus();
  second.click();
  assert.ok(dialog.open);
  assert.equal($('#detail h2')!.textContent, 'Cable');
  // Then the close event of the dialog already gone arrives.
  dialog.dispatchEvent(new Event('close'));
  await settle();
  assert.ok(dialog.open, 'the new dialog stays open');
  assert.equal($('#detail h2')?.textContent, 'Cable', 'and keeps its content');
  assert.ok($('#detail [data-close]'), 'its × is still there');
  assert.equal(document.activeElement === second, true, 'focus is not moved by the late event');
  // Closing the new dialog still returns focus to its own opener, not the first card.
  document.body.focus();
  dialog.close();
  assert.equal(dialog.open, false);
  assert.equal($('#detail h2'), null, 'closing it unmounts it');
  assert.equal(document.activeElement === second, true, 'focus goes back to the second card');
});

test('a link inside a calculated factory dialog moves focus into the new one (#319)', async () => {
  open({ calculated: plan });
  render();
  const stage = calcStage()!;
  const producer = stage.rows!.find(row =>
    Object.keys(row.outputs).some(n => stage.rows!.some(o => o.id !== row.id && o.inputs[n])),
  )!;
  const dialog = $<HTMLDialogElement>('#detail')!;
  const opener = $<HTMLButtonElement>(`#main .factory-card [data-calc-factory="${producer.id}"]`)!;
  opener.focus();
  opener.click();
  assert.equal($('#detail h2')!.textContent, producer.name);
  const link = $<HTMLElement>('#detail .dialog-body [data-calc-factory]')!;
  follow(link, 'calc-3-' + link.dataset.calcFactory);
  dialog.close();
  assert.equal(document.activeElement === opener, true, 'closing returns focus to the opener');
});

test('a factory in a group’s build order moves focus into its dialog (#319)', async () => {
  const stage = plan.stages['3'];
  const consumer = stage.rows!.find(row =>
    stage.rows!.some(
      o => o.id !== row.id && Object.keys(o.outputs || {}).some(n => row.inputs?.[n]),
    ),
  )!;
  const supplier = stage.rows!.find(
    o => o.id !== consumer.id && Object.keys(o.outputs || {}).some(n => consumer.inputs[n]),
  )!;
  open({
    calculated: plan,
    state: {
      factoryGroups: {
        groups: [{ id: 'fg-test01', name: 'Chain test' }],
        assignments: {
          [consumer.id]: [{ group: 'fg-test01', rate: null }],
          [supplier.id]: [{ group: 'fg-test01', rate: null }],
        },
      },
    },
  });
  render();
  const opener = $<HTMLButtonElement>('[data-group-chain="fg-test01"]')!;
  opener.focus();
  opener.click();
  // "build order" is joined by a no-break space, so a wrapping eyebrow keeps it whole (#460).
  assert.match($('#detail .eyebrow')!.textContent, /^Factory group · build\u00a0order · /);
  // The group's name heads it and the body does not repeat it, so it may wrap on a phone (#435).
  assert.ok($('#detail .dialog-head')!.classList.contains('wrap-title'));
  follow($('#detail .chain-title [data-calc-factory]')!, 'calc-3-' + supplier.id);
  // A factory's own dialog keeps its one-line title (#318).
  assert.ok(!$('#detail .dialog-head')!.classList.contains('wrap-title'));
  void closeDetail();
  await settle();
  assert.equal(document.activeElement === opener, true, 'the × returns focus to Build order');
});

test('a dialog keeps an unsaved note while a box in it is ticked', async () => {
  // The note's save fails (no reply for /api/update), so the note stays unsaved (#858).
  const calls = stubFetch({});
  const asked = answerConfirms(true);
  render();
  const wire = 'calc-3-' + row('wire');
  openCalculatedFactory(row('wire'));
  $<HTMLTextAreaElement>('#detail-note')!.value = 'Unsaved thought';
  $('#detail-note')!.dispatchEvent(new Event('input'));
  // What toggleCheck (ui/actions.ts) does once the tick is saved.
  state.checks[wire] = true;
  render();
  await nextTick();
  assert.equal($<HTMLInputElement>(`#detail [data-check="${wire}"]`)!.checked, true);
  assert.equal($<HTMLTextAreaElement>('#detail-note')!.value, 'Unsaved thought');
  // Leaving the box sends the note, and that write fails.
  $('#detail-note')!.dispatchEvent(new Event('blur'));
  await settle();
  assert.deepEqual(
    calls.map(([path]) => path),
    ['/api/update'],
  );
  // Replacing the dialog asks about the unsaved note first; answered yes, it is dropped.
  openCalculatedFactory(row('wire'));
  await settle();
  assert.equal(asked.length, 1, 'replacing the dialog asks about the unsaved note');
  assert.equal(
    $<HTMLTextAreaElement>('#detail-note')!.value,
    '',
    'opening the dialog again starts from the saved note',
  );
});

test('belt advice counts no extra lane at an exact multiple of the capacity', () => {
  // Two lanes' worth exactly, then a little over one lane.
  const advice = (rate: number) => {
    const plan = lanePlan(rate, false, '3');
    const model: FlowModel = {
      stage: '3',
      equivalent: 4,
      machineCount: 4,
      inputs: [{ name: 'Iron Ore', rate, link: null, plan }],
      outputs: [],
      machineName: '',
      recipe: null,
      bar: null,
      sameItemConsumers: () => [],
    };
    const el = document.createElement('div');
    createApp({ render: () => h(LaneAdvice, { model }) }).mount(el);
    return { capacity: plan.lane.cap, text: el.querySelector('.logi-row p')!.textContent!.trim() };
  };
  const { capacity } = advice(1);
  // A hair under the multiple, as a solver value can be, is still every lane full (#88).
  assert.match(advice(2 * capacity * (1 - 1e-10)).text, /all 2 full\.$/);
  assert.match(advice(2 * capacity).text, /→ 2 × Mk\.\d belts — all 2 full\.$/);
  // A hair over the multiple needs a third lane, which carries almost nothing (#89).
  assert.match(
    advice(2 * capacity + 0.001).text,
    /3 × Mk\.\d belts — 2 full \+ 1 carrying under 0\.01\/min\.$/,
  );
  assert.match(advice(capacity + 30).text, /→ 2 × Mk\.\d belts — 1 full \+ 1 carrying 30\/min\.$/);
});

test('closing or replacing a dialog asks before dropping an unsaved note', async () => {
  render();
  openCalculatedFactory(row('wire'));
  const asked = answerConfirms(false);
  $<HTMLTextAreaElement>('#detail-note')!.value = 'Unsaved thought';
  const dialog = $<HTMLDialogElement>('#detail')!;
  // The × and a backdrop click (closeDetail), another factory's link, and Escape. The
  // question opens in #confirm, above the dialog.
  void closeDetail();
  assert.ok($<HTMLDialogElement>('#confirm')!.open && dialog.open, 'asked above the dialog');
  await settle();
  openCalculatedFactory(row('screws'));
  await settle();
  const escape = new Event('cancel', { cancelable: true });
  cancelDetail(escape);
  await settle();
  assert.equal(asked.length, 3);
  assert.match(asked[0]!, /notes that could not be saved/);
  assert.equal(escape.defaultPrevented, true);
  assert.ok(dialog.open, 'kept notes keep the dialog open');
  assert.equal($<HTMLTextAreaElement>('#detail-note')!.value, 'Unsaved thought');
  assert.equal($('#detail [data-save-note]')!.dataset.saveNote, 'factory-' + row('wire'));
  // Leaving anyway: the ×, then Escape on a reopened dialog, close it.
  answerConfirms(true);
  void closeDetail();
  await settle();
  assert.equal(dialog.open, false);
  openCalculatedFactory(row('wire'));
  $<HTMLTextAreaElement>('#detail-note')!.value = 'Unsaved thought';
  const escapeAgain = new Event('cancel', { cancelable: true });
  cancelDetail(escapeAgain);
  assert.equal(escapeAgain.defaultPrevented, true, 'held open until the answer');
  await settle();
  assert.equal(dialog.open, false);
  // Without an edit there is nothing to ask, and it all happens at once.
  const none = answerConfirms(false);
  openCalculatedFactory(row('wire'));
  void closeDetail();
  assert.equal(dialog.open, false);
  assert.equal(none.length, 0);
});

// The machine instructions are three compact cells, Total · At 100% · Adjustable (SP-20, #255),
// in a description list so each number is read with its label. Each cell as [label, value,
// caption], runs of whitespace as one space.
const machineCells = () =>
  $$('#detail dl.machine-cells > div.stat.compact').map(cell =>
    [
      cell.querySelector('dt')!,
      cell.querySelector('dd strong')!,
      cell.querySelector('dd small')!,
    ].map(part => part.textContent!.replace(/\s+/g, ' ').trim()),
  );
const percent = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 1 }) + '%';

test('a migrated dialog shows its machines as Total, At 100% and Adjustable cells', () => {
  render();
  openCalculatedFactory(row('smart-plating'));
  assert.deepEqual(machineCells(), [
    ['Total', '58', 'Assembler · peak load 435 MW'],
    ['At 100%', '57', num(2) + ' Smart Plating/min each'],
    ['Adjustable', '1 at 50%', '≈ 50% → ≈ ' + num(1) + ' Smart Plating/min'],
  ]);
  assert.equal($$('#detail dl.machine-cells dt').length, 3, 'every number has its label');
  assert.ok(
    !$$('#detail p').some(p => /whole building/.test(p.textContent!)),
    'the old sentence is gone',
  );
  // Every machine at 100%: no adjustable one and no clock. Above 1,000 MW the peak is in GW.
  openCalculatedFactory(row('copper-ingot'));
  assert.deepEqual(machineCells(), [
    ['Total', num(168), 'Refinery · peak load ' + num(2.52) + ' GW'],
    ['At 100%', num(168), num(37.5) + ' Copper Ingot/min each'],
    ['Adjustable', '0', 'No underclock needed'],
  ]);
  // The cell shows the card's clock (one decimal).
  openCalculatedFactory(row('heavy-modular-frame'));
  assert.deepEqual(machineCells()[2]![1], '1 at ' + percent(66.7));
  // One building at 100% is 1 · 1 · 0 (#112 kept "1 whole buildings" out; the cells count it).
  openCalculatedFactory(row('versatile-framework'));
  assert.deepEqual(
    machineCells().map(c => c[1]),
    ['1', '1', '0'],
  );
});

test('the machine counts follow the card’s clock rule: one decimal, never up to 100%', () => {
  assert.deepEqual(machineCounts(3, 99.96), {
    total: 3,
    full: 2,
    adjustable: 1,
    clock: (99.9).toLocaleString(),
  });
  assert.equal(
    machineLine(3, 'Smelter', 99.96),
    `3 × Smelter · last at ${(99.9).toLocaleString()}%`,
  );
  assert.deepEqual(machineCounts(4, 100), { total: 4, full: 4, adjustable: 0 });
  assert.deepEqual(machineCounts(1, 25), { total: 1, full: 0, adjustable: 1, clock: '25' });
});

test('a calculated dialog shows the same three cells as its card, with output per machine', () => {
  const plan = generated();
  const rows = plan.stages['3'].rows!;
  const made = rows.find(
    r => Object.keys(r.outputs).length === 1 && r.machines > 2 && r.lastClock < 99,
  )!;
  const generator = rows.find(r => !Object.keys(r.outputs).length)!;
  const whole = rows.find(
    r => r !== made && r !== generator && Object.keys(r.outputs).length === 1,
  )!;
  assert.ok(made && generator && whole, 'the default plan has these lines');
  // A generator with its last one at 62.5%, a line running all at 100%, one single machine.
  Object.assign(generator, {
    machines: 5,
    equivalent: 4.625,
    lastClock: 62.5,
    generationMW: 406.8,
  });
  Object.assign(whole, { equivalent: whole.machines, lastClock: 100 });
  open({ calculated: plan });
  render();
  openCalculatedFactory(made.id);
  const [item, rate] = Object.entries(made.outputs)[0]!;
  const each = rate / made.equivalent,
    fraction = made.equivalent - (made.machines - 1);
  const card = $(`#main button.name[data-calc-factory="${made.id}"]`)!
    .closest('.factory-card')!
    .querySelector('.machines')!.textContent!;
  const cells = machineCells();
  assert.deepEqual(cells, [
    ['Total', num(made.machines), made.machine + ' · peak load ' + power(made.peakMW)],
    ['At 100%', num(made.machines - 1), `${num(each)} ${item}/min each`],
    [
      'Adjustable',
      '1 at ' + card.split(' · last at ')[1],
      `≈ ${num(fraction * 100)}% → ≈ ${num(each * fraction)} ${item}/min`,
    ],
  ]);
  assert.match(cells[2]![1]!, /^1 at [\d.,]+%$/, 'the card and the dialog show one clock');
  assert.doesNotMatch(detail(), /Clock each/, 'the cells replace the setup table');
  // A generator's Total says what it generates; it draws no peak load.
  openCalculatedFactory(generator.id);
  assert.deepEqual(machineCells(), [
    ['Total', '5', generator.machine + ' · generates ' + num(406.8) + ' MW'],
    ['At 100%', '4', num(406.8 / 4.625) + ' MW each'],
    [
      'Adjustable',
      '1 at ' + percent(62.5),
      `≈ ${num(62.5)}% → ≈ ${num((406.8 / 4.625) * 0.625)} MW`,
    ],
  ]);
  // All at 100%: the Adjustable cell is 0, with no clock.
  openCalculatedFactory(whole.id);
  assert.deepEqual(machineCells()[2], ['Adjustable', '0', 'No underclock needed']);
  assert.equal(machineCells()[1]![1], num(whole.machines));
  // A single machine below 100% is 1 · 0 · 1 at its clock, with nothing at full speed.
  Object.assign(whole, { machines: 1, equivalent: 0.4, lastClock: 40 });
  open({ calculated: plan });
  render();
  openCalculatedFactory(whole.id);
  assert.deepEqual(
    machineCells().map(c => c[1]),
    ['1', '0', '1 at ' + percent(40)],
  );
  assert.equal(machineCells()[1]![2], '');
});

// SP-21 (#256): the Output, Storage and Machines tiles repeated the card, so they are gone; the
// output rate is the line under the title, and the flow comes straight after the header (after a
// guide note). No-break spaces keep a rate whole.
const summary = () => $('#detail .dialog-head [data-dialog-summary]')?.textContent ?? null;
const noBreakSpace = ' ';
const bodyStart = () =>
  [...$('#detail .dialog-body')!.children]
    .slice(0, 2)
    .map(child =>
      child.matches('.badge')
        ? 'badge'
        : child.tagName === 'H3'
          ? child.textContent
          : child.className,
    );
const noTiles = () => {
  assert.equal($('#detail .dialog-body > .stats:not(.machine-cells)'), null, 'no summary tiles');
  assert.doesNotMatch(detail(), /Total production|Protected allowance|Shared oil processes/);
};

test('a migrated dialog says its output under its title, its printed page and its note', () => {
  render();
  const card = $(`#main button.name[data-calc-factory="${row('iron-ingot')}"]`)!.closest(
    '.factory-card',
  )!;
  openCalculatedFactory(row('iron-ingot'));
  noTiles();
  assert.equal(summary(), `${num(5850)}/min`);
  // Escaped: on nl-NL the thousands separator is a dot, a regex wildcard (#576).
  const rate = new RegExp(num(5850).replace(/[.,]/g, '\\$&'));
  assert.match(card.querySelector('.output')!.textContent!, rate);
  assert.doesNotMatch(num(5850).replace(/[.,]/, 'X'), rate, 'a wrong separator does not pass');
  assert.equal($('#detail .dialog-head .eyebrow')!.textContent, 'Phase 3 · Printed page 54');
  // The guide's note for the row comes before the flow.
  const note = $('#detail .dialog-body > [data-guide-note]')!;
  assert.match(note.textContent!, /Reserve space for 13 halls/);
  assert.deepEqual(bodyStart(), ['notice info', 'Flow at Phase 3']);
  // The Machines tile's count and machine are the Total cell's.
  assert.deepEqual(machineCells()[0], ['Total', '90', 'Refinery · peak load ' + power(1350)]);
  // The dialog is still named by its title alone.
  assert.equal($('#detail h2#detail-title')!.textContent, 'Iron Ingot');
});

test('a migrated profile’s oil, fluid and nuclear dialogs say their output under the title', () => {
  render();
  // Oil: a row of the shared campus is a row like any other, with its machine cells.
  openCalculatedFactory(row('plastic'));
  noTiles();
  assert.equal(summary(), `${num(1800)}/min`);
  assert.equal(bodyStart()[0], 'Flow at Phase 3', 'the flow first');
  assert.ok($('#detail .machine-cells'));
  // A fluid is measured in m³, as its flow is.
  openMigrated({ phase: '4' });
  render();
  openCalculatedFactory(row('alumina-solution', '4'));
  noTiles();
  assert.equal(summary(), `${num(10126.666666666666)}${noBreakSpace}m³/min`);
  // Nuclear: the guide's nuclear-site notice stays.
  openCalculatedFactory(row('uranium-fuel-rod', '4'));
  noTiles();
  assert.equal(summary(), `${num(10)}/min`);
  assert.match(detail(), /Process buffer at the nuclear site/);
  assert.deepEqual(
    machineCells().map(c => c[1]),
    ['25', '25', '0'],
  );
});

test('a calculated dialog says its card’s headline under the title, and outputs only when more', () => {
  const plan = generated();
  const rows = plan.stages['3'].rows!;
  const named = rows.find(row => {
    const outputNames = Object.keys(row.outputs);
    return outputNames.length === 1 && outputNames[0] === row.name;
  })!;
  const several = rows.find(r => Object.keys(r.outputs).length > 1)!;
  const generator = rows.find(r => !Object.keys(r.outputs).length && r.generationMW > 0)!;
  assert.ok(named && several && generator, 'the default plan has these lines');
  open({ calculated: plan });
  render();
  const headline = (id: string) =>
    $(`#main button.name[data-calc-factory="${id}"]`)!
      .closest('.factory-card')!
      .querySelector('.output')!
      .textContent!.replace(/\s+/g, '');
  const outputsHeading = () => $$('#detail h3').some(h => h.textContent === 'Outputs per minute');
  // One output named like the row: the headline says it all, so the list is not repeated.
  openCalculatedFactory(named.id);
  const rate = Object.values(named.outputs)[0]!;
  assert.equal(summary(), num(rate) + '/min');
  assert.equal(summary()!.replace(/\s+/g, ''), headline(named.id), 'the card’s headline');
  assert.equal(outputsHeading(), false);
  assert.equal($('#detail .dialog-body > h3')!.textContent, 'Flow at Phase 3');
  assert.equal($('#detail .dialog-body')!.firstElementChild!.tagName, 'H3', 'the flow first');
  // Several outputs: the main one in the header, every one in the list.
  openCalculatedFactory(several.id);
  const [main, mainRate] = Object.entries(several.outputs)[0]!;
  assert.match(summary()!, new RegExp('^' + num(mainRate).replace(/[.,]/g, '\\$&')));
  assert.equal(outputsHeading(), true);
  for (const item of Object.keys(several.outputs)) assert.match(detail(), new RegExp(item));
  assert.ok(main);
  // A generator makes no items: its power is the headline, and nothing else is listed.
  openCalculatedFactory(generator.id);
  assert.equal(summary(), power(generator.generationMW));
  assert.equal(outputsHeading(), false);
  assert.match(machineCells()[0]![2]!, /generates/);
});

test('the calculated factories page shows its rows, round-up offer and warnings', async () => {
  const plan = generated();
  plan.stages['3'].feasible = false;
  plan.stages['3'].reason = evil;
  open({ calculated: plan });
  render();
  noMarkup();
  const rows = plan.stages['3'].rows!;
  assert.equal($$('#main .factory-card').length, rows.length);
  assert.equal($('#main .toolbar > span')!.textContent, rows.length + ' production lines');
  assert.ok($('[data-round-up]'), 'without whole machines it offers rounding up');
  assert.match($('#main .notice.warn')!.textContent, /Planning draft/);
  const first = rows[0]!;
  assert.equal($<HTMLInputElement>(`[data-check="calc-3-${first.id}"]`)!.checked, false);
  $<HTMLInputElement>('#factory-search')!.value = first.name;
  $('#factory-search')!.dispatchEvent(new Event('input'));
  await nextTick();
  assert.ok($$('#main .factory-card').length >= 1);
  assert.ok($$('#main .factory-card').length < rows.length);
});

// SP-18 (#253): the round-up offer is one info line with a quiet button; the explanation is in
// the confirm dialog, and Cancel sends nothing.
test('Round up production… is a one-line offer that asks first (SP-18)', async () => {
  open({ calculated: generated() });
  render();
  const offer = $('#main .notice.round-up-offer')!;
  assert.ok(offer.classList.contains('info'));
  assert.equal(offer.querySelector('p'), null, 'no paragraph of explanation on the page');
  const button = offer.querySelector<HTMLButtonElement>('[data-round-up]')!;
  assert.ok(button.classList.contains('quiet') && !button.classList.contains('primary'));
  assert.equal(button.textContent!.trim(), 'Round up production…');
  const calls = stubFetch({});
  const asked = answerConfirms(false);
  // As a real press does, the button has focus when it is clicked.
  button.focus();
  button.click();
  await nextTick();
  await nextTick();
  assert.equal(asked.length, 1, 'it asks');
  assert.match(asked[0]!, /recalculated profile revision/);
  assert.match(asked[0]!, /previous profile stays available/);
  assert.equal(calls.length, 0, 'Cancel sends nothing');
  assert.equal(document.activeElement, button, 'focus is back on the button');
});

// Both card kinds lead with what the line makes, its unit beside it, and put the machines and the
// last one's clock on the line below (SP-14, #249).
const cardOf = (selector: string) => $(selector)!.closest('.factory-card')!;
const headline = (card: Element) => card.querySelector('.card-main .output')!.textContent!.trim();
// Text with a no-break space (or &nbsp; in markup) and runs of whitespace as one space.
const plain = (text: string) =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const machinesLine = (card: Element) => card.querySelector('.card-main .machines')!.textContent;

test('a migrated card shows its output as the headline and machines with the clock below', () => {
  render();
  const card = (id: string) => cardOf(`#main button.name[data-calc-factory="${row(id)}"]`);
  const wire = card('wire');
  assert.equal(
    headline(wire),
    num(9600) + '/min',
    'no gap before /min, as every rate is written (#651)',
  );
  assert.equal(wire.querySelector('.output span')!.textContent, '/min', 'the unit is its own span');
  assert.equal(machinesLine(wire), num(320) + ' × Constructor', 'all at 100%: no clock');
  const plating = card('smart-plating');
  assert.equal(headline(plating), '115/min');
  assert.equal(machinesLine(plating), '58 × Assembler · last at 50%');
  // One machine at 100% has no "last".
  assert.equal(machinesLine(card('versatile-framework')), '1 × Assembler');
});

test('a calculated card shows its main output, or a generator’s power, as the headline', async () => {
  const plan = generated();
  const rows = plan.stages['3'].rows!;
  const made = rows.find(
    r => Object.keys(r.outputs).length === 1 && r.machines > 1 && r.lastClock < 99,
  )!;
  const generator = rows.find(r => !Object.keys(r.outputs).length)!;
  assert.ok(made && generator, 'the default plan has a production line and a power line');
  generator.name = evil;
  generator.machines = 5;
  generator.equivalent = 4.625;
  generator.generationMW = 406.8;
  open({ calculated: plan });
  render();
  noMarkup();
  const card = cardOf(`#main button.name[data-calc-factory="${made.id}"]`);
  const [item, rate] = Object.entries(made.outputs)[0]!;
  assert.equal(headline(card), num(rate) + '/min');
  assert.ok(
    machinesLine(card)!.startsWith(`${made.machines} × ${made.machine} · last at `),
    'machines, then the adjustable one’s clock',
  );
  assert.match(machinesLine(card)!, /· last at [\d.,]+%$/);
  // A row named after its one output has no line repeating the headline.
  if (made.name === item) assert.equal(card.querySelector('.recipe'), null);
  const power = cardOf(`#main button.name[data-calc-factory="${generator.id}"]`);
  assert.equal(headline(power), num(406.8) + ' MW', 'a word unit keeps a no-break space');
  assert.equal(power.querySelector('.output span')!.textContent, 'MW');
  assert.equal(
    machinesLine(power),
    `5 × ${generator.machine} · last at ${(62.5).toLocaleString()}%`,
  );
  assert.equal(power.querySelector('.recipe'), null, 'nothing restates the power');
  // Above 1000 MW it is GW, with the unit still shown.
  generator.generationMW = 24882.66;
  open({ calculated: plan });
  render();
  await nextTick();
  assert.equal(
    headline(cardOf(`#main button.name[data-calc-factory="${generator.id}"]`)),
    num(24.88266) + ' GW',
  );
});

// A nuclear plant makes waste as well as power. Its power is still the headline, and the waste
// is listed once, below the machines (#371). The rows are shaped as a Phase 5 recycle plan
// calculates them (planner.ts, generatorsFor), at the fractional counts #370 reports.
const NUCLEAR = [
  { id: 'power-uranium', name: 'Uranium power', rod: 'Uranium Fuel Rod', rodPer: 0.2 },
  { id: 'power-plutonium', name: 'Plutonium power', rod: 'Plutonium Fuel Rod', rodPer: 0.1 },
];
function withNuclear() {
  const plan = generated();
  const rows = plan.stages['3'].rows!;
  const generator = rows.find(r => r.generationMW > 0 && !Object.keys(r.outputs).length)!;
  const shape = [
    { waste: 'Uranium Waste', per: 10, equivalent: 138.892, machines: 139 },
    { waste: 'Plutonium Waste', per: 1, equivalent: 69.446, machines: 70 },
  ];
  const made = NUCLEAR.map((nuclear, i) => {
    const plantShape = shape[i]!;
    return {
      ...generator,
      id: nuclear.id,
      name: nuclear.name,
      machine: 'Nuclear Power Plant',
      power: -2500,
      inputs: {
        [nuclear.rod]: nuclear.rodPer * plantShape.equivalent,
        Water: 240 * plantShape.equivalent,
      },
      outputs: { [plantShape.waste]: plantShape.per * plantShape.equivalent },
      equivalent: plantShape.equivalent,
      machines: plantShape.machines,
      lastClock: (plantShape.equivalent - (plantShape.machines - 1)) * 100,
      generationMW: 2500 * plantShape.equivalent,
    };
  });
  rows.push(...made);
  return { plan, made };
}

test('a nuclear plant card leads with its power and lists its waste below it (#371)', () => {
  const { plan, made } = withNuclear();
  open({ calculated: plan });
  render();
  noMarkup();
  for (const row of made) {
    const [waste, rate] = Object.entries(row.outputs)[0]!;
    const card = cardOf(`#main button.name[data-calc-factory="${row.id}"]`);
    assert.equal(plain(headline(card)), power(row.generationMW), row.name);
    assert.equal(card.querySelector('.output span')!.textContent, 'GW');
    assert.equal(machinesLine(card), machineLine(row.machines, row.machine, row.lastClock));
    assert.match(machinesLine(card)!, / · last at [\d.,]+%$/);
    assert.equal(plain(card.querySelector('.recipe')!.textContent!), `${waste}: ${num(rate)}/min`);
    assert.equal(card.textContent!.split(num(rate)).length - 1, 1, 'the waste rate once');
  }
  // The dialog's summary line says the card's headline; its outputs list names the waste.
  for (const row of made) {
    const card = cardOf(`#main button.name[data-calc-factory="${row.id}"]`);
    openCalculatedFactory(row.id);
    assert.equal(summary(), power(row.generationMW));
    assert.equal(plain(summary()!), plain(headline(card)));
    assert.ok($$('#detail h3').some(h => h.textContent === 'Outputs per minute'));
    assert.match(detail(), new RegExp(Object.keys(row.outputs)[0]!));
    closeDetail();
  }
});

test('a generator’s card, dialog and build step show its building, not its waste (#350)', () => {
  const { plan, made } = withNuclear();
  const coal = plan.stages['3'].rows!.find(
    r => r.generationMW > 0 && !Object.keys(r.outputs).length,
  )!;
  const line = plan.stages['3'].rows!.find(r => !r.generationMW && Object.keys(r.outputs).length)!;
  open({ calculated: plan });
  render();
  const iconSrc = (el: Element | null) => el!.querySelector('img.item-icon')!.getAttribute('src');
  for (const row of [coal, ...made]) {
    const icon = `./icons/${slugOf(row.machine)}.png`;
    const card = cardOf(`#main button.name[data-calc-factory="${row.id}"]`);
    assert.equal(iconSrc(card.querySelector('.card-icon')), icon, row.name);
    assert.deepEqual(taskIcon({ id: `calc-3-${row.id}`, title: row.name }), { item: row.machine });
    openCalculatedFactory(row.id);
    assert.equal(iconSrc($('#detail .dialog-icon')), icon, row.name);
    closeDetail();
  }
  // A production line keeps its main output's icon.
  const [item] = Object.keys(line.outputs);
  const card = cardOf(`#main button.name[data-calc-factory="${line.id}"]`);
  assert.equal(iconSrc(card.querySelector('.card-icon')), `./icons/${slugOf(item!)}.png`);
  assert.deepEqual(taskIcon({ id: `calc-3-${line.id}`, title: line.name }), { item });
});

test('a nuclear plant’s group share says its waste and its power (#371, #374)', async () => {
  const { plan, made } = withNuclear();
  const [uranium, plutonium] = made as [(typeof made)[0], (typeof made)[0]];
  const waste = uranium.outputs['Uranium Waste']!;
  open({
    calculated: plan,
    state: {
      factoryGroups: {
        groups: GROUPS.groups,
        assignments: {
          // A fixed rate keeps the meaning it has always had for this row, the first output's
          // rate (group-links.ts shares the row out by it too); the card says that share as
          // waste and as the power it stands for.
          'power-uranium': [
            { group: 'fg-cable01', rate: waste / 4 },
            { group: 'fg-plates1', rate: null },
          ],
          'power-plutonium': [
            { group: 'fg-cable01', rate: null },
            { group: 'fg-plates1', rate: null },
          ],
        },
      },
    },
  });
  render();
  await nextTick();
  const sections = $$('#main .user-group');
  const text = (sectionIndex: number, id: string) =>
    plain(
      sections[sectionIndex]!.querySelector(`[data-calc-factory="${id}"]`)!
        .closest('.factory-card')!
        .querySelector('.allocation')!.textContent!,
    );
  const both = (row: (typeof made)[0], share: number) => {
    const [item, total] = Object.entries(row.outputs)[0]!;
    return `${num(total * share)} ${item}/min (${power(row.generationMW * share)})`;
  };
  assert.ok(
    text(0, uranium.id).startsWith(`Here: ${both(uranium, 1 / 4)} of ${both(uranium, 1)}`),
    text(0, uranium.id),
  );
  assert.ok(
    text(1, uranium.id).startsWith(
      `Remaining here: ${both(uranium, 3 / 4)} of ${both(uranium, 1)}`,
    ),
    text(1, uranium.id),
  );
  for (const sectionIndex of [0, 1])
    assert.ok(
      text(sectionIndex, plutonium.id).startsWith(
        `Remaining here, split 2 ways: ${both(plutonium, 1 / 2)} of ${both(plutonium, 1)}`,
      ),
      text(sectionIndex, plutonium.id),
    );
});

// A generator without outputs (coal, fuel) gives its group share in GW above 1,000 MW, like its
// card's headline (#380).
test('a coal plant’s group share is in GW above 1,000 MW, like its headline (#380)', async () => {
  const plan = generated();
  const coal = plan.stages['3'].rows!.find(
    r => r.generationMW > 0 && !Object.keys(r.outputs).length,
  )!;
  coal.generationMW = 4412.6;
  open({
    calculated: plan,
    state: {
      factoryGroups: {
        groups: GROUPS.groups,
        assignments: {
          [coal.id]: [
            { group: 'fg-cable01', rate: null },
            { group: 'fg-plates1', rate: null },
          ],
        },
      },
    },
  });
  render();
  await nextTick();
  const card = $$('#main .user-group')[0]!
    .querySelector(`[data-calc-factory="${coal.id}"]`)!
    .closest('.factory-card')!;
  assert.equal(power(4412.6), `${num(4.4126)} GW`, 'the share below is in GW');
  assert.ok(
    plain(card.querySelector('.allocation')!.textContent!).startsWith(
      `Remaining here, split 2 ways: ${power(4412.6 / 2)} of ${power(4412.6)}`,
    ),
    plain(card.querySelector('.allocation')!.textContent!),
  );
});

// The group editor names the unit a fixed rate is saved in (#374): a nuclear plant's rate is its
// waste per minute, as it always was, with the power that stands for beside it while typing; an
// output-less generator's rate is in MW. A production line keeps "Production per minute".
test('the group editor names a generator’s rate unit and shows the power it stands for (#374)', async () => {
  const { plan, made } = withNuclear();
  const uranium = made[0]!;
  const waste = uranium.outputs['Uranium Waste']!;
  const rows = plan.stages['3'].rows!;
  const coal = rows.find(r => r.generationMW > 0 && !Object.keys(r.outputs).length)!;
  const line = rows.find(r => !r.generationMW && Object.keys(r.outputs).length)!;
  open({
    calculated: plan,
    state: {
      factoryGroups: {
        groups: GROUPS.groups,
        assignments: {
          'power-uranium': [
            { group: 'fg-cable01', rate: waste / 4 },
            { group: 'fg-plates1', rate: null },
          ],
          [coal.id]: [{ group: 'fg-cable01', rate: null }],
          [line.id]: [{ group: 'fg-cable01', rate: null }],
        },
      },
    },
  });
  setFactoryEditing(true);
  render();
  await nextTick();
  noMarkup();
  const field = (id: string, group: string) =>
    $<HTMLInputElement>(`[data-assign-rate="${id}"][data-group="${group}"]`)!;
  const hint = (el: HTMLInputElement) =>
    plain(document.getElementById(el.getAttribute('aria-describedby')!)!.textContent!);
  const fixed = field(uranium.id, 'fg-cable01'),
    rest = field(uranium.id, 'fg-plates1');
  assert.equal(fixed.getAttribute('aria-label'), 'Uranium Waste per minute in Cable factory');
  assert.equal(hint(fixed), `Uranium Waste/min ≈ ${power(uranium.generationMW / 4)}`);
  assert.equal(hint(rest), 'Uranium Waste/min', 'an empty field has no power figure');
  // Typing shows the power at once, and the typed text stays through that redraw.
  fixed.value = '5';
  fixed.dispatchEvent(new Event('input'));
  await nextTick();
  assert.equal(fixed.value, '5');
  assert.equal(hint(fixed), `Uranium Waste/min ≈ ${power(5 * (uranium.generationMW / waste))}`);
  fixed.value = '-2';
  fixed.dispatchEvent(new Event('input'));
  await nextTick();
  assert.equal(hint(fixed), 'Uranium Waste/min', 'no figure for a rate that cannot be saved');
  // An output-less generator's rate is in MW.
  const coalField = field(coal.id, 'fg-cable01');
  assert.equal(coalField.getAttribute('aria-label'), 'MW in Cable factory');
  assert.equal(hint(coalField), 'MW');
  // A production line keeps its label and has no hint.
  const lineField = field(line.id, 'fg-cable01');
  assert.equal(lineField.getAttribute('aria-label'), 'Production per minute in Cable factory');
  assert.equal(lineField.getAttribute('aria-describedby'), null);
});

test('a migrated profile’s group editor names the rate unit of a part (#374)', async () => {
  openMigrated({ state: { factoryGroups: structuredClone(GROUPS) } });
  setFactoryEditing(true);
  render();
  await nextTick();
  const rate = $<HTMLInputElement>(`[data-assign-rate="${row('wire')}"][data-group="fg-cable01"]`)!;
  assert.equal(rate.getAttribute('aria-label'), 'Production per minute in Cable factory');
  assert.equal($('.assign-unit'), null, 'a part has no power to explain');
});

// A nuclear plant's flow, machine cells and build-plan step name its power first and its waste
// alongside (#373); the waste destinations stay, since the waste is belted onward.
function withNuclearFlow() {
  const { plan, made } = withNuclear();
  const uranium = made[0]!;
  const waste = uranium.outputs['Uranium Waste']!;
  const rows = plan.stages['3'].rows!;
  const line = rows.find(r => Object.keys(r.outputs).length === 1 && !r.generationMW)!;
  rows.push({
    ...line,
    id: 'waste-recycle',
    name: 'Non-Fissile Uranium',
    inputs: { 'Uranium Waste': waste },
    outputs: { 'Non-Fissile Uranium': waste * 1.5 },
  });
  return { plan, uranium, waste };
}
const escaped = (text: string) => text.replace(/[.,+()?]/g, '\\$&');
// An element's text with a space between its parts, as it reads on screen.
const spaced = (el: Element) => plain(el.innerHTML.replace(/<[^>]+>/g, ' '));

test('a nuclear plant’s flow feeds the power grid and sends its waste on (#373)', () => {
  const { plan, uranium, waste } = withNuclearFlow();
  open({ calculated: plan });
  render();
  openCalculatedFactory(uranium.id);
  const rows = $$('#detail .rail-row').map(r => spaced(r));
  assert.equal(rows[0], `Power grid generation ${power(uranium.generationMW)}`);
  assert.ok(
    rows.some(r => r.startsWith('Non-Fissile Uranium ↗')),
    'the waste consumer stays: ' + rows.join(' | '),
  );
  const bar = spaced($('#detail .rail-machine-out')!);
  assert.ok(bar.startsWith(power(uranium.generationMW) + ' generation + '), bar);
  assert.match(bar, new RegExp(escaped(`+ ${num(waste)} Uranium Waste/min · `)));
  const caption = plain($('#detail .rail-machine-main small')!.textContent!);
  assert.match(
    caption,
    new RegExp(escaped(`${num(2500)} MW + 10 Uranium Waste/min out per machine`)),
  );
  // The recipe panel gives a plant's power, then its waste.
  const cells = $$('#detail .rail-recipe-outs .rail-cell').map(c => spaced(c));
  assert.deepEqual(cells, [`${num(2500)} MW Power generation`, '10 Uranium Waste']);
});

test('a nuclear plant’s machine cells and build-plan step give MW with the waste alongside (#373)', async () => {
  const { plan, uranium } = withNuclearFlow();
  open({ calculated: plan });
  render();
  const clock = machinesLine(cardOf(`#main button.name[data-calc-factory="${uranium.id}"]`))!.split(
    ' · last at ',
  )[1];
  openCalculatedFactory(uranium.id);
  const fraction = uranium.equivalent - (uranium.machines - 1);
  const last = `${num(2500 * fraction)} MW · ${num(10 * fraction)} Uranium Waste/min`;
  assert.deepEqual(machineCells().slice(1), [
    ['At 100%', num(uranium.machines - 1), `${num(2500)} MW · 10 Uranium Waste/min each`],
    ['Adjustable', '1 at ' + clock, `≈ ${num(fraction * 100)}% → ≈ ${last}`],
  ]);
  closeDetail();
  const step = calcTasks().find(t => t.id === 'calc-3-' + uranium.id)!;
  assert.match(step.body, new RegExp(escaped(`→ ≈ ${last}.`)));
  const waste = uranium.outputs['Uranium Waste']!;
  assert.match(
    step.body,
    new RegExp(
      escaped(`Outputs: ${power(uranium.generationMW)}, Uranium Waste ${num(waste)}/min.`),
    ),
  );
  // All at 100%: "Each machine" gives the power and the waste.
  Object.assign(uranium, {
    equivalent: 139,
    lastClock: 100,
    outputs: { 'Uranium Waste': 1390 },
    generationMW: 2500 * 139,
  });
  open({ calculated: plan });
  const whole = calcTasks().find(t => t.id === 'calc-3-' + uranium.id)!;
  assert.match(
    whole.body,
    new RegExp(escaped(`Each machine: ${num(2500)} MW · 10 Uranium Waste/min.`)),
  );
});

test('a coal plant’s flow, cells and step still give MW alone (#373)', () => {
  const plan = generated();
  const generator = plan.stages['3'].rows!.find(
    r => r.generationMW > 0 && !Object.keys(r.outputs).length,
  )!;
  Object.assign(generator, {
    machines: 5,
    equivalent: 4.625,
    lastClock: 62.5,
    generationMW: 406.8,
  });
  open({ calculated: plan });
  render();
  openCalculatedFactory(generator.id);
  const rows = $$('#detail .rail-row').map(r => spaced(r));
  assert.deepEqual(rows, [`Power grid generation ${power(406.8)}`]);
  assert.equal(spaced($('#detail .rail-machine-out')!), `${power(406.8)} generation`);
  assert.deepEqual(
    $$('#detail .rail-recipe-outs .rail-cell').map(c => spaced(c)),
    [`${num3(406.8 / 4.625)} MW Power generation`],
  );
  assert.deepEqual(machineCells().slice(1), [
    ['At 100%', '4', num(406.8 / 4.625) + ' MW each'],
    [
      'Adjustable',
      '1 at ' + percent(62.5),
      `≈ ${num(62.5)}% → ≈ ${num((406.8 / 4.625) * 0.625)} MW`,
    ],
  ]);
  closeDetail();
  const step = calcTasks().find(t => t.id === 'calc-3-' + generator.id)!;
  assert.match(step.body, new RegExp(escaped(`Outputs: ${power(406.8)}.`) + '$'));
});

// A build-plan step points to an easier rounded option only where the factory dialog offers
// one: not for a nuclear or waste line, nor when the profile runs whole machines (#379).
test('a build-plan step offers the easier rounded option only when the dialog shows it (#379)', () => {
  const HINT = 'Open factory details for an easier rounded option.';
  const offered = (id: string) => {
    const step = calcTasks().find(t => t.id === 'calc-3-' + id)!;
    openCalculatedFactory(id);
    const dialog = $$('#detail .notice').some(n => /Easier optional setting/.test(n.textContent));
    closeDetail();
    return [step.body.includes(HINT), dialog];
  };
  const { plan, uranium } = withNuclearFlow();
  const line = plan.stages['3'].rows!.find(r => !r.generationMW && Object.keys(r.outputs).length)!;
  Object.assign(line, { machines: 5, equivalent: 4.625, lastClock: 62.5 });
  plan.settings.wholeMachines = false;
  open({ calculated: plan });
  render();
  assert.deepEqual(offered(line.id), [true, true], 'a production line under exact ratios');
  assert.ok(uranium.equivalent % 1 > 0, 'the uranium plant runs one machine below 100%');
  assert.deepEqual(offered(uranium.id), [false, false], 'a nuclear line');
  plan.settings.wholeMachines = true;
  open({ calculated: plan });
  render();
  assert.deepEqual(offered(line.id), [false, false], 'a profile that runs whole machines');
});

// A card for a row that generates power says so in words, with a glyph and an accent edge that
// are not the Running chip's (#374); a production line has neither.
test('a power plant’s card is marked as generating power, in text (#374)', async () => {
  const { plan, made } = withNuclear();
  const rows = plan.stages['3'].rows!;
  const coal = rows.find(r => r.generationMW > 0 && !Object.keys(r.outputs).length)!;
  const line = rows.find(r => !r.generationMW)!;
  open({ calculated: plan, state: { checks: { ['calc-3-' + coal.id]: true } } });
  render();
  await nextTick();
  for (const row of [...made, coal]) {
    const card = cardOf(`#main button.name[data-calc-factory="${row.id}"]`);
    assert.ok(card.classList.contains('generator'), row.name);
    const mark = card.querySelector('[data-generates]')!;
    assert.equal(plain(mark.textContent!), '⚡︎ Generates power for the grid');
    assert.equal(mark.querySelector('[aria-hidden="true"]')!.textContent, '⚡︎');
  }
  const running = cardOf(`#main button.name[data-calc-factory="${coal.id}"]`);
  assert.ok(running.classList.contains('done'), 'running and generating are separate marks');
  // The chip keeps saying the running state (held back here: the plan's fuel line is not built).
  assert.match(chipSays(running), /^(● Running|◐ Held back)$/);
  assert.ok(running.classList.contains('generator'));
  const plainCard = cardOf(`#main button.name[data-calc-factory="${line.id}"]`);
  assert.ok(!plainCard.classList.contains('generator'));
  assert.equal(plainCard.querySelector('[data-generates]'), null);
});

test('a calculated card with several outputs names each of them below the headline', () => {
  const plan = generated();
  const rows = plan.stages['3'].rows!;
  const multi = rows.find(r => Object.keys(r.outputs).length > 1)!;
  assert.ok(multi, 'the default plan has a line with a by-product');
  open({ calculated: plan });
  render();
  const card = cardOf(`#main button.name[data-calc-factory="${multi.id}"]`);
  const outputs = Object.entries(multi.outputs);
  assert.equal(headline(card), itemRate(outputs[0]![0], outputs[0]![1]));
  assert.deepEqual(
    card
      .querySelector('.recipe')!
      .innerHTML.replace(/<!--.*?-->/g, '')
      .trim()
      .split('<br>')
      .map(plain),
    outputs.map(([item, rate]) => `${item}: ${num(rate)}${FLUIDS.has(item) ? ' m³' : ''}/min`),
  );
});

// A fluid is measured in m³/min everywhere its rate is written, as the flow diagram and the
// dialog's summary line already did; solids keep /min (#351, #361). plain() reads a no-break
// space (or its &nbsp; in markup) as a space.
const m3 = (rate: number) => num(rate) + ' m³/min';
const ROW_FUEL = 'Recipe_ResidualFuel_C'; // Residual Fuel: Heavy Oil Residue in, Fuel out.
const ROW_OIL = 'Recipe_LiquidFuel_C'; // Fuel: Crude Oil in, Fuel and Polymer Resin out.

test('a migrated card measures a fluid in m³/min, like its dialog (#351)', async () => {
  const alumina = row('alumina-solution', '4');
  openMigrated({ phase: '4' });
  render();
  const card = cardOf(`#main button.name[data-calc-factory="${alumina}"]`);
  assert.equal(plain(headline(card)), m3(10126.666666666666));
  assert.equal(card.querySelector('.output span')!.textContent, 'm³/min');
  // The headline agrees with the dialog's summary line.
  openCalculatedFactory(alumina);
  assert.equal(plain(summary()!).split(' · ')[0], plain(headline(card)));
  // The output per machine too, in the machine cells and the flow's machine line.
  assert.match(machineCells()[1]![2]!, / m³ Alumina Solution\/min each$/);
  assert.match(plain(detail()), / m³ Alumina Solution\/min out per machine/);
  // A solid keeps /min.
  const iron = cardOf(`#main button.name[data-calc-factory="${row('iron-ingot', '4')}"]`);
  assert.equal(iron.querySelector('.output span')!.textContent, '/min');
  // A group's share of a fluid is in m³/min as well.
  openMigrated({
    phase: '4',
    state: {
      factoryGroups: {
        groups: GROUPS.groups,
        assignments: {
          [alumina]: [
            { group: 'fg-cable01', rate: 600 },
            { group: 'fg-plates1', rate: null },
          ],
        },
      },
    },
  });
  render();
  await nextTick();
  assert.ok(
    plain($$('#main .user-group')[0]!.querySelector('.allocation')!.textContent).startsWith(
      `Here: ${m3(600)} of ${m3(10126.666666666666)}`,
    ),
  );
});

// happy-dom lays nothing out, so the line boxes were measured in Edge at 1440 and 390 px; this
// pins what keeps them together: a no-break space before m³, and nowrap on the rates.
test('the flow diagram keeps a fluid rate’s unit beside its number (#364)', () => {
  openMigrated({ phase: '4' });
  render();
  openCalculatedFactory(row('alumina-solution', '4'));
  const unit = (el: Element | null | undefined) => el?.querySelector('small')?.textContent;
  const scrap = $$('#detail .rail-row').find(r => /Aluminum Scrap/.test(r.textContent!))!;
  const rate = scrap.querySelector('.rail-rate')!;
  assert.equal(plain(rate.textContent!), m3(10066.666666666666));
  assert.equal(unit(rate), `${noBreakSpace}m³/min`, 'the destination row');
  const water = $$('#detail .rail-tile').find(t => /Water/.test(t.textContent!))!;
  assert.equal(unit(water.querySelector('.rail-rate')), `${noBreakSpace}m³/min`, 'the input tile');
  assert.equal(unit($('#detail .rail-machine-out b')), `${noBreakSpace}m³/min`, 'the machine bar');
  assert.ok(
    $$('#detail .rail-rate, #detail .rail-machine-out b').every(el => !/ m³/.test(el.textContent!)),
    'no ordinary space before m³ anywhere in the flow',
  );
  // A solid's unit has no space to break at.
  const bauxite = $$('#detail .rail-tile').find(t => /Bauxite/.test(t.textContent!))!;
  assert.equal(unit(bauxite.querySelector('.rail-rate')), '/min');
});

// happy-dom lays nothing out, so the column positions were measured in Edge at 1440 and 1100 px
// (one machines-column x per dialog); this pins what lines them up: every destination row has the
// four cells the shared grid's columns expect, and the stylesheet makes the rows a subgrid of it.
test('the flow diagram’s destination rows share one set of columns (#378)', () => {
  const cells = (where: string) => {
    const rows = $$('#detail .rail-rows > *');
    assert.ok(rows.length, `${where}: the flow has destination rows`);
    for (const row of rows) {
      assert.ok(row.classList.contains('rail-row'), `${where}: only rows in the grid`);
      const kids = [...row.children];
      assert.equal(kids.length, 4, `${where}: ${row.textContent} has four cells`);
      // An icon or an empty frame, or the power grid's blank, icon-wide cell: it takes no item
      // (#560, #599).
      const blank =
        kids[0]!.tagName === 'SPAN' &&
        kids[0]!.className === 'rail-noframe' &&
        !kids[0]!.childNodes.length;
      assert.ok(
        /\b(item-icon|rail-noicon)\b/.test(kids[0]!.className) ||
          (blank && /Power grid/.test(row.textContent!)),
        `${where}: icon first`,
      );
      assert.deepEqual(
        kids.slice(1).map(k => k.className),
        ['rail-main', 'rail-mach', 'rail-rate'],
        `${where}: name, machines, rate`,
      );
    }
  };
  openMigrated({ phase: '4' });
  render();
  openCalculatedFactory(row('alumina-solution', '4'));
  cells('Alumina Solution');
  const plan = generated();
  const rows = plan.stages['3'].rows!;
  const made = rows.find(r => Object.keys(r.outputs).length === 1)!;
  const generator = rows.find(r => r.generationMW > 0)!;
  assert.ok(made && generator, 'the default plan has a production line and a generator');
  open({ calculated: plan });
  render();
  openCalculatedFactory(made.id);
  cells(made.name);
  openCalculatedFactory(generator.id);
  assert.ok(
    $$('#detail .rail-row').some(r => /Power grid/.test(r.textContent!)),
    'a generator delivers to the power grid',
  );
  cells(generator.name);

  const css = fs
    .readFileSync('public/style.css', 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // The body of the at-rule starting with `head`.
  const block = (head: string, from = 0) => {
    const start = css.indexOf(head, from);
    assert.ok(start >= 0, `style.css has ${head}`);
    let depth = 0,
      i = css.indexOf('{', start);
    const open = i;
    for (; i < css.length; i++)
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) break;
    return css.slice(open + 1, i);
  };
  const rule = (text: string, selector: string) => {
    const matches = [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
      match => match[1]!.trim() === selector,
    );
    assert.ok(matches.length, `${selector} is styled`);
    return matches.map(match => match[2]!.replace(/\s+/g, ' ')).join(' ');
  };
  const grid = block('@supports (grid-template-columns: subgrid)');
  assert.match(rule(grid, '.rail-rows'), /display: grid;/);
  assert.match(rule(grid, '.rail-rows'), /grid-template-columns: auto minmax\(0, 1fr\) auto auto;/);
  assert.match(rule(grid, '.rail-row'), /display: grid;/);
  assert.match(rule(grid, '.rail-row'), /grid-column: 1 \/ -1;/);
  assert.match(rule(grid, '.rail-row'), /grid-template-columns: subgrid;/);
  // Without subgrid the rows keep their own flex layout, and a phone's rows wrap as flex.
  const outside = css.replace('@supports (grid-template-columns: subgrid) {' + grid + '}', '');
  const top = outside.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  assert.match(rule(top, '.rail-rows'), /display: flex;/);
  assert.match(rule(top, '.rail-row'), /display: flex;/);
  let phone = '';
  for (let position = css.indexOf('@media (max-width: 640px)'); position >= 0; ) {
    phone += block('@media (max-width: 640px)', position);
    position = css.indexOf('@media (max-width: 640px)', position + 1);
  }
  assert.match(rule(phone, '.rail-rows'), /display: flex;/);
  assert.match(rule(phone, '.rail-row'), /display: flex;.*flex-wrap: wrap;/);
  assert.ok(
    css.indexOf('@supports (grid-template-columns: subgrid)') <
      css.lastIndexOf('@media (max-width: 640px)'),
    'the phone layout comes after the grid, so it wins',
  );
});

test('a calculated card measures a fluid in m³/min, like its dialog (#351)', () => {
  const plan = generated();
  const rows = plan.stages['3'].rows!;
  const fuel = rows.find(r => r.id === ROW_FUEL)!,
    oil = rows.find(r => r.id === ROW_OIL)!;
  assert.ok(fuel && oil, 'the default plan makes Fuel on two lines');
  open({ calculated: plan });
  render();
  const card = cardOf(`#main button.name[data-calc-factory="${fuel.id}"]`);
  assert.equal(plain(headline(card)), m3(fuel.outputs.Fuel!));
  assert.equal(card.querySelector('.output span')!.textContent, 'm³/min');
  // Named Residual Fuel, so its one output is listed below, in the same unit.
  assert.equal(
    plain(card.querySelector('.recipe')!.textContent!),
    'Fuel: ' + m3(fuel.outputs.Fuel!),
  );
  openCalculatedFactory(fuel.id);
  assert.equal(plain(summary()!), plain(headline(card)));
  // A fluid and a solid output: each in its own unit.
  const both = cardOf(`#main button.name[data-calc-factory="${oil.id}"]`);
  assert.deepEqual(
    both
      .querySelector('.recipe')!
      .innerHTML.replace(/<!--.*?-->/g, '')
      .trim()
      .split('<br>')
      .map(plain),
    Object.entries(oil.outputs).map(
      ([item, rate]) => `${item}: ${item === 'Fuel' ? m3(rate) : num(rate) + '/min'}`,
    ),
  );
});

test('a calculated factory dialog measures fluid inputs and outputs in m³/min (#361)', () => {
  const plan = generated();
  const fuel = plan.stages['3'].rows!.find(r => r.id === ROW_FUEL)!;
  open({ calculated: plan });
  render();
  openCalculatedFactory(fuel.id);
  const easy = plain($('#detail .notice.info')!.textContent!);
  assert.match(easy, /Its output: Fuel [\d.,]+ m³\/min\./);
  assert.match(easy, /Extra inputs needed: Heavy Oil Residue [\d.,]+ m³\/min\./);
  // The outputs list (the row is not named after its output), the machine cells and the flow's
  // machine line.
  const all = plain(detail());
  assert.ok(all.includes('<p>Fuel ' + m3(fuel.outputs.Fuel!) + '</p>'));
  assert.match(machineCells()[2]![2]!, /≈ [\d.,]+ m³ Fuel\/min$/);
  assert.match(all, / · 40 m³ Fuel\/min out per machine/);
  assert.doesNotMatch(all, /Heavy Oil Residue [\d.,]+\/min|[\d.,] Fuel\/min/);
});

test('a migrated profile’s completion modules measure a fluid input in m³/min (#361)', () => {
  openMigrated({ phase: 'post' });
  render();
  const fabric = $('[data-check="completion-fabric"]')!.closest('.completion-item')!;
  assert.match(plain(fabric.textContent!), /Inputs: Polymer Resin 10\/min · Water 10 m³\/min/);
  // A no-break space keeps the number with its m³.
  assert.ok(fabric.textContent!.includes('Water 10 m³/min'));
});

test('a calculated card ticked Running is marked done', () => {
  const plan = generated();
  const row = plan.stages['3'].rows![0]!;
  open({ calculated: plan, state: { checks: { ['calc-3-' + row.id]: true } } });
  render();
  assert.ok($(`#main [data-check="calc-3-${row.id}"]`)!.closest('.factory-card.done'));
});

// Each card opens with a status chip that follows its Running box: glyph and word, so it reads
// without colour, and hidden from screen readers, which hear the box itself (SP-15, #250).
const chip = (card: Element) => card.querySelector<HTMLElement>('.status-chip')!;
const chipSays = (card: Element) => chip(card).textContent!.replace(/\s+/g, ' ').trim();

test('a migrated card’s status chip says Running or Not built and follows the box', async () => {
  stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  render();
  // Iron Ingot draws only raw resources, so ticked alone it runs rather than waiting on a supplier.
  const key = 'calc-3-' + row('iron-ingot');
  const ingot = () => cardOf(`#main button.name[data-calc-factory="${row('iron-ingot')}"]`);
  assert.equal(ingot().firstElementChild, chip(ingot()), 'the chip is at the top of the card');
  assert.equal(chipSays(ingot()), '○ Not built');
  assert.equal(chip(ingot()).dataset.runningStatus, 'idle');
  assert.equal(chip(ingot()).getAttribute('aria-hidden'), 'true', 'the box already says it');
  assert.equal(chip(ingot()).querySelector('button, input'), null, 'a status, not a control');
  assert.equal(ingot().querySelectorAll('[data-check]').length, 1, 'one Running box');
  assert.ok(!ingot().classList.contains('done'));
  $<HTMLInputElement>(`#main [data-check="${key}"]`)!.click();
  await settle();
  assert.equal(state.checks[key], true);
  assert.equal(chipSays(ingot()), '● Running');
  assert.equal(chip(ingot()).dataset.runningStatus, 'running');
  assert.ok(chip(ingot()).classList.contains('green'));
  assert.ok(ingot().classList.contains('done'), 'the running card is tinted');
  $<HTMLInputElement>(`#main [data-check="${key}"]`)!.click();
  await settle();
  assert.equal(chipSays(ingot()), '○ Not built');
});

test('a calculated card’s status chip says Running, Not built, or Held back with its reason', async () => {
  stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  const rows = plan.stages['3'].rows!;
  // A row fed by another row, and that supplier: marked running alone, the row is held back.
  const consumer = rows.find(row =>
    Object.keys(row.inputs).some(n => rows.some(o => o.id !== row.id && o.outputs[n])),
  )!;
  const other = rows.find(r => r.id !== consumer.id && !Object.keys(r.inputs).length) ?? rows[0]!;
  open({ calculated: plan });
  render();
  await nextTick();
  const card = (id: string) => cardOf(`#main button.name[data-calc-factory="${id}"]`);
  assert.equal(card(consumer.id).firstElementChild, chip(card(consumer.id)));
  assert.equal(chipSays(card(consumer.id)), '○ Not built');
  assert.equal(chip(card(consumer.id)).getAttribute('aria-hidden'), 'true');
  $<HTMLInputElement>(`#main [data-check="calc-3-${consumer.id}"]`)!.click();
  await settle();
  const held = card(consumer.id);
  assert.equal(chipSays(held), '◐ Held back');
  assert.equal(chip(held).dataset.runningStatus, 'held');
  assert.ok(held.classList.contains('done'), 'it is marked running, so it is tinted');
  assert.match(
    held.querySelector('[data-build-held]')!.textContent!,
    /^Running at 0%: short of /,
    'with its reason',
  );
  assert.equal($$('[data-running-status="held"]').length, 1);
  // Every row marked running: nothing is held back.
  open({
    calculated: plan,
    state: { checks: Object.fromEntries(rows.map(r => ['calc-3-' + r.id, true])) },
  });
  render();
  await nextTick();
  assert.equal(
    $$('#main [data-running-status="running"]').length,
    $$('#main .factory-card').length,
  );
  assert.equal(chipSays(card(other.id)), '● Running');
  assert.equal($('[data-build-held]'), null);
});

test('a calculated factory dialog shows its flow, setup and expansion', () => {
  open({ calculated: plan });
  render();
  const stage = calcStage()!;
  const producer = stage.rows!.find(row =>
    Object.keys(row.outputs).some(n => stage.rows!.some(o => o.id !== row.id && o.inputs[n])),
  )!;
  openCalculatedFactory(producer.id);
  assert.equal($('#detail h2')!.textContent, producer.name);
  assert.match(detail(), /Delivers · /);
  assert.ok($('#detail [data-calc-factory]'));
  assert.match(detail(), /Machine setup/);
  assert.match(detail(), /Expansion by phase/);
  assert.equal($('#detail [data-save-note]')!.dataset.saveNote, 'factory-' + producer.id);
});

// SP-22 (#257): both dialogs' expansion tables name each phase and mark the one being worked on
// with an accent edge and a "current" tag; Post Phase 5 works on Phase 5's row, and says so.
test('the expansion tables label their phases and mark the current one (SP-22)', () => {
  const rows = () => $$('#detail table').at(-1)!.querySelectorAll('tbody tr');
  const summary = () =>
    [...rows()].map(row => [
      row.querySelector('td')!.textContent!.replace(/\s+/g, ' ').trim(),
      row.classList.contains('current-phase'),
      row.getAttribute('aria-current'),
    ]);
  // A calculated factory at Phase 4.
  open({ calculated: plan, phase: '4' });
  render();
  openCalculatedFactory(calcStage()!.rows![0]!.id);
  const calc = summary();
  assert.ok(
    calc.every(([label]) => /^Phase \d/.test(label as string)),
    JSON.stringify(calc),
  );
  assert.deepEqual(
    calc.filter(([, current]) => current),
    [['Phase 4current', true, 'true']],
  );
  // At Post Phase 5 the Phase 5 row is current.
  open({ calculated: plan, phase: 'post' });
  render();
  openCalculatedFactory(calcStage()!.rows![0]!.id);
  assert.deepEqual(
    summary().filter(([, current]) => current),
    [['Phase 5current: Post Phase 5', true, 'true']],
  );
  // A migrated profile's dialog does the same, from the phases its plan builds the row in.
  openMigrated({ phase: '4' });
  render();
  openCalculatedFactory(row('wire', '4'));
  const migratedPhases = summary();
  assert.deepEqual(
    migratedPhases.map(([label]) => (label as string).replace('current', '')),
    ['Phase 3', 'Phase 4', 'Phase 5'],
  );
  assert.deepEqual(
    migratedPhases.filter(([, current]) => current),
    [['Phase 4current', true, 'true']],
  );
});

// The Running box sits in the dialog's sticky header, between the title and the ×, and writes
// the same key as the factory's card (#239).
const headerRunning = async (key: string, label: RegExp, openIt: () => void) => {
  openIt();
  await nextTick();
  const box = $<HTMLInputElement>(`#detail .dialog-head [data-check="${key}"]`)!;
  assert.ok(box, 'the Running box is in the header');
  assert.equal($$('#detail [data-check]').length, 1, 'and only there');
  assert.equal($('#detail .dialog-body [data-check]'), null);
  assert.equal($('#detail .detail-actions'), null, 'no actions row is left in the body');
  assert.match(box.closest('label')!.textContent!, label, 'it keeps its label');
  const order = $$('#detail .dialog-head input, #detail .dialog-head button');
  assert.deepEqual(
    order.map(
      control => control.dataset.check ?? (control.dataset.close === undefined ? '?' : 'close'),
    ),
    [key, 'close'],
    'Tab goes title → Running → ×',
  );
  assert.equal(box.checked, false);
  box.click();
  await settle();
  assert.equal(state.checks[key], true, 'saved under the card’s key');
  assert.equal($<HTMLInputElement>(`#detail .dialog-head [data-check="${key}"]`)!.checked, true);
  assert.equal(
    $<HTMLInputElement>(`#main .factory-card [data-check="${key}"]`)!.checked,
    true,
    'the card behind the dialog follows',
  );
};

test('a migrated factory dialog has its Running box in the header, saved as its card’s', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  render();
  const key = 'calc-3-' + row('wire');
  await headerRunning(key, /^Running at Phase 3 target$/, () => openCalculatedFactory(row('wire')));
  assert.deepEqual(calls.at(-1)![1], { type: 'check', key, value: true });
  assert.ok($(`#main [data-check="${key}"]`)!.closest('.factory-card.done'));
});

test('a calculated factory dialog has its Running box in the header, saved as its card’s', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  open({ calculated: plan });
  render();
  const first = calcStage()!.rows![0]!;
  await headerRunning('calc-3-' + first.id, /^Running at Phase 3 target$/, () =>
    openCalculatedFactory(first.id),
  );
  assert.deepEqual(calls.at(-1)![1], { type: 'check', key: 'calc-3-' + first.id, value: true });
});

test('a group build order stages suppliers before consumers', () => {
  const stage = plan.stages['3'];
  const consumer = stage.rows!.find(row =>
    stage.rows!.some(
      o => o.id !== row.id && Object.keys(o.outputs || {}).some(n => row.inputs?.[n]),
    ),
  )!;
  const supplier = stage.rows!.find(
    o => o.id !== consumer.id && Object.keys(o.outputs || {}).some(n => consumer.inputs[n]),
  )!;
  open({
    calculated: plan,
    state: {
      factoryGroups: {
        groups: [{ id: 'fg-test01', name: 'Chain test' }],
        assignments: {
          [consumer.id]: [{ group: 'fg-test01', rate: null }],
          [supplier.id]: [{ group: 'fg-test01', rate: null }],
        },
      },
    },
  });
  render();
  assert.ok($('[data-group-chain="fg-test01"]'), 'the group offers its build order');
  openGroupChain('fg-test01');
  assert.match($('#detail .eyebrow')!.textContent, /build\u00a0order/);
  const names = $$('#detail .chain-title .rail-link').map(link => link.textContent);
  assert.deepEqual(names, [supplier.name + ' ↗', consumer.name + ' ↗'], 'supplier first');
  assert.ok($('#detail .chain-title [data-calc-factory]'), 'stages link to their dialogs');
  assert.match(detail(), /Needs/);
  assert.match(detail(), /Feeds/);
  assert.match(detail(), /stage 1/, 'the consumer names the stage that supplies it');
});

test('a dialog left open when the session ends closes with the sign-in screen', async () => {
  render();
  openCalculatedFactory(row('wire'));
  assert.equal($<HTMLDialogElement>('#detail')!.open, true);
  // boot() after an ended session: /api/workspace answers with no user.
  stubFetch({ '/api/workspace': { user: null, accountsEnabled: true, saves: [] } });
  await boot();
  assert.ok($('#auth-form'), 'the sign-in screen is up');
  assert.equal($<HTMLDialogElement>('#detail')!.open, false, 'no dialog over it');
});

test('built so far: the plan panel and factory cards follow the rows marked running', async () => {
  const stage = plan.stages['3'];
  const rows = stage.rows!;
  // A row fed by another row (not only by raw resources), and that supplier.
  const consumer = rows.find(row =>
    Object.keys(row.inputs).some(n => rows.some(o => o.id !== row.id && o.outputs[n])),
  )!;
  open({ calculated: plan, state: { checks: { ['calc-3-' + consumer.id]: true } } });
  go('plan');
  render();
  noMarkup();
  const panel = () => $('[data-build-status]')!;
  assert.ok(panel(), 'the panel is on the calculated plan page');
  assert.match(panel().textContent, new RegExp(`1 of ${rows.length} factories marked running`));
  assert.ok($('[data-build-none]'), 'nothing reaches the elevator yet');
  assert.match($('[data-build-waiting]')!.textContent, new RegExp(consumer.name));
  assert.match($('[data-build-waiting]')!.textContent, /running at 0%, short of /);
  // The next step is a factory link that opens its dialog.
  const next = $<HTMLButtonElement>('[data-build-next] [data-calc-factory]')!;
  assert.ok(next, 'the next step links to its factory');
  next.click();
  assert.equal($<HTMLDialogElement>('#detail')!.open, true);
  closeDetail();
  // Its factory card says the same.
  go('factories');
  render();
  await nextTick();
  const held = $$('[data-build-held]');
  assert.equal(held.length, 1);
  assert.match(held[0]!.textContent, /^Running at 0%: short of /);
  // Every row marked running: the whole delivery flows and nothing is left to build.
  open({
    calculated: plan,
    state: { checks: Object.fromEntries(rows.map(r => ['calc-3-' + r.id, true])) },
  });
  go('plan');
  render();
  await nextTick();
  assert.equal($('[data-build-waiting]'), null);
  assert.match(
    $('[data-build-next]')!.textContent,
    /Every factory of this phase is marked running/,
  );
  for (const [item, delivery] of Object.entries(stage.delivery!)) {
    const line = $$('[data-build-rate]').find(rate =>
      rate.closest('.delivery')!.textContent.includes(item),
    );
    assert.ok(line, item);
    assert.ok(
      line.textContent.startsWith(`${num(delivery.rate)} of ${num(delivery.rate)}/min now`),
      item,
    );
  }
});

test('between groups: a card per group with what comes in and goes out, names escaped (#213)', async () => {
  const rows = plan.stages['3'].rows!;
  const assignments = Object.fromEntries(
    rows.map((r, i) => [r.id, [{ group: i % 2 ? 'fg-parts1' : 'fg-smelt1', rate: null }]]),
  );
  open({
    calculated: plan,
    state: {
      factoryGroups: {
        groups: [
          { id: 'fg-smelt1', name: evil },
          { id: 'fg-parts1', name: 'Parts' },
          { id: 'fg-spare1', name: 'Spare' },
        ],
        assignments,
      },
    },
  });
  go('logistics');
  render();
  await nextTick();
  noMarkup();
  const section = $('[data-group-links]')!;
  assert.ok(section, 'shown once the profile has groups');
  // One card per group, in the groups' order, after a card for each raw resource (#222, #339);
  // the elevator is only a row end.
  const all = $$('[data-group-card]');
  const isSourceCard = (card: HTMLElement) => card.dataset.group!.startsWith('supply/');
  const sourceCards = all.filter(isSourceCard),
    cards = all.filter(card => !isSourceCard(card));
  assert.ok(sourceCards.length > 1, 'a card per raw resource');
  assert.deepEqual(all.slice(0, sourceCards.length), sourceCards, 'the sources come first');
  assert.deepEqual(
    cards.map(c => c.querySelector('h3')!.textContent),
    [evil, 'Parts'],
  );
  assert.equal($('[data-group="mines"]'), null, 'no combined mines card any more');
  for (const sourceCard of sourceCards)
    assert.deepEqual(
      [...sourceCard.querySelectorAll<HTMLElement>('[data-flow]')].map(part => part.dataset.flow),
      ['out'],
      'a source only sends',
    );
  // A group nothing reaches or leaves gets a line, not an empty card.
  assert.match(
    $('[data-idle-groups]')!.textContent!,
    /Nothing moves in or out of Spare in this phase/,
  );
  const [smelt, parts] = cards as [HTMLElement, HTMLElement];
  const flow = (card: HTMLElement, direction: string) =>
    card.querySelector(`[data-flow="${direction}"]`)!;
  const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();
  // Each link shows twice: out of its sender and into its receiver, with the controls on Out only.
  const key = 'fg-smelt1:fg-parts1';
  const out = flow(smelt, 'out').querySelector(`[data-link-out="${key}"]`)!;
  const into = flow(parts, 'in').querySelector(`[data-link-in="${key}"]`)!;
  assert.match(text(out), /^→ to Parts /);
  assert.ok(text(into).startsWith(`← from ${evil} `), text(into));
  assert.ok(out.querySelector('[data-link-mode]'));
  assert.equal($$('[data-link-in] select, [data-link-in] input').length, 0);
  assert.equal($$('[data-link-mode]').length, $$('[data-link-out]').length);
  // Every link has exactly one Out row, so each can be edited, and the mines' go to the groups.
  const outs = $$('[data-link-out]').map(row => row.dataset.linkOut);
  assert.equal(new Set(outs).size, outs.length);
  assert.deepEqual(
    [...new Set($$('[data-link-in]').map(row => row.dataset.linkIn))].filter(
      link => !outs.includes(link),
    ),
    [],
  );
  assert.ok(outs.some(link => link!.startsWith('supply/Iron Ore:fg-')));
  const ends = (direction: string) => $$(`[data-flow="${direction}"] .flow-end`).map(text);
  // Each raw resource is a source of its own (#231) with a card of its own (#339), named by its
  // item, whose Out part counts and totals its links; no card has sections any more.
  assert.ok(ends('in').includes('← from Iron Ore'));
  assert.ok(ends('in').includes('← from Coal'));
  const iron = $('[data-group-card][data-group="supply/Iron Ore"]')!;
  assert.equal(iron.querySelector('h3')!.textContent, 'Iron Ore');
  assert.match(
    text(iron.querySelector('[data-flow="out"] [data-flow-sum]')!),
    /^\d+ links? · [\d.,]+( m³)?\/min$/,
  );
  assert.equal($('.flow-source'), null, 'no sections inside a card');
  assert.ok(ends('out').includes('→ to Space Elevator'));
  // The items with their rates, named for screen readers; the belts totalled per mark.
  const item = out.querySelector('.flow-items li')!;
  assert.match(text(item), /^[A-Z][\w ]+: [\d.,]+( m³)?\/min$/);
  // Every item line carries its unit, a solid's /min and a fluid's m³/min (#462).
  const lines = $$('[data-link-out] .flow-items li').map(text);
  assert.ok(lines.length && lines.every(l => /\d( m³)?\/min$/.test(l)), JSON.stringify(lines));
  assert.ok(
    lines.some(l => /^Iron Ore: [\d.,]+\/min$/.test(l)),
    'a solid reads /min',
  );
  assert.ok(
    lines.some(l => /^Crude Oil: [\d.,]+ m³\/min$/.test(l)),
    'a fluid reads m³/min',
  );
  assert.match(item.getAttribute('title')!, /^[A-Z][\w ]+: [\d.,]+( m³)?\/min$/);
  for (const linkBadge of $$('[data-link-badge]'))
    assert.match(text(linkBadge), /^\d+ × Mk\.\d (belt|pipe)s?( · \d+ × Mk\.\d (belt|pipe)s?)*$/);
  const badge = (row: Element) => text(row.querySelector('[data-link-badge]')!);
  assert.equal(badge(out), badge(into));
  // Each part counts its links and adds up what they carry.
  const inRows = flow(parts, 'in').querySelectorAll('[data-link-in]').length;
  assert.match(
    text(flow(parts, 'in').querySelector('[data-flow-sum]')!),
    new RegExp(`^${inRows} links? · [\\d.,]+/min`),
  );
  noMarkup();
  // Rows outside every group make an Ungrouped card, listed last.
  open({
    calculated: plan,
    state: {
      factoryGroups: {
        groups: [{ id: 'fg-parts1', name: 'Parts' }],
        assignments: Object.fromEntries(
          rows.slice(1).map(r => [r.id, [{ group: 'fg-parts1', rate: null }]]),
        ),
      },
    },
  });
  go('logistics');
  render();
  await nextTick();
  assert.deepEqual(
    $$('[data-group-card]')
      .map(card => card.dataset.group)
      .filter(id => !id!.startsWith('supply/')),
    ['fg-parts1', 'ungrouped'],
  );
  assert.ok($$('[data-group-card]')[0]!.dataset.group!.startsWith('supply/'));
  // Without groups there is nothing to show.
  open({ calculated: plan });
  go('logistics');
  render();
  await nextTick();
  assert.equal($('[data-group-links]'), null);
});

test('between groups has its own Logistics page, with a way forward when there is nothing to show (#229)', async () => {
  const rows = plan.stages['3'].rows!;
  const factoryGroups = {
    groups: [{ id: 'fg-smelt1', name: evil }],
    assignments: Object.fromEntries(rows.map(r => [r.id, [{ group: 'fg-smelt1', rate: null }]])),
  };
  open({ calculated: plan, state: { factoryGroups } });
  assert.equal(viewOf('logistics'), 'logistics', 'a deep link to #logistics opens it');
  go('factories');
  render();
  await nextTick();
  // The factories page no longer carries the section; a line points to the new page.
  assert.equal($('[data-group-links]'), null);
  assert.equal($('[data-logistics-link] a')!.getAttribute('href'), '#logistics');
  const nav = $$('.nav a').map(a => a.textContent!.trim());
  assert.deepEqual(nav.slice(0, 3), ['◫Build plan', '▥Factories', '⇄Logistics']);
  go('logistics');
  render();
  await nextTick();
  assert.equal($('h1')!.textContent, 'Logistics');
  assert.ok($('[data-group-links] [data-group-card]'));
  assert.equal($('.nav a.active')!.textContent!.trim(), '⇄Logistics');
  noMarkup();
  // A calculated profile without groups: what to do first.
  open({ calculated: plan });
  go('logistics');
  render();
  await nextTick();
  assert.equal($('[data-group-links]'), null);
  assert.equal($('[data-logistics-empty="groups"] a')!.getAttribute('href'), '#factories');
  go('factories');
  render();
  await nextTick();
  assert.equal($('[data-logistics-link]'), null, 'no pointer to an empty page');
  noMarkup();
  // With no calculated plan open (the page is drawn once more after its profile has gone, #356),
  // it draws its header and nothing else.
  go('logistics');
  render();
  await nextTick();
  closePlan();
  render();
  await nextTick();
  assert.equal($('#main h1')!.textContent, 'Logistics');
  assert.equal($('#main .notice'), null);
  assert.equal($('[data-group-links]'), null);
});

test('between groups: a link can go by truck, train or back to belts, with the vehicle math (#205)', async () => {
  const rows = plan.stages['3'].rows!;
  const assignments = Object.fromEntries(
    rows.map((r, i) => [r.id, [{ group: i % 2 ? 'fg-parts1' : 'fg-smelt1', rate: null }]]),
  );
  open({
    calculated: plan,
    workspace: { catalog: catalog() },
    state: {
      version: 3,
      factoryGroups: {
        groups: [
          { id: 'fg-smelt1', name: evil },
          { id: 'fg-parts1', name: 'Parts' },
        ],
        assignments,
      },
    },
  });
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  go('logistics');
  render();
  await nextTick();
  const key = 'fg-smelt1:fg-parts1';
  const pick = async (selector: string, value: string) => {
    const el = $<HTMLSelectElement | HTMLInputElement>(selector)!;
    el.value = value;
    el.dispatchEvent(new Event('change'));
    await settle();
  };
  assert.equal($<HTMLSelectElement>(`[data-link-mode="${key}"]`)!.value, 'belt');
  assert.equal($(`[data-link-trip="${key}"]`), null, 'belts need no round trip');
  await pick(`[data-link-mode="${key}"]`, 'truck');
  assert.deepEqual(calls.at(-1)![1], {
    type: 'factoryLinkTransport',
    from: 'fg-smelt1',
    to: 'fg-parts1',
    mode: 'truck',
    roundTripMin: 5,
    fuel: 'Packaged Fuel',
  });
  assert.equal(state.version, 7);
  const linkEl = $(`[data-link-out="${key}"]`)!;
  assert.match(
    linkEl.querySelector('[data-link-load]')!.textContent!,
    /^\d+ trucks?, \d+ of 48 slots each trip\. Up to [\d.,]+ Packaged Fuel\/min/,
  );
  assert.doesNotMatch(linkEl.textContent!, /Mk\.\d belt/, 'the belt advice gives way');
  // The receiving group's In row shows the vehicles, without controls.
  assert.match(
    $(`[data-link-in="${key}"] [data-link-badge]`)!.textContent!.trim(),
    /^\d+ trucks?$/,
  );
  // A round trip out of range is refused before anything is sent.
  const sent = calls.length;
  await pick(`[data-link-trip="${key}"]`, '0');
  assert.equal(calls.length, sent);
  assert.equal($<HTMLInputElement>(`[data-link-trip="${key}"]`)!.value, '5');
  await pick(`[data-link-trip="${key}"]`, '12');
  await pick(`[data-link-fuel="${key}"]`, 'Coal');
  assert.deepEqual(state.factoryGroups.links![key], {
    mode: 'truck',
    roundTripMin: 12,
    fuel: 'Coal',
  });
  // A train keeps the round trip, drops the fuel and counts cars.
  await pick(`[data-link-mode="${key}"]`, 'train');
  assert.deepEqual(state.factoryGroups.links![key], { mode: 'train', roundTripMin: 12 });
  assert.equal($(`[data-link-fuel="${key}"]`), null);
  assert.match(
    $(`[data-link-out="${key}"] [data-link-load]`)!.textContent!,
    /^1 train: \d+ locomotives?, \d+ freight cars?/,
  );
  await pick(`[data-link-mode="${key}"]`, 'belt');
  assert.equal(state.factoryGroups.links, undefined);
  assert.match($(`[data-link-out="${key}"]`)!.textContent!, /Mk\.\d (belt|pipe)/);
  noMarkup();
});

test('between groups: existing supply sent straight to storage has its row and controls on its own card (#222, #339)', async () => {
  const supplied = generatedWith({ existingSupply: { 'Iron Plate': 30 } });
  open({
    calculated: supplied,
    workspace: { catalog: catalog() },
    state: {
      version: 3,
      factoryGroups: { groups: [{ id: 'fg-plate1', name: 'Plates' }], assignments: {} },
    },
  });
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  go('logistics');
  render();
  await nextTick();
  const key = 'supply/Iron Plate:storage';
  const row = $(`[data-group-card][data-group="supply/Iron Plate"] [data-link-out="${key}"]`)!;
  assert.ok(row, 'the link with neither end on a group card shows');
  assert.match(row.textContent!.replace(/\s+/g, ' '), /→ to Protected storage Iron Plate: /);
  // Existing supply is marked and its card comes after the mined resources' (#231, #339).
  const heads = $$('[data-group-card]')
    .filter(card => card.dataset.group!.startsWith('supply/'))
    .map(card => card.querySelector('h3')!.textContent!.trim());
  const plate = heads.findIndex(h => h.startsWith('Iron Plate (existing supply)'));
  assert.ok(plate > 0, JSON.stringify(heads));
  assert.ok(heads.slice(0, plate).every(h => !h.includes('existing supply')));
  const mode = $<HTMLSelectElement>(`[data-link-mode="${key}"]`)!;
  mode.value = 'truck';
  mode.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(calls.at(-1)![1], {
    type: 'factoryLinkTransport',
    from: 'supply/Iron Plate',
    to: 'storage',
    mode: 'truck',
    roundTripMin: 5,
    fuel: 'Packaged Fuel',
  });
  assert.ok($(`[data-link-out="${key}"] [data-link-load]`), 'its vehicle math shows');
  noMarkup();
});

test('between groups: a vehicle saved on a whole mines link applies to each source until one is changed (#231)', async () => {
  const rows = plan.stages['3'].rows!;
  const truck = { mode: 'truck' as const, roundTripMin: 7, fuel: 'Coal' };
  open({
    calculated: plan,
    workspace: { catalog: catalog() },
    state: {
      version: 7,
      factoryGroups: {
        groups: [{ id: 'fg-smelt1', name: 'All' }],
        assignments: Object.fromEntries(
          rows.map(r => [r.id, [{ group: 'fg-smelt1', rate: null }]]),
        ),
        links: { 'mines:fg-smelt1': truck },
      },
    },
  });
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  go('logistics');
  render();
  await nextTick();
  const sources = $$('[data-link-out]')
    .map(row => row.dataset.linkOut!)
    .filter(key => key.startsWith('supply/') && key.endsWith(':fg-smelt1'));
  assert.ok(sources.length > 1, JSON.stringify(sources));
  for (const source of sources)
    assert.equal($<HTMLSelectElement>(`[data-link-mode="${source}"]`)!.value, 'truck', source);
  // Changing one: the others keep the truck as their own, and the old entry goes.
  const [first, ...rest] = sources;
  const mode = $<HTMLSelectElement>(`[data-link-mode="${first}"]`)!;
  mode.value = 'train';
  mode.dispatchEvent(new Event('change'));
  await settle();
  const sent = calls.at(-1)![1] as Extract<UpdateOp, { type: 'factoryLinkTransport' }>;
  assert.deepEqual([...sent.siblings!].sort(), sources.map(source => source.split(':')[0]).sort());
  const links = state.factoryGroups.links!;
  assert.equal(links['mines:fg-smelt1'], undefined);
  assert.deepEqual(links[first!], { mode: 'train', roundTripMin: 7 });
  for (const source of rest) assert.deepEqual(links[source], truck, source);
  assert.equal(state.version, 11);
  noMarkup();
});

test('between groups: splitting an old mines vehicle keeps it for sources that arrive only in another phase (#235)', async () => {
  // Every phase's rows in one group, so its mines sources differ from phase to phase.
  const allRows = Object.values(plan.stages).flatMap(stage => stage.rows || []);
  const truck = { mode: 'truck' as const, roundTripMin: 7, fuel: 'Coal' };
  open({
    calculated: plan,
    workspace: { catalog: catalog() },
    state: {
      version: 7,
      factoryGroups: {
        groups: [{ id: 'fg-smelt1', name: 'All' }],
        assignments: Object.fromEntries(
          allRows.map(r => [r.id, [{ group: 'fg-smelt1', rate: null }]]),
        ),
        links: { 'mines:fg-smelt1': truck },
      },
    },
  });
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  go('logistics');
  render();
  await nextTick();
  const shown = $$('[data-link-out]')
    .map(row => row.dataset.linkOut!)
    .filter(key => key.startsWith('supply/') && key.endsWith(':fg-smelt1'));
  // A source that reaches the group in some phase, but not in the one on screen.
  const everywhere = new Set(
    Object.values(plan.stages)
      .filter(stage => stage.rows?.length)
      .flatMap(stage => groupLinks(stage, state.factoryGroups))
      .filter(link => link.from.startsWith('supply/') && link.to === 'fg-smelt1')
      .map(link => link.from + ':' + link.to),
  );
  const later = [...everywhere].filter(key => !shown.includes(key));
  assert.ok(later.length > 0, 'the plan has a source this phase does not show');
  const mode = $<HTMLSelectElement>(`[data-link-mode="${shown[0]}"]`)!;
  mode.value = 'train';
  mode.dispatchEvent(new Event('change'));
  await settle();
  const sent = calls.at(-1)![1] as Extract<UpdateOp, { type: 'factoryLinkTransport' }>;
  assert.deepEqual(
    [...sent.siblings!].sort(),
    [...everywhere].map(key => key.split(':')[0]).sort(),
    'the siblings cover every phase',
  );
  const links = state.factoryGroups.links!;
  assert.equal(links['mines:fg-smelt1'], undefined);
  for (const key of later) assert.deepEqual(links[key], truck, `${key} keeps the truck`);
  noMarkup();
});

test('between groups: recalculating with transport fuel creates a revision that plans it (#206)', async () => {
  const rows = plan.stages['3'].rows!;
  const assignments = Object.fromEntries(
    rows.map((r, i) => [r.id, [{ group: i % 2 ? 'fg-parts1' : 'fg-smelt1', rate: null }]]),
  );
  const factoryGroups = {
    groups: [
      { id: 'fg-smelt1', name: evil },
      { id: 'fg-parts1', name: 'Parts' },
    ],
    assignments,
    links: {
      'fg-smelt1:fg-parts1': { mode: 'truck' as const, roundTripMin: 6, fuel: 'Packaged Fuel' },
    },
  };
  open({
    calculated: plan,
    workspace: { catalog: catalog() },
    state: { version: 7, factoryGroups },
  });
  go('logistics');
  render();
  await nextTick();
  const note = () => $('[data-transport-fuel-note]')!.textContent!.replace(/\s+/g, ' ');
  assert.match(
    note(),
    /The vehicles on these links burn up to Phase 3: [\d.,]+ Packaged Fuel\/min/,
  );
  // The new revision's context: the same plan, now with the fuel in its settings. Its Phase 1
  // and 2 milestones are ticked, so it opens on Phase 3 rather than on them (#570, #759).
  const earlier = Object.fromEntries(
    [...phaseStepIds('1'), ...phaseStepIds('2')].map(id => [id, true]),
  );
  let sent: { settings: { transportFuel: object }; carryFrom: string; name: string } | undefined;
  const calls = stubFetch({
    '/api/profiles': (body: typeof sent) => {
      sent = body;
      return { saveId: 's', profileId: 'p', reviewCount: 2, workspace };
    },
    '/api/context': () => ({
      save: { id: 's', name: 'World' },
      profile: { id: 'p', kind: 'calculated', name: 'Fuelled' },
      state: { ...state, factoryGroups, checks: { ...state.checks, ...earlier } },
      plan: {
        ...plan,
        settings: { ...plan.settings, transportFuel: sent!.settings.transportFuel },
      },
    }),
  });
  $('[data-recalc-transport]')!.click();
  await settle();
  await settle();
  assert.equal(calls[0]![0], '/api/profiles');
  assert.equal(sent!.carryFrom, 'p');
  assert.equal(sent!.name, `${evil} · transport fuel`);
  assert.deepEqual(Object.keys(sent!.settings.transportFuel), ['3', '4', '5']);
  assert.match($('#toast')!.textContent!, /2 completed factory checks need review/);
  assert.match(note(), /This plan already includes the vehicle fuel/);
  assert.equal($('[data-recalc-transport]'), null);
  noMarkup();
});

// The jump bar and folding sections of both factories pages (JumpBar.vue, CollapseToggle.vue,
// SP-17, #252).
const jumps = () =>
  $$('#main .jump-bar [data-jump]').map(button => [
    button.dataset.jump,
    button.querySelector('.count')!.textContent,
    button.textContent!.trim().replace(/\s+/g, ' '),
  ]);
const toggleOf = (key: string) => $<HTMLButtonElement>(`[data-collapse="${key}"]`)!;
const cardsOf = (key: string) => $<HTMLElement>(`#cards-${key}`)!;
// Every section this file folds, unfolded again for the open profile: the folded state lives in
// session.ts (and localStorage) across tests, as it does across pages.
const unfoldAll = () => {
  for (const key of ['fg-cable01', 'fg-plates1', 'fg-a', 'site-oil', 'site-nuclear'])
    setSectionCollapsed(key, false);
};
// Where scrollIntoView() was asked to go, by element id.
const scrolled: string[] = [];
beforeEach(() => {
  scrolled.length = 0;
  HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
    scrolled.push(this.id);
  };
});

test('the jump bar lists each group and shared site with its running count', async () => {
  openMigrated({
    state: { factoryGroups: structuredClone(GROUPS), checks: { ['calc-3-' + row('wire')]: true } },
  });
  render();
  await nextTick();
  assert.equal($('#main .jump-bar')!.tagName, 'NAV');
  assert.equal($('#main .jump-bar')!.getAttribute('aria-label'), 'Groups on this page');
  assert.ok($('#main .toolbar + .jump-bar'), 'right under the toolbar');
  // Groups first, then the shared sites, in the order the page draws them.
  assert.deepEqual(jumps(), [
    ['fg-cable01', '1/1', 'Cable factory 1/1, 1 of 1 running'],
    ['fg-plates1', '1/1', 'Stitched plates 1/1, 1 of 1 running'],
    ['site-oil', '0/3', 'Oil campus 0/3, 0 of 3 running'],
  ]);
  assert.deepEqual(
    $$('#main .site-group').map(site => site.id),
    ['section-fg-cable01', 'section-fg-plates1', 'section-site-oil'],
  );
  // The counts follow the search, like the chips, but not the chosen chip: Running keeps the
  // groups (with their count) and drops the site nothing runs at, as the page does.
  statusChip('done').click();
  await nextTick();
  assert.deepEqual(
    jumps().map(j => j.slice(0, 2)),
    [
      ['fg-cable01', '1/1'],
      ['fg-plates1', '1/1'],
    ],
  );
  statusChip('all').click();
  await find('plastic');
  assert.deepEqual(jumps(), [['site-oil', '0/1', 'Oil campus 0/1, 0 of 1 running']]);
  await find('no-such-part');
  assert.equal($('#main .jump-bar'), null, 'nothing to jump to');
  // Without a group or site to show there is no bar: here only the ungrouped Wire card.
  openMigrated();
  render();
  await find('wire');
  assert.deepEqual(factoryIds('#main'), [row('wire')]);
  assert.equal($('#main .jump-bar'), null);
  await find('');
});

test('a jump brings the section into view and focuses its heading', async () => {
  openMigrated({ state: { factoryGroups: structuredClone(GROUPS) } });
  render();
  await nextTick();
  const button = $<HTMLButtonElement>('[data-jump="site-oil"]')!;
  button.focus();
  button.click();
  await settle();
  const heading = $('#section-site-oil h2')!;
  assert.equal(heading.getAttribute('tabindex'), '-1');
  assert.equal(document.activeElement, heading);
  assert.deepEqual(scrolled, ['section-site-oil']);
  $<HTMLButtonElement>('[data-jump="fg-plates1"]')!.click();
  await settle();
  assert.equal(document.activeElement, $('#section-fg-plates1 h2'));
  assert.equal($('#section-fg-plates1 h2')!.textContent, 'Stitched plates');
  // While groups are edited, the name field stands in for the heading.
  $('[data-toggle-factory-edit]')!.click();
  await nextTick();
  $<HTMLButtonElement>('[data-jump="fg-cable01"]')!.click();
  await settle();
  assert.equal(document.activeElement, $('[data-group-rename="fg-cable01"]'));
});

test('a group folds with its toggle, is remembered, and still counts in the chips', async () => {
  openMigrated({
    state: { factoryGroups: structuredClone(GROUPS), checks: { ['calc-3-' + row('wire')]: true } },
  });
  unfoldAll();
  render();
  await nextTick();
  const before = structuredClone(state);
  const counts = chips();
  const total = $('#main .toolbar > span')!.textContent;
  const toggle = toggleOf('fg-cable01');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.getAttribute('aria-controls'), 'cards-fg-cable01');
  assert.equal(toggle.getAttribute('aria-label'), 'Factories in Cable factory');
  assert.ok(cardsOf('fg-cable01').classList.contains('cards'));
  toggle.focus();
  toggle.click();
  await nextTick();
  assert.equal(toggleOf('fg-cable01').getAttribute('aria-expanded'), 'false');
  assert.equal(cardsOf('fg-cable01').style.display, 'none', 'its cards are hidden');
  assert.ok($('#section-fg-cable01')!.classList.contains('collapsed'));
  assert.equal($('#section-fg-cable01 h2')!.textContent, 'Cable factory', 'its header stays');
  assert.equal(document.activeElement, toggleOf('fg-cable01'), 'focus stays on the toggle');
  assert.equal(cardsOf('fg-plates1').style.display, '', 'the other group stays open');
  // A folded group still counts: in the chips, the page's total and the jump bar.
  assert.deepEqual(chips(), counts);
  assert.equal($('#main .toolbar > span')!.textContent, total);
  assert.equal(jumps()[0]![1], '1/1');
  // Remembered through redraws and pages, and for this profile only.
  go('plan');
  render();
  await nextTick();
  go('factories');
  render();
  await nextTick();
  assert.equal(toggleOf('fg-cable01').getAttribute('aria-expanded'), 'false');
  // It is view state in this browser, not progress: nothing in the profile changed.
  assert.deepEqual(state, before);
  assert.deepEqual(JSON.parse(localStorage.getItem('planner-collapsed-sections')!), [
    's/p/fg-cable01',
  ]);
  setContext({
    save: { id: 's', name: 'World' },
    profile: { id: 'other', kind: 'calculated', name: 'World' },
    state: { ...structuredClone(state), factoryGroups: structuredClone(GROUPS) },
    plan: migrated(),
  });
  render();
  await nextTick();
  assert.equal(toggleOf('fg-cable01').getAttribute('aria-expanded'), 'true');
  // A shared site folds the same way, and still counts too.
  const otherCounts = chips();
  toggleOf('site-oil').click();
  await nextTick();
  assert.equal(cardsOf('site-oil').style.display, 'none');
  assert.equal(toggleOf('site-oil').getAttribute('aria-label'), 'Outputs of Oil campus');
  assert.deepEqual(chips(), otherCounts);
  toggleOf('site-oil').click();
  await nextTick();
  assert.equal(cardsOf('site-oil').style.display, '');
  openMigrated({ state: { factoryGroups: structuredClone(GROUPS) } });
  unfoldAll();
});

test('jumping to a folded section unfolds it, and folding works while editing groups', async () => {
  openMigrated({ state: { factoryGroups: structuredClone(GROUPS) } });
  unfoldAll();
  render();
  await nextTick();
  toggleOf('fg-plates1').click();
  await nextTick();
  assert.equal(cardsOf('fg-plates1').style.display, 'none');
  $<HTMLButtonElement>('[data-jump="fg-plates1"]')!.click();
  await settle();
  assert.equal(cardsOf('fg-plates1').style.display, '', 'going there is asking to see it');
  assert.equal(toggleOf('fg-plates1').getAttribute('aria-expanded'), 'true');
  assert.equal(document.activeElement, $('#section-fg-plates1 h2'));
  // Edit groups keeps working: rename and remove are there, and a folded group keeps them.
  $('[data-toggle-factory-edit]')!.click();
  await nextTick();
  toggleOf('fg-cable01').click();
  await nextTick();
  assert.ok($('[data-group-rename="fg-cable01"]'));
  assert.ok($('[data-remove-group="fg-cable01"]'));
  assert.equal(cardsOf('fg-cable01').style.display, 'none');
  unfoldAll();
});

test('an empty group shows in the jump bar while editing, and user names stay text', async () => {
  openMigrated({
    state: { factoryGroups: { groups: [{ id: 'fg-a', name: evil }], assignments: {} } },
  });
  render();
  await nextTick();
  assert.deepEqual(
    jumps().map(j => j[0]),
    ['site-oil'],
    'an empty group is not drawn, so not listed',
  );
  setFactoryEditing(true);
  render();
  await nextTick();
  assert.deepEqual(jumps()[0]!.slice(0, 2), ['fg-a', '0/0']);
  assert.equal(toggleOf('fg-a').getAttribute('aria-label'), 'Factories in ' + evil);
  noMarkup();
});

test('the calculated page has the jump bar and folding groups too', async () => {
  const rows = plan.stages['3'].rows!;
  const [first, second, third] = rows;
  open({
    calculated: plan,
    state: {
      checks: { ['calc-3-' + first!.id]: true },
      factoryGroups: {
        groups: [
          { id: 'fg-cable01', name: 'North' },
          { id: 'fg-plates1', name: 'South' },
        ],
        assignments: {
          [first!.id]: [{ group: 'fg-cable01', rate: null }],
          [second!.id]: [{ group: 'fg-cable01', rate: null }],
          [third!.id]: [{ group: 'fg-plates1', rate: null }],
        },
      },
    },
  });
  unfoldAll();
  render();
  await nextTick();
  assert.deepEqual(
    jumps().map(j => j.slice(0, 2)),
    [
      ['fg-cable01', '1/2'],
      ['fg-plates1', '0/1'],
    ],
  );
  const counts = chips();
  toggleOf('fg-cable01').click();
  await nextTick();
  assert.equal(cardsOf('fg-cable01').style.display, 'none');
  assert.deepEqual(chips(), counts, 'folded rows still count in the chips');
  assert.equal($('#main .toolbar > span')!.textContent, `${rows.length} production lines`);
  $<HTMLButtonElement>('[data-jump="fg-cable01"]')!.click();
  await settle();
  assert.equal(cardsOf('fg-cable01').style.display, '');
  assert.equal(document.activeElement, $('#section-fg-cable01 h2'));
  assert.deepEqual(scrolled, ['section-fg-cable01']);
  unfoldAll();
});

test('folded sections survive a page refresh, and anything unreadable opens them all', async () => {
  // A refresh loads session.ts afresh, which reads what this browser remembered.
  const fresh = async (stored: string | null) => {
    if (stored === null) localStorage.removeItem('planner-collapsed-sections');
    else localStorage.setItem('planner-collapsed-sections', stored);
    vi.resetModules();
    const session = await import('../../public/app/session.ts');
    session.setContext({
      save: { id: 's', name: 'World' },
      profile: { id: 'original', kind: 'calculated', name: 'World' },
      state: structuredClone(state),
      plan: migratedPlan(),
    });
    return session;
  };
  let session = await fresh('["s/original/fg-cable01","s/other/site-oil"]');
  assert.equal(session.sectionCollapsed('fg-cable01'), true);
  assert.equal(session.sectionCollapsed('site-oil'), false, "another profile's choice");
  for (const bad of [null, 'not json', '{"fg-cable01":true}', '[1,null]']) {
    session = await fresh(bad);
    assert.equal(session.sectionCollapsed('fg-cable01'), false, String(bad));
  }
  // Folding again writes a clean list.
  session.setSectionCollapsed('site-oil', true);
  assert.deepEqual(JSON.parse(localStorage.getItem('planner-collapsed-sections')!), [
    's/original/site-oil',
  ]);
  localStorage.removeItem('planner-collapsed-sections');
});
// #356: a page stays mounted until render() swaps it out, so the factories page can be drawn
// once more after the profile it was drawn for has gone and no calculated plan is open. It
// draws nothing then rather than throwing, groups and group editing included.
test('the factories page draws nothing while no calculated plan is open', async () => {
  const el = document.createElement('div');
  const errors: unknown[] = [];
  open({ state: { factoryGroups: structuredClone(GROUPS) } });
  closePlan();
  setFactoryEditing(true);
  const app = createApp({ render: () => h(CalculatedFactoriesPage) });
  app.config.errorHandler = error => void errors.push(error);
  app.mount(el);
  await nextTick();
  assert.deepEqual(errors, [], 'it draws without an error');
  assert.equal(el.querySelector('.toolbar, .cards'), null, 'it draws no factories');
  app.unmount();
});

// A plan with a guide (#393, #468; a migrated handbook profile) draws the rows it places at a
// shared site together, as the handbook drew its oil campus and nuclear site, marks a local row,
// shows a row's printed page and note in its dialog, and in Post Phase 5 adds its completion
// modules ticking completion-<id>. Names and notes are text.
test("a guided plan's sites, local badges, notes and completion modules on the factories page", async () => {
  const rows = plan.stages['3'].rows!;
  const [oil1, oil2, local] = [rows[0]!, rows[1]!, rows[2]!];
  const guided = {
    ...structuredClone(plan),
    guide: {
      phases: {},
      factories: {
        [oil1.id]: { site: 'oil' as const },
        [oil2.id]: { site: 'oil' as const },
        [local.id]: { local: true, page: 54, note: evil },
      },
      completion: [
        {
          id: 'thermal',
          name: evil,
          recipe: 'Thermal Propulsion Rocket',
          output: 2,
          machines: 4,
          machine: 'Manufacturer',
          lastClock: 50,
          inputs: { 'Modular Engine': 5 },
          byproducts: {},
        },
      ],
    },
  };
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  open({ calculated: guided, phase: '3' });
  go('factories');
  render();
  await nextTick();
  noMarkup();
  const site = $('#main #section-site-oil')!;
  assert.ok(site, 'the oil campus');
  assert.equal(site.querySelector('h2')!.textContent, 'Oil campus');
  assert.match(site.querySelector('.eyebrow')!.textContent!, /SHARED SITE · 2 OUTPUTS/);
  assert.deepEqual(
    [...site.querySelectorAll<HTMLElement>('.factory-card button.name')].map(
      button => button.dataset.calcFactory,
    ),
    [oil1.id, oil2.id],
  );
  assert.equal($('#main #section-site-nuclear'), null, 'no site the guide leaves empty');
  assert.ok($('#main .jump-bar [data-jump="site-oil"]'), 'the jump bar lists the site');
  const card = $(`#main button.name[data-calc-factory="${local.id}"]`)!.closest('.factory-card')!;
  assert.equal(card.querySelector('[data-local]')!.textContent, 'Local');
  assert.equal($$('#main [data-local]').length, 1, 'only the local row is marked');
  openCalculatedFactory(local.id);
  await nextTick();
  assert.match($('#detail .dialog-head .eyebrow')!.textContent!, /^Phase 3 · Printed page 54$/);
  assert.equal($('#detail [data-guide-note]')!.textContent, evil);
  noMarkup();
  void closeDetail();
  await settle();
  // Post Phase 5: the completion modules, ticking their own ids.
  open({ calculated: guided, phase: 'post' });
  go('factories');
  render();
  await nextTick();
  noMarkup();
  const box = $<HTMLInputElement>('#main [data-check="completion-thermal"]')!;
  assert.ok(box.closest('.completion-item')!.textContent!.includes(evil));
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'check', key: 'completion-thermal', value: true });
  // Without a guide nothing of it shows.
  open({ calculated: plan, phase: 'post' });
  go('factories');
  render();
  await nextTick();
  assert.equal($('#main .site-group'), null);
  assert.equal($('#main .completion-grid'), null);
  assert.equal($('#main [data-local]'), null);
});

// Two more handbook behaviours for a guided plan (#478): a row the guide builds at the nuclear
// site gets the handbook's nuclear-site notice in its dialog, and a guide that builds any row
// locally adds the Local chip, which keeps just those rows. Without such a guide neither shows.
test('a guided plan: the nuclear-site notice in a dialog, and the Local chip', async () => {
  const rows = plan.stages['3'].rows!;
  const [nuclear, local] = [rows[0]!, rows[1]!];
  const guided = {
    ...structuredClone(plan),
    guide: {
      phases: {},
      factories: { [nuclear.id]: { nuclear: true }, [local.id]: { local: true } },
    },
  };
  open({ calculated: guided, phase: '3' });
  go('factories');
  render();
  await nextTick();
  const chips = () => $$('#main [data-filter]').map(chip => chip.dataset.filter);
  assert.deepEqual(chips(), ['all', 'todo', 'done', 'local', 'held']);
  $('#main [data-filter="local"]')!.click();
  await nextTick();
  assert.deepEqual(
    $$('#main .factory-card button.name').map(button => button.dataset.calcFactory),
    [local.id],
    'Local keeps only the rows the guide builds locally',
  );
  $('#main [data-filter="all"]')!.click();
  await nextTick();
  openCalculatedFactory(nuclear.id);
  await nextTick();
  assert.match(
    $('#detail [data-guide-nuclear]')!.textContent!.replace(/\s+/g, ' ').trim(),
    /^Process buffer at the nuclear site\. Keep radioactive recycling flows balanced; do not apply a generic storage surplus\.$/,
  );
  void closeDetail();
  await settle();
  openCalculatedFactory(local.id);
  await nextTick();
  assert.equal($('#detail [data-guide-nuclear]'), null, 'only on the nuclear row');
  void closeDetail();
  await settle();
  // Without a guide: the calculated chips as before, and no notice.
  open({ calculated: plan, phase: '3' });
  go('factories');
  render();
  await nextTick();
  assert.deepEqual(chips(), ['all', 'todo', 'done', 'held']);
  openCalculatedFactory(nuclear.id);
  await nextTick();
  assert.equal($('#detail [data-guide-nuclear]'), null);
  void closeDetail();
  await settle();
});

// A transcribed handbook (engine 'handbook-…', #486) warns before round-up and Recalculate with
// transport fuel solve it afresh (decision 7B on #387, #480); any other plan does not.
test('round-up and Recalculate with transport fuel warn first on a transcribed plan (#480)', async () => {
  for (const engine of ['handbook-2026-09-13', plan.engine]) {
    const profilePlan = { ...structuredClone(plan), engine };
    profilePlan.settings.wholeMachines = false;
    open({ calculated: profilePlan });
    go('factories');
    render();
    await nextTick();
    const asked = answerConfirms(false);
    $<HTMLButtonElement>('[data-round-up]')!.click();
    await nextTick();
    await nextTick();
    assert.equal(asked.length, 1, engine);
    assert.equal(asked[0]!.includes(RESOLVE_WARNING), engine.startsWith('handbook-'), engine);
    // Recalculate with transport fuel says it beside its button.
    const rows = profilePlan.stages['3'].rows!;
    open({
      calculated: profilePlan,
      workspace: { catalog: catalog() },
      state: {
        version: 7,
        factoryGroups: {
          groups: [
            { id: 'fg-smelt1', name: 'Smelting' },
            { id: 'fg-parts1', name: 'Parts' },
          ],
          assignments: Object.fromEntries(
            rows.map((r, i) => [r.id, [{ group: i % 2 ? 'fg-parts1' : 'fg-smelt1', rate: null }]]),
          ),
          links: {
            'fg-smelt1:fg-parts1': {
              mode: 'truck' as const,
              roundTripMin: 6,
              fuel: 'Packaged Fuel',
            },
          },
        },
      },
    });
    go('logistics');
    render();
    await nextTick();
    assert.ok($('[data-recalc-transport]'), engine);
    assert.equal(
      $('[data-transport-fuel-note] [data-resolve-warning]')?.textContent ?? null,
      engine.startsWith('handbook-') ? RESOLVE_WARNING : null,
      engine,
    );
  }
});
