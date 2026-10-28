// The world map page (#1283, slice 1: #map, ui/pages/MapPage.vue): the owner's map image with its
// attribution, opened fitted to the middle of its box, and the flow graph's pan and zoom
// (graph-pan-zoom.ts) with room to drag the map past its edges (#1289):
// − / + / Fit, the wheel around the pointer, a drag on the map, and the keyboard on the focused
// map (the arrow keys move it, + and − zoom it). It is in the sidebar after Logistics. Nothing is
// stored: no save is sent. Since #1289 a drag moves the map on a wide box while the map is
// narrower than it, and nothing in the box can be selected or dragged by the browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  Object.assign(BOX_SIZES, { clientWidth: BOX.width, clientHeight: BOX.height });
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
// Where the map's top-left corner is drawn in the box's visible area (px). Before #1289 the map
// had no offset and sat in the middle of a wider box (margin: 0 auto).
const mapAt = () => {
  const layer = $('[data-map-layer]')!;
  const el = box();
  const left = layer.style.left
    ? parseFloat(layer.style.left)
    : Math.max(0, (el.clientWidth - drawnWidth()) / 2);
  return {
    x: left - el.scrollLeft,
    y: (layer.style.top ? parseFloat(layer.style.top) : 0) - el.scrollTop,
  };
};
// What a browser does that happy-dom does not: the box scrolls only as far as what it holds
// reaches past it. What it holds is its children's drawn sizes and offsets (style), at least the
// box itself.
function scrollsAsDrawn(el: HTMLElement) {
  const reach = (side: 'width' | 'height') =>
    Math.max(
      side === 'width' ? el.clientWidth : el.clientHeight,
      ...[...el.children].map(child => {
        const css = (child as HTMLElement).style;
        const offset = parseFloat(side === 'width' ? css.left : css.top) || 0;
        return offset + (parseFloat(css[side]) || 0);
      }),
    );
  const at = { left: el.scrollLeft, top: el.scrollTop };
  const keep = (value: number, most: number) => Math.min(Math.max(0, most), Math.max(0, value));
  Object.defineProperties(el, {
    scrollLeft: {
      configurable: true,
      get: () => at.left,
      set: (value: number) => (at.left = keep(value, reach('width') - el.clientWidth)),
    },
    scrollTop: {
      configurable: true,
      get: () => at.top,
      set: (value: number) => (at.top = keep(value, reach('height') - el.clientHeight)),
    },
  });
}
// The map page on a wide box, as on a desktop screen: 1240 × 640, where Fit draws the map 640 px
// wide and a step in 800 px, both narrower than the box.
async function showWideMap() {
  Object.assign(BOX_SIZES, { clientWidth: 1240, clientHeight: 640 });
  await showMap();
  scrollsAsDrawn(box());
  zoomButton('fit').click();
  await settle();
}
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
const wheelAt = (x: number, y: number, deltaY: number) => {
  const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY });
  // happy-dom's WheelEvent has no pointer position, which a browser's has.
  Object.defineProperties(wheel, { clientX: { value: x }, clientY: { value: y } });
  return wheel;
};
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

test('the map opens fitted to its box: the whole image, in its middle', async () => {
  await showMap();
  close(drawnWidth(), WORLD_MAP.width * FITS, 'width');
  close(drawnHeight(), WORLD_MAP.height * FITS, 'height');
  assert.ok(drawnWidth() <= BOX.width && drawnHeight() <= BOX.height, 'the whole map fits');
  assert.equal(zoomLevel(), `${Math.round(FITS * 100)}%`);
  // Half the box of room on each side of the map (#1289).
  const room = $('[data-map-room]')!.style;
  assert.deepEqual(
    [parseFloat(room.width), parseFloat(room.height)],
    [drawnWidth() + BOX.width, drawnHeight() + BOX.height],
  );
  assert.deepEqual(mapAt(), {
    x: (BOX.width - drawnWidth()) / 2,
    y: (BOX.height - drawnHeight()) / 2,
  });
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
  assert.deepEqual(
    mapAt(),
    { x: (BOX.width - drawnWidth()) / 2, y: (BOX.height - drawnHeight()) / 2 },
    'in the middle of the box',
  );
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
  // The spot of the map under the pointer, as a share of the map's size.
  const under = (drawn: number) => ({
    x: (pointer.x - mapAt().x) / drawn,
    y: (pointer.y - mapAt().y) / drawn,
  });
  const spot = under(before);
  const wheel = wheelAt(pointer.x, pointer.y, -100);
  $('[data-map-layer]')!.dispatchEvent(wheel);
  await settle();
  assert.equal(wheel.defaultPrevented, true, 'the wheel zooms rather than scrolls the page');
  const after = drawnWidth();
  assert.ok(after > before, 'up zooms in');
  close(under(after).x, spot.x, 'the spot under the pointer, across');
  close(under(after).y, spot.y, 'the spot under the pointer, down');
});

