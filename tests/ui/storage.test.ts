// The storage room (public/app/ui/pages/StoragePage.vue, with its parts in
// public/app/ui/storage/) and the container dialog (public/app/ui/detail/SlotDialog.vue),
// mounted the way the app mounts them, in happy-dom.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import type { DragDropManager } from '@dnd-kit/vue';
import { beforeEach, test } from 'vitest';
import { bayCapacity } from '../../public/state.ts';
import { floor, setFloor, setLayoutEditing, setQuery, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { containerMove, openSlot, slotKeys, storageBays } from '../../public/app/views/storage.ts';
import { moveContainer } from '../../public/app/ui/actions.ts';
import { inView, landsOnTarget, pointerOnly } from '../../public/app/ui/storage/drop-point.ts';
import {
  answerConfirms,
  $,
  $$,
  applyUpdate,
  evil,
  generated,
  go,
  handbook,
  open,
  page,
  stubFetch,
} from './setup.ts';
import type { StorageEdits, UpdateOp } from '../../public/types/index.ts';

const noMarkup = () =>
  assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');
const settle = async () => {
  await new Promise(r => setTimeout(r, 20));
  await nextTick();
};
const letters = () => $$('#main .bay-letter').map(e => e.textContent);
const EDITS = {
  floors: [{ id: 'cf-abcd12', label: 'Basement' }],
  floorNames: { ground: 'Main hall' },
  bays: [{ id: 'S', name: 'Overflow', floor: 'cf-abcd12' }],
  bayNames: { A: 'Renamed ingots' },
  slots: { S01: evil },
  clearedSlots: ['A01'],
  hiddenBays: [],
  hiddenFloors: [],
};
// Layout edits with only the given fields, as a test sets them up; the page reads the others
// as absent.
const someEdits = (edits: Partial<StorageEdits>) => edits as StorageEdits;
// The fields of the layout ops this file reads from an /api/update body.
type LayoutOp = { type: UpdateOp['type'] } & Partial<
  Omit<Extract<UpdateOp, { type: 'storageFloorAdd' }>, 'type'>
>;

beforeEach(() => {
  page();
  open();
  setQuery('');
  setFloor('ground');
  setLayoutEditing(false);
  answerConfirms(true);
  go('storage');
});

test('the handbook room shows its printed bays, notice and checklist', () => {
  render();
  assert.equal($('#main h1')!.textContent, 'Storage room');
  assert.ok($('[data-slot="A01"]'), 'a state without storageEdits shows the handbook layout');
  assert.match($('#main .notice.info')!.textContent, /Ground floor is built\./);
  assert.deepEqual(
    $$('.tabs .tab').map(t => t.textContent.trim()),
    ['Ground floor', 'Upper floor', 'Workshop'],
  );
  assert.ok($('.tabs .tab.active')!.dataset.floor === 'ground');
  assert.equal(
    $$('#main section:last-child .checklist [data-check]').length,
    handbook.storageTasks.length,
  );
});

test('bays stay in address order in the document and take their hall position from the grid', () => {
  render();
  const order = letters();
  assert.ok(order.length > 2 && order.length % 2 === 0, 'whole rows of bays');
  assert.deepEqual(order, [...order].sort(), 'a single narrow column reads alphabetically');
  const at = Object.fromEntries(
    $$('#main .bay').map(b => {
      const style = b.getAttribute('style')!;
      return [
        b.querySelector('.bay-letter')!.textContent,
        [
          Number(style.match(/--bay-row: ?(\d+)/)![1]),
          Number(style.match(/--bay-col: ?(\d+)/)![1]),
        ],
      ];
    }),
  );
  assert.deepEqual(at.A, [order.length / 2, 1], 'A stays at the entrance, left of the aisle');
  assert.deepEqual(at.B, [order.length / 2, 3], 'B stays at the entrance, right of the aisle');
  assert.deepEqual(at[order.at(-2)!], [1, 1], 'the last pair stays at the rear of the hall');
  assert.equal($$('#main .aisle').length, order.length / 2, 'every row keeps its aisle');
  assert.equal($('#main .eyebrow.floor-marker')!.textContent, 'REAR OF HALL ↑');
});

test('layout edits show custom floors, bays and assignments, escaped', async () => {
  open({ state: { storageEdits: structuredClone(EDITS) } });
  render();
  noMarkup();
  assert.ok($$('#main h3').some(h => h.textContent === 'Renamed ingots'));
  assert.deepEqual(
    $$('.tabs .tab').map(t => t.textContent.trim()),
    ['Main hall', 'Upper floor', 'Workshop', 'Basement'],
  );
  assert.equal($('[data-slot="A01"]'), null, 'a cleared container shows as reserved');
  $('[data-floor="cf-abcd12"]')!.click();
  await nextTick();
  assert.equal(floor, 'cf-abcd12');
  assert.equal($('[data-slot="S01"] span')!.textContent, evil);
  noMarkup();
  $('[data-toggle-layout]')!.click();
  await nextTick();
  assert.ok($('[data-remove-bay="S"]'), 'an added bay can be removed');
  assert.equal($<HTMLInputElement>('[data-bay-rename="S"]')!.value, 'Overflow');
  assert.ok($('.add-container[data-bay="S"]'));
  assert.equal(
    $<HTMLButtonElement>('[data-remove-floor="cf-abcd12"]')!.disabled,
    true,
    'not while it has bays',
  );
  assert.equal($('[data-remove-floor="cf-abcd12"]')!.textContent.trim(), 'Remove its bays first');
  assert.ok(
    $('[data-remove-floor="cf-abcd12"]')!.classList.contains('unavailable'),
    'no wait cursor',
  );
  assert.equal(
    $('[data-clear-slot="S01"]')!.getAttribute('aria-label'),
    `Clear container S01: ${evil}`,
  );
});

test('a bay grows past eight containers and keeps offering the next address', async () => {
  open({ state: { storageEdits: someEdits({ slots: { A10: 'Aluminum Casing' } }) } });
  setLayoutEditing(true);
  render();
  const bay = $$('#main .bay').find(b => b.querySelector('.bay-letter')!.textContent === 'A')!;
  assert.ok(bay.querySelector('[data-slot="A08"]'));
  assert.equal(bay.querySelector('.slot.empty')!.textContent.replace(/\s+/g, ''), 'A09Reserved');
  assert.ok(bay.querySelector('[data-slot="A10"]'));
  assert.ok(bay.querySelector('.walkway.added'));
  assert.equal(bay.querySelector('[data-slot="A11"]'), null);
  assert.match(
    bay.querySelector<HTMLInputElement>('.add-container input')!.placeholder,
    /Add container/,
  );
  open({
    state: {
      storageEdits: someEdits({
        slots: Object.fromEntries(
          Array.from({ length: bayCapacity - 8 }, (_, i) => ['A' + (i + 9), 'Item ' + i]),
        ),
      }),
    },
  });
  render();
  await nextTick();
  assert.ok($(`[data-slot="A${bayCapacity}"]`), 'a bay reaches the last addressable position');
  assert.equal($('.add-container[data-bay="A"]'), null, 'and then stops offering one');
});

const search = async (value: string) => {
  $<HTMLInputElement>('#storage-search')!.value = value;
  $('#storage-search')!.dispatchEvent(new Event('input'));
  await nextTick();
};
const results = () =>
  $$('#main [data-find-slot]').map(b => b.textContent.replace(/\s+/g, ' ').trim());

test('the search narrows the floor to matching bays and marks the matches', async () => {
  render();
  await search('A01');
  assert.deepEqual(letters(), ['A']);
  assert.ok($('[data-slot="A01"]')!.closest('.slot')!.classList.contains('match'));
  assert.match($('#main p.small.muted')!.textContent, /Filtered view/);
});

test('the search lists matching containers on every floor, with floor and address (#240)', async () => {
  render();
  assert.equal($('[data-search-results]'), null, 'no results list without a query');
  assert.equal($('[data-search-status]')!.textContent, '', 'the live region is there, and empty');
  await search('wir');
  assert.deepEqual(results(), [
    'Wire · Ground floor · C01',
    'Quickwire · Ground floor · C04',
    'Automated Wiring · Upper floor · K03',
  ]);
  assert.equal($('[data-search-status]')!.getAttribute('role'), 'status');
  assert.equal($('[data-search-status]')!.textContent, '3 containers match wir, on 2 floors');
  assert.ok(
    $$('#main [data-find-slot]').every(b => b.tagName === 'BUTTON' && b.closest('li')),
    'each result is a button in a list',
  );
  assert.ok($('[data-find-slot="K03"] img.item-icon'), 'with the item icon');
  // Only this floor's bays with a match are drawn.
  assert.deepEqual(letters(), ['C']);
});

test('a result switches to its floor, keeps the match marked and focuses the container (#240)', async () => {
  render();
  await search('wir');
  const result = $<HTMLButtonElement>('[data-find-slot="K03"]')!;
  result.focus();
  result.click();
  await settle();
  assert.equal(floor, 'upper');
  assert.equal($('.tabs .tab.active')!.dataset.floor, 'upper');
  assert.equal($<HTMLInputElement>('#storage-search')!.value, 'wir', 'the query stays');
  assert.equal(document.activeElement, $('#main [data-slot="K03"]'));
  assert.ok($('[data-slot="K03"]')!.closest('.slot')!.classList.contains('match'));
  // A result on the floor already shown focuses its container too.
  $<HTMLButtonElement>('[data-find-slot="K03"]')!.focus();
  $<HTMLButtonElement>('[data-find-slot="K03"]')!.click();
  await settle();
  assert.equal(document.activeElement, $('#main [data-slot="K03"]'));
  // This floor has nothing else to show for another match: the grid says where to look.
  $<HTMLButtonElement>('[data-find-slot="C04"]')!.click();
  await settle();
  assert.equal(floor, 'ground');
  assert.equal(document.activeElement, $('#main [data-slot="C04"]'));
});

test('switching floors keeps the query, and a floor without a match says so (#240)', async () => {
  render();
  await search('Quickwire');
  $('[data-floor="upper"]')!.click();
  await nextTick();
  assert.equal($<HTMLInputElement>('#storage-search')!.value, 'Quickwire');
  assert.deepEqual(results(), ['Quickwire · Ground floor · C04'], 'the results stay');
  assert.deepEqual(letters(), []);
  assert.equal(
    $('#main .floor-grid .empty-state')!.textContent.trim(),
    'Nothing on this floor matches. The results above are on other floors.',
  );
});

test('a search nothing holds shows one empty state (#240)', async () => {
  render();
  await search('no-such-item');
  assert.equal($('[data-search-empty]')!.textContent, 'No container holds no-such-item');
  assert.equal($('[data-search-status]')!.textContent, 'No container holds no-such-item');
  assert.equal($$('#main .empty-state').length, 1, 'the grid adds no second message');
  assert.equal($('#main [data-find-slot]'), null);
});

test('the search leaves out hidden bays, and lists at most 24 results (#240)', async () => {
  open({ state: { storageEdits: someEdits({ hiddenBays: ['C'] }) } });
  render();
  await search('wir');
  assert.deepEqual(results(), ['Automated Wiring · Upper floor · K03']);
  await search('e');
  assert.equal($$('#main [data-find-slot]').length, 24);
  assert.match($('[data-search-results] p.small')!.textContent, /Showing the first 24 of \d+\./);
});

test('a result in an added bay on an added floor is escaped and leads there (#240)', async () => {
  open({ state: { storageEdits: structuredClone(EDITS) } });
  render();
  await search('x-evil');
  noMarkup();
  assert.deepEqual(results(), [`${evil} · Basement · S01`]);
  $<HTMLButtonElement>('[data-find-slot="S01"]')!.click();
  await settle();
  noMarkup();
  assert.equal(floor, 'cf-abcd12');
  assert.equal(document.activeElement, $('#main [data-slot="S01"]'));
});

test('Done and "Complete room" write the four checks of each container', async () => {
  const calls = stubFetch({ '/api/update': () => state });
  render();
  const done = $<HTMLInputElement>('[data-complete-slot="A02"]')!;
  done.checked = true;
  done.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(calls[0]![1], { type: 'checks', keys: slotKeys('A02'), value: true });
  const bay = $$('#main .bay').find(b => b.querySelector('.bay-letter')!.textContent === 'A')!;
  bay.querySelector<HTMLButtonElement>('[data-complete-bay]')!.click();
  await settle();
  const named = [...bay.querySelectorAll<HTMLElement>('[data-slot]')].map(b => b.dataset.slot!);
  assert.deepEqual(calls[1]![1], {
    type: 'checks',
    keys: named.flatMap(slotKeys),
    value: true,
  });
  assert.match($('#toast')!.textContent, /Room A completed/);
  // A saved room shows its containers done and its button disabled.
  for (const k of named.flatMap(slotKeys)) state.checks[k] = true;
  render();
  await nextTick();
  const complete = bay.querySelector<HTMLButtonElement>('[data-complete-bay]')!;
  assert.equal(complete.disabled, true);
  // Nothing is saving, so it is marked .unavailable (no wait cursor) and says it is done.
  assert.ok(complete.classList.contains('unavailable'));
  assert.equal(complete.textContent.trim(), 'Room A completed ✓');
  assert.equal(
    bay.querySelector('.bay-actions .muted')!.textContent,
    `${named.length}/${named.length} containers done`,
  );
});

test('a failed Done save unticks the box again', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'Disk full' }), { status: 500 });
  render();
  const done = $<HTMLInputElement>('[data-complete-slot="A02"]')!;
  done.checked = true;
  done.dispatchEvent(new Event('change'));
  await settle();
  assert.equal(done.checked, false);
  assert.equal($('#toast')!.textContent, 'Disk full');
});

