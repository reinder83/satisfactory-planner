// A factory's flow graph (#1192, ui/detail/FlowGraphDialog.vue), opened from "Flow graph ↗" on its
// heading on the Factories page, on the planner's default Phase 3 plan with the default factory
// groups: by keyboard it opens and closes with focus back on the button, the drawing has one
// arrow per flow the group's flow figures give (flowGraph of shownGroupFlow), and "The graph as
// a table" lists every one of them, self links included. Pan and zoom (#1223): the wheel over the
// drawing zooms it, a drag on its background moves it while a press on a line's box without a
// drag opens that line, and − / + / Fit zoom it. Where the boxes land is checked in a real
// browser (browser-check.ts); happy-dom lays nothing out, so a test gives the box its size.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { itemRate } from '../../public/app/flow.ts';
import { flowGraph, type FlowGraph } from '../../public/app/flow-graph.ts';
import { setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { shownGroupFlow } from '../../public/app/shown-group-flow.ts';
import { cancelDetail, closeDetail } from '../../public/app/ui/actions.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { $, $$, evil, generated, go, open, page } from './setup.ts';
import type { FactoryGroups } from '../../public/types/index.ts';

const plan = generated();
const groups: FactoryGroups = defaultFactoryGroups(plan);
const GROUP = 'fg-iron01';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
async function showFactories(factoryGroups = groups) {
  page();
  setQuery('');
  open({ calculated: structuredClone(plan), phase: '3', state: { factoryGroups } });
  go('factories');
  render();
  await settle();
}
const button = (id = GROUP) => $<HTMLButtonElement>(`#main [data-group-graph="${id}"]`)!;
const dialog = () => $<HTMLDialogElement>('#detail')!;
// The graph the dialog draws, from the same figures (the flow page's).
const graphOf = (id = GROUP): FlowGraph => {
  const flow = shownGroupFlow(id);
  assert.ok(flow, id);
  return flowGraph(flow, itemRate, () => '');
};
// Opens the graph the way Enter or Space on the focused button does: a native <button> turns
// either key into a click.
async function openGraph(id = GROUP) {
  const opener = button(id);
  assert.equal(opener.localName, 'button');
  assert.equal(opener.type, 'button');
  opener.focus();
  opener.click();
  await settle();
  assert.ok(dialog().open, 'the dialog is open');
}

beforeEach(() => showFactories());

test('every factory with a production line has "Flow graph ↗", one-line factories too', () => {
  const sections = $$('#main .user-group');
  assert.ok(sections.length > 2, 'the default groups are drawn');
  for (const section of sections) {
    const id = section.id.replace(/^section-/, '');
    const graph = section.querySelector<HTMLButtonElement>(`[data-group-graph="${id}"]`);
    assert.ok(graph, id + ' has a flow graph button');
    assert.equal(graph.textContent?.trim(), 'Flow graph ↗');
    const name = section.querySelector('h2')!.textContent!;
    assert.equal(graph.getAttribute('aria-label'), 'Flow graph of ' + name);
  }
});

test('the keyboard opens the flow graph and Escape or × closes it, focus back on the button', async () => {
  await openGraph();
  const name = groups.groups.find(group => group.id === GROUP)!.name;
  assert.equal($('#detail h2')!.textContent, name);
  assert.equal($('#detail .eyebrow')!.textContent, 'FACTORY · FLOW GRAPH');
  // The drawing's box takes focus, so the keyboard scrolls it; its name points to the table.
  const box = $('#detail [data-flow-graph]')!;
  assert.equal(box.tabIndex, 0);
  assert.match(box.getAttribute('aria-label')!, /^Flow graph of .+ lists every flow\.$/);
  assert.equal(box.querySelector('svg')!.getAttribute('aria-hidden'), 'true');
  // Escape: the browser closes the dialog after its cancel event, which nothing holds up here.
  const escape = new Event('cancel', { cancelable: true });
  cancelDetail(escape);
  assert.equal(escape.defaultPrevented, false, 'Escape is let through');
  dialog().close();
  await settle();
  assert.equal(dialog().open, false);
  assert.equal(document.activeElement === button(), true, 'Escape returns focus to the button');
  // The × does the same.
  await openGraph();
  $<HTMLButtonElement>('#detail [data-close]')!.focus();
  await closeDetail();
  await settle();
  assert.equal(dialog().open, false);
  assert.equal(document.activeElement === button(), true, 'the × returns focus to the button');
});

test('one arrow per flow, and the table lists every flow with its rate', async () => {
  await openGraph();
  const graph = graphOf();
  assert.ok(graph.edges.length > 10, 'the iron group has flows');
  // Every flow but a line's own output back into itself is drawn, each once.
  const drawn = $$('#detail [data-flow-graph] path[data-edge]').map(path => path.dataset.edge);
  assert.deepEqual(
    drawn,
    graph.edges.filter(edge => edge.note !== 'self').map(edge => edge.id),
  );
  assert.equal(
    $$('#detail [data-edge-label]').length,
    drawn.length,
    'each drawn arrow is labelled',
  );
  // Every arrow stays inside the drawing, also one passing below the boxes of a tall layer.
  const svg = $<SVGSVGElement>('#detail [data-flow-graph] svg')!;
  assert.equal(svg.getAttribute('height'), String(graph.height));
  for (const edge of graph.edges)
    for (const [, x, y] of edge.path?.matchAll(/(-?[\d.]+),(-?[\d.]+)/g) ?? [])
      assert.ok(
        +x! >= 0 && +x! <= graph.width && +y! >= 0 && +y! <= graph.height,
        `${edge.id} at ${x},${y} is inside ${graph.width} × ${graph.height}`,
      );
  assert.equal($$('#detail [data-flow-graph] [data-node]').length, graph.nodes.length);
  // The table: every flow once, in the same order, with the words of the flow page's table.
  const rows = $$('#detail [data-flow-graph-table] [data-flow-edge]');
  assert.deepEqual(
    rows.map(row => row.dataset.flowEdge),
    graph.edges.map(edge => edge.id),
  );
  rows.forEach((row, i) => {
    const edge = graph.edges[i]!;
    const cells = [...row.querySelectorAll('td')].map(cell => cell.textContent!.trim());
    assert.equal(cells[0], edge.fromText);
    assert.ok(cells[1]!.startsWith(edge.item), cells[1]);
    assert.equal(cells[2], itemRate(edge.item, edge.rate));
    assert.equal(cells[3], edge.toText);
  });
  // The rates add up to what the group's lines use and make: each line's inputs.
  const flow = shownGroupFlow(GROUP)!;
  for (const line of flow.lines)
    for (const input of line.inputs) {
      const into = graph.edges.filter(
        edge => edge.to === 'line:' + line.id && edge.item === input.item,
      );
      const total = into.reduce((sum, edge) => sum + edge.rate, 0);
      assert.ok(Math.abs(total - input.rate) < 1e-6, `${line.id} ${input.item}`);
    }
});

test('a hostile factory name is shown as text', async () => {
  const hostile: FactoryGroups = {
    ...groups,
    groups: groups.groups.map(group => (group.id === GROUP ? { ...group, name: evil } : group)),
  };
  await showFactories(hostile);
  await openGraph();
  assert.equal($('#detail h2')!.textContent, evil);
  assert.equal(document.querySelector('x-evil'), null);
});

// The drawing's box, given the size a browser would lay it out at (happy-dom lays out nothing),
// and the drawing's size as rendered.
function sizedBox(width = 400, height = 300) {
  const box = $('#detail [data-flow-graph]')!;
  Object.defineProperty(box, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(box, 'clientHeight', { configurable: true, value: height });
  return box;
}
const drawnWidth = () => Number($('#detail [data-flow-graph] svg')!.getAttribute('width'));
const zoomLevel = () => $('#detail [data-flow-zoom-level]')!.textContent!.trim();
const pointer = (type: string, x: number, y: number, init: PointerEventInit = {}) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    clientX: x,
    clientY: y,
    ...init,
  });

