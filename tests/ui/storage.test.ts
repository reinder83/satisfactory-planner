// The storage room (public/app/ui/pages/StoragePage.vue, with its parts in
// public/app/ui/storage/) and the container dialog (public/app/ui/detail/SlotDialog.vue),
// mounted the way the app mounts them, in happy-dom.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { bayCapacity, mutate } from '../../public/state.ts';
import { floor, setFloor, setLayoutEditing, setQuery, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { openSlot, slotKeys } from '../../public/app/views/storage.ts';
import { $, $$, evil, generated, go, handbook, open, page, stubFetch } from './setup.ts';
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
  globalThis.confirm = () => true;
  go('storage');
});

test('the handbook room shows its printed bays, notice and checklist', () => {
  render();
  assert.equal($('#main h1')!.textContent, 'Storage room');
  assert.ok($('[data-slot="A01"]'), 'a state without storageEdits shows the handbook layout');
  assert.match($('#main .notice')!.textContent, /Ground floor is built\./);
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

test('the search narrows the floor to matching bays and marks the matches', async () => {
  render();
  $<HTMLInputElement>('#storage-search')!.value = 'A01';
  $('#storage-search')!.dispatchEvent(new Event('input'));
  await nextTick();
  assert.deepEqual(letters(), ['A']);
  assert.ok($('[data-slot="A01"]')!.closest('.slot')!.classList.contains('match'));
  assert.match($('#main p.small.muted')!.textContent, /Filtered view/);
  $<HTMLInputElement>('#storage-search')!.value = 'no-such-item';
  $('#storage-search')!.dispatchEvent(new Event('input'));
  await nextTick();
  assert.equal(
    $('#main .empty-state')!.textContent.trim(),
    'No matching item on this floor. Try another floor.',
  );
  $('[data-floor="upper"]')!.click();
  await nextTick();
  assert.equal(
    $<HTMLInputElement>('#storage-search')!.value,
    '',
    'switching floor clears the search',
  );
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
    form.querySelector('input')!.value = value;
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
  assert.equal($<HTMLInputElement>('#add-bay input')!.value, '', 'the form empties after adding');
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
  globalThis.confirm = () => false;
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
  assert.match($('#main .notice')!.textContent, /Ground floor is built\./);
});

test('a calculated profile shows only the items it stores, and its one checklist step', () => {
  open({ calculated: generated() });
  render();
  assert.ok($$('#main .slot-details span').some(s => s.textContent === 'Iron Plate'));
  assert.equal($('[data-slot="G01"]'), null);
  assert.match($('#main .notice')!.textContent, /Optional storage template/);
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
  const calls = stubFetch<UpdateOp>({ '/api/update': (op: UpdateOp) => mutate(state, op) });
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
