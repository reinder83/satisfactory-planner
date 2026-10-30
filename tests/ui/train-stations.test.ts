// Train stations on the Logistics page (#1284, slice 1: ui/factories/TrainStations.vue and
// ui/detail/StationDialog.vue): "+ Add train station" opens the editor for a new station, which
// Add station saves as one `trainStation` update; "Edit station ↗" opens a station to rename it,
// change its owner and edit its platforms (add, type, cargo with the item search, belt, move and
// remove, all with buttons and announced); nothing is saved before Save; and Delete station
// removes it with Undo in the toast. Every name is the profile's own text, never markup.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { render } from '../../public/app/shell.ts';
import { state } from '../../public/app/session.ts';
import { $, $$, applyUpdate, evil, go, open, page, stubFetch } from './setup.ts';
import type { ProgressState, TrainStation, UpdateOp } from '../../public/types/index.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const GROUPS = {
  groups: [
    { id: 'fg-plates1', name: evil },
    { id: 'fg-wires1', name: 'Wire' },
  ],
  assignments: {},
};
const MINE: TrainStation = {
  id: 'ts-mine01',
  name: 'Iron mine',
  owner: { kind: 'outpost', resource: 'Iron Ore', nodes: { pure: 3 } },
  platforms: [
    { kind: 'empty' },
    { kind: 'load', cargo: ['Iron Ore'], belt: 5 },
    { kind: 'unload', belt: 2 },
  ],
};
const DROP: TrainStation = {
  id: 'ts-drop02',
  name: evil,
  owner: { kind: 'factory', id: 'fg-plates1' },
  platforms: [{ kind: 'unload', belt: 4 }],
};

let sent: UpdateOp[] = [];
async function showLogistics(progress: Partial<ProgressState> = {}) {
  open({ state: { version: 3, factoryGroups: GROUPS, ...progress } });
  sent = [];
  stubFetch<UpdateOp>({
    '/api/update': (update: UpdateOp) => {
      sent.push(update);
      return applyUpdate(update);
    },
  });
  go('logistics');
  render();
  await settle();
}
const dialog = () => $<HTMLDialogElement>('#detail')!;
const card = (id: string) => $(`[data-station="${id}"]`);
const rows = () => $$('[data-platform]');
const inRow = <E extends Element = HTMLElement>(at: number, selector: string) =>
  rows()[at]!.querySelector<E>(selector)!;
const choose = (select: HTMLSelectElement, value: string) => {
  select.value = value;
  select.dispatchEvent(new Event('change'));
};
const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input'));
};
const fieldsOf = ({ id: _id, ...fields }: TrainStation) => fields;

beforeEach(() => page());
afterEach(() => dialog()?.close());

