// Train lines on the Logistics page's Trains tab (#1284, slices 2 and 3: ui/factories/TrainLines.vue,
// LineChecks.vue, LineWagons.vue and ui/detail/LineDialog.vue): "+ Add train line" opens the editor
// for a new line, which Add line saves as one `trainLine` update; the consist buttons (+ Wagon,
// + Locomotive, − Last car), the stops (added, moved, removed), the direction and the round trip
// are a draft until Save, and the checks and the wagon table follow the draft. On the card the
// checks offer "Add rear locomotive" (saved at once) and the station's editor; Delete line removes
// it with Undo; deleting a station takes it off the lines and its Undo puts them back. An outpost's
// card says when its belts take less than its extractors give. Every name is text, never markup.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { render } from '../../public/app/shell.ts';
import { setLogisticsTab, state } from '../../public/app/session.ts';
import { $, $$, applyUpdate, evil, go, open, page, stubFetch } from './setup.ts';
import type { ProgressState, TrainLine, TrainStation, UpdateOp } from '../../public/types/index.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const MINE: TrainStation = {
  id: 'ts-mine01',
  name: 'Iron mine',
  owner: { kind: 'outpost', resource: 'Iron Ore', nodes: { pure: 2 } },
  platforms: [
    { kind: 'load', cargo: ['Iron Ore'], belt: 5 },
    { kind: 'load', cargo: ['Iron Ore'], belt: 5 },
    { kind: 'empty' },
  ],
};
const WORKS: TrainStation = {
  id: 'ts-works2',
  name: evil,
  platforms: [{ kind: 'unload', belt: 5 }, { kind: 'unload', belt: 5 }, { kind: 'empty' }],
};
const SHUTTLE: TrainLine = {
  id: 'tl-shut01',
  name: 'Ore shuttle',
  cars: ['loco', 'wagon', 'wagon'],
  stops: ['ts-mine01', 'ts-works2'],
  direction: 'backAndForth',
  roundTrip: 4,
};

let sent: UpdateOp[] = [];
async function showTrains(progress: Partial<ProgressState> = {}) {
  open({ state: { version: 29, trainStations: [MINE, WORKS], ...progress } });
  sent = [];
  stubFetch<UpdateOp>({
    '/api/update': (update: UpdateOp) => {
      sent.push(update);
      return applyUpdate(update);
    },
  });
  setLogisticsTab('trains');
  go('logistics');
  render();
  await settle();
}
const dialog = () => $<HTMLDialogElement>('#detail')!;
const card = (id: string) => $(`[data-line="${id}"]`)!;
const click = async (selector: string, root: ParentNode = document) => {
  root.querySelector<HTMLButtonElement>(selector)!.click();
  await settle();
};
const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input'));
};
const cars = () => $$('[data-car]').map(car => car.textContent!.trim());
const checkKeys = (root: ParentNode = dialog()) =>
  [...root.querySelectorAll<HTMLElement>('[data-line-check]')].map(item => item.dataset.lineCheck);

beforeEach(() => page());
afterEach(() => dialog()?.close());

