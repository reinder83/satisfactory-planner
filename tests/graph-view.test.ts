// Pan and zoom of a factory's flow graph (public/app/graph-view.ts, #1223, part of #1201): a zoom
// around a point keeps the spot of the drawing under it, the zoom stays between GRAPH_ZOOM.min
// and .max, the scroll offsets stay where the box can scroll to, and Fit shows the whole drawing
// without blowing a small one up.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampGraphView,
  clampGraphZoom,
  fitGraphView,
  GRAPH_ZOOM,
  graphWheelFactor,
  panGraphBy,
  zoomGraphAround,
  type GraphView,
} from '../public/app/graph-view.ts';

const box = { width: 800, height: 500 };
const size = { width: 2000, height: 1200 };
const close = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${what}: ${actual} is not ${expected}`);
// The spot of the drawing, in its own coordinates, under a point of the box.
const under = (view: GraphView, x: number, y: number) => ({
  x: (view.left + x) / view.zoom,
  y: (view.top + y) / view.zoom,
});

test('a zoom around a point keeps the spot of the drawing under that point', () => {
  const start: GraphView = { zoom: 1, left: 300, top: 200 };
  const point = { x: 250, y: 120 };
  for (const factor of [1.25, 1 / 1.25, 2, 0.5]) {
    const zoomed = zoomGraphAround(start, factor, point, box, size);
    close(zoomed.zoom, factor, 'zoom');
    const before = under(start, point.x, point.y);
    const after = under(zoomed, point.x, point.y);
    close(after.x, before.x, `x at ${factor}`);
    close(after.y, before.y, `y at ${factor}`);
  }
});

test('the zoom stays between its limits, and a zoom at a limit moves nothing', () => {
  assert.equal(clampGraphZoom(10), GRAPH_ZOOM.max);
  assert.equal(clampGraphZoom(0.001), GRAPH_ZOOM.min);
  assert.equal(clampGraphZoom(1.5), 1.5);
  const most: GraphView = { zoom: GRAPH_ZOOM.max, left: 900, top: 600 };
  assert.deepEqual(zoomGraphAround(most, 2, { x: 100, y: 100 }, box, size), most);
  const least = zoomGraphAround({ zoom: 1, left: 0, top: 0 }, 1e-6, { x: 0, y: 0 }, box, size);
  assert.equal(least.zoom, GRAPH_ZOOM.min);
});

test('the scroll offsets stay where the box can scroll to', () => {
  // Zoomed out around the bottom-right corner: the drawing is 1000 × 600, the box 800 × 500.
  const out = zoomGraphAround(
    { zoom: 1, left: 1200, top: 700 },
    0.5,
    { x: 800, y: 500 },
    box,
    size,
  );
  assert.deepEqual(out, { zoom: 0.5, left: 200, top: 100 });
  // Smaller than the box: nothing to scroll.
  assert.deepEqual(clampGraphView({ zoom: 0.2, left: 50, top: 50 }, box, size), {
    zoom: 0.2,
    left: 0,
    top: 0,
  });
  // A drag moves the drawing with the pointer, up to its edges.
  assert.deepEqual(panGraphBy({ zoom: 1, left: 300, top: 200 }, 100, -50, box, size), {
    zoom: 1,
    left: 200,
    top: 250,
  });
  assert.deepEqual(panGraphBy({ zoom: 1, left: 300, top: 200 }, 1000, -5000, box, size), {
    zoom: 1,
    left: 0,
    top: 700,
  });
});

test('Fit shows the whole drawing, and never blows a small one up', () => {
  // 2000 × 1200 in 800 × 500: the width decides, 0.4.
  const fitted = fitGraphView(box, size);
  assert.deepEqual(fitted, { zoom: 0.4, left: 0, top: 0 });
  assert.ok(size.width * fitted.zoom <= box.width && size.height * fitted.zoom <= box.height);
  // The height decides for a tall one.
  assert.equal(fitGraphView(box, { width: 400, height: 1000 }).zoom, 0.5);
  // A small graph stays at natural size.
  assert.equal(fitGraphView(box, { width: 300, height: 200 }).zoom, 1);
  // A huge one stops at the smallest zoom; a box not laid out yet leaves natural size.
  assert.equal(fitGraphView(box, { width: 100000, height: 100 }).zoom, GRAPH_ZOOM.min);
  assert.equal(fitGraphView({ width: 0, height: 0 }, size).zoom, 1);
});

test('the wheel zooms in going up and out going down, a notch by about a fifth', () => {
  assert.ok(graphWheelFactor(-100, 0) > 1.15 && graphWheelFactor(-100, 0) < 1.25);
  close(graphWheelFactor(100, 0), 1 / graphWheelFactor(-100, 0), 'down undoes up');
  assert.equal(graphWheelFactor(0, 0), 1);
  // 3 lines are a notch, as 100 px; a huge delta is no bigger than 500 px.
  assert.ok(Math.abs(graphWheelFactor(3, 1) - graphWheelFactor(100, 0)) < 0.01);
  assert.equal(graphWheelFactor(1, 2), graphWheelFactor(500, 0));
});
