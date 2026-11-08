// Factories on the world map (#1283, slice 3: ui/pages/MapPage.vue): "Place factory" puts the
// factory picked beside it in the middle of the view as one `mapFactory` update and focuses it;
// a placed factory is a link to its build order (the flow page); a drag moves it and saves on the
// drop without following the link; the arrow keys move a focused one, saved once it loses focus;
// Delete takes it off the map with Undo in the toast; and "Show on the map" hides or shows the
// factories for the profile (`mapLayers`), as the open profile has it.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { toastShortcut } from '../../public/app/api.ts';
import { render } from '../../public/app/shell.ts';
import { flowRoute, state } from '../../public/app/session.ts';
import { PLACE_STEP } from '../../public/app/map-factories.ts';
import { MARKER_NUDGE, nudgedMarker, onMap } from '../../public/app/map-markers.ts';
import { WORLD_MAP, imageToWorld, worldToImage } from '../../public/app/world-map.ts';
import { $, $$, applyUpdate, evil, go, open, page, stubFetch } from './setup.ts';
import type { FactoryPlaces, ProgressState, UpdateOp } from '../../public/types/index.ts';

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
// A click on a factory link is a navigation in a browser: what the page did with it is recorded
// here, last in the bubbling, and the navigation itself is stopped so the test stays on the map.
let clicks: boolean[] = [];
const recordClick = (e: Event) => {
  if (!(e.target as Element).closest?.('[data-map-factory]')) return;
  clicks.push(e.defaultPrevented);
  e.preventDefault();
};
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
  clicks = [];
  window.addEventListener('click', recordClick);
});
afterEach(() => {
  for (const { name, own } of sizes)
    if (own) Object.defineProperty(HTMLElement.prototype, name, own);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  window.removeEventListener('click', recordClick);
});

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
// The fitted zoom of slice 1: the whole image in the 400 × 300 box.
const FITS = Math.min(BOX.width / WORLD_MAP.width, BOX.height / WORLD_MAP.height, 1);
const GROUPS = {
  groups: [
    { id: 'fg-plates1', name: evil },
    { id: 'fg-wires1', name: 'Wire' },
    { id: 'fg-power1', name: 'Power' },
  ],
  // A factory with no production line is not on the map (#1305), so each one has a line.
  assignments: {
    plates: [{ group: 'fg-plates1', rate: null }],
    wires: [{ group: 'fg-wires1', rate: null }],
    power: [{ group: 'fg-power1', rate: null }],
  },
};
const PLATES = { x: -98000, y: 61250 };
const WIRE = { x: 12500, y: -40000 };
const placed = (places: FactoryPlaces): Partial<ProgressState> => ({
  version: 28,
  factoryGroups: GROUPS,
  factoryPlaces: places,
});