test('the wheel over the drawing zooms it, and a sideways wheel still scrolls it', async () => {
  await openGraph();
  const graph = graphOf();
  const box = sizedBox();
  assert.equal(drawnWidth(), graph.width, 'natural size on opening');
  assert.equal(zoomLevel(), '100%');
  const up = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 });
  box.querySelector('svg')!.dispatchEvent(up);
  await settle();
  assert.equal(up.defaultPrevented, true, 'the wheel zooms rather than scrolls');
  assert.ok(drawnWidth() > graph.width, 'up zooms in');
  assert.notEqual(zoomLevel(), '100%');
  const down = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
  box.dispatchEvent(down);
  await settle();
  assert.ok(Math.abs(drawnWidth() - graph.width) < 1e-6, 'down zooms back out');
  const sideways = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 80 });
  box.dispatchEvent(sideways);
  assert.equal(sideways.defaultPrevented, false, 'a sideways wheel scrolls the box');
  // Outside the drawing the wheel is the page's.
  const outside = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 });
  $('#detail [data-flow-graph-table]')!.dispatchEvent(outside);
  assert.equal(outside.defaultPrevented, false, 'the wheel outside the drawing scrolls');
});

test('a drag on the background moves the drawing; a press on a line without a drag opens it', async () => {
  await openGraph();
  const box = sizedBox();
  const svg = box.querySelector('svg')!;
  box.scrollLeft = 200;
  box.scrollTop = 100;
  // A move under the threshold is no drag yet.
  svg.dispatchEvent(pointer('pointerdown', 100, 100));
  svg.dispatchEvent(pointer('pointermove', 102, 101));
  assert.deepEqual([box.scrollLeft, box.scrollTop], [200, 100], 'a press that hardly moves');
  svg.dispatchEvent(pointer('pointermove', 40, 70));
  assert.deepEqual([box.scrollLeft, box.scrollTop], [260, 130], 'the drawing follows the drag');
  await settle();
  assert.ok(box.classList.contains('panning'), 'the grabbing cursor while it moves');
  svg.dispatchEvent(pointer('pointerup', 40, 70));
  await settle();
  assert.equal(box.classList.contains('panning'), false);
  // The click the browser sends after the drag opens nothing, even over a line's box.
  const line = $('#detail [data-node^="line:"]')!;
  line.querySelector('rect')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  assert.ok($('#detail [data-flow-graph]'), 'the graph is still shown after a drag');
  // A press on a line's box that does not move, then its click: the line's dialog in its place.
  const rect = line.querySelector('rect')!;
  rect.dispatchEvent(pointer('pointerdown', 150, 150));
  rect.dispatchEvent(pointer('pointermove', 180, 150));
  assert.deepEqual([box.scrollLeft, box.scrollTop], [260, 130], 'a press on a box does not pan');
  rect.dispatchEvent(pointer('pointerup', 180, 150));
  rect.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  assert.equal($('#detail [data-flow-graph]'), null, 'the graph made way');
  assert.ok(dialog().open, 'the dialog stays open');
  const row = line.dataset.node!.slice('line:'.length);
  assert.ok(
    plan.stages['3']!.rows!.some(r => r.id === row),
    row + ' is a row of the plan',
  );
  assert.notEqual($('#detail .eyebrow')!.textContent, 'FACTORY · FLOW GRAPH');
});

