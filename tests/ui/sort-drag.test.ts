// The pointer's drag to reorder (ui/sort-drag.ts, #1399): the row under the pointer takes the drop
// even when it is tall, and a drag held near the top or bottom edge of the scrolling box scrolls it
// (a frame at a time) until it is let go, cancelled or Escaped. happy-dom lays out nothing, so the
// rows' and the box's boxes are given.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { beginSortDrag, scrollStep, SCROLL_EDGE } from '../../public/app/ui/sort-drag.ts';

let box: HTMLElement;
let rows: HTMLElement[];
let handle: HTMLElement;
let frames: FrameRequestCallback[];

const rect = (top: number, bottom: number): DOMRect =>
  ({ left: 0, right: 300, top, bottom, width: 300, height: bottom - top }) as DOMRect;

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {
    frames = [];
  });
  document.body.innerHTML = '<div id="box"></div>';
  box = document.getElementById('box')!;
  box.style.overflowY = 'auto';
  Object.defineProperty(box, 'scrollHeight', { value: 900, configurable: true });
  Object.defineProperty(box, 'clientHeight', { value: 400, configurable: true });
  box.getBoundingClientRect = () => rect(100, 500);
  // A short row, a tall row and a short row, as at 390 px.
  const spans: [number, number][] = [
    [120, 160],
    [164, 464],
    [468, 508],
  ];
  rows = spans.map(([top, bottom]) => {
    const row = document.createElement('div');
    row.getBoundingClientRect = () => rect(top, bottom);
    box.append(row);
    return row;
  });
  handle = document.createElement('button');
  rows[0]!.append(handle);
});
afterEach(() => vi.unstubAllGlobals());

const ptr = (type: string, y: number) =>
  new PointerEvent(type, { bubbles: true, clientX: 50, clientY: y, pointerType: 'touch' });

// Press on the handle at y 140 the way the row's @pointerdown does.
function start(onDrop: (to: number) => void) {
  handle.addEventListener('pointerdown', e =>
    beginSortDrag(e, { items: () => rows, from: 0, onDrop }),
  );
  handle.dispatchEvent(ptr('pointerdown', 140));
}

test('the tall row under the pointer takes the drop at its top edge', () => {
  const drops: number[] = [];
  start(to => drops.push(to));
  handle.dispatchEvent(ptr('pointermove', 180));
  assert.ok(rows[1]!.classList.contains('sort-over'), 'near its top, not past its middle');
  assert.ok(rows[0]!.classList.contains('sort-source'));
  handle.dispatchEvent(ptr('pointerup', 180));
  assert.deepEqual(drops, [1]);
  assert.ok(!rows[1]!.classList.contains('sort-over'));
});

test('scrollStep scrolls near an edge only, faster nearer it', () => {
  assert.equal(scrollStep(300, 100, 500), 0);
  assert.ok(scrollStep(490, 100, 500) > 0);
  assert.ok(scrollStep(110, 100, 500) < 0);
  assert.ok(scrollStep(499, 100, 500) > scrollStep(500 - SCROLL_EDGE + 5, 100, 500));
});

test('held near the bottom edge the box scrolls a frame at a time and stops on drop', () => {
  start(() => {});
  handle.dispatchEvent(ptr('pointermove', 490));
  assert.equal(box.scrollTop, 0);
  assert.equal(frames.length, 1, 'a frame is asked for');
  frames.shift()!(0);
  assert.ok(box.scrollTop > 0, 'the box scrolled down');
  const after = box.scrollTop;
  assert.equal(frames.length, 1, 'and keeps going while the pointer stays there');
  frames.shift()!(0);
  assert.ok(box.scrollTop > after);
  handle.dispatchEvent(ptr('pointerup', 490));
  assert.equal(frames.length, 0, 'no frame is left running after the drop');
});

test('a pointer mid-box does not scroll, and Escape stops a running scroll', () => {
  const drops: number[] = [];
  start(to => drops.push(to));
  handle.dispatchEvent(ptr('pointermove', 300));
  frames.shift()?.(0);
  assert.equal(box.scrollTop, 0);
  handle.dispatchEvent(ptr('pointermove', 495));
  assert.equal(frames.length, 1);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(frames.length, 0);
  assert.deepEqual(drops, [], 'Escape drops nothing');
});