let sent: UpdateOp[] = [];
async function showMap(progress: Partial<ProgressState> = {}) {
  page();
  open({ name: evil, state: { factoryGroups: GROUPS, ...progress } });
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
// The point of the image (px of its natural size) under point (x, y) of the box.
const onImage = (x: number, y: number) => ({
  x: (x + box().scrollLeft - parseFloat(layer().style.left)) / FITS,
  y: (y + box().scrollTop - parseFloat(layer().style.top)) / FITS,
});
type Point = { x: number; y: number };
const close = (actual: Point, expected: Point, what: string) =>
  assert.ok(
    Math.abs(actual.x - expected.x) < 1 && Math.abs(actual.y - expected.y) < 1,
    `${what}: ${JSON.stringify(actual)}`,
  );
const factory = (id: string) => $<HTMLAnchorElement>(`[data-map-factory="${id}"]`);
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
const drawnAt = (el: HTMLElement) => [parseFloat(el.style.left), parseFloat(el.style.top)];

test('Place factory puts the factory picked in the middle of the view and focuses it', async () => {
  await showMap();
  assert.equal($$('[data-map-factory]').length, 0);
  const select = $<HTMLSelectElement>('[data-map-place-select]')!;
  assert.equal(select.getAttribute('aria-label'), 'Factory to place on the map');
  assert.deepEqual(
    [...select.options].map(option => [option.value, option.textContent!.trim()]),
    [
      ['fg-plates1', evil],
      ['fg-wires1', 'Wire'],
      ['fg-power1', 'Power'],
    ],
    'every factory, in the Factories page’s order; a hostile name is text',
  );
  assert.equal(document.querySelector('x-evil'), null);
  select.value = 'fg-wires1';
  select.dispatchEvent(new Event('change'));
  await settle();
  const button = $<HTMLButtonElement>('[data-map-place-factory]')!;
  assert.equal(button.textContent!.trim(), '+ Place factory');
  button.click();
  await settle();
  await settle();
  // The middle of the view, which Fit puts in the middle of the map.
  assert.deepEqual(onImage(BOX.width / 2, BOX.height / 2), {
    x: WORLD_MAP.width / 2,
    y: WORLD_MAP.height / 2,
  });
  const middle = onMap(imageToWorld(onImage(BOX.width / 2, BOX.height / 2)));
  assert.deepEqual(sent, [{ type: 'mapFactory', id: 'fg-wires1', value: middle }]);
  assert.equal(state.version, 28);
  const wire = factory('fg-wires1')!;
  assert.ok(wire, 'the factory is on the map');
  assert.equal(document.activeElement, wire, 'focus goes to it');
  assert.equal(wire.tagName, 'A');
  assert.equal(wire.getAttribute('href'), '#' + flowRoute('fg-wires1'));
  assert.match(wire.getAttribute('href')!, /^#factories\/fg-wires1\/flow/);
  assert.equal(
    wire.getAttribute('aria-label'),
    'Wire, factory. Enter opens its build order, the arrow keys move it, Delete takes it off the map.',
  );
  assert.equal(wire.dataset.node, 'factory:fg-wires1');
  assert.equal(wire.querySelector('.map-factory-label')!.textContent, 'Wire');
  const at = worldToImage(middle);
  const [left, top] = drawnAt(wire);
  assert.ok(Math.abs(left! - at.x * FITS) < 0.5 && Math.abs(top! - at.y * FITS) < 0.5);
  // Each factory once: the picker now offers the others, the first of them picked.
  assert.deepEqual(
    [...$<HTMLSelectElement>('[data-map-place-select]')!.options].map(option => option.value),
    ['fg-plates1', 'fg-power1'],
  );
  assert.equal($<HTMLSelectElement>('[data-map-place-select]')!.value, 'fg-plates1');
  assert.equal(
    $('[data-map-factory-count]')!.textContent,
    '(1)',
    'the switch counts the factories on the map',
  );
});

// A factory placed while a pin covers the middle of the view steps aside diagonally, PLACE_STEP
// px on screen at a time, to the first spot no pin covers, a marker's pin as well.
test('Place factory never puts a factory on a pin already there', async () => {
  await showMap();
  const placeNext = async () => {
    $<HTMLButtonElement>('[data-map-place-factory]')!.click();
    await settle();
    await settle();
    const update = sent.at(-1)! as Extract<UpdateOp, { type: 'mapFactory' }>;
    return worldToImage(update.value!);
  };
  const middle = { x: WORLD_MAP.width / 2, y: WORLD_MAP.height / 2 };
  const step = PLACE_STEP / FITS;
  close(await placeNext(), middle, 'the first in the middle');
  close(await placeNext(), { x: middle.x + step, y: middle.y + step }, 'the second a step aside');
  assert.equal(sent.length, 2);
  // With a marker a step up and left of the middle too, the third goes two steps down and right.
  await showMap({
    ...placed({ ...state.factoryPlaces }),
    mapMarkers: [
      {
        id: 'mk-iron01',
        name: 'Iron',
        type: 'resource',
        ...onMap(imageToWorld({ x: middle.x - step, y: middle.y - step })),
      },
    ],
  });
  close(await placeNext(), { x: middle.x + 2 * step, y: middle.y + 2 * step }, 'the third');
  const pins = $$('[data-map-factory], [data-map-marker]').map(drawnAt);
  assert.equal(pins.length, 4);
  for (const [i, a] of pins.entries())
    for (const b of pins.slice(i + 1))
      assert.ok(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) >= 32, 'no pin on another');
});

test('every factory placed: no picker; a profile without factories has none either', async () => {
  await showMap(placed({ 'fg-plates1': PLATES, 'fg-wires1': WIRE, 'fg-power1': WIRE }));
  assert.deepEqual(
    $$('[data-map-factory]').map(el => el.dataset.mapFactory),
    ['fg-plates1', 'fg-wires1', 'fg-power1'],
    'in the Factories page’s order, which is the tab order',
  );
  assert.equal($('[data-map-place]'), null);
  await showMap({ factoryGroups: { groups: [], assignments: {} } });
  assert.equal($('[data-map-place]'), null);
  assert.doesNotMatch($('.world-map > p.small')!.textContent!, /factory/i);
});

test('a press on a factory follows its link; a drag moves it, saves on the drop and follows nothing', async () => {
  await showMap(placed({ 'fg-plates1': PLATES }));
  const plates = factory('fg-plates1')!;
  plates.dispatchEvent(pointer('pointerdown', 50, 50));
  plates.dispatchEvent(pointer('pointerup', 50, 50));
  plates.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.deepEqual(clicks, [false], 'a press without a drag follows the link');
  assert.deepEqual(sent, []);
  const from = worldToImage(PLATES);
  plates.dispatchEvent(pointer('pointerdown', 100, 100));
  plates.dispatchEvent(pointer('pointermove', 140, 100));
  await settle();
  const [left] = drawnAt(factory('fg-plates1')!);
  assert.ok(left! > from.x * FITS + 30, 'it follows');
  assert.ok(box().classList.contains('moving'));
  assert.deepEqual(sent, [], 'saved only on the drop');
  plates.dispatchEvent(pointer('pointerup', 140, 100));
  const end = new MouseEvent('click', { bubbles: true, cancelable: true });
  plates.dispatchEvent(end);
  await settle();
  assert.equal(end.defaultPrevented, true, 'the click that ends a drag follows nothing');
  assert.deepEqual(clicks, [false], 'and goes no further');
  assert.equal(sent.length, 1);
  const update = sent[0]! as Extract<UpdateOp, { type: 'mapFactory' }>;
  assert.equal(update.id, 'fg-plates1');
  assert.equal(update.value!.y, PLATES.y, 'a drag straight across keeps y');
  assert.ok(update.value!.x > PLATES.x);
  assert.deepEqual(state.factoryPlaces, { 'fg-plates1': update.value });
});

test('the arrow keys move a focused factory, saved once it loses focus', async () => {
  await showMap(placed({ 'fg-wires1': WIRE }));
  const wire = factory('fg-wires1')!;
  wire.focus();
  const scrolled = [box().scrollLeft, box().scrollTop];
  assert.equal(key(wire, 'ArrowLeft').defaultPrevented, true);
  key(wire, 'ArrowUp', { shiftKey: true });
  await settle();
  let expected = nudgedMarker(WIRE, 'ArrowLeft', false, FITS)!;
  expected = nudgedMarker(expected, 'ArrowUp', true, FITS)!;
  const [left] = drawnAt(factory('fg-wires1')!);
  assert.ok(Math.abs(worldToImage(WIRE).x * FITS - left! - MARKER_NUDGE) < 1, `${left} moved left`);
  assert.deepEqual([box().scrollLeft, box().scrollTop], scrolled, 'not the map');
  assert.deepEqual(sent, [], 'not saved while the keys still move it');
  assert.equal(key(wire, 'ArrowLeft', { altKey: true }).defaultPrevented, false);
  box().focus();
  await settle();
  assert.deepEqual(sent, [{ type: 'mapFactory', id: 'fg-wires1', value: expected }]);
});

test('Delete takes a focused factory off the map with Undo, and focus goes to the map', async () => {
  await showMap(placed({ 'fg-plates1': PLATES, 'fg-wires1': WIRE }));
  const wire = factory('fg-wires1')!;
  wire.focus();
  assert.equal(key(wire, 'Delete').defaultPrevented, true);
  await settle();
  assert.deepEqual(sent, [{ type: 'mapFactory', id: 'fg-wires1', value: null }]);
  assert.equal(factory('fg-wires1'), null);
  assert.equal(document.activeElement, box());
  key(box(), 'Delete');
  await settle();
  assert.equal(sent.length, 1, 'a second Delete takes nothing off');
  assert.deepEqual(
    [...$<HTMLSelectElement>('[data-map-place-select]')!.options].map(option => option.value),
    ['fg-wires1', 'fg-power1'],
    'it can be placed again',
  );
  const toast = $('#toast')!;
  assert.match(toast.textContent!, /^Took “Wire” off the map\./);
  toast.querySelector<HTMLButtonElement>('button')!.click();
  await settle();
  await settle();
  assert.deepEqual(sent[1], { type: 'mapFactory', id: 'fg-wires1', value: WIRE });
  assert.match($('#toast')!.textContent!, /^“Wire” is back on the map\./);
  assert.equal(document.activeElement, factory('fg-wires1'), 'focus on the factory back');
  assert.deepEqual(state.factoryPlaces, { 'fg-plates1': PLATES, 'fg-wires1': WIRE });
});

// Delete right after an arrow key, before the move is saved: Undo puts the factory back where the
// key moved it, not where it was saved.
test('Delete within the save delay after an arrow key: Undo keeps the move', async () => {
  await showMap(placed({ 'fg-wires1': WIRE }));
  const wire = factory('fg-wires1')!;
  wire.focus();
  key(wire, 'ArrowRight', { shiftKey: true });
  await settle();
  const movedTo = nudgedMarker(WIRE, 'ArrowRight', true, FITS)!;
  assert.deepEqual(sent, [], 'the move is not saved yet');
  key(factory('fg-wires1')!, 'Delete');
  await settle();
  assert.deepEqual(sent, [{ type: 'mapFactory', id: 'fg-wires1', value: null }]);
  $('#toast')!.querySelector<HTMLButtonElement>('button')!.click();
  await settle();
  await settle();
  assert.deepEqual(sent[1], { type: 'mapFactory', id: 'fg-wires1', value: movedTo });
  assert.deepEqual(state.factoryPlaces, { 'fg-wires1': movedTo });
  // The save delay passes and saves nothing more.
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.equal(sent.length, 2);
});

test('“Show on the map” hides and shows the factories for the profile', async () => {
  await showMap(placed({ 'fg-plates1': PLATES }));
  const toggle = $<HTMLInputElement>('[data-map-layer-toggle="factories"]')!;
  assert.equal(toggle.closest('label')!.textContent!.replace(/\s+/g, ' ').trim(), 'Factories (1)');
  assert.equal(toggle.checked, true);
  toggle.checked = false;
  toggle.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(sent, [{ type: 'mapLayer', layer: 'factories', value: false }]);
  assert.deepEqual(state.mapLayers, { factories: false });
  assert.equal($$('[data-map-factory]').length, 0, 'hidden');
  assert.equal($('[data-map-place]'), null, 'and nothing to place while hidden');
  assert.match($('.world-map > p.small')!.textContent!, /The factories are hidden\./);
  assert.ok($$('[data-map-add-marker]').length, 'the markers are not touched');
  toggle.checked = true;
  toggle.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(sent[1], { type: 'mapLayer', layer: 'factories', value: true });
  assert.equal('mapLayers' in state, false);
  assert.equal($$('[data-map-factory]').length, 1);
});

test('a profile that hid its factories opens with them hidden; another shows its own', async () => {
  await showMap({ ...placed({ 'fg-plates1': PLATES }), mapLayers: { factories: false } });
  assert.equal($<HTMLInputElement>('[data-map-layer-toggle="factories"]')!.checked, false);
  assert.equal($$('[data-map-factory]').length, 0);
  await showMap(placed({ 'fg-wires1': WIRE }));
  assert.equal($<HTMLInputElement>('[data-map-layer-toggle="factories"]')!.checked, true);
  assert.deepEqual(
    $$('[data-map-factory]').map(el => el.dataset.mapFactory),
    ['fg-wires1'],
  );
});

// "Remove from map" (#1305): the mouse's way off the map. A button beside the pin of the factory
// the pointer is on or that has focus, so the keyboard reaches it with Tab; it takes the factory
// off with the same Undo as Delete, puts focus on the map, and never places a marker.
const removeButton = (id: string) => $<HTMLButtonElement>(`[data-map-factory-remove="${id}"]`);
test('Remove from map: shown for the factory under the pointer, one click takes it off with Undo', async () => {
  await showMap(placed({ 'fg-plates1': PLATES, 'fg-wires1': WIRE }));
  assert.equal($$('[data-map-factory-remove]').length, 0, 'not drawn until a factory is touched');
  factory('fg-wires1')!.dispatchEvent(new MouseEvent('mouseenter'));
  await settle();
  const button = removeButton('fg-wires1')!;
  assert.ok(button, 'drawn beside the factory the pointer is on');
  assert.equal(removeButton('fg-plates1'), null, 'and only there');
  assert.equal(button.textContent!.replace(/\s+/g, ' ').trim(), '× Remove from map');
  assert.equal(button.getAttribute('aria-label'), 'Remove from map: Wire');
  assert.equal(button.type, 'button');
  assert.deepEqual(drawnAt(button), drawnAt(factory('fg-wires1')!), 'on the pin’s spot');
  // The pointer crosses to the button and clicks it: no marker dialog, nothing followed.
  button.dispatchEvent(new MouseEvent('mouseenter'));
  button.click();
  await settle();
  assert.deepEqual(sent, [{ type: 'mapFactory', id: 'fg-wires1', value: null }]);
  assert.equal(factory('fg-wires1'), null);
  assert.equal(removeButton('fg-wires1'), null);
  assert.equal(document.activeElement, box(), 'focus goes to the map');
  assert.equal($('#detail[open]'), null, 'no marker was placed');
  assert.deepEqual(clicks, [], 'the link was not followed');
  assert.match($('#toast')!.textContent!, /^Took “Wire” off the map\./);
  // Undo brings it back where it stood.
  $('#toast')!.querySelector<HTMLButtonElement>('button')!.click();
  await settle();
  await settle();
  assert.deepEqual(sent[1], { type: 'mapFactory', id: 'fg-wires1', value: WIRE });
  assert.deepEqual(state.factoryPlaces, { 'fg-plates1': PLATES, 'fg-wires1': WIRE });
  assert.ok(factory('fg-wires1'));
});

test('Remove from map by keyboard: Tab reaches the button after the factory, Enter presses it', async () => {
  await showMap(placed({ 'fg-wires1': WIRE }));
  const wire = factory('fg-wires1')!;
  wire.focus();
  await settle();
  const button = removeButton('fg-wires1')!;
  assert.ok(button, 'drawn while the factory has focus');
  assert.equal(
    wire.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    Node.DOCUMENT_POSITION_FOLLOWING,
    'the next control in the tab order',
  );
  // Tab moves focus to it: the factory's blur names the button, which stays.
  wire.dispatchEvent(new FocusEvent('blur', { relatedTarget: button }));
  button.focus();
  await settle();
  assert.equal(removeButton('fg-wires1'), button, 'still there while it has focus');
  assert.equal(document.activeElement, button);
  // Enter or Space on a button is its click.
  button.click();
  await settle();
  assert.deepEqual(sent, [{ type: 'mapFactory', id: 'fg-wires1', value: null }]);
  assert.equal(document.activeElement, box());
  // Ctrl+Z presses the toast's Undo, as for Delete.
  toastShortcut(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true }));
  await settle();
  await settle();
  assert.deepEqual(sent[1], { type: 'mapFactory', id: 'fg-wires1', value: WIRE });
  assert.equal(document.activeElement, factory('fg-wires1'));
});