test('the layout editor saves floors, bays, containers and removals', async () => {
  const calls = stubFetch<LayoutOp>({ '/api/update': () => state });
  open({ state: { storageEdits: structuredClone(EDITS) } });
  setLayoutEditing(true);
  render();
  const submit = (form: HTMLElement, value: string) => {
    form.querySelector<HTMLInputElement>('input[name=name]')!.value = value;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
  };
  submit($('#add-bay')!, 'New bay');
  await settle();
  assert.deepEqual(calls.at(-1)![1], {
    type: 'storageBayAdd',
    id: 'T',
    name: 'New bay',
    floor: 'ground',
  });
  assert.equal(
    $<HTMLInputElement>('#add-bay [name=name]')!.value,
    '',
    'the form empties after adding',
  );
  submit($('#add-floor')!, 'Attic');
  await settle();
  assert.equal(calls.at(-1)![1].type, 'storageFloorAdd');
  assert.match(calls.at(-1)![1].id!, /^cf-[0-9a-f]{12}$/);
  submit($('#rename-floor')!, 'Great hall');
  await settle();
  assert.deepEqual(calls.at(-1)![1], {
    type: 'storageFloorRename',
    id: 'ground',
    label: 'Great hall',
  });
  submit($('.add-container[data-bay="A"]')!, 'Iron Plate');
  await settle();
  assert.deepEqual(
    calls.at(-1)![1],
    { type: 'storageSlotAssign', key: 'A01', name: 'Iron Plate' },
    'the cleared position is filled first',
  );
  const rename = $<HTMLInputElement>('[data-bay-rename="A"]')!;
  rename.value = 'Ingots';
  rename.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'storageBayRename', id: 'A', name: 'Ingots' });
  $('[data-clear-slot="A02"]')!.click();
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'storageSlotClear', key: 'A02' });
  assert.match($('#toast')!.textContent, /saved checkmarks are kept/);
  $('[data-floor="cf-abcd12"]')!.click();
  await nextTick();
  $('[data-remove-bay="S"]')!.click();
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'storageBayRemove', id: 'S' });
  // With its bay gone the floor can be removed, which returns to the ground floor.
  state.storageEdits.bays = [];
  render();
  await nextTick();
  $('[data-remove-floor="cf-abcd12"]')!.click();
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'storageFloorRemove', id: 'cf-abcd12' });
  assert.equal(floor, 'ground');
  answerConfirms(false);
  const before = calls.length;
  $('[data-floor="ground"]')!.click();
  await nextTick();
  state.storageEdits.bays = [{ id: 'S', name: 'Overflow', floor: 'ground' }];
  render();
  await nextTick();
  $('[data-remove-bay="S"]')!.click();
  await settle();
  assert.equal(calls.length, before, 'a declined confirmation removes nothing');
});