test('− / + / Fit zoom the drawing, Fit to the whole graph', async () => {
  await openGraph();
  const graph = graphOf();
  const box = sizedBox(400, 300);
  const zoomButton = (which: string) =>
    $<HTMLButtonElement>(`#detail [data-flow-zoom="${which}"]`)!;
  assert.deepEqual(
    ['out', 'in', 'fit'].map(which => zoomButton(which).getAttribute('aria-label')),
    ['Zoom out', 'Zoom in', 'Fit the whole graph'],
  );
  for (const which of ['out', 'in', 'fit']) assert.equal(zoomButton(which).type, 'button');
  zoomButton('in').click();
  await settle();
  assert.equal(zoomLevel(), '125%');
  assert.ok(Math.abs(drawnWidth() - graph.width * 1.25) < 1e-6);
  zoomButton('out').click();
  zoomButton('out').click();
  await settle();
  assert.equal(zoomLevel(), '80%');
  box.scrollLeft = 120;
  zoomButton('fit').click();
  await settle();
  const fits = Math.min(400 / graph.width, 300 / graph.height, 1);
  assert.ok(Math.abs(drawnWidth() - graph.width * fits) < 1e-6, 'the whole width fits');
  const height = Number(box.querySelector('svg')!.getAttribute('height'));
  assert.ok(drawnWidth() <= 400 + 1e-6 && height <= 300 + 1e-6, 'the whole graph fits');
  assert.equal(box.scrollLeft, 0, 'from its left edge');
});
