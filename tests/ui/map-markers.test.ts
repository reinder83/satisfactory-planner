// Markers on the world map (#1283, slice 2: ui/pages/MapPage.vue, ui/detail/MarkerDialog.vue): a
// click on the map or "Add marker" opens the marker dialog for a new marker there, which Place
// marker saves as one `mapMarker` update; a press on a marker opens it to edit; a drag moves it
// and saves on the drop; the arrow keys move a focused one, saved once they rest or it loses
// focus; Delete removes it with Undo in the toast; and "Show on the map" hides or shows the
// markers for the profile (`mapLayers`), as the open profile has it.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { render } from '../../public/app/shell.ts';
import { state } from '../../public/app/session.ts';
import {
  MARKER_NUDGE,
  MARKER_NUDGE_SHIFT,
  nudgedMarker,
  onMap,
} from '../../public/app/map-markers.ts';
import { imageToWorld, worldToImage } from '../../public/app/world-map.ts';
import { WORLD_MAP } from '../../public/app/world-map.ts';
import { $, $$, applyUpdate, evil, go, open, page, stubFetch } from './setup.ts';
import type { MapMarker, ProgressState, UpdateOp } from '../../public/types/index.ts';

// happy-dom lays out nothing, so the map's box is given the size a browser would draw it at, with
// no border; every element's client rectangle is at (0, 0), so a client point is a point in the
// box. The map is drawn half the box into what the box scrolls (#1289): onImage() gives the
// point of the image under a point in the box.
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
  ($<HTMLDialogElement>('#detail') as HTMLDialogElement | null)?.close();
});

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
// The fitted zoom of slice 1: the whole image in the 400 × 300 box.
const FITS = Math.min(BOX.width / WORLD_MAP.width, BOX.height / WORLD_MAP.height, 1);
const IRON: MapMarker = {
  id: 'mk-iron01',
  name: 'Pure iron',
  type: 'resource',
  color: 'green',
  x: -120500,
  y: 48250,
};
const ARCH: MapMarker = { id: 'mk-arch02', name: 'Stone arch', type: 'landmark', x: 30000, y: 0 };

let sent: UpdateOp[] = [];
async function showMap(progress: Partial<ProgressState> = {}) {
  page();
  open({ name: evil, state: progress });
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
const box = () => $('[data-world-map]')!;
const layer = () => $('[data-map-layer]')!;
const marker = (id: string) => $<HTMLButtonElement>(`[data-map-marker="${id}"]`);
const dialog = () => $<HTMLDialogElement>('#detail')!;
const pointer = (type: string, x: number, y: number, id = 1) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: id,
    pointerType: 'mouse',
    button: 0,
    clientX: x,
    clientY: y,
  });
const key = (el: Element, name: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  el.dispatchEvent(event);
  return event;
};
// The point of the image (px of its natural size) under point (x, y) of the box: the map is
// drawn at its style's left and top in what the box scrolls.
const onImage = (x: number, y: number, zoom = FITS) => ({
  x: (x + box().scrollLeft - parseFloat(layer().style.left)) / zoom,
  y: (y + box().scrollTop - parseFloat(layer().style.top)) / zoom,
});
// Where marker `spot` is drawn on the map (px), as its style says.
const drawnAt = (el: HTMLElement) => [parseFloat(el.style.left), parseFloat(el.style.top)];

