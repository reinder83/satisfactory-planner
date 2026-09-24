// The storage room (public/app/ui/pages/StoragePage.vue, with its parts in
// public/app/ui/storage/) and the container dialog (public/app/ui/detail/SlotDialog.vue),
// mounted the way the app mounts them, in happy-dom.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { bayCapacity } from '../../public/state.js';
import { floor, setFloor, setLayoutEditing, setQuery, state } from '../../public/app/session.js';
import { render } from '../../public/app/shell.js';
import { openSlot, slotKeys } from '../../public/app/views/storage.js';
import { $, $$, evil, generated, go, handbook, open, page, stubFetch } from './setup.mjs';

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
};

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
  assert.equal($('#main h1').textContent, 'Storage room');
  assert.ok($('[data-slot="A01"]'), 'a state without storageEdits shows the handbook layout');
  assert.match($('#main .notice').textContent, /Ground floor is built\./);
  assert.deepEqual(
    $$('.tabs .tab').map(t => t.textContent.trim()),
    ['Ground floor', 'Upper floor', 'Workshop'],
  );
  assert.ok($('.tabs .tab.active').dataset.floor === 'ground');
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
      const style = b.getAttribute('style');
      return [
        b.querySelector('.bay-letter').textContent,
        [Number(style.match(/--bay-row: ?(\d+)/)[1]), Number(style.match(/--bay-col: ?(\d+)/)[1])],
      ];
    }),
  );
  assert.deepEqual(at.A, [order.length / 2, 1], 'A stays at the entrance, left of the aisle');
  assert.deepEqual(at.B, [order.length / 2, 3], 'B stays at the entrance, right of the aisle');
  assert.deepEqual(at[order.at(-2)], [1, 1], 'the last pair stays at the rear of the hall');
  assert.equal($$('#main .aisle').length, order.length / 2, 'every row keeps its aisle');
  assert.equal($('#main .eyebrow.floor-marker').textContent, 'REAR OF HALL ↑');
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
  $('[data-floor="cf-abcd12"]').click();
  await nextTick();
  assert.equal(floor, 'cf-abcd12');
  assert.equal($('[data-slot="S01"] span').textContent, evil);
  noMarkup();
  $('[data-toggle-layout]').click();
  await nextTick();
  assert.ok($('[data-remove-bay="S"]'), 'an added bay can be removed');
  assert.equal($('[data-bay-rename="S"]').value, 'Overflow');
  assert.ok($('.add-container[data-bay="S"]'));
  assert.equal($('[data-remove-floor="cf-abcd12"]').disabled, true, 'not while it has bays');
  assert.equal($('[data-remove-floor="cf-abcd12"]').textContent.trim(), 'Remove its bays first');
  assert.equal(
    $('[data-clear-slot="S01"]').getAttribute('aria-label'),
    `Clear container S01: ${evil}`,
  );
});

test('a bay grows past eight containers and keeps offering the next address', async () => {
  open({ state: { storageEdits: { slots: { A10: 'Aluminum Casing' } } } });
  setLayoutEditing(true);
  render();
  const bay = $$('#main .bay').find(b => b.querySelector('.bay-letter').textContent === 'A');
  assert.ok(bay.querySelector('[data-slot="A08"]'));
  assert.equal(bay.querySelector('.slot.empty').textContent.replace(/\s+/g, ''), 'A09Reserved');
  assert.ok(bay.querySelector('[data-slot="A10"]'));
  assert.ok(bay.querySelector('.walkway.added'));
  assert.equal(bay.querySelector('[data-slot="A11"]'), null);
  assert.match(bay.querySelector('.add-container input').placeholder, /Add container/);
  open({
    state: {
      storageEdits: {
        slots: Object.fromEntries(
          Array.from({ length: bayCapacity - 8 }, (_, i) => ['A' + (i + 9), 'Item ' + i]),
        ),
      },
    },
  });
  render();
  await nextTick();
  assert.ok($(`[data-slot="A${bayCapacity}"]`), 'a bay reaches the last addressable position');
  assert.equal($('.add-container[data-bay="A"]'), null, 'and then stops offering one');
});