test('Remove from map follows a factory that is being moved and leaves when focus leaves', async () => {
  await showMap(placed({ 'fg-wires1': WIRE }));
  const wire = factory('fg-wires1')!;
  wire.focus();
  key(wire, 'ArrowRight');
  await settle();
  assert.deepEqual(drawnAt(removeButton('fg-wires1')!), drawnAt(factory('fg-wires1')!));
  wire.blur();
  await settle();
  assert.equal(removeButton('fg-wires1'), null, 'gone once focus has left');
  await new Promise(resolve => setTimeout(resolve, 700));
});

// A factory with no production line is not on the map (#1305): nothing to open, and the Factories
// page hides it. Its saved place stays untouched, so it is back where it was with its first line.
test('a factory without lines is not drawn or offered, keeps its place, and returns with a line', async () => {
  const places = { 'fg-plates1': PLATES, 'fg-wires1': WIRE };
  const groups = {
    groups: GROUPS.groups,
    assignments: { wires: [{ group: 'fg-wires1', rate: null }] },
  };
  await showMap({ version: 28, factoryGroups: groups, factoryPlaces: places });
  assert.deepEqual(
    $$('[data-map-factory]').map(el => el.dataset.mapFactory),
    ['fg-wires1'],
    'only the factory with a line',
  );
  assert.equal($('[data-map-factory-count]')!.textContent, '(1)');
  assert.equal($('[data-map-place]'), null, 'nothing to place: the others have no line');
  assert.deepEqual(state.factoryPlaces, places, 'the empty factory’s place is kept');
  // It gets its first line: it is on the map again, where it was.
  await showMap({
    version: 28,
    factoryGroups: {
      groups: GROUPS.groups,
      assignments: { ...groups.assignments, plates: [{ group: 'fg-plates1', rate: 100 }] },
    },
    factoryPlaces: places,
  });
  assert.deepEqual(
    $$('[data-map-factory]').map(el => el.dataset.mapFactory),
    ['fg-plates1', 'fg-wires1'],
  );
  const at = worldToImage(PLATES);
  assert.ok(Math.abs(parseFloat(factory('fg-plates1')!.style.left) - at.x * FITS) < 1);
});