test('Logistics lists no stations yet; Add train station opens the editor, saved on Add', async () => {
  await showLogistics();
  const section = $('[data-train-stations]')!;
  assert.equal(section.querySelector('h2')!.textContent, 'Train stations');
  assert.ok($('[data-stations-empty]'), 'it says there are none yet');
  $<HTMLButtonElement>('[data-station-add]')!.click();
  await settle();
  assert.equal(dialog().open, true);
  assert.equal($('#detail-title')!.textContent, 'New train station');
  const name = $<HTMLInputElement>('[data-station-name]')!;
  assert.equal(name.value, 'Station 1');
  assert.equal(name.maxLength, 60);
  // Belongs to: none, the profile's factories, a mining outpost or storage.
  const owner = $<HTMLSelectElement>('[data-station-owner]')!;
  assert.deepEqual(
    [...owner.options].map(option => [option.value, option.textContent!.trim()]),
    [
      ['', 'No owner set'],
      ['factory:fg-plates1', evil],
      ['factory:fg-wires1', 'Wire'],
      ['outpost', 'Mining outpost'],
      ['storage', 'Storage'],
    ],
  );
  type(name, 'Plates loading');
  choose(owner, 'factory:fg-plates1');
  // Two platforms: the first loads Iron Plate and Iron Rod (mixed cargo) on a Mk.3 belt.
  $<HTMLButtonElement>('[data-platform-add]')!.click();
  await settle();
  assert.equal(rows().length, 1);
  assert.equal(document.activeElement, inRow(0, '[data-platform-kind]'), 'focus on its type');
  assert.equal(inRow(0, '[data-platform-kind]').getAttribute('aria-label'), 'Type: platform 1');
  assert.ok(inRow(0, '[data-cargo-none]'), 'a new load platform has no cargo yet');
  const cargo = () => inRow<HTMLInputElement>(0, '[data-cargo-add] input');
  assert.equal(cargo().getAttribute('aria-label'), 'Add cargo: platform 1');
  type(cargo(), 'Iron Pla');
  await settle();
  inRow<HTMLButtonElement>(0, '[data-item-pick="Iron Plate"]').click();
  await settle();
  assert.equal(cargo().value, '', 'a fresh field for the next item');
  assert.equal(document.activeElement, cargo(), 'with focus in it');
  type(cargo(), 'Iron Ro');
  await settle();
  inRow<HTMLButtonElement>(0, '[data-item-pick="Iron Rod"]').click();
  await settle();
  assert.deepEqual(
    $$('[data-cargo]').map(item => item.dataset.cargo),
    ['Iron Plate', 'Iron Rod'],
  );
  choose(inRow(0, '[data-platform-belt]'), '3');
  $<HTMLButtonElement>('[data-platform-add]')!.click();
  await settle();
  choose(inRow(1, '[data-platform-kind]'), 'empty');
  await settle();
  assert.equal(rows()[1]!.querySelector('[data-platform-belt]'), null, 'an empty one has none');
  // The empty platform moves to the front: focus stays on it, on the button that still works.
  inRow<HTMLButtonElement>(1, '[data-platform-up]').click();
  await settle();
  assert.equal(inRow(0, '.platform-number').textContent, 'Platform 1');
  assert.equal((inRow(0, '[data-platform-kind]') as HTMLSelectElement).value, 'empty');
  assert.equal(inRow<HTMLButtonElement>(0, '[data-platform-up]').disabled, true);
  assert.equal(document.activeElement, inRow(0, '[data-platform-down]'));
  assert.equal(
    inRow(0, '[data-platform-down]').getAttribute('aria-label'),
    'Move down: platform 1',
  );
  assert.deepEqual(sent, [], 'nothing is saved before Add station');
  $<HTMLButtonElement>('[data-station-save]')!.click();
  await settle();
  assert.equal(sent.length, 1);
  const update = sent[0]! as Extract<UpdateOp, { type: 'trainStation' }>;
  assert.equal(update.type, 'trainStation');
  assert.match(update.id, /^ts-[a-z0-9]{10}$/);
  assert.deepEqual(update.value, {
    name: 'Plates loading',
    owner: { kind: 'factory', id: 'fg-plates1' },
    platforms: [{ kind: 'empty' }, { kind: 'load', cargo: ['Iron Plate', 'Iron Rod'], belt: 3 }],
  });
  assert.equal(state.version, 29);
  assert.equal(dialog().open, false);
  const added = card(update.id)!;
  assert.equal(added.querySelector('h3')!.textContent, 'Plates loading');
  assert.equal(added.querySelector('[data-station-belongs]')!.textContent, `Factory: ${evil}`);
  assert.equal(
    added.querySelector('[data-station-count]')!.textContent,
    '2 platforms: 1 load, 1 empty',
  );
  assert.deepEqual(
    [...added.querySelectorAll('[data-station-platforms] li')].map(li => li.textContent),
    ['Empty platform', 'Load Iron Plate and Iron Rod · Mk.3 (270/min) belt'],
  );
  assert.equal(document.activeElement, $(`[data-station-edit="${update.id}"]`), 'focus on Edit');
  assert.equal($('[data-stations-empty]'), null);
  assert.equal(document.querySelector('x-evil'), null, 'a hostile name is text');
});