test('the workshop floor shows its checklist and no bays', async () => {
  render();
  $('[data-floor="workshop"]')!.click();
  await nextTick();
  assert.match($('#main .panel h2')!.textContent, /Workshop beneath Q\/R/);
  assert.deepEqual(
    $$('#main .panel [data-check]').map(b => b.dataset.check),
    ['workshop-bench', 'workshop-tools', 'workshop-weapons', 'workshop-mam'],
  );
  assert.equal($('#main .empty-state'), null, 'no empty-floor message on the workshop');
});

test('a copied original profile keeps the built ground-floor notice', () => {
  open({ profileId: 'copy-of-original' });
  render();
  assert.match($('#main .notice.info')!.textContent, /Ground floor is built\./);
});

test('a calculated profile shows only the items it stores, and its one checklist step', () => {
  open({ calculated: generated() });
  render();
  assert.ok($$('#main .slot-details span').some(s => s.textContent === 'Iron Plate'));
  assert.equal($('[data-slot="G01"]'), null);
  assert.match($('#main .notice.info')!.textContent, /Optional storage template/);
  assert.deepEqual(
    $$('#main section:last-child [data-check]').map(b => b.dataset.check),
    ['calc-storage-layout'],
  );
});

test('the container dialog shows its place, checks, factory link and note', async () => {
  open({ state: { notes: { 'slot-A02': evil }, checks: { 'slot-A02-built': true } } });
  render();
  $('[data-slot="A02"]')!.click();
  assert.ok($<HTMLDialogElement>('#detail')!.open);
  noMarkup();
  const name = $('[data-slot="A02"] span')!.textContent;
  assert.equal($('#detail h2')!.textContent, name);
  assert.match($('#detail .eyebrow')!.textContent, /^A02 · Ground floor · Bay A$/);
  assert.match($('#detail .dialog-body p')!.textContent, /Rear bank, position 2 from the left/);
  assert.deepEqual(
    $$<HTMLInputElement>('#detail .check-columns input').map(i => [i.dataset.check, i.checked]),
    [
      ['slot-A02-built', true],
      ['slot-A02-labelled', false],
      ['slot-A02-connected', false],
      ['slot-A02-verified', false],
    ],
  );
  assert.ok($('#detail .detail-actions [data-factory]'), 'the item links to its factory');
  assert.equal($<HTMLTextAreaElement>('#detail-note')!.value, evil);
  assert.equal($('#detail-note')!.getAttribute('aria-label'), 'Container notes');
  assert.equal($('#detail [data-save-note]')!.dataset.saveNote, 'slot-A02');
  openSlot('A01');
  assert.equal($('#detail h2')!.textContent, $('[data-slot="A01"] span')!.textContent);
});