// #1310: a pin that was hovered or focused when it was taken off the map comes back from Undo or
// Ctrl+Z without a "Remove from map" button, until it is hovered or focused again.
test('Remove from map: the button does not come back with the factory after Undo or Ctrl+Z', async () => {
  await showMap(placed({ 'fg-wires1': WIRE }));
  factory('fg-wires1')!.dispatchEvent(new MouseEvent('mouseenter'));
  await settle();
  removeButton('fg-wires1')!.click();
  await settle();
  $('#toast')!.querySelector<HTMLButtonElement>('button')!.click();
  await settle();
  await settle();
  assert.ok(factory('fg-wires1'), 'Undo brought the factory back');
  assert.equal(removeButton('fg-wires1'), null, 'no button for a pointer that is elsewhere');
  // Removed by Delete while focused, restored by Ctrl+Z.
  const wire = factory('fg-wires1')!;
  wire.focus();
  wire.dispatchEvent(new MouseEvent('mouseenter'));
  key(wire, 'Delete');
  await settle();
  assert.equal(factory('fg-wires1'), null);
  toastShortcut(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true }));
  await settle();
  await settle();
  assert.ok(factory('fg-wires1'));
  assert.equal(removeButton('fg-wires1'), null, 'nor after Ctrl+Z');
  await new Promise(resolve => setTimeout(resolve, 700));
});