test('a click on the map opens a new marker there; Place marker saves it and focuses it', async () => {
  await showMap();
  assert.equal($$('[data-map-marker]').length, 0);
  const click = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    clientX: 120,
    clientY: 90,
  });
  layer().dispatchEvent(click);
  await settle();
  assert.equal(dialog().open, true, 'the marker dialog opens');
  assert.equal($('#detail-title')!.textContent, 'New marker');
  assert.deepEqual(sent, [], 'nothing is saved before Place marker');
  const name = $<HTMLInputElement>('[data-marker-name]')!;
  assert.equal(name.value, 'Marker 1');
  assert.equal(name.maxLength, 60);
  assert.equal($<HTMLInputElement>('[data-marker-type="landmark"]')!.checked, true);
  assert.deepEqual(
    $$<HTMLInputElement>('[data-marker-type]').map(input =>
      input.closest('label')!.textContent!.trim(),
    ),
    ['Resource node', 'Landmark', 'Note'],
  );
  assert.equal(
    $<HTMLSelectElement>('[data-marker-color]')!.options[0]!.textContent!.trim(),
    'The type’s own (Blue)',
  );
  const spot = onMap(imageToWorld(onImage(120, 90)));
  assert.match(
    $('[data-marker-spot]')!.textContent!,
    /^\s*In the game at x [−\d,]+, y [−\d,]+ \(game units\)\./,
  );
  name.value = evil;
  name.dispatchEvent(new Event('input'));
  const resource = $<HTMLInputElement>('[data-marker-type="resource"]')!;
  resource.checked = true;
  resource.dispatchEvent(new Event('change'));
  const color = $<HTMLSelectElement>('[data-marker-color]')!;
  color.value = 'purple';
  color.dispatchEvent(new Event('change'));
  $<HTMLButtonElement>('[data-marker-save]')!.click();
  await settle();
  assert.equal(sent.length, 1);
  const update = sent[0]! as Extract<UpdateOp, { type: 'mapMarker' }>;
  assert.equal(update.type, 'mapMarker');
  assert.match(update.id, /^mk-[a-z0-9]{10}$/);
  assert.deepEqual(update.value, { name: evil, type: 'resource', color: 'purple', ...spot });
  assert.equal(state.version, 27);
  assert.equal(dialog().open, false, 'the dialog closes');
  const placed = marker(update.id)!;
  assert.ok(placed, 'the marker is on the map');
  assert.equal(document.activeElement, placed, 'focus goes to the new marker');
  assert.equal(
    placed.getAttribute('aria-label'),
    `${evil}, Resource node. Enter edits it, the arrow keys move it, Delete removes it.`,
  );
  assert.equal(placed.dataset.node, 'marker:' + update.id);
  assert.equal(placed.querySelector('.map-marker-label')!.textContent, evil);
  const at = worldToImage(spot);
  const [left, top] = drawnAt(placed);
  assert.ok(Math.abs(left! - at.x * FITS) < 0.5 && Math.abs(top! - at.y * FITS) < 0.5);
  assert.equal(placed.style.getPropertyValue('--marker'), '#c9a7ff');
  assert.equal(document.querySelector('x-evil'), null, 'a hostile name is text');
});

test('a blank name is refused in the dialog; Cancel and Add marker send nothing', async () => {
  await showMap();
  $<HTMLButtonElement>('[data-map-add-marker]')!.click();
  await settle();
  assert.equal(dialog().open, true);
  const name = $<HTMLInputElement>('[data-marker-name]')!;
  name.value = '   ';
  name.dispatchEvent(new Event('input'));
  $<HTMLButtonElement>('[data-marker-save]')!.click();
  await settle();
  assert.deepEqual(sent, []);
  assert.equal($('#marker-name-error')!.textContent, 'Give the marker a name.');
  assert.equal(name.getAttribute('aria-invalid'), 'true');
  assert.equal(document.activeElement, name);
  // "Add marker" placed it in the middle of the view, which Fit puts in the middle of the map.
  const middle = onMap(imageToWorld(onImage(BOX.width / 2, BOX.height / 2)));
  assert.deepEqual(onImage(BOX.width / 2, BOX.height / 2), {
    x: WORLD_MAP.width / 2,
    y: WORLD_MAP.height / 2,
  });
  assert.match(
    $('[data-marker-spot]')!.textContent!,
    new RegExp(`x ${middle.x.toLocaleString('en-US').replace('-', '−')},`),
  );
  $<HTMLButtonElement>('[data-marker-cancel]')!.click();
  await settle();
  assert.equal(dialog().open, false);
  assert.deepEqual(sent, [], 'Cancel saves nothing');
  assert.equal($$('[data-map-marker]').length, 0);
});

