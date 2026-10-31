// The train network diagram (#1284, slice 4: ui/factories/TrainDiagram.vue, app/train-diagram.ts)
// on the Logistics page's Trains tab: stations in columns along the lines (pick-ups left, drop-offs
// right), each line in its colour with its name, direction and cargo, one-way dashed; pointing at
// or focusing a station lights up its lines; a drag moves a station on the 5 px grid and saves the
// layout on the drop, the arrow keys move a focused one, Enter opens its editor, the stored layout
// comes back, and Reset layout asks first and drops it. Every name is text, never markup.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { render } from '../../public/app/shell.ts';
import { setLogisticsTab, state } from '../../public/app/session.ts';
import { automaticSpots, DIAGRAM, stationColumns } from '../../public/app/train-diagram.ts';
import { $, $$, answerConfirms, applyUpdate, evil, go, open, page, stubFetch } from './setup.ts';
import type { ProgressState, TrainLine, TrainStation, UpdateOp } from '../../public/types/index.ts';

const settle = async (ms = 20) => {
  await new Promise(resolve => setTimeout(resolve, ms));
  await nextTick();
};
const station = (
  id: string,
  name: string,
  kinds: ('load' | 'unload' | 'empty')[],
): TrainStation => ({
  id,
  name,
  platforms: kinds.map(kind =>
    kind === 'load' ? { kind, cargo: ['Iron Ore'] } : kind === 'unload' ? { kind } : { kind },
  ),
});
const MINE = station('ts-mine01', 'Iron mine', ['load', 'load', 'empty']);
const WORKS = station('ts-works2', evil, ['unload', 'unload', 'empty']);
const STORE = station('ts-store3', 'Storage', ['unload']);
const SHUTTLE: TrainLine = {
  id: 'tl-shut01',
  name: 'Ore shuttle',
  cars: ['loco', 'wagon', 'wagon', 'loco'],
  stops: ['ts-mine01', 'ts-works2'],
  direction: 'backAndForth',
  roundTrip: 4,
};
const LOOP: TrainLine = {
  id: 'tl-loop02',
  name: 'Loop',
  cars: ['loco', 'wagon'],
  stops: ['ts-works2', 'ts-store3'],
  direction: 'oneWay',
};

let sent: UpdateOp[] = [];
async function showDiagram(progress: Partial<ProgressState> = {}) {
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
  setLogisticsTab('trains');
  go('logistics');
  render();
  await settle();
  // happy-dom lays out nothing: the box gets the size a browser would draw it at.
  const box = $('[data-diagram]');
  if (box) {
    Object.defineProperty(box, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(box, 'clientHeight', { configurable: true, value: 400 });
  }
}
const node = (id: string) => $(`[data-diagram-station="${id}"]`)!;
const spotOf = (id: string) =>
  node(id)
    .getAttribute('transform')!
    .match(/translate\(([-\d.]+),([-\d.]+)\)/)!
    .slice(1)
    .map(Number);
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
const key = (target: Element, name: string, shiftKey = false) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true }));

beforeEach(() => page());
afterEach(() => $<HTMLDialogElement>('#detail')?.close());

test('columns follow the lines: pick-ups left, drop-offs right', () => {
  assert.deepEqual(stationColumns([MINE, WORKS, STORE], [SHUTTLE, LOOP]), {
    'ts-mine01': 0,
    'ts-works2': 1,
    'ts-store3': 2,
  });
  // A line calling at a station twice stays put; a station on no line is in the first column.
  assert.deepEqual(
    stationColumns([MINE, WORKS], [{ stops: ['ts-mine01', 'ts-works2', 'ts-mine01'] }]),
    { 'ts-mine01': 1, 'ts-works2': 1 },
  );
  const spots = automaticSpots([MINE, WORKS, STORE], [SHUTTLE]);
  assert.deepEqual(spots['ts-mine01'], [DIAGRAM.margin, DIAGRAM.margin]);
  assert.deepEqual(spots['ts-store3'], [
    DIAGRAM.margin,
    DIAGRAM.margin + DIAGRAM.height + DIAGRAM.rowGap,
  ]);
});