test('Add train line opens the editor; the draft is saved whole on Add line', async () => {
  await showTrains();
  assert.ok($('[data-lines-empty]'), 'no lines yet');
  await click('[data-line-add]');
  assert.equal(dialog().open, true);
  assert.equal($('#detail-title')!.textContent, 'New train line');
  assert.equal($<HTMLInputElement>('[data-line-name]')!.value, 'Line 1');
  assert.deepEqual(cars(), ['Locomotive', 'Wagon 1'], 'a new line has a locomotive and a wagon');
  // The consist: + Wagon, + Locomotive, − Last car.
  await click('[data-line-add-wagon]');
  assert.deepEqual(cars(), ['Locomotive', 'Wagon 1', 'Wagon 2']);
  await click('[data-line-remove-car]');
  assert.deepEqual(cars(), ['Locomotive', 'Wagon 1']);
  // Stops: both stations, in the order added; then the second moved up.
  const select = $<HTMLSelectElement>('[data-stop-select]')!;
  assert.deepEqual(
    [...select.options].map(option => option.textContent!.trim()),
    ['Iron mine', evil],
  );
  await click('[data-stop-add]');
  select.value = 'ts-works2';
  select.dispatchEvent(new Event('change'));
  await click('[data-stop-add]');
  assert.deepEqual(
    $$('[data-stop] .platform-number').map(stop => stop.textContent),
    ['Stop 1: Iron mine', `Stop 2: ${evil}`],
  );
  await click('[data-stop="1"] [data-stop-up]');
  assert.deepEqual(
    $$('[data-stop] .platform-number').map(stop => stop.textContent),
    [`Stop 1: ${evil}`, 'Stop 2: Iron mine'],
  );
  assert.equal(document.activeElement, $('[data-stop="0"] [data-stop-down]'), 'focus follows');
  // Back and forth without a rear locomotive: the check offers one, which goes in the draft.
  $<HTMLInputElement>('[data-line-direction-choice="backAndForth"]')!.click();
  await settle();
  assert.ok(checkKeys().includes('rear-loco'));
  await click('[data-line-fix="rearLoco"]', dialog());
  assert.deepEqual(cars(), ['Locomotive', 'Wagon 1', 'Rear locomotive']);
  assert.equal(checkKeys().includes('rear-loco'), false);
  // + Wagon goes in front of the rear locomotive.
  await click('[data-line-add-wagon]');
  assert.deepEqual(cars(), ['Locomotive', 'Wagon 1', 'Wagon 2', 'Rear locomotive']);
  // The round trip: a bad one is refused under the field.
  const trip = $<HTMLInputElement>('[data-line-trip]')!;
  type(trip, '-3');
  await click('[data-line-save]');
  assert.equal(sent.length, 0, 'nothing saved');
  assert.match($('#line-trip-error')!.textContent!, /above 0 and at most 600/);
  type(trip, '4.5');
  type($<HTMLInputElement>('[data-line-name]')!, 'Ore shuttle');
  assert.deepEqual(sent, [], 'nothing saved before Add line');
  await click('[data-line-save]');
  assert.equal(sent.length, 1);
  // deepEqual(sent, []) above narrowed it to an empty list.
  const update = (sent as UpdateOp[])[0]!;
  assert.ok(update.type === 'trainLine');
  assert.deepEqual(update.value, {
    name: 'Ore shuttle',
    cars: ['loco', 'wagon', 'wagon', 'loco'],
    stops: ['ts-works2', 'ts-mine01'],
    direction: 'backAndForth',
    roundTrip: 4.5,
  });
  assert.equal(dialog().open, false);
  assert.equal(document.activeElement, $(`[data-line-edit="${update.id}"]`), 'focus on its Edit');
  assert.equal(document.querySelector('x-evil'), null, 'a hostile name is text');
});