test('a reserved position opens no dialog', () => {
  open({ state: { storageEdits: someEdits({ clearedSlots: ['A01'] }) } });
  render();
  openSlot('A01');
  assert.equal($<HTMLDialogElement>('#detail')!.open, false);
});

// The save indicator redraws the bay before the click handler resumes; the button must stay
// as that redraw leaves it (browser-check.ts waits for exactly this).
test('"Complete room" stays disabled once the saved room is complete', async () => {
  stubFetch({
    '/api/update': (body: Extract<UpdateOp, { type: 'checks' }>) => ({
      ...state,
      checks: { ...state.checks, ...Object.fromEntries(body.keys.map(k => [k, true])) },
    }),
  });
  render();
  const button = $('[data-complete-bay="A"]')!;
  button.click();
  await settle();
  assert.equal($<HTMLButtonElement>('[data-complete-bay="A"]')!.disabled, true);
});

test('a handbook bay can be hidden in edit mode and restored, and its items are listed meanwhile', async () => {
  // The update stand-in applies the operation the way the server does.
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  open({ state: { checks: { 'slot-C01-built': true } } });
  setLayoutEditing(true);
  render();
  const items = handbook.storage.find(b => b.id === 'C')!.items.filter(x => x.name);
  assert.ok($('[data-slot="C01"]'), 'bay C is in the room');
  assert.equal($('[data-hide-bay="S"]'), null, 'only handbook bays offer Hide');
  $('[data-hide-bay="C"]')!.click();
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'storageBayHide', id: 'C' });
  assert.equal($('[data-slot="C01"]'), null, 'bay C left the room');
  assert.match($('[data-unplaced]')!.textContent!, new RegExp(items[0]!.name!));
  assert.match($('[data-hidden-bays]')!.textContent!, /C · /);
  assert.equal(state.checks['slot-C01-built'], true, 'its checkmark is kept');
  // Out of edit mode the notice stays; the Restore panel is only in edit mode.
  setLayoutEditing(false);
  render();
  await nextTick();
  assert.ok($('[data-unplaced]'));
  assert.equal($('[data-hidden-bays]'), null);
  setLayoutEditing(true);
  render();
  await nextTick();
  $('[data-restore-bay="C"]')!.click();
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'storageBayRestore', id: 'C' });
  assert.ok($('[data-slot="C01"]'), 'bay C is back');
  assert.equal($('[data-unplaced]'), null);
  noMarkup();
});

test('a reserved position keeps a filled card’s shape, with inert stand-ins (#200)', () => {
  // A01 cleared: a reserved position in the handbook room.
  open({ state: { storageEdits: someEdits({ clearedSlots: ['A01'] }) } });
  render();
  const reserved = $$('.bay-items .slot.empty').find(
    s => s.querySelector('strong')!.textContent === 'A01',
  )!;
  assert.ok(reserved, 'A01 is reserved');
  // The same parts as a filled card, so the row keeps its height.
  assert.ok(reserved.querySelector('.slot-icon-space'), 'the icon’s space is kept');
  assert.equal(reserved.querySelector('.slot-reserved')!.textContent, 'Reserved');
  const done = reserved.querySelector<HTMLElement>('.slot-space')!;
  assert.equal(done.getAttribute('aria-hidden'), 'true');
  const box = done.querySelector<HTMLInputElement>('input')!;
  assert.equal(box.disabled, true);
  assert.equal(box.tabIndex, -1);
  assert.equal(box.dataset.completeSlot, undefined, 'not a control the page counts or saves');
  noMarkup();
});

test('an empty built-in floor can be hidden and restored from the layout editor (#168)', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  open();
  setLayoutEditing(true);
  // The ground floor still has its bays: hiding waits until they are gone.
  render();
  assert.equal($<HTMLButtonElement>('[data-hide-floor="ground"]')!.disabled, true);
  assert.match($('[data-hide-floor="ground"]')!.textContent!, /Hide or remove its bays first/);
  setFloor('workshop');
  render();
  await nextTick();
  $('[data-hide-floor="workshop"]')!.click();
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'storageFloorHide', id: 'workshop' });
  assert.ok(
    !$$('.tabs .tab').some(t => t.dataset.floor === 'workshop'),
    'the workshop tab is gone',
  );
  assert.notEqual(floor, 'workshop', 'the page moved to a floor that is still there');
  assert.match($('[data-hidden-bays]')!.textContent!, /Workshop · floor/);
  $('[data-restore-floor="workshop"]')!.click();
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'storageFloorRestore', id: 'workshop' });
  assert.ok(
    $$('.tabs .tab').some(t => t.dataset.floor === 'workshop'),
    'the tab is back',
  );
  assert.equal($('[data-hidden-bays]'), null);
});

