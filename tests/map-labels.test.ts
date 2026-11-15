// MAP-5: which names the world map leaves out at a zoom (app/map-labels.ts): a name that would
// cover a name drawn before it is left out; the first in the order of importance is kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hiddenLabels, lineNameBox, nameBox, textWidth } from '../public/app/map-labels.ts';

const at = (id: string, left: number, top: number, text: string) => ({
  id,
  box: nameBox(left, top, text, 13, 20),
});

test('two names that would overlap: the first is kept, the second is left out', () => {
  const hidden = hiddenLabels([
    at('a', 100, 100, 'Industrial parts'),
    at('b', 110, 108, 'Electronics'),
  ]);
  assert.deepEqual([...hidden], ['b']);
});

test('names that fit are all drawn, below each other or far apart', () => {
  assert.deepEqual([...hiddenLabels([at('a', 100, 100, 'Wire'), at('b', 100, 200, 'Plates')])], []);
  assert.deepEqual([...hiddenLabels([at('a', 100, 100, 'Wire'), at('b', 400, 100, 'Plates')])], []);
  // Close, but with a name's width of room between them.
  assert.deepEqual([...hiddenLabels([at('a', 100, 100, 'Wire'), at('b', 100, 124, 'Plates')])], []);
});

test('the order of importance decides, and a hidden name does not hide the ones after it', () => {
  const first = at('a', 100, 100, 'Plates');
  const second = at('b', 110, 104, 'Wire');
  const third = at('c', 200, 100, 'Rods');
  assert.deepEqual([...hiddenLabels([first, second, third])], ['b']);
  assert.deepEqual([...hiddenLabels([second, first, third])], ['a']);
  // Three in a pile: only the first is drawn.
  assert.deepEqual([...hiddenLabels([first, second, at('d', 105, 102, 'Rods 2')])].sort(), [
    'b',
    'd',
  ]);
});

test('zooming in moves the pins apart and brings the names back', () => {
  const names = (zoom: number) =>
    hiddenLabels([
      at('a', 100 * zoom, 100 * zoom, 'Industrial parts'),
      at('b', 110 * zoom, 108 * zoom, 'Electronics'),
    ]);
  assert.deepEqual([...names(1)], ['b']);
  assert.deepEqual([...names(8)], [], 'eight times closer in, both fit');
});

test('the box of a name follows its text, cut at the label’s limit, and a line name sits centred', () => {
  assert.equal(textWidth('Wire', 13, 20), 4 * 13 * 0.6);
  assert.equal(textWidth('x'.repeat(50), 13, 20), 20 * 13 * 0.6, 'cut with an ellipsis at 20ch');
  const box = lineNameBox(200, 100, 'Ore shuttle');
  assert.equal(box.x + box.w / 2, 200);
});

test('a train line’s name is left out when it would sit on a pin’s name', () => {
  const hidden = hiddenLabels([
    at('a', 100, 100, 'Industrial parts'),
    { id: 'line:1', box: lineNameBox(160, 104, 'Ore shuttle') },
  ]);
  assert.deepEqual([...hidden], ['line:1']);
});

test('a name left out is only hidden, and comes back on hover and focus (style.css)', () => {
  const css = fs
    .readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(
    css,
    /\.map-factory-label\[data-label-hidden\],[^{]*\.map-line-label\[data-label-hidden\] \{\s*visibility: hidden;/,
  );
  assert.match(
    css,
    /\.map-factory:is\(:hover, :focus, :focus-within\) \.map-factory-label\[data-label-hidden\],[^{]*\{\s*visibility: visible;/,
  );
});
