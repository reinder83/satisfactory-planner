// MAP-5 on the world map (ui/pages/MapPage.vue, app/map-labels.ts): the names of pins that stand
// so close that the names would overlap are left out (`data-label-hidden`), the first one in the
// order of importance kept; the pins, their links and their accessible names stay, and a name is
// drawn again when the pins are apart.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { render } from '../../public/app/shell.ts';
import { $, $$, applyUpdate, go, open, page, stubFetch } from './setup.ts';
import type { ProgressState, UpdateOp } from '../../public/types/index.ts';

// happy-dom lays out nothing, so the map's box is given a size (as tests/ui/map-factories.test.ts).
const BOX_SIZES: Record<string, number> = {
  clientWidth: 400,
  clientHeight: 300,
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
    const original = (own ?? inherited)!.get!;
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-world-map') ? BOX_SIZES[name] : original.call(this);
      },
    });
  }
});
afterEach(() => {
  for (const { name, own } of sizes) {
    if (own) Object.defineProperty(HTMLElement.prototype, name, own);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  }
});

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const GROUPS = {
  groups: [
    { id: 'fg-parts01', name: 'Industrial parts' },
    { id: 'fg-elec001', name: 'Electronics' },
    { id: 'fg-far0001', name: 'Faraway' },
  ],
  assignments: {
    a: [{ group: 'fg-parts01', rate: null }],
    b: [{ group: 'fg-elec001', rate: null }],
    c: [{ group: 'fg-far0001', rate: null }],
  },
};
async function showMap(places: Record<string, { x: number; y: number }>) {
  page();
  open({
    state: { version: 28, factoryGroups: GROUPS, factoryPlaces: places } as Partial<ProgressState>,
  });
  stubFetch<UpdateOp>({ '/api/update': (update: UpdateOp) => applyUpdate(update) });
  go('map');
  render();
  await settle();
  await settle();
}
const label = (id: string) => $(`[data-map-factory="${id}"] .map-factory-label`)!;
const hidden = (id: string) => label(id).hasAttribute('data-label-hidden');

test('MAP-5: the name of a pin that would sit under another pin’s name is left out', async () => {
  // 5,000 game units apart is a couple of px at the fitted zoom: the names would be one blur.
  await showMap({
    'fg-parts01': { x: -98000, y: 61250 },
    'fg-elec001': { x: -93000, y: 64000 },
    'fg-far0001': { x: 300000, y: -200000 },
  });
  assert.equal($$('[data-map-factory]').length, 3, 'every pin is still drawn');
  assert.equal(hidden('fg-parts01'), false, 'the first stays');
  assert.equal(hidden('fg-elec001'), true, 'the one under it is left out');
  assert.equal(hidden('fg-far0001'), false, 'a pin far away keeps its name');
  // The pin keeps its accessible name and its link; only the drawn name is gone.
  const pin = $<HTMLAnchorElement>('[data-map-factory="fg-elec001"]')!;
  assert.match(pin.getAttribute('aria-label')!, /Electronics/);
  assert.ok(pin.getAttribute('href'));
  assert.equal(label('fg-elec001').textContent, 'Electronics', 'the text is there for hover');
  assert.equal(label('fg-elec001').getAttribute('aria-hidden'), 'true');
});

test('MAP-5: pins far enough apart all show their names', async () => {
  await showMap({
    'fg-parts01': { x: -98000, y: 61250 },
    // 60,000 units is about 24 px at the fitted zoom: a name's height and some air between.
    'fg-elec001': { x: -98000, y: 121250 },
    'fg-far0001': { x: 300000, y: -200000 },
  });
  for (const id of ['fg-parts01', 'fg-elec001', 'fg-far0001']) assert.equal(hidden(id), false, id);
});

// #1399: a touch screen has no hover, so a name left out comes back by pressing its pin, and goes
// again when another pin or the bare map is pressed.
test('#1399: on touch, pressing a pin with its name left out shows it until the map is pressed', async () => {
  await showMap({
    'fg-parts01': { x: -98000, y: 61250 },
    'fg-elec001': { x: -93000, y: 64000 },
    'fg-far0001': { x: 300000, y: -200000 },
  });
  const press = (el: Element, pointerType: string) =>
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType }));
  const pin = (id: string) => $<HTMLElement>(`[data-map-factory="${id}"]`)!;
  assert.equal(hidden('fg-elec001'), true);
  press(pin('fg-elec001'), 'mouse');
  await settle();
  assert.equal(hidden('fg-elec001'), true, 'a mouse has hover: its press changes nothing');
  press(pin('fg-elec001'), 'touch');
  await settle();
  assert.equal(hidden('fg-elec001'), false, 'a finger on the pin shows its name');
  assert.equal(pin('fg-elec001').hasAttribute('data-revealed'), true, 'drawn over the others');
  assert.equal(hidden('fg-far0001'), false);
  press($('[data-map-image]')!, 'touch');
  await settle();
  assert.equal(hidden('fg-elec001'), true, 'a press on the bare map puts it away again');
  assert.equal(pin('fg-elec001').hasAttribute('data-revealed'), false);
  press(pin('fg-elec001'), 'touch');
  await settle();
  press(pin('fg-parts01'), 'touch');
  await settle();
  assert.equal(hidden('fg-elec001'), true, 'another pin takes the reveal');
});