test('an added bay takes the letter typed, and a hidden handbook letter only after a yes (#167)', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  open({ state: { checks: { 'slot-C01-built': true } } });
  setLayoutEditing(true);
  render();
  const add = async (letter: string, name: string) => {
    $<HTMLInputElement>('#new-bay-letter')!.value = letter;
    $<HTMLInputElement>('#new-bay-name')!.value = name;
    $('#add-bay')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
  };
  assert.equal(
    $<HTMLInputElement>('#new-bay-letter')!.value,
    'S',
    'the next free letter is filled in',
  );
  // A letter already in the room is refused before anything is sent.
  const before = calls.length;
  await add('c', 'Clash');
  assert.equal(calls.length, before);
  assert.match($('#toast')!.textContent!, /Bay C is already in the room/);
  // Hide C, then take its letter: asked first; "No" sends nothing, "Yes" replaces it.
  $('[data-hide-bay="C"]')!.click();
  await settle();
  const asked = answerConfirms(false);
  await add('C', 'My parts');
  assert.equal(asked.length, 1);
  assert.match(asked[0]!, /Bay C still has saved progress/);
  assert.equal(state.storageEdits.bays.length, 0, 'no bay was added');
  answerConfirms(true);
  await add('C', 'My parts');
  assert.deepEqual(calls.at(-1)![1], {
    type: 'storageBayAdd',
    id: 'C',
    name: 'My parts',
    floor: 'ground',
    replace: true,
  });
  assert.equal(state.checks['slot-C01-built'], undefined, 'the handbook bay’s records are cleared');
  assert.ok($('[data-remove-bay="C"]'), 'the added bay C is in the room');
  // The hidden handbook bay now says why it cannot be restored.
  assert.match($('[data-hidden-bays]')!.textContent!, /An added bay uses this letter/);
  assert.equal($('[data-restore-bay="C"]'), null);
  noMarkup();
});

test('a handbook bay sharing its letter with an added bay stored before #91 offers no Hide', () => {
  open({
    state: {
      storageEdits: someEdits({ bays: [{ id: 'C', name: 'Old added C', floor: 'ground' }] }),
    },
  });
  setLayoutEditing(true);
  render();
  assert.equal($('[data-hide-bay="C"]'), null, 'remove the added bay first');
  assert.ok($('[data-hide-bay="D"]'), 'other handbook bays still offer Hide');
});

test('a bay moves to another floor from edit mode, with its records, and the built room says so (#190)', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  open({ state: { version: 1, checks: { 'slot-D01-built': true } } });
  render();
  assert.equal($('[data-move-bay]'), null, 'only while editing the layout');
  setLayoutEditing(true);
  render();
  await nextTick();
  const menu = $<HTMLSelectElement>('[data-move-bay="D"]')!;
  assert.deepEqual(
    [...menu.options].map(o => o.value),
    ['', 'upper', 'workshop'],
    'every other floor in the tabs',
  );
  menu.value = 'upper';
  menu.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(calls.at(-1)![1], { type: 'storageBayMove', id: 'D', floor: 'upper' });
  assert.equal($('[data-slot="D01"]'), null, 'bay D left the ground floor');
  assert.match($('#toast')!.textContent!, /Bay D moved to Upper floor/);
  assert.match($('[data-moved-off]')!.textContent!, /bay D to Upper floor/);
  setFloor('upper');
  render();
  await nextTick();
  assert.ok($('[data-slot="D01"]'), 'and arrived upstairs');
  assert.equal(state.checks['slot-D01-built'], true, 'its checkmark came along');
  noMarkup();
});

test('a hidden bay moved onto a floor keeps it from going, and the button says which (#216)', async () => {
  stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  // D moved to an added floor and J to the workshop, both then hidden: neither floor shows a bay.
  open({
    state: {
      storageEdits: someEdits({
        floors: [{ id: 'cf-abcd', label: 'Annex' }],
        bayFloors: { D: 'cf-abcd', J: 'workshop' },
        hiddenBays: ['D', 'J'],
      }),
    },
  });
  setLayoutEditing(true);
  setFloor('cf-abcd');
  render();
  await nextTick();
  assert.equal($$('.bay').length, 0, 'the annex shows no bay');
  const remove = $<HTMLButtonElement>('[data-remove-floor="cf-abcd"]')!;
  assert.equal(remove.disabled, true);
  assert.match(remove.textContent!, /Restore and move hidden bay D first/);
  setFloor('workshop');
  render();
  await nextTick();
  const hide = $<HTMLButtonElement>('[data-hide-floor="workshop"]')!;
  assert.equal(hide.disabled, true);
  assert.match(hide.textContent!, /Restore and move hidden bay J first/);
  // Restored, J shows on the workshop, so the button asks for the usual instead.
  $('[data-restore-bay="J"]')!.click();
  await settle();
  assert.ok($('[data-slot="J01"]'), 'J is back, on the floor it was moved to');
  assert.match($('[data-hide-floor="workshop"]')!.textContent!, /Hide or remove its bays first/);
  noMarkup();
});

test('the update stand-in applies an op like the server: a refused one leaves the page state alone (#214)', () => {
  open({ state: { checks: { 'slot-C01-built': true } } });
  const before = structuredClone(state);
  // Only handbook bays can be hidden, and only a valid state is accepted.
  assert.throws(
    () => applyUpdate({ type: 'storageBayHide', id: 'S' }),
    /Invalid hidden bay|handbook/,
  );
  assert.throws(
    () => applyUpdate({ type: 'check', key: 'x', value: 'yes' as unknown as boolean }),
    /Invalid checks value/,
  );
  assert.deepEqual(state, before, 'nothing on the page changed');
  // An accepted one returns the new state and still leaves the page's until save() takes it.
  const next = applyUpdate({ type: 'storageBayHide', id: 'C' });
  assert.deepEqual(next.storageEdits.hiddenBays, ['C']);
  assert.equal(next.version, 5);
  assert.deepEqual(state, before);
});