// #1310: where a device cannot hover, a pill for every factory covered the pins beside them at Fit
// zoom. The first tap on a factory picks it and shows only its button (the link is not followed);
// a tap on it again follows the link; a press elsewhere on the map puts the button away.
test('Remove from map on a touch device: one pill, for the tapped factory', async () => {
  const original = window.matchMedia;
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: query.includes('hover: none'),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  });
  try {
    await showMap(placed({ 'fg-plates1': PLATES, 'fg-wires1': WIRE }));
    assert.equal($$('[data-map-factory-remove]').length, 0, 'none until a factory is tapped');
    factory('fg-wires1')!.click();
    await settle();
    assert.deepEqual(clicks, [true], 'the first tap picked it: the link was not followed');
    assert.deepEqual(
      $$('[data-map-factory-remove]').map(el => el.dataset.mapFactoryRemove),
      ['fg-wires1'],
      'a button for the tapped factory only',
    );
    factory('fg-plates1')!.click();
    await settle();
    assert.deepEqual(
      $$('[data-map-factory-remove]').map(el => el.dataset.mapFactoryRemove),
      ['fg-plates1'],
      'tapping another moves the button',
    );
    factory('fg-plates1')!.click();
    assert.deepEqual(clicks.slice(2), [false], 'the second tap follows the link');
    $('[data-map-image]')!.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }),
    );
    await settle();
    assert.equal($$('[data-map-factory-remove]').length, 0, 'a press on the map puts it away');
    // Pick, remove, Undo: no button comes back.
    factory('fg-wires1')!.click();
    await settle();
    removeButton('fg-wires1')!.click();
    await settle();
    $('#toast')!.querySelector<HTMLButtonElement>('button')!.click();
    await settle();
    await settle();
    assert.ok(factory('fg-wires1'));
    assert.equal($$('[data-map-factory-remove]').length, 0);
  } finally {
    window.matchMedia = original;
  }
});

