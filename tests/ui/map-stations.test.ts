// Train stations and lines on the world map (#1284, slice 4: ui/pages/MapPage.vue, app/map-stations.ts):
// "+ Add train station" opens the station editor for a new station in the middle of the view,
// which Add station saves with its place; "+ Place station" puts the station picked beside it in
// the middle; a placed station opens its editor on a press, moves with a drag (saved on the drop)
// or the arrow keys (saved once it loses focus), and Delete takes it off the map with Undo, the
// station staying in the profile. The train lines are drawn between their placed stops (solid back
// and forth, dashed one-way), and both layers have their switch in "Show on the map".
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { render } from '../../public/app/shell.ts';
import { state } from '../../public/app/session.ts';
import { onMap } from '../../public/app/map-markers.ts';
import { WORLD_MAP, imageToWorld } from '../../public/app/world-map.ts';
import { $, $$, applyUpdate, evil, go, open, page, stubFetch } from './setup.ts';
import type { ProgressState, TrainLine, TrainStation, UpdateOp } from '../../public/types/index.ts';

// happy-dom lays out nothing: the map's box gets the size a browser draws it at (as in
// map-factories.test.ts), every client rectangle at (0, 0).
const BOX = { width: 400, height: 300 };
const BOX_SIZES: Record<string, number> = {
  clientWidth: BOX.width,
  clientHeight: BOX.height,
  clientLeft: 0,
  clientTop: 0,
};
const sizes = Object.keys(BOX_SIZES).map(name => ({
  name,
  own: Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
  inherited: Object.getOwnPropertyDescriptor(Element.prototype, name),
}));
beforeEach(() => {
  for (const { name, own, inherited } of sizes) {
    // Every one of them is a getter of Element or HTMLElement in happy-dom.
    const original = (own ?? inherited)!.get!;
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        if (!this.hasAttribute('data-world-map')) return original.call(this);
        return BOX_SIZES[name];
      },
    });
  }
});
afterEach(() => {
  for (const { name, own } of sizes)
    if (own) Object.defineProperty(HTMLElement.prototype, name, own);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  $<HTMLDialogElement>('#detail')?.close();
});

const settle = async (ms = 20) => {
  await new Promise(resolve => setTimeout(resolve, ms));
  await nextTick();
};
const MINE: TrainStation = {
  id: 'ts-mine01',
  name: 'Iron mine',
  platforms: [{ kind: 'load', cargo: ['Iron Ore'], belt: 5 }],
  place: { x: -98000, y: 61250 },
};
const WORKS: TrainStation = {
  id: 'ts-works2',
  name: evil,
  platforms: [{ kind: 'unload' }],
  place: { x: 12500, y: -40000 },
};
const STORE: TrainStation = { id: 'ts-store3', name: 'Storage', platforms: [] };
const SHUTTLE: TrainLine = {
  id: 'tl-shut01',
  name: 'Ore shuttle',
  cars: ['loco', 'wagon', 'loco'],
  stops: ['ts-mine01', 'ts-works2'],
  direction: 'backAndForth',
};
const LOOP: TrainLine = { ...SHUTTLE, id: 'tl-loop02', name: 'Loop', direction: 'oneWay' };

let sent: UpdateOp[] = [];
async function showMap(progress: Partial<ProgressState> = {}) {
  page();
  open({
    state: {
      version: 30,
      trainStations: [MINE, WORKS, STORE],
      trainLines: [SHUTTLE, LOOP],
      ...progress,
    },
  });
  sent = [];
  stubFetch<UpdateOp>({
    '/api/update': (update: UpdateOp) => {
      sent.push(update);
      return applyUpdate(update);
    },
  });
  go('map');
  render();
  await settle();
  await settle();
}
const pin = (id: string) => $<HTMLButtonElement>(`[data-map-station="${id}"]`);
const box = () => $('[data-world-map]')!;
const layer = () => $('[data-map-layer]')!;
const FITS = Math.min(BOX.width / WORLD_MAP.width, BOX.height / WORLD_MAP.height, 1);
const middle = () =>
  onMap(
    imageToWorld({
      x: (BOX.width / 2 + box().scrollLeft - parseFloat(layer().style.left)) / FITS,
      y: (BOX.height / 2 + box().scrollTop - parseFloat(layer().style.top)) / FITS,
    }),
  );
const pointer = (type: string, x: number, y: number) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    clientX: x,
    clientY: y,
  });