// #1289: the map lies in room half the box wide and high, so a click is placed by where the map
// is drawn in what the box scrolls; a click in the room around the map places nothing.
test('a click on a zoomed and moved map places the marker at the spot clicked', async () => {
  await showMap();
  for (let i = 0; i < 3; i++) {
    $<HTMLButtonElement>('[data-map-zoom="in"]')!.click();
    await settle();
  }
  const zoom = parseFloat(layer().style.width) / WORLD_MAP.width;
  box().scrollLeft = 90;
  box().scrollTop = 410;
  const click = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    clientX: 250,
    clientY: 60,
  });
  layer().dispatchEvent(click);
  await settle();
  assert.equal(dialog().open, true);
  // The point clicked is 250 − (200 − 90) = 140 px into the map across, 60 − (150 − 410) = 320 down.
  assert.deepEqual(onImage(250, 60, zoom), { x: 140 / zoom, y: 320 / zoom });
  const spot = onMap(imageToWorld({ x: 140 / zoom, y: 320 / zoom }));
  $<HTMLButtonElement>('[data-marker-save]')!.click();
  await settle();
  const update = sent[0]! as Extract<UpdateOp, { type: 'mapMarker' }>;
  assert.deepEqual({ x: update.value!.x, y: update.value!.y }, spot);
  const [left, top] = drawnAt(marker(update.id)!);
  assert.ok(
    Math.abs(left! - 140) < 0.5 && Math.abs(top! - 320) < 0.5,
    'drawn where it was clicked',
  );
  // The room around the map is not the map.
  $('[data-map-room]')!.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }),
  );
  await settle();
  assert.equal(dialog().open, false, 'a click beside the map places nothing');
  assert.equal(sent.length, 1);
});

test('a press on a marker opens it to edit; Save replaces it where it is', async () => {
  await showMap({ version: 27, mapMarkers: [IRON, ARCH] });
  assert.deepEqual(
    $$('[data-map-marker]').map(el => el.dataset.mapMarker),
    [IRON.id, ARCH.id],
    'in the order they were placed, which is the tab order',
  );
  const iron = marker(IRON.id)!;
  iron.focus();
  iron.dispatchEvent(pointer('pointerdown', 50, 50));
  iron.dispatchEvent(pointer('pointerup', 50, 50));
  iron.click();
  await settle();
  assert.equal(dialog().open, true);
  assert.equal($('#detail-title')!.textContent, 'Edit marker');
  assert.equal($<HTMLInputElement>('[data-marker-name]')!.value, 'Pure iron');
  assert.equal($<HTMLInputElement>('[data-marker-type="resource"]')!.checked, true);
  assert.equal($<HTMLSelectElement>('[data-marker-color]')!.value, 'green');
  assert.match($('[data-marker-spot]')!.textContent!, /x −120,500, y 48,250/);
  const name = $<HTMLInputElement>('[data-marker-name]')!;
  name.value = 'Pure iron, south';
  name.dispatchEvent(new Event('input'));
  const color = $<HTMLSelectElement>('[data-marker-color]')!;
  color.value = '';
  color.dispatchEvent(new Event('change'));
  $<HTMLButtonElement>('[data-marker-save]')!.click();
  await settle();
  const { id: _id, color: _color, ...rest } = IRON;
  assert.deepEqual(sent, [
    { type: 'mapMarker', id: IRON.id, value: { ...rest, name: 'Pure iron, south' } },
  ]);
  assert.equal(document.activeElement, marker(IRON.id), 'focus is back on the marker');
  assert.deepEqual(
    $$('[data-map-marker]').map(el => el.dataset.mapMarker),
    [IRON.id, ARCH.id],
  );
  assert.equal(marker(IRON.id)!.style.getPropertyValue('--marker'), '#f89c1c', 'the type’s own');
});