test('the search narrows the floor to matching bays and marks the matches', async () => {
  render();
  $('#storage-search').value = 'A01';
  $('#storage-search').dispatchEvent(new Event('input'));
  await nextTick();
  assert.deepEqual(letters(), ['A']);
  assert.ok($('[data-slot="A01"]').closest('.slot').classList.contains('match'));
  assert.match($('#main p.small.muted').textContent, /Filtered view/);
  $('#storage-search').value = 'no-such-item';
  $('#storage-search').dispatchEvent(new Event('input'));
  await nextTick();
  assert.equal(
    $('#main .empty-state').textContent.trim(),
    'No matching item on this floor. Try another floor.',
  );
  $('[data-floor="upper"]').click();
  await nextTick();
  assert.equal($('#storage-search').value, '', 'switching floor clears the search');
});

test('Done and "Complete room" write the four checks of each container', async () => {
  const calls = stubFetch({ '/api/update': () => state });
  render();
  const done = $('[data-complete-slot="A02"]');
  done.checked = true;
  done.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(calls[0][1], { type: 'checks', keys: slotKeys('A02'), value: true });
  const bay = $$('#main .bay').find(b => b.querySelector('.bay-letter').textContent === 'A');
  bay.querySelector('[data-complete-bay]').click();
  await settle();
  const named = [...bay.querySelectorAll('[data-slot]')].map(b => b.dataset.slot);
  assert.deepEqual(calls[1][1], {
    type: 'checks',
    keys: named.flatMap(slotKeys),
    value: true,
  });
  assert.match($('#toast').textContent, /Room A completed/);
  // A saved room shows its containers done and its button disabled.
  for (const k of named.flatMap(slotKeys)) state.checks[k] = true;
  render();
  await nextTick();
  assert.equal(bay.querySelector('[data-complete-bay]').disabled, true);
  assert.equal(
    bay.querySelector('.bay-actions .muted').textContent,
    `${named.length}/${named.length} containers done`,
  );
});

test('a failed Done save unticks the box again', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'Disk full' }), { status: 500 });
  render();
  const done = $('[data-complete-slot="A02"]');
  done.checked = true;
  done.dispatchEvent(new Event('change'));
  await settle();
  assert.equal(done.checked, false);
  assert.equal($('#toast').textContent, 'Disk full');
});

test('the layout editor saves floors, bays, containers and removals', async () => {
  const calls = stubFetch({ '/api/update': () => state });
  open({ state: { storageEdits: structuredClone(EDITS) } });
  setLayoutEditing(true);
  render();
  const submit = (form, value) => {
    form.querySelector('input').value = value;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
  };
  submit($('#add-bay'), 'New bay');
  await settle();
  assert.deepEqual(calls.at(-1)[1], {
    type: 'storageBayAdd',
    id: 'T',
    name: 'New bay',
    floor: 'ground',
  });
  assert.equal($('#add-bay input').value, '', 'the form empties after adding');
  submit($('#add-floor'), 'Attic');
  await settle();
  assert.equal(calls.at(-1)[1].type, 'storageFloorAdd');
  assert.match(calls.at(-1)[1].id, /^cf-[0-9a-f]{12}$/);
  submit($('#rename-floor'), 'Great hall');
  await settle();
  assert.deepEqual(calls.at(-1)[1], {
    type: 'storageFloorRename',
    id: 'ground',
    label: 'Great hall',
  });
  submit($('.add-container[data-bay="A"]'), 'Iron Plate');
  await settle();
  assert.deepEqual(
    calls.at(-1)[1],
    { type: 'storageSlotAssign', key: 'A01', name: 'Iron Plate' },
    'the cleared position is filled first',
  );
  const rename = $('[data-bay-rename="A"]');
  rename.value = 'Ingots';
  rename.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(calls.at(-1)[1], { type: 'storageBayRename', id: 'A', name: 'Ingots' });
  $('[data-clear-slot="A02"]').click();
  await settle();
  assert.deepEqual(calls.at(-1)[1], { type: 'storageSlotClear', key: 'A02' });
  assert.match($('#toast').textContent, /saved checkmarks are kept/);
  $('[data-floor="cf-abcd12"]').click();
  await nextTick();
  $('[data-remove-bay="S"]').click();
  await settle();
  assert.deepEqual(calls.at(-1)[1], { type: 'storageBayRemove', id: 'S' });
  // With its bay gone the floor can be removed, which returns to the ground floor.
  state.storageEdits.bays = [];
  render();
  await nextTick();
  $('[data-remove-floor="cf-abcd12"]').click();
  await settle();
  assert.deepEqual(calls.at(-1)[1], { type: 'storageFloorRemove', id: 'cf-abcd12' });
  assert.equal(floor, 'ground');
  globalThis.confirm = () => false;
  const before = calls.length;
  $('[data-floor="ground"]').click();
  await nextTick();
  state.storageEdits.bays = [{ id: 'S', name: 'Overflow', floor: 'ground' }];
  render();
  await nextTick();
  $('[data-remove-bay="S"]').click();
  await settle();
  assert.equal(calls.length, before, 'a declined confirmation removes nothing');
});

