// The world map page (#1283, slice 1: #map, ui/pages/MapPage.vue): the owner's map image with its
// attribution, opened fitted to its box, and the flow graph's pan and zoom (graph-pan-zoom.ts):
// − / + / Fit, the wheel around the pointer, a drag on the map, and the keyboard on the focused
// map (the arrow keys move it, + and − zoom it). It is in the sidebar after Logistics. Nothing is
// stored: no save is sent.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { render } from '../../public/app/shell.ts';
import { WORLD_MAP } from '../../public/app/world-map.ts';
import { $, $$, evil, go, open, page, stubFetch } from './setup.ts';

// happy-dom lays out nothing, so the map's box is given the size a browser would draw it at, with
// no border (clientLeft and clientTop).
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
});

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const box = () => $('[data-world-map]')!;
const drawnWidth = () => parseFloat($('[data-map-layer]')!.style.width);
const drawnHeight = () => parseFloat($('[data-map-layer]')!.style.height);
const zoomLevel = () => $('[data-map-zoom-level]')!.textContent!.trim();
const zoomButton = (which: string) => $<HTMLButtonElement>(`[data-map-zoom="${which}"]`)!;
const close = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${what}: ${actual} ≠ ${expected}`);
// The fitted zoom: the whole image in the box, never above its natural size.
const FITS = Math.min(BOX.width / WORLD_MAP.width, BOX.height / WORLD_MAP.height, 1);
// Presses + `times`: from the fitted 23%, three presses draw the map 586 px wide, five 915 px.
async function zoomInTimes(times: number) {
  for (let i = 0; i < times; i++) zoomButton('in').click();
  await settle();
}

let calls: [path: string, body: unknown][] = [];
async function showMap() {
  page();
  open({ name: evil });
  calls = stubFetch({});
  go('map');
  render();
  await settle();
  await settle();
}

test('the map page shows the image, its attribution and a named, focusable map', async () => {
  await showMap();
  assert.equal($('#main h1')!.textContent, 'World map');
  assert.equal(document.title, 'World map · Satisfactory Planner');
  const image = $<HTMLImageElement>('[data-map-image]')!;
  assert.equal(image.getAttribute('src'), './images/satisfactory-map.webp', 'page-relative');
  assert.equal(image.getAttribute('alt'), 'The Satisfactory world map, north up');
  assert.equal(image.getAttribute('draggable'), 'false');
  assert.equal($('[data-map-attribution]')!.textContent!.trim(), 'Map: © Coffee Stain Studios');
  assert.equal(box().tabIndex, 0, 'the map takes focus, for the keyboard');
  assert.match(box().getAttribute('aria-label')!, /^World map\. The arrow keys move it/);
  assert.deepEqual(
    ['out', 'in', 'fit'].map(which => zoomButton(which).getAttribute('aria-label')),
    ['Zoom out', 'Zoom in', 'Fit the whole map'],
  );
  for (const which of ['out', 'in', 'fit']) assert.equal(zoomButton(which).type, 'button');
  assert.equal(document.querySelector('x-evil'), null);
});

test('the sidebar lists the map after Logistics and marks it while it is shown', async () => {
  await showMap();
  const nav = $$('.nav a').map(a => a.getAttribute('href'));
  assert.deepEqual(nav.slice(0, 4), ['#plan', '#factories', '#logistics', '#map']);
  const link = $('.nav a[href="#map"]')!;
  assert.equal(link.textContent!.trim(), '◎World map');
  assert.equal(link.getAttribute('aria-current'), 'page');
  assert.equal(link.querySelector('.navicon')!.getAttribute('aria-hidden'), 'true');
});

test('the map opens fitted to its box: the whole image, from its top-left corner', async () => {
  await showMap();
  close(drawnWidth(), WORLD_MAP.width * FITS, 'width');
  close(drawnHeight(), WORLD_MAP.height * FITS, 'height');
  assert.ok(drawnWidth() <= BOX.width && drawnHeight() <= BOX.height, 'the whole map fits');
  assert.equal(zoomLevel(), `${Math.round(FITS * 100)}%`);
  assert.equal(box().scrollLeft, 0);
  assert.equal(box().scrollTop, 0);
});

test('− / + zoom the map by a step, and Fit brings the whole map back', async () => {
  await showMap();
  zoomButton('in').click();
  await settle();
  close(drawnWidth(), WORLD_MAP.width * FITS * 1.25, 'zoomed in');
  zoomButton('in').click();
  await settle();
  close(drawnWidth(), WORLD_MAP.width * FITS * 1.25 ** 2, 'zoomed in twice');
  zoomButton('out').click();
  await settle();
  close(drawnWidth(), WORLD_MAP.width * FITS * 1.25, 'zoomed out');
  box().scrollLeft = 120;
  box().scrollTop = 40;
  zoomButton('fit').click();
  await settle();
  close(drawnWidth(), WORLD_MAP.width * FITS, 'fitted again');
  assert.deepEqual([box().scrollLeft, box().scrollTop], [0, 0], 'from the top-left corner');
  assert.deepEqual(calls, [], 'a view is never saved: the page sends nothing');
});

test('the wheel zooms around the pointer: the spot under it stays under it', async () => {
  await showMap();
  // Zoomed in far enough that the map is wider and taller than its box in both views.
  await zoomInTimes(3);
  const el = box();
  el.scrollLeft = 150;
  el.scrollTop = 90;
  const before = drawnWidth();
  // The box's corner is at (0, 0) in happy-dom, so the pointer's client point is its point in the box.
  const pointer = { x: 260, y: 110 };
  const spot = { x: (el.scrollLeft + pointer.x) / before, y: (el.scrollTop + pointer.y) / before };
  const wheel = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY: -100,
  });
  // happy-dom's WheelEvent has no pointer position, which a browser's has.
  Object.defineProperties(wheel, { clientX: { value: pointer.x }, clientY: { value: pointer.y } });
  $('[data-map-layer]')!.dispatchEvent(wheel);
  await settle();
  assert.equal(wheel.defaultPrevented, true, 'the wheel zooms rather than scrolls the page');
  const after = drawnWidth();
  assert.ok(after > before, 'up zooms in');
  close((el.scrollLeft + pointer.x) / after, spot.x, 'the spot under the pointer, across');
  close((el.scrollTop + pointer.y) / after, spot.y, 'the spot under the pointer, down');
});

test('a drag on the map moves it', async () => {
  await showMap();
  await zoomInTimes(3);
  const el = box();
  el.scrollLeft = 200;
  el.scrollTop = 100;
  const layer = $('[data-map-layer]')!;
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
  layer.dispatchEvent(pointer('pointerdown', 100, 100));
  layer.dispatchEvent(pointer('pointermove', 40, 70));
  assert.deepEqual([el.scrollLeft, el.scrollTop], [260, 130], 'the map follows the drag');
  await settle();
  assert.ok(el.classList.contains('panning'), 'the grabbing cursor while it moves');
  layer.dispatchEvent(pointer('pointerup', 40, 70));
  await settle();
  assert.equal(el.classList.contains('panning'), false);
});

test('on the focused map the arrow keys move it and + and − zoom it', async () => {
  await showMap();
  await zoomInTimes(5);
  const el = box();
  el.focus();
  el.scrollLeft = 300;
  el.scrollTop = 200;
  const key = (name: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', {
      key: name,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    el.dispatchEvent(event);
    return event;
  };
  assert.equal(key('ArrowRight').defaultPrevented, true, 'the key moves the map, not the page');
  await settle();
  assert.deepEqual([el.scrollLeft, el.scrollTop], [380, 200], 'right');
  key('ArrowDown');
  await settle();
  assert.deepEqual([el.scrollLeft, el.scrollTop], [380, 280], 'down');
  key('ArrowLeft', { shiftKey: true });
  await settle();
  assert.deepEqual([el.scrollLeft, el.scrollTop], [60, 280], 'Shift moves it further');
  key('ArrowUp');
  await settle();
  assert.deepEqual([el.scrollLeft, el.scrollTop], [60, 200], 'up');
  key('ArrowLeft', { shiftKey: true });
  await settle();
  assert.equal(el.scrollLeft, 0, 'never past the map’s edge');
  const width = drawnWidth();
  assert.equal(key('+').defaultPrevented, true);
  await settle();
  close(drawnWidth(), width * 1.25, '+ zooms in');
  key('-');
  await settle();
  close(drawnWidth(), width, '− zooms out');
  // Ctrl + is the browser's own zoom of the page.
  assert.equal(key('+', { ctrlKey: true }).defaultPrevented, false);
  await settle();
  close(drawnWidth(), width, 'Ctrl + leaves the map alone');
  assert.equal(document.activeElement, el, 'focus stays on the map');
});