test('a drag moves a marker and saves it on the drop, and opens nothing', async () => {
  await showMap({ version: 27, mapMarkers: [IRON] });
  const iron = marker(IRON.id)!;
  const from = worldToImage(IRON);
  const scrolled = [box().scrollLeft, box().scrollTop];
  iron.dispatchEvent(pointer('pointerdown', 100, 100));
  iron.dispatchEvent(pointer('pointermove', 140, 120));
  await settle();
  // The drag moves the exact spot by whole image px, as far as the pointer went.
  const start = { x: Math.round(from.x), y: Math.round(from.y) };
  const px = {
    x: Math.round(start.x + 40 / FITS) - start.x,
    y: Math.round(start.y + 20 / FITS) - start.y,
  };
  const { west, east, north, south } = WORLD_MAP.bounds;
  const to = onMap({
    x: IRON.x + (px.x * (east - west)) / WORLD_MAP.width,
    y: IRON.y + (px.y * (south - north)) / WORLD_MAP.height,
  });
  const [left, top] = drawnAt(marker(IRON.id)!);
  assert.ok(Math.abs(left! - worldToImage(to).x * FITS) < 0.01, 'it follows');
  assert.ok(top! > from.y * FITS);
  assert.ok(box().classList.contains('moving'), 'the grabbing cursor');
  assert.deepEqual([box().scrollLeft, box().scrollTop], scrolled, 'the map does not pan');
  assert.deepEqual(sent, [], 'saved only on the drop');
  iron.dispatchEvent(pointer('pointerup', 140, 120));
  iron.click();
  await settle();
  const { id: _id, ...rest } = IRON;
  assert.deepEqual(sent, [{ type: 'mapMarker', id: IRON.id, value: { ...rest, ...to } }]);
  assert.equal(dialog().open, false, 'the click that ends a drag opens nothing');
  assert.deepEqual({ x: state.mapMarkers![0]!.x, y: state.mapMarkers![0]!.y }, to);
  // A drag straight across keeps the spot's y exactly.
  const moved = marker(IRON.id)!;
  moved.dispatchEvent(pointer('pointerdown', 100, 100));
  moved.dispatchEvent(pointer('pointermove', 160, 100));
  moved.dispatchEvent(pointer('pointerup', 160, 100));
  await settle();
  assert.equal(state.mapMarkers![0]!.y, to.y);
  assert.ok(state.mapMarkers![0]!.x > to.x);
});

test('the arrow keys move a focused marker, saved once it loses focus; the map stays put', async () => {
  await showMap({ version: 27, mapMarkers: [ARCH, IRON] });
  const arch = marker(ARCH.id)!;
  arch.focus();
  const scrolled = [box().scrollLeft, box().scrollTop];
  assert.equal(key(arch, 'ArrowRight').defaultPrevented, true, 'the key moves the marker');
  key(arch, 'ArrowRight');
  key(arch, 'ArrowDown', { shiftKey: true });
  await settle();
  let expected = nudgedMarker(ARCH, 'ArrowRight', false, FITS)!;
  expected = nudgedMarker(expected, 'ArrowRight', false, FITS)!;
  expected = nudgedMarker(expected, 'ArrowDown', true, FITS)!;
  const [left, top] = drawnAt(marker(ARCH.id)!);
  const start = worldToImage(ARCH);
  assert.ok(Math.abs(left! - start.x * FITS - 2 * MARKER_NUDGE) < 1, `${left} moved right`);
  assert.ok(Math.abs(top! - start.y * FITS - MARKER_NUDGE_SHIFT) < 1, `${top} moved down`);
  assert.deepEqual([box().scrollLeft, box().scrollTop], scrolled.map(Number), 'not the map');
  assert.deepEqual(sent, [], 'not saved while the keys are still moving it');
  assert.equal(document.activeElement, marker(ARCH.id), 'focus stays on the marker');
  // Ctrl and the other keys are not the marker's.
  assert.equal(key(arch, 'ArrowLeft', { ctrlKey: true }).defaultPrevented, false);
  box().focus();
  await settle();
  const { id: _id, ...rest } = ARCH;
  assert.deepEqual(sent, [{ type: 'mapMarker', id: ARCH.id, value: { ...rest, ...expected } }]);
});

test('Delete removes a focused marker with Undo, and focus goes to the map', async () => {
  await showMap({ version: 27, mapMarkers: [IRON, ARCH] });
  const iron = marker(IRON.id)!;
  iron.focus();
  assert.equal(key(iron, 'Delete').defaultPrevented, true);
  await settle();
  assert.deepEqual(sent, [{ type: 'mapMarker', id: IRON.id, value: null }]);
  assert.equal(marker(IRON.id), null);
  assert.equal(document.activeElement, box(), 'the map, where a second Delete removes nothing');
  key(box(), 'Delete');
  await settle();
  assert.equal(sent.length, 1);
  const toast = $('#toast')!;
  assert.match(toast.textContent!, /^Deleted marker “Pure iron”\./);
  toast.querySelector<HTMLButtonElement>('button')!.click();
  await settle();
  await settle();
  const { id: _id, ...rest } = IRON;
  assert.deepEqual(sent[1], { type: 'mapMarker', id: IRON.id, value: rest });
  assert.match($('#toast')!.textContent!, /^Marker “Pure iron” is back on the map\./);
  assert.equal(document.activeElement, marker(IRON.id), 'focus on the marker that came back');
  assert.deepEqual(state.mapMarkers, [ARCH, IRON], 'back after the others');
});