const key = (el: Element, name: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
const stationUpdates = () =>
  sent.filter(
    (update): update is Extract<UpdateOp, { type: 'trainStation' }> =>
      update.type === 'trainStation',
  );

test('placed stations are pins named with their lines; the lines are drawn between them', async () => {
  await showMap();
  assert.deepEqual(
    $$('[data-map-station]').map(el => el.dataset.mapStation),
    ['ts-mine01', 'ts-works2'],
  );
  assert.equal(
    pin('ts-mine01')!.getAttribute('aria-label'),
    'Iron mine, train station. Lines: Ore shuttle, Loop. Enter edits it, the arrow keys move it, Delete takes it off the map.',
  );
  assert.equal(pin('ts-works2')!.querySelector('.map-station-label')!.textContent, evil);
  assert.equal(document.querySelector('x-evil'), null, 'a hostile name is text');
  const shuttle = $('[data-map-line="tl-shut01"]')!;
  assert.equal(shuttle.classList.contains('dashed'), false, 'back and forth is solid');
  assert.equal(shuttle.querySelector('text')!.textContent!.trim(), 'Ore shuttle ⇄');
  assert.equal($('[data-map-line="tl-loop02"]')!.classList.contains('dashed'), true);
  assert.equal($('[data-map-line="tl-loop02"] text')!.textContent!.trim(), 'Loop →');
  assert.equal($('[data-map-lines]')!.getAttribute('aria-hidden'), 'true');
  // The switches, with their counts.
  const label = (layerName: string) =>
    $(`[data-map-layer-toggle="${layerName}"]`)!
      .closest('label')!
      .textContent!.replace(/\s+/g, ' ')
      .trim();
  assert.equal(label('stations'), 'Train stations (2)');
  assert.equal(label('trainLines'), 'Train lines (2)');
  const lines = $<HTMLInputElement>('[data-map-layer-toggle="trainLines"]')!;
  lines.checked = false;
  lines.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(sent, [{ type: 'mapLayer', layer: 'trainLines', value: false }]);
  assert.equal($('[data-map-lines]'), null);
  const stations = $<HTMLInputElement>('[data-map-layer-toggle="stations"]')!;
  stations.checked = false;
  stations.dispatchEvent(new Event('change'));
  await settle();
  assert.equal($$('[data-map-station]').length, 0);
  assert.equal($('[data-map-add-station]'), null, 'no add control while hidden');
});

test('Place station puts the station picked in the middle; Add train station adds one there', async () => {
  await showMap();
  const select = $<HTMLSelectElement>('[data-map-station-select]')!;
  assert.equal(select.getAttribute('aria-label'), 'Train station to place on the map');
  assert.deepEqual(
    [...select.options].map(option => option.value),
    ['ts-store3'],
  );
  $<HTMLButtonElement>('[data-map-place-station]')!.click();
  await settle();
  await settle();
  const placed = stationUpdates().at(-1)!;
  // The middle of the view, or a step aside where a pin covers it (freePlace).
  assert.equal(placed.value!.name, 'Storage');
  assert.ok(placed.value!.place);
  assert.ok(placed.value!.place.x >= middle().x, 'from the middle, down and right');
  assert.equal(document.activeElement, pin('ts-store3'), 'focus goes to it');
  assert.equal($('[data-map-station-place]'), null, 'every station is on the map');
  // + Add train station: the editor for a new station, saved with its place.
  $<HTMLButtonElement>('[data-map-add-station]')!.click();
  await settle();
  assert.equal($('#detail-title')!.textContent, 'New train station');
  assert.equal($<HTMLInputElement>('[data-station-name]')!.value, 'Station 4');
  $<HTMLButtonElement>('[data-station-save]')!.click();
  await settle();
  await settle();
  const added = stationUpdates().at(-1)!;
  assert.equal(added.value!.name, 'Station 4');
  assert.ok(added.value!.place, 'placed where the map was');
  assert.equal(state.trainStations!.length, 4);
  assert.equal(document.activeElement, pin(added.id), 'focus goes to its pin');
});

test('a press opens the editor; a drag and the arrow keys move a station; Delete takes it off', async () => {
  await showMap();
  const mine = pin('ts-mine01')!;
  mine.dispatchEvent(pointer('pointerdown', 50, 50));
  mine.dispatchEvent(pointer('pointerup', 50, 50));
  mine.click();
  await settle();
  assert.equal($('#detail-title')!.textContent, 'Edit train station');
  $<HTMLDialogElement>('#detail')!.close();
  // A drag saves on the drop, keeping everything else of the station.
  mine.dispatchEvent(pointer('pointerdown', 100, 100));
  mine.dispatchEvent(pointer('pointermove', 140, 100));
  mine.dispatchEvent(pointer('pointerup', 140, 100));
  await settle();
  const dragged = stationUpdates().at(-1)!;
  assert.equal(dragged.id, 'ts-mine01');
  assert.ok(dragged.value!.place!.x > MINE.place!.x, 'moved east');
  assert.deepEqual(dragged.value!.platforms, MINE.platforms);
  // The arrow keys: saved once it loses focus.
  const before = sent.length;
  pin('ts-works2')!.focus();
  key(pin('ts-works2')!, 'ArrowUp');
  await settle();
  assert.equal(sent.length, before, 'not saved while the keys move it');
  pin('ts-works2')!.blur();
  await settle();
  const nudged = stationUpdates().at(-1)!;
  assert.equal(nudged.id, 'ts-works2');
  assert.ok(nudged.value!.place!.y < WORKS.place!.y, 'moved north');
  // Delete takes it off the map; the station and its lines stay; Undo puts it back.
  pin('ts-works2')!.focus();
  key(pin('ts-works2')!, 'Delete');
  await settle();
  assert.equal(pin('ts-works2'), null);
  assert.equal(document.activeElement, box(), 'focus goes to the map');
  const kept = state.trainStations!.find(station => station.id === 'ts-works2')!;
  assert.equal('place' in kept, false);
  assert.deepEqual(
    state.trainLines!.map(line => line.stops),
    [SHUTTLE.stops, LOOP.stops],
  );
  assert.equal($('[data-map-line="tl-shut01"]'), null, 'a line with one placed stop is not drawn');
  const toast = $('#toast')!;
  assert.match(toast.textContent!, /^Took “.*” off the map\. Undo/);
  toast.querySelector<HTMLButtonElement>('button')!.click();
  await settle();
  await settle();
  assert.deepEqual(
    state.trainStations!.find(station => station.id === 'ts-works2')!.place,
    nudged.value!.place,
  );
  assert.equal(document.activeElement, pin('ts-works2'));
});