test('bays move left and right on their floor in edit mode, and the hall pairs them in that order (#191)', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  open({ state: { version: 1, checks: { 'slot-A01-built': true } } });
  render();
  await nextTick();
  const place = (id: string) => {
    const bay = $(`[data-slot="${id}01"]`)!.closest<HTMLElement>('.bay')!.style;
    return ['--bay-row', '--bay-col'].map(p => bay.getPropertyValue(p).trim());
  };
  // The handbook's pairing: A and B share the row by the entrance, G and H the rear one.
  assert.deepEqual(letters(), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  assert.deepEqual(place('A'), ['4', '1']);
  assert.deepEqual(place('H'), ['1', '3']);
  assert.equal($('[data-bay-left]'), null, 'only while editing the layout');
  setLayoutEditing(true);
  render();
  await nextTick();
  assert.equal($<HTMLButtonElement>('[data-bay-left="A"]')!.disabled, true, 'A is first');
  assert.equal($<HTMLButtonElement>('[data-bay-right="H"]')!.disabled, true, 'H is last');
  assert.equal($('[data-bay-left="A"]')!.getAttribute('aria-label'), 'Move bay A left');
  $('[data-bay-right="A"]')!.click();
  await settle();
  assert.deepEqual(calls.at(-1)![1], {
    type: 'storageBayOrder',
    floor: 'ground',
    order: ['B', 'A', 'C', 'D', 'E', 'F', 'G', 'H'],
  });
  assert.equal(state.version, 10);
  assert.deepEqual(letters(), ['B', 'A', 'C', 'D', 'E', 'F', 'G', 'H']);
  assert.deepEqual(place('B'), ['4', '1']);
  assert.deepEqual(place('A'), ['4', '3']);
  assert.equal(state.checks['slot-A01-built'], true, 'its progress stays with the bay');
  // Moving right from the right-hand side goes to the next row back.
  $('[data-bay-right="A"]')!.click();
  await settle();
  assert.deepEqual(letters(), ['B', 'C', 'A', 'D', 'E', 'F', 'G', 'H']);
  assert.deepEqual(place('A'), ['3', '1']);
  // A bay moved onto the floor takes its default place: last here, alone at the back.
  const menu = () => $<HTMLSelectElement>('[data-move-bay="I"]')!;
  setFloor('upper');
  render();
  await nextTick();
  menu().value = 'ground';
  menu().dispatchEvent(new Event('change'));
  await settle();
  setFloor('ground');
  render();
  await nextTick();
  assert.deepEqual(letters(), ['B', 'C', 'A', 'D', 'E', 'F', 'G', 'H', 'I']);
  assert.deepEqual(place('I'), ['1', '1']);
  assert.equal($$('.aisle').length, 5, 'an aisle beside every row');
  // The search keeps the order.
  setQuery('A0');
  render();
  await nextTick();
  assert.equal(letters().indexOf('C') < letters().indexOf('A'), true);
  setQuery('');
});

test('a stored bay order skips letters no longer on the floor and places the rest (#191)', async () => {
  open({
    state: {
      version: 9,
      storageEdits: {
        floors: [],
        floorNames: {},
        bays: [],
        bayNames: {},
        slots: {},
        clearedSlots: [],
        hiddenBays: ['D'],
        hiddenFloors: [],
        bayOrder: { ground: ['Z', 'D', 'C', 'B'] },
      },
    },
  });
  setLayoutEditing(false);
  render();
  await nextTick();
  // B and C trade places; D is hidden and Z does not exist, so both are skipped.
  assert.deepEqual(letters(), ['A', 'C', 'B', 'E', 'F', 'G', 'H']);
});

test('containers get drag handles in edit mode, and a drop moves or swaps them with their progress (#208)', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  open({
    state: {
      version: 1,
      checks: { 'slot-A02-built': true, 'slot-A03-verified': true },
      notes: { 'slot-A02': evil },
    },
  });
  render();
  await nextTick();
  const name = (id: string) =>
    storageBays()
      .flatMap(b => b.items)
      .find(x => x.id === id)?.name ?? null;
  const [a01, a02, a03] = ['A01', 'A02', 'A03'].map(name);
  assert.equal($('[data-drag-slot]'), null, 'nothing drags outside edit mode');
  // A container card is not made a disabled button: its Done box and details stay usable.
  const cardAttrs = () =>
    ['role', 'tabindex', 'aria-disabled'].filter(a => $('[data-drop="A01"]')!.hasAttribute(a));
  await settle();
  assert.deepEqual(cardAttrs(), []);
  setLayoutEditing(true);
  render();
  await nextTick();
  // A handle on every filled position, a drop target on every position, and one past the end.
  const named = storageBays()
    .filter(b => b.floor === 'ground')
    .flatMap(b => b.items)
    .filter(x => x.name);
  assert.equal($$('[data-drag-slot]').length, named.length);
  assert.equal(
    $('[data-drag-slot="A01"]')!.getAttribute('aria-label'),
    `Move container A01: ${a01}. Space to pick it up, arrow keys to move, Space to drop.`,
  );
  assert.ok($('[data-drop="A09"].drop-new'), 'a drop past A08 makes A09');
  await settle();
  assert.deepEqual(cardAttrs(), [], 'in edit mode the handle carries the drag attributes');
  assert.equal($('[data-drag-slot="A01"]')!.getAttribute('aria-roledescription'), 'draggable');
  // Clear C05, then drop A02 on it: a move, the reserved address left behind.
  await moveContainer('C04', 'C04');
  assert.equal(calls.length, 0, 'a drop on its own place saves nothing');
  $('[data-clear-slot="C05"]')!.click();
  await settle();
  await moveContainer('A02', 'C05');
  assert.deepEqual(calls.at(-1)![1], {
    type: 'storageSlotMove',
    from: 'A02',
    to: 'C05',
    fromName: a02,
    toName: null,
  });
  assert.equal(name('C05'), a02);
  assert.equal(name('A02'), null);
  assert.equal(state.checks['slot-C05-built'], true, 'its checkmarks went along');
  assert.equal(state.notes['slot-C05'], evil, 'and its note');
  assert.match($('#toast')!.textContent!, new RegExp(`moved from A02 to C05`));
  // A drop on a filled position swaps the two.
  await moveContainer('A03', 'A01');
  assert.equal(name('A01'), a03);
  assert.equal(name('A03'), a01);
  assert.equal(state.checks['slot-A01-verified'], true);
  assert.match($('#toast')!.textContent!, /swapped places \(A03 ↔ A01\)/);
  // Past the end of a bay: only the next address takes a container.
  await moveContainer('A01', 'A09');
  assert.equal(name('A09'), a03);
  assert.equal(containerMove('A04', 'A12'), null, 'not a gap past the end');
  assert.equal(containerMove('A02', 'A04'), null, 'an empty position has nothing to move');
  noMarkup();
});