test('Edit station opens it; Save replaces it whole, Cancel sends nothing', async () => {
  await showLogistics({ version: 29, trainStations: [MINE, DROP] } as Partial<ProgressState>);
  assert.equal($$('[data-station-card]').length, 2);
  assert.equal(
    card(MINE.id)!.querySelector('[data-station-belongs]')!.textContent,
    'Mining outpost: Iron Ore on 3 pure nodes',
  );
  const edit = $<HTMLButtonElement>(`[data-station-edit="${DROP.id}"]`)!;
  assert.equal(edit.getAttribute('aria-label'), `Edit station ↗: ${evil}`);
  assert.equal(document.querySelector('x-evil'), null);
  // Cancel: nothing changes.
  edit.click();
  await settle();
  type($<HTMLInputElement>('[data-station-name]')!, 'Changed');
  $<HTMLButtonElement>('[data-station-cancel]')!.click();
  await settle();
  assert.equal(dialog().open, false);
  assert.deepEqual(sent, []);
  // The mine: an outpost of 3 pure and 2 normal Copper Ore nodes, its middle platform removed.
  $<HTMLButtonElement>(`[data-station-edit="${MINE.id}"]`)!.click();
  await settle();
  assert.equal($('#detail-title')!.textContent, 'Edit train station');
  assert.equal($<HTMLSelectElement>('[data-station-owner]')!.value, 'outpost');
  assert.equal($<HTMLSelectElement>('[data-outpost-resource]')!.value, 'Iron Ore');
  assert.equal($<HTMLInputElement>('[data-outpost-nodes="pure"]')!.value, '3');
  choose($<HTMLSelectElement>('[data-outpost-resource]')!, 'Copper Ore');
  type($<HTMLInputElement>('[data-outpost-nodes="normal"]')!, '2');
  assert.equal(rows().length, 3);
  inRow<HTMLButtonElement>(1, '[data-platform-remove]').click();
  await settle();
  assert.equal(rows().length, 2);
  assert.equal(document.activeElement, inRow(1, '[data-platform-kind]'), 'on the next one');
  $<HTMLButtonElement>('[data-station-save]')!.click();
  await settle();
  assert.deepEqual(sent, [
    {
      type: 'trainStation',
      id: MINE.id,
      value: {
        name: 'Iron mine',
        owner: { kind: 'outpost', resource: 'Copper Ore', nodes: { pure: 3, normal: 2 } },
        platforms: [{ kind: 'empty' }, { kind: 'unload', belt: 2 }],
      },
    },
  ]);
  assert.deepEqual(
    state.trainStations!.map(station => station.id),
    [MINE.id, DROP.id],
    'replaced where it was',
  );
  assert.equal(document.activeElement, $(`[data-station-edit="${MINE.id}"]`));
});

test('cargo is removed with its × and a platform keeps its belt when it changes type', async () => {
  await showLogistics({ version: 29, trainStations: [MINE] } as Partial<ProgressState>);
  $<HTMLButtonElement>(`[data-station-edit="${MINE.id}"]`)!.click();
  await settle();
  const remove = inRow<HTMLButtonElement>(1, '[data-cargo-remove]');
  assert.equal(remove.getAttribute('aria-label'), 'Remove Iron Ore from platform 2');
  remove.click();
  await settle();
  assert.ok(inRow(1, '[data-cargo-none]'));
  assert.equal(document.activeElement, inRow(1, '[data-cargo-add] input'));
  choose(inRow(1, '[data-platform-kind]'), 'unload');
  await settle();
  assert.equal((inRow(1, '[data-platform-belt]') as HTMLSelectElement).value, '5');
  choose(inRow(2, '[data-platform-belt]'), '');
  // The last platform moves up one place: focus stays on its Move up, which still works there.
  inRow<HTMLButtonElement>(2, '[data-platform-up]').click();
  await settle();
  assert.equal(document.activeElement, inRow(1, '[data-platform-up]'));
  $<HTMLButtonElement>('[data-station-save]')!.click();
  await settle();
  assert.deepEqual((sent[0]! as Extract<UpdateOp, { type: 'trainStation' }>).value!.platforms, [
    { kind: 'empty' },
    { kind: 'unload' },
    { kind: 'unload', belt: 5 },
  ]);
});