test('stations, lines with their labels, and the list of lines', async () => {
  await showDiagram();
  assert.equal($('#train-diagram-title')!.textContent, 'Network diagram');
  assert.deepEqual(
    $$('[data-diagram-station]').map(box => box.dataset.diagramStation),
    ['ts-mine01', 'ts-works2', 'ts-store3'],
  );
  assert.ok(spotOf('ts-mine01')[0]! < spotOf('ts-works2')[0]!, 'pick-up left of drop-off');
  assert.ok(spotOf('ts-works2')[0]! < spotOf('ts-store3')[0]!);
  // The shuttle has arrows both ways; the loop is dashed, one way.
  const shuttle = $('[data-segment="tl-shut01"]')!;
  assert.ok(shuttle.getAttribute('marker-start'));
  assert.equal(shuttle.classList.contains('dashed'), false);
  const loop = $$('[data-segment="tl-loop02"]');
  assert.equal(loop.length, 1);
  assert.equal(loop[0]!.classList.contains('dashed'), true);
  assert.equal(loop[0]!.getAttribute('marker-start'), null);
  assert.equal($('[data-line-label="tl-shut01"]')!.textContent!.trim(), 'Ore shuttle ⇄ Iron Ore');
  assert.equal($('[data-line-label="tl-loop02"]')!.textContent!.trim(), 'Loop → no cargo yet');
  assert.equal(
    node('ts-mine01').getAttribute('aria-label'),
    'Iron mine, No owner set. Lines: Ore shuttle. Enter opens it, the arrow keys move it.',
  );
  assert.match($('[data-legend-line="tl-loop02"]')!.textContent!, /Loop\s*→\s*One-way loop:/);
  assert.equal(document.querySelector('x-evil'), null, 'a hostile name is text');
});

test('pointing at or focusing a station lights up its lines and fades the rest', async () => {
  await showDiagram();
  node('ts-mine01').dispatchEvent(new PointerEvent('pointerenter'));
  await settle();
  assert.equal($('[data-segment="tl-shut01"]')!.classList.contains('hl'), true);
  assert.equal($('[data-segment="tl-loop02"]')!.classList.contains('faded'), true);
  assert.equal(node('ts-store3').classList.contains('faded'), true);
  node('ts-mine01').dispatchEvent(new PointerEvent('pointerleave'));
  node('ts-works2').dispatchEvent(new FocusEvent('focus'));
  await settle();
  assert.equal($('[data-segment="tl-shut01"]')!.classList.contains('hl'), true);
  assert.equal($('[data-segment="tl-loop02"]')!.classList.contains('hl'), true);
});

test('a drag moves a station on the grid and saves the layout; the keys move it too', async () => {
  await showDiagram();
  const [x, y] = spotOf('ts-store3') as [number, number];
  const box = node('ts-store3');
  box.dispatchEvent(pointer('pointerdown', 100, 100));
  box.dispatchEvent(pointer('pointermove', 103, 101));
  box.dispatchEvent(pointer('pointermove', 141, 122));
  box.dispatchEvent(pointer('pointerup', 141, 122));
  await settle();
  assert.deepEqual(spotOf('ts-store3'), [x + 40, y + 20], 'snapped to the 5 px grid');
  const layout = sent.filter(update => update.type === 'trainLayout');
  assert.equal(layout.length, 1, 'saved once, on the drop');
  assert.deepEqual(state.trainLayout?.stations?.['ts-store3'], [x + 40, y + 20]);
  assert.equal(Object.keys(state.trainLayout!.stations!).length, 3, 'the others are held');
  // A press without a drag opens the station's editor.
  box.dispatchEvent(pointer('pointerdown', 50, 50));
  box.dispatchEvent(pointer('pointerup', 50, 50));
  box.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  assert.equal($('#detail-title')!.textContent, 'Edit train station');
  $<HTMLDialogElement>('#detail')!.close();
  // The arrow keys: a grid step, Shift ten; saved once they rest.
  key(node('ts-mine01'), 'ArrowDown');
  key(node('ts-mine01'), 'ArrowRight', true);
  await settle();
  const [mx, my] = spotOf('ts-mine01') as [number, number];
  assert.deepEqual([mx, my], [DIAGRAM.margin + 50, DIAGRAM.margin + 5]);
  await settle(700);
  assert.deepEqual(state.trainLayout?.stations?.['ts-mine01'], [mx, my]);
  // Enter opens it.
  key(node('ts-mine01'), 'Enter');
  await settle();
  assert.equal($<HTMLInputElement>('[data-station-name]')!.value, 'Iron mine');
});

test('the stored layout comes back; Reset layout asks first and drops it', async () => {
  await showDiagram({ trainLayout: { stations: { 'ts-mine01': [400, 300] } } });
  assert.deepEqual(spotOf('ts-mine01'), [400, 300]);
  answerConfirms(false);
  $<HTMLButtonElement>('[data-diagram-reset]')!.click();
  await settle();
  assert.deepEqual(spotOf('ts-mine01'), [400, 300], 'kept when the answer is no');
  answerConfirms(true);
  $<HTMLButtonElement>('[data-diagram-reset]')!.click();
  await settle();
  await settle();
  assert.deepEqual(spotOf('ts-mine01'), [DIAGRAM.margin, DIAGRAM.margin]);
  assert.equal('trainLayout' in state, false);
});

test('no stations: the diagram says what it will show', async () => {
  await showDiagram({ version: 1, trainStations: undefined, trainLines: undefined });
  assert.ok($('[data-diagram-empty]'));
  assert.equal($('[data-diagram]'), null);
});