// The drop targets @dnd-kit/vue has registered for the page, by the address each answers to,
// with the address the cell registered under it shows (its data-drop). Read from the manager
// the page's DragDropProvider gives its cells, found through a cell's component instance.
const isManager = (x: unknown): x is DragDropManager =>
  !!x && typeof x === 'object' && 'registry' in x && 'monitor' in x;
function dropManager(): DragDropManager {
  const cell = $('[data-drop]') as (HTMLElement & { __vueParentComponent?: unknown }) | null;
  const instance = cell?.__vueParentComponent as { provides?: object } | undefined;
  const provides = instance?.provides;
  assert.ok(provides, 'a drop cell is a mounted component');
  let manager: DragDropManager | undefined;
  // `provides` inherits from the parents' through its prototype chain.
  for (let p: object | null = provides; p && !manager; p = Object.getPrototypeOf(p))
    for (const key of Reflect.ownKeys(p)) {
      const value: unknown = Reflect.get(p, key);
      const ref = value && typeof value === 'object' && 'value' in value ? value.value : value;
      if (isManager(ref)) manager = ref;
    }
  assert.ok(manager, 'the storage page provides a drag and drop manager');
  return manager;
}
function dropTargets(): Map<string, string | null> {
  return new Map(
    [...dropManager().registry.droppables].map(d => [
      String(d.id),
      d.element?.getAttribute('data-drop') ?? null,
    ]),
  );
}

test('a drop past the end lands on the position it shows, also once the one before is filled (#292)', async () => {
  stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  open({ state: { version: 1, checks: { 'slot-A02-built': true }, notes: { 'slot-A02': evil } } });
  setLayoutEditing(true);
  render();
  await settle();
  const name = (id: string) =>
    storageBays()
      .flatMap(b => b.items)
      .find(x => x.id === id)?.name ?? null;
  const a02 = name('A02');
  assert.equal($('[data-drop="A09"]')!.classList.contains('drop-new'), true);
  assert.equal(dropTargets().get('A09'), 'A09');
  // A container dropped on A09 fills it, and the next free address is offered.
  await moveContainer('A01', 'A09');
  await settle();
  assert.equal($('[data-drop="A09"]')!.classList.contains('drop-new'), false);
  assert.equal($('[data-drop="A10"]')!.classList.contains('drop-new'), true);
  // Each drop target answers to the address its cell shows: the filled A09 to A09 and the new
  // cell to A10. The new cell used to keep answering to A09, so a container dropped on it was
  // swapped with the one just placed there instead of moving to A10.
  const targets = dropTargets();
  assert.equal(targets.get('A09'), 'A09');
  assert.equal(targets.get('A10'), 'A10', 'the offered position takes drops as A10');
  for (const [id, shown] of targets) assert.equal(shown, id, `drop target ${id}`);
  // The drop the page then sees moves A02 there, its progress going along.
  await moveContainer('A02', 'A10');
  await settle();
  assert.equal(name('A10'), a02);
  assert.equal(name('A02'), null);
  assert.equal(state.checks['slot-A10-built'], true);
  assert.equal(state.notes['slot-A10'], evil);
  assert.equal(dropTargets().get('A11'), 'A11');
  noMarkup();
});

// The dragEnd handler the page binds on its DragDropProvider (StoragePage.vue), found through a
// cell's component instance.
function pageDragEnd(): (event: unknown, manager: unknown) => Promise<void> {
  type Instance = { parent: Instance | null; vnode: { props: Record<string, unknown> | null } };
  const cell = $('[data-drop="A01"]') as (HTMLElement & { __vueParentComponent?: unknown }) | null;
  let at = cell?.__vueParentComponent as Instance | null | undefined;
  while (at && typeof at.vnode.props?.onDragEnd !== 'function') at = at.parent;
  const dragEnd = at?.vnode.props?.onDragEnd as
    | ((event: unknown, manager: unknown) => Promise<void>)
    | undefined;
  assert.ok(dragEnd, 'the page handles dragend');
  return dragEnd;
}

// Gives a drop cell a box on screen (happy-dom lays nothing out): 100 × 100 at (left, top).
function placeCell(id: string, left: number, top: number): HTMLElement {
  const cell = $(`[data-drop="${id}"]`)!;
  cell.getBoundingClientRect = () => new DOMRect(left, top, 100, 100);
  return cell;
}

// A finished mouse drag of `from` onto the cell `to`, let go at (x, y).
const mouseDrop = (from: string, to: HTMLElement, x: number, y: number) => ({
  canceled: false,
  operation: {
    source: { id: from },
    target: { id: to.dataset.drop, element: to },
    position: { current: { x, y } },
    activatorEvent: new PointerEvent('pointerdown'),
  },
});