// A full typed MediaQueryList for a device that cannot hover (a phone) or can (a mouse).
const media = (query: string, hover: boolean): MediaQueryList => ({
  matches: query.includes('hover: none') ? !hover : false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
});

// #1313: on a device that cannot hover a tap on an empty part of the map opens no marker dialog
// (it fired when a tap dismissed a picked factory or ended a pan); "Add marker" still places one,
// in the middle of the view. A click with a mouse opens it as before.
test('on a touch device a tap on the empty map places no marker; Add marker does', async () => {
  const original = window.matchMedia;
  window.matchMedia = (query: string) => media(query, false);
  try {
    await showMap(placed({ 'fg-wires1': WIRE }));
    const dialog = () => $<HTMLDialogElement>('#detail')!;
    const tap = () =>
      layer().dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 200, clientY: 150 }),
      );
    tap();
    await settle();
    assert.equal(dialog().open, false, 'a tap on the empty map opens nothing');
    factory('fg-wires1')!.click();
    await settle();
    assert.ok(removeButton('fg-wires1'), 'the factory is picked');
    $('[data-map-image]')!.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }),
    );
    tap();
    await settle();
    assert.equal(removeButton('fg-wires1'), null, 'the tap dismissed the pick');
    assert.equal(dialog().open, false, 'and opened no Add marker');
    $<HTMLButtonElement>('[data-map-add-marker]')!.click();
    await settle();
    assert.equal(dialog().open, true, 'Add marker opens the dialog for a new marker');
  } finally {
    window.matchMedia = original;
  }
});