test('a drag on the map moves it', async () => {
  await showMap();
  await zoomInTimes(3);
  const el = box();
  el.scrollLeft = 200;
  el.scrollTop = 100;
  const layer = $('[data-map-layer]')!;
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

// #1289: on a desktop the box is a wide strip, and the map was drawn in its middle with nothing
// to scroll sideways until it was wider than the box: a drag across did nothing, a drag down
// stopped after a few px. Now the box has half its size of room past each edge of the map.
test('on a wide box a drag moves the map both ways while it is narrower than the box', async () => {
  await showWideMap();
  zoomButton('in').click();
  await settle();
  assert.equal(zoomLevel(), '40%');
  assert.ok(drawnWidth() < 1240, `the map (${drawnWidth()} px) is narrower than the box`);
  const layer = $('[data-map-layer]')!;
  const drag = async (from: [number, number], to: [number, number]) => {
    const start = mapAt();
    layer.dispatchEvent(pointer('pointerdown', ...from));
    layer.dispatchEvent(pointer('pointermove', ...to));
    layer.dispatchEvent(pointer('pointerup', ...to));
    await settle();
    return { x: mapAt().x - start.x, y: mapAt().y - start.y };
  };
  assert.deepEqual(await drag([600, 300], [450, 300]), { x: -150, y: 0 }, 'to the left');
  assert.deepEqual(await drag([600, 300], [900, 300]), { x: 300, y: 0 }, 'to the right');
  assert.deepEqual(await drag([600, 300], [600, 50]), { x: 0, y: -250 }, 'up');
  assert.deepEqual(await drag([600, 100], [400, 600]), { x: -200, y: 500 }, 'down and left');
  // As far as a map app: an edge of the map stops in the middle of the box.
  await drag([0, 0], [5000, 5000]);
  assert.deepEqual(mapAt(), { x: 620, y: 320 }, 'its top-left corner at most in the middle');
  await drag([1200, 600], [-3800, -4400]);
  assert.deepEqual(
    { x: mapAt().x + drawnWidth(), y: mapAt().y + drawnHeight() },
    { x: 620, y: 320 },
    'its bottom-right corner at least in the middle',
  );
});

test('on a wide box the wheel keeps the spot under the pointer while the map is narrow', async () => {
  await showWideMap();
  const el = box();
  for (const [x, y, deltaY] of [
    [300, 200, -100],
    [1000, 500, -100],
    [150, 600, 100],
    [700, 40, 100],
  ] as const) {
    const before = { drawn: drawnWidth(), at: mapAt() };
    const spot = { x: (x - before.at.x) / before.drawn, y: (y - before.at.y) / before.drawn };
    $('[data-map-layer]')!.dispatchEvent(wheelAt(x, y, deltaY));
    await settle();
    assert.notEqual(drawnWidth(), before.drawn, 'it zoomed');
    assert.ok(drawnWidth() < el.clientWidth, 'narrower than the box');
    close((x - mapAt().x) / drawnWidth(), spot.x, `across at ${x}, ${y}`);
    close((y - mapAt().y) / drawnWidth(), spot.y, `down at ${x}, ${y}`);
  }
});

test('Fit shows the whole map in the middle of a wide box, also after zooming out below it', async () => {
  await showWideMap();
  const centred = () => {
    const at = mapAt();
    assert.ok(at.x >= 0 && at.y >= 0, 'the whole map is in the box');
    assert.ok(at.x + drawnWidth() <= 1240 && at.y + drawnHeight() <= 640);
    close(at.x + drawnWidth() / 2, 620, 'across the middle');
    close(at.y + drawnHeight() / 2, 320, 'down the middle');
  };
  assert.equal(zoomLevel(), '32%');
  centred();
  // Below Fit, down to the flow graph's 10%, around the middle: still in the middle.
  for (let i = 0; i < 12; i++) {
    zoomButton('out').click();
    await settle();
  }
  assert.equal(zoomLevel(), '10%');
  assert.equal(zoomButton('out').disabled, true);
  centred();
  const layer = $('[data-map-layer]')!;
  layer.dispatchEvent(pointer('pointerdown', 600, 300));
  layer.dispatchEvent(pointer('pointermove', 400, 200));
  layer.dispatchEvent(pointer('pointerup', 400, 200));
  zoomButton('fit').click();
  await settle();
  assert.equal(zoomLevel(), '32%');
  centred();
});

test('nothing in the map can be selected or dragged by the browser, and a press focuses it', async () => {
  await showMap();
  const image = $('[data-map-image]')!;
  const dragstart = new Event('dragstart', { bubbles: true, cancelable: true });
  image.dispatchEvent(dragstart);
  assert.equal(dragstart.defaultPrevented, true, 'no native drag of the image or a selection');
  // A mouse press on the map starts no selection, and the map takes focus as before.
  const layer = $('[data-map-layer]')!;
  const down = pointer('pointerdown', 100, 100);
  layer.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  assert.equal(document.activeElement, box());
  layer.dispatchEvent(pointer('pointerup', 100, 100));
  // A finger's press is left alone: there is no mouse selection to stop.
  const touch = new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    pointerId: 2,
    pointerType: 'touch',
  });
  layer.dispatchEvent(touch);
  assert.equal(touch.defaultPrevented, false);
  layer.dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, pointerId: 2, pointerType: 'touch' }),
  );
  // The rule in style.css, as happy-dom draws no selection: the box and all in it.
  const css = fs
    .readFileSync('public/style.css', 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = /\n\.map-scroll \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(rule, /\n\s*user-select: none;/);
  assert.match(rule, /\n\s*-webkit-user-select: none;/);
});