test("a line's card: train, stops, checks with their buttons, and what each wagon carries", async () => {
  await showTrains({ version: 30, trainLines: [SHUTTLE] });
  const shuttle = card(SHUTTLE.id);
  assert.match(shuttle.querySelector('h3')!.textContent!, /Ore shuttle\s*⇄ Back and forth/);
  assert.equal(
    shuttle.querySelector('[data-line-train]')!.textContent,
    'Train: Locomotive, 2 wagons',
  );
  assert.match(shuttle.querySelector('[data-line-stops]')!.textContent!, /Iron mine/);
  assert.deepEqual(checkKeys(shuttle), ['rear-loco']);
  // The wagon table: what the platforms decide.
  const wagon = shuttle.querySelector('[data-wagon="1"]')!;
  assert.deepEqual(
    [...wagon.children].map(cell => cell.textContent!.trim()),
    ['1', 'Iron Ore', 'Iron mine', evil, 'Mk.5 belt (780/min)', '3,120 of 3,200 per trip'],
  );
  // Add rear locomotive on the card saves at once.
  const fix = shuttle.querySelector<HTMLButtonElement>('[data-line-fix="rearLoco"]')!;
  assert.equal(fix.getAttribute('aria-label'), 'Add rear locomotive: Ore shuttle');
  fix.click();
  await settle();
  assert.deepEqual(
    sent.map(update => update.type === 'trainLine' && update.value?.cars),
    [['loco', 'wagon', 'wagon', 'loco']],
  );
  assert.equal(
    card(SHUTTLE.id).querySelector('[data-line-checks-ok]')!.textContent!.trim(),
    '✓ Train and stops match.',
  );
  assert.equal(document.activeElement, $(`[data-line-edit="${SHUTTLE.id}"]`));
  // A station check opens that station's editor.
  await showTrains({
    version: 30,
    trainLines: [{ ...SHUTTLE, cars: ['loco', 'wagon', 'wagon', 'wagon', 'wagon', 'loco'] }],
  });
  const open = card(SHUTTLE.id).querySelector<HTMLButtonElement>(
    '[data-line-check-station="ts-mine01"]',
  )!;
  assert.equal(open.getAttribute('aria-label'), 'Edit station ↗: Iron mine');
  open.click();
  await settle();
  assert.equal($('#detail-title')!.textContent, 'Edit train station');
  assert.equal($<HTMLInputElement>('[data-station-name]')!.value, 'Iron mine');
});

test('an outpost card says when its belts and trains take less than its extractors give', async () => {
  await showTrains({
    version: 30,
    trainLines: [{ ...SHUTTLE, cars: ['loco', 'wagon', 'wagon', 'loco'] }],
  });
  const checks = $$('[data-station="ts-mine01"] [data-station-check]').map(
    item => item.dataset.stationCheck,
  );
  assert.deepEqual(checks, ['outpost-lanes:ts-mine01', 'outpost-trains:ts-mine01']);
  assert.equal($('[data-station="ts-works2"] [data-station-checks]'), null);
});

test('Edit line: Cancel keeps it; Delete line removes it with Undo', async () => {
  await showTrains({ version: 30, trainLines: [SHUTTLE] });
  await click(`[data-line-edit="${SHUTTLE.id}"]`);
  assert.equal($('#detail-title')!.textContent, 'Edit train line');
  await click('[data-line-add-wagon]');
  await click('[data-line-cancel]');
  assert.deepEqual(sent, [], 'Cancel saves nothing');
  await click(`[data-line-edit="${SHUTTLE.id}"]`);
  await click('[data-line-delete]');
  assert.deepEqual(sent, [{ type: 'trainLine', id: SHUTTLE.id, value: null }]);
  assert.equal(dialog().open, false);
  assert.equal(document.activeElement, $('[data-line-add]'));
  const toast = $('#toast')!;
  assert.match(toast.textContent!, /^Deleted train line “Ore shuttle”\. Undo/);
  toast.querySelector<HTMLButtonElement>('button')!.click();
  await settle();
  assert.deepEqual(state.trainLines, [SHUTTLE]);
  assert.match($('#toast')!.textContent!, /^Train line “Ore shuttle” is back\./);
});

test('deleting a station takes it off the lines, and its Undo puts them back', async () => {
  await showTrains({ version: 30, trainLines: [SHUTTLE] });
  await click('[data-station-edit="ts-mine01"]');
  await click('[data-station-delete]');
  assert.deepEqual(state.trainLines![0]!.stops, ['ts-works2']);
  const toast = $('#toast')!;
  assert.match(toast.textContent!, /It is no longer a stop of 1 train line\./);
  toast.querySelector<HTMLButtonElement>('button')!.click();
  await settle();
  await settle();
  assert.equal(state.trainStations!.length, 2);
  assert.deepEqual(state.trainLines, [SHUTTLE], 'the line has its stop back');
});