test('with a mouse a click on the empty map still opens Add marker', async () => {
  const original = window.matchMedia;
  window.matchMedia = (query: string) => media(query, true);
  try {
    await showMap(placed({ 'fg-wires1': WIRE }));
    layer().dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 200, clientY: 150 }),
    );
    await settle();
    assert.equal($<HTMLDialogElement>('#detail')!.open, true);
  } finally {
    window.matchMedia = original;
  }
});

// #1313: the "Remove from map" pill stays in the map's frame: shifted left at the right edge,
// right at the left edge, flipped above its pin at the bottom edge. happy-dom lays out nothing,
// so the pill is given the rectangle a browser would draw it at (the frame is 0..400 by 0..300).
test('the Remove from map pill is kept inside the map frame', async () => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  let at = new DOMRect(0, 0, 0, 0);
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.hasAttribute('data-world-map')) return new DOMRect(0, 0, BOX.width, BOX.height);
    if (this.hasAttribute('data-map-factory-remove')) {
      const dx = parseFloat(this.style.getPropertyValue('--remove-dx') || '0');
      const dy = parseFloat(this.style.getPropertyValue('--remove-dy') || '0');
      return new DOMRect(at.x + dx, at.y + dy, at.width, at.height);
    }
    return original.call(this);
  };
  try {
    await showMap(placed({ 'fg-wires1': WIRE }));
    const shown = async (rect: DOMRect) => {
      at = rect;
      factory('fg-wires1')!.dispatchEvent(new MouseEvent('mouseenter'));
      await settle();
      const pill = removeButton('fg-wires1')!;
      box().dispatchEvent(new Event('scroll'));
      await settle();
      return pill.style;
    };
    const inside = await shown(new DOMRect(100, 100, 120, 26));
    assert.equal(inside.getPropertyValue('--remove-dx'), '', 'inside: not moved');
    assert.equal(inside.getPropertyValue('--remove-dy'), '');
    const right = await shown(new DOMRect(340, 100, 120, 26));
    assert.equal(right.getPropertyValue('--remove-dx'), '-60px', 'right edge: shifted left');
    const left = await shown(new DOMRect(-30, 100, 120, 26));
    assert.equal(left.getPropertyValue('--remove-dx'), '30px', 'left edge: shifted right');
    const bottom = await shown(new DOMRect(100, 285, 120, 26));
    assert.equal(bottom.getPropertyValue('--remove-dy'), '-58px', 'bottom edge: above the pin');
    const top = await shown(new DOMRect(100, -10, 120, 26));
    assert.equal(top.getPropertyValue('--remove-dy'), '', 'top edge: stays below the pin');
  } finally {
    HTMLElement.prototype.getBoundingClientRect = original;
  }
});