test('a blank name and bad node counts are refused in the dialog', async () => {
  await showLogistics();
  $<HTMLButtonElement>('[data-station-add]')!.click();
  await settle();
  const name = $<HTMLInputElement>('[data-station-name]')!;
  type(name, '   ');
  $<HTMLButtonElement>('[data-station-save]')!.click();
  await settle();
  assert.deepEqual(sent, []);
  assert.equal($('#station-name-error')!.textContent, 'Give the station a name.');
  assert.equal(name.getAttribute('aria-invalid'), 'true');
  assert.equal(document.activeElement, name);
  type(name, 'Outpost');
  choose($<HTMLSelectElement>('[data-station-owner]')!, 'outpost');
  await settle();
  const pure = $<HTMLInputElement>('[data-outpost-nodes="pure"]')!;
  type(pure, '2.5');
  $<HTMLButtonElement>('[data-station-save]')!.click();
  await settle();
  assert.deepEqual(sent, []);
  assert.match($('#outpost-nodes-error')!.textContent!, /whole number from 0 to 99/);
  type(pure, '2');
  $<HTMLButtonElement>('[data-station-save]')!.click();
  await settle();
  assert.equal(sent.length, 1);
  assert.deepEqual((sent[0]! as Extract<UpdateOp, { type: 'trainStation' }>).value, {
    name: 'Outpost',
    owner: { kind: 'outpost', resource: 'Iron Ore', nodes: { pure: 2 } },
    platforms: [],
  });
});

test('Delete station removes it with Undo, which puts it back after the others', async () => {
  await showLogistics({ version: 29, trainStations: [MINE, DROP] } as Partial<ProgressState>);
  $<HTMLButtonElement>(`[data-station-edit="${MINE.id}"]`)!.click();
  await settle();
  $<HTMLButtonElement>('[data-station-delete]')!.click();
  await settle();
  await settle();
  assert.deepEqual(sent, [{ type: 'trainStation', id: MINE.id, value: null }]);
  assert.equal(dialog().open, false);
  assert.equal(card(MINE.id), null);
  assert.equal(document.activeElement, $('[data-station-add]'), 'focus on Add train station');
  const toast = $('#toast')!;
  assert.match(toast.textContent!, /^Deleted train station “Iron mine”\. Undo/);
  toast.querySelector<HTMLButtonElement>('button')!.click();
  await settle();
  await settle();
  assert.deepEqual(sent[1], { type: 'trainStation', id: MINE.id, value: fieldsOf(MINE) });
  assert.match($('#toast')!.textContent!, /^Train station “Iron mine” is back\./);
  assert.deepEqual(
    state.trainStations!.map(station => station.id),
    [DROP.id, MINE.id],
  );
  assert.equal(document.activeElement, $(`[data-station-edit="${MINE.id}"]`));
});

test('a station without an owner, or of storage, says so', async () => {
  await showLogistics({
    version: 29,
    trainStations: [
      { ...DROP, owner: undefined },
      { id: 'ts-store03', name: 'Store', owner: { kind: 'storage' }, platforms: [] },
    ],
  } as Partial<ProgressState>);
  assert.equal(card(DROP.id)!.querySelector('[data-station-belongs]')!.textContent, 'No owner set');
  assert.equal(card('ts-store03')!.querySelector('[data-station-belongs]')!.textContent, 'Storage');
  assert.equal(
    card('ts-store03')!.querySelector('[data-station-count]')!.textContent,
    'No platforms yet',
  );
});