test('a drop is saved once dnd-kit has finished it, so the bay is not redrawn mid-drop (#292)', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  open();
  setLayoutEditing(true);
  render();
  await settle();
  const dragEnd = pageDragEnd();
  // dnd-kit is still animating the drop: the operation is not idle yet.
  const status = { idle: false };
  const done = dragEnd(mouseDrop('A02', placeCell('A09', 200, 200), 250, 250), {
    dragOperation: { status },
  });
  await settle();
  await settle();
  assert.equal(calls.length, 0, 'nothing is saved or redrawn while the drop is running');
  status.idle = true;
  await done;
  assert.equal(calls.length, 1);
  assert.equal(calls[0]![1].type, 'storageSlotMove');
  assert.equal($('[data-drop="A09"] [data-slot="A09"]') !== null, true, 'A02 is drawn at A09');
  assert.equal($('[data-slot="A02"]'), null);
});

test('a position is the drop target only while the pointer is over it, in the window (#298)', async () => {
  open();
  setLayoutEditing(true);
  render();
  await settle();
  const droppables = [...dropManager().registry.droppables];
  assert.ok(droppables.length > 8);
  // dnd-kit's default would fall back to the dragged card's shape when no position is under the
  // pointer, so a card let go in the aisle landed on whichever position it overlapped.
  for (const d of droppables)
    assert.equal(d.collisionDetector, pointerOnly, `drop target ${String(d.id)}`);
  // Where the detector looks at all: a pointer outside the window hits nothing, not the
  // out-of-sight position below or beside it.
  const at = (x: number, y: number, activatorEvent: Event) =>
    inView({ activatorEvent, position: { current: { x, y } } });
  const mouse = new PointerEvent('pointerdown'),
    keys = new KeyboardEvent('keydown');
  assert.equal(at(10, 10, mouse), true);
  assert.equal(at(10, innerHeight + 80, mouse), false);
  assert.equal(at(innerWidth + 5, 10, mouse), false);
  assert.equal(at(-1, 10, mouse), false);
  // The keyboard moves the card's centre and never auto-scrolls, so it is not held to the window.
  assert.equal(at(10, innerHeight + 80, keys), true);
});

test('the drop target follows the page as it scrolls under a pointer held still (#303)', async () => {
  open();
  setLayoutEditing(true);
  render();
  await settle();
  const manager = dropManager();
  // dnd-kit's drag feedback asks for the page's animations, which happy-dom does not have.
  document.getAnimations ??= () => [];
  Element.prototype.getAnimations ??= () => [];
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const over = () => $$('.drop-over').map(c => c.dataset.drop);
  // A02 is picked up and held over A06, with A07 below.
  placeCell('A06', 200, 200);
  placeCell('A07', 200, 320);
  manager.actions.start({
    source: 'A02',
    coordinates: { x: 250, y: 250 },
    event: new PointerEvent('pointerdown'),
  });
  // dnd-kit measures the positions as they come into view, which happy-dom never reports.
  for (const d of manager.registry.droppables) d.refreshShape();
  manager.actions.move({ to: { x: 250, y: 251 } });
  await settle();
  assert.deepEqual(over(), ['A06']);
  // The page scrolls 120 px (an auto-scroll, the wheel); the pointer does not move. A07 is now
  // under it. dnd-kit kept A06 until the pointer moved again, measured 75 ms late or later.
  placeCell('A06', 200, 80);
  placeCell('A07', 200, 200);
  document.dispatchEvent(new Event('scroll'));
  await frame();
  await settle();
  assert.deepEqual(over(), ['A07'], 'the position under the pointer is the target');
  assert.equal(manager.dragOperation.target?.id, 'A07');
  // Scrolled on past every position: none is the target.
  placeCell('A07', 200, 60);
  document.dispatchEvent(new Event('scroll'));
  await frame();
  await settle();
  assert.deepEqual(over(), []);
  manager.actions.stop({ canceled: true });
  await settle();
  // After the drag, a scroll measures nothing again.
  // A06 is registered: its cell is on the page.
  const a06 = manager.registry.droppables.get('A06')!;
  const shape = a06.shape;
  placeCell('A06', 200, 200);
  document.dispatchEvent(new Event('scroll'));
  await frame();
  assert.equal(a06.shape, shape, 'the listener went with the drag');
});

test('a drop let go away from the position dnd-kit names saves nothing (#298)', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  open();
  setLayoutEditing(true);
  render();
  await settle();
  const dragEnd = pageDragEnd(),
    idle = { dragOperation: { status: { idle: true } } };
  const a07 = placeCell('A07', 200, 200);
  // In the aisle beside the position; after an auto-scroll dnd-kit kept a target that had
  // scrolled away from under the pointer, and G02 was swapped with C05.
  await dragEnd(mouseDrop('A02', a07, 320, 250), idle);
  await dragEnd(mouseDrop('A02', a07, 250, 150), idle);
  // Outside the window, over a position that is out of sight.
  const below = placeCell('A08', 200, innerHeight + 10);
  await dragEnd(mouseDrop('A02', below, 250, innerHeight + 50), idle);
  // A target with no element on the page.
  const lost = mouseDrop('A02', a07, 250, 250);
  await dragEnd({ ...lost, operation: { ...lost.operation, target: { id: 'A07' } } }, idle);
  // Cancelled.
  await dragEnd({ ...mouseDrop('A02', a07, 250, 250), canceled: true }, idle);
  await settle();
  assert.equal(calls.length, 0, 'nothing is saved');
  assert.ok($('[data-slot="A02"]'), 'A02 stays where it was');
  // Let go on the position itself, it swaps; a keyboard drop is judged by the card's centre.
  const a07name = $('[data-slot="A07"] span')!.textContent;
  await dragEnd(mouseDrop('A02', a07, 250, 250), idle);
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0]![1].type, 'storageSlotMove');
  assert.equal($('[data-slot="A02"] span')!.textContent, a07name);
  const keyDrop = mouseDrop('A03', placeCell('A08', 200, innerHeight + 10), 250, innerHeight + 50);
  await dragEnd(
    {
      ...keyDrop,
      operation: { ...keyDrop.operation, activatorEvent: new KeyboardEvent('keydown') },
    },
    idle,
  );
  assert.equal(calls.length, 2, 'the keyboard drop is saved');
  assert.equal(landsOnTarget({ ...keyDrop.operation, target: null }), false);
});