test('the workshop floor shows its checklist and no bays', async () => {
  render();
  $('[data-floor="workshop"]').click();
  await nextTick();
  assert.match($('#main .panel h2').textContent, /Workshop beneath Q\/R/);
  assert.deepEqual(
    $$('#main .panel [data-check]').map(b => b.dataset.check),
    ['workshop-bench', 'workshop-tools', 'workshop-weapons', 'workshop-mam'],
  );
  assert.equal($('#main .empty-state'), null, 'no empty-floor message on the workshop');
});

test('a calculated profile shows only the items it stores, and its one checklist step', () => {
  open({ calculated: generated() });
  render();
  assert.ok($$('#main .slot-details span').some(s => s.textContent === 'Iron Plate'));
  assert.equal($('[data-slot="G01"]'), null);
  assert.match($('#main .notice').textContent, /Optional storage template/);
  assert.deepEqual(
    $$('#main section:last-child [data-check]').map(b => b.dataset.check),
    ['calc-storage-layout'],
  );
});

test('the container dialog shows its place, checks, factory link and note', async () => {
  open({ state: { notes: { 'slot-A02': evil }, checks: { 'slot-A02-built': true } } });
  render();
  $('[data-slot="A02"]').click();
  assert.ok($('#detail').open);
  noMarkup();
  const name = $('[data-slot="A02"] span').textContent;
  assert.equal($('#detail h2').textContent, name);
  assert.match($('#detail .eyebrow').textContent, /^A02 · Ground floor · Bay A$/);
  assert.match($('#detail .dialog-body p').textContent, /Rear bank, position 2 from the left/);
  assert.deepEqual(
    $$('#detail .check-columns input').map(i => [i.dataset.check, i.checked]),
    [
      ['slot-A02-built', true],
      ['slot-A02-labelled', false],
      ['slot-A02-connected', false],
      ['slot-A02-verified', false],
    ],
  );
  assert.ok($('#detail .detail-actions [data-factory]'), 'the item links to its factory');
  assert.equal($('#detail-note').value, evil);
  assert.equal($('#detail-note').getAttribute('aria-label'), 'Container notes');
  assert.equal($('#detail [data-save-note]').dataset.saveNote, 'slot-A02');
  openSlot('A01');
  assert.equal($('#detail h2').textContent, $('[data-slot="A01"] span').textContent);
});

test('a reserved position opens no dialog', () => {
  open({ state: { storageEdits: { clearedSlots: ['A01'] } } });
  render();
  openSlot('A01');
  assert.equal($('#detail').open, false);
});