// Delete right after an arrow key, before the move is saved: Undo puts the marker back where the
// key moved it, not where it was saved.
test('Delete within the save delay after an arrow key: Undo keeps the move', async () => {
  await showMap({ version: 27, mapMarkers: [IRON] });
  const iron = marker(IRON.id)!;
  iron.focus();
  key(iron, 'ArrowDown');
  await settle();
  const { x, y } = nudgedMarker(IRON, 'ArrowDown', false, FITS)!;
  assert.deepEqual(sent, [], 'the move is not saved yet');
  key(marker(IRON.id)!, 'Delete');
  await settle();
  assert.deepEqual(sent, [{ type: 'mapMarker', id: IRON.id, value: null }]);
  $('#toast')!.querySelector<HTMLButtonElement>('button')!.click();
  await settle();
  await settle();
  const { id: _id, ...rest } = IRON;
  assert.deepEqual(sent[1], { type: 'mapMarker', id: IRON.id, value: { ...rest, x, y } });
  assert.deepEqual(state.mapMarkers, [{ ...IRON, x, y }]);
  // The save delay passes and saves nothing more.
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.equal(sent.length, 2);
});

test('“Delete marker” in the dialog removes it with Undo too', async () => {
  await showMap({ version: 27, mapMarkers: [ARCH] });
  marker(ARCH.id)!.click();
  await settle();
  $<HTMLButtonElement>('[data-marker-delete]')!.click();
  await settle();
  assert.deepEqual(sent, [{ type: 'mapMarker', id: ARCH.id, value: null }]);
  assert.equal(dialog().open, false);
  assert.equal(document.activeElement, box());
  assert.equal('mapMarkers' in state, false);
  assert.equal(state.version < 27, true, 'the last marker gone: the version its content needs');
  assert.match($('#toast')!.textContent!, /^Deleted marker “Stone arch”\. Undo/);
});

test('“Show on the map” hides and shows the markers for the profile', async () => {
  await showMap({ version: 27, mapMarkers: [IRON, ARCH] });
  const toggle = $<HTMLInputElement>('[data-map-layer-toggle="markers"]')!;
  assert.equal($('[data-map-layers] legend')!.textContent, 'Show on the map');
  assert.equal(toggle.closest('label')!.textContent!.replace(/\s+/g, ' ').trim(), 'Markers (2)');
  assert.equal(toggle.checked, true);
  assert.deepEqual(
    $$<HTMLInputElement>('[data-map-layer-toggle]').map(input => input.dataset.mapLayerToggle),
    ['factories', 'markers'],
    'train stations and lines get their switch with their content (#1284)',
  );
  toggle.checked = false;
  toggle.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(sent, [{ type: 'mapLayer', layer: 'markers', value: false }]);
  assert.deepEqual(state.mapLayers, { markers: false });
  assert.equal($$('[data-map-marker]').length, 0, 'hidden');
  assert.equal($('[data-map-add-marker]'), null);
  layer().dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 }));
  await settle();
  assert.equal(dialog().open, false, 'a click places nothing while they are hidden');
  toggle.checked = true;
  toggle.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(sent[1], { type: 'mapLayer', layer: 'markers', value: true });
  assert.equal('mapLayers' in state, false);
  assert.equal($$('[data-map-marker]').length, 2);
});

test('a profile that hid its markers opens with them hidden; another shows its own', async () => {
  await showMap({ version: 27, mapMarkers: [IRON], mapLayers: { markers: false } });
  assert.equal($<HTMLInputElement>('[data-map-layer-toggle="markers"]')!.checked, false);
  assert.equal($$('[data-map-marker]').length, 0);
  assert.match($('.world-map > p.small')!.textContent!, /The markers are hidden\./);
  await showMap({ version: 27, mapMarkers: [ARCH] });
  assert.equal($<HTMLInputElement>('[data-map-layer-toggle="markers"]')!.checked, true);
  assert.deepEqual(
    $$('[data-map-marker]').map(el => el.dataset.mapMarker),
    [ARCH.id],
  );
});
