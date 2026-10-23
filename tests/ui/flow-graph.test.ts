// A factory's flow graph (#1192, ui/detail/FlowGraphDialog.vue), opened from "Flow graph ↗" on its
// heading on the Factories page, on the planner's default Phase 3 plan with the default factory
// groups: by keyboard it opens and closes with focus back on the button, the drawing has one
// arrow per flow the group's flow figures give (flowGraph of shownGroupFlow), and "The graph as
// a table" lists every one of them, self links included. Pan and zoom (#1223): the wheel over the
// drawing zooms it, a drag on its background moves it while a press on a line's box without a
// drag opens that line, and − / + / Fit zoom it. Rearranging (#1224): a drag of a line's box moves
// it and saves the layout once it ends, an arrow key moves a focused line, Reset layout goes back
// to the automatic layout, and the graph opens again as it was left. Where the boxes land is
// checked in a real browser (browser-check.ts); happy-dom lays nothing out, so a test gives the
// box its size.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { itemRate } from '../../public/app/flow.ts';
import { flowGraph, type FlowGraph } from '../../public/app/flow-graph.ts';
import { placedGraph } from '../../public/app/graph-layout.ts';
import { setQuery, state } from '../../public/app/session.ts';
import { LAYOUT_SAVE_DELAY } from '../../public/app/ui/detail/graph-layout-save.ts';
import { render } from '../../public/app/shell.ts';
import { shownGroupFlow } from '../../public/app/shown-group-flow.ts';
import { cancelDetail, closeDetail } from '../../public/app/ui/actions.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import {
  $,
  $$,
  answerConfirms,
  applyUpdate,
  evil,
  generated,
  go,
  open,
  page,
  stubFetch,
} from './setup.ts';
import type { FactoryGroups, GroupLayout, UpdateOp } from '../../public/types/index.ts';

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
// A dialog a test left open goes, so a save it still has waiting is not the next test's.
afterEach(async () => {
  if (!dialog().open) return;
  dialog().close();
  await settle();
});

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
  // Only the lines' boxes are there for the keyboard and screen readers (#1224); the arrows, their
  // labels and the places are the table's.
  for (const hidden of box.querySelectorAll('path[data-edge], [data-edge-label], defs'))
    assert.equal(hidden.getAttribute('aria-hidden'), 'true');
  for (const place of box.querySelectorAll('[data-node]:not([data-node^="line:"])'))
    assert.equal(place.getAttribute('aria-hidden'), 'true');
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
  // A press on a line's box that hardly moves, then its click: the line's dialog in its place.
  const rect = line.querySelector('rect')!;
  rect.dispatchEvent(pointer('pointerdown', 150, 150));
  rect.dispatchEvent(pointer('pointermove', 152, 151));
  assert.deepEqual([box.scrollLeft, box.scrollTop], [260, 130], 'a press on a box does not pan');
  rect.dispatchEvent(pointer('pointerup', 152, 151));
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

// Where the box of node `id` is drawn, from its transform.
const drawnAt = (id: string): [number, number] => {
  const transform = $(`#detail [data-node="${id}"]`)!.getAttribute('transform')!;
  const [, x, y] = transform.match(/translate\(([-\d.]+),([-\d.]+)\)/)!;
  return [Number(x), Number(y)];
};
const layoutSaves = (calls: [string, UpdateOp][]) =>
  calls
    .filter(([path, body]) => path === '/api/update' && body.type === 'factoryGroupLayout')
    .map(([, body]) => body);
const storedLayout = (): GroupLayout | undefined =>
  state.factoryGroups.groups.find(group => group.id === GROUP)?.layout;
const lineIds = (graph: FlowGraph) =>
  graph.nodes.filter(node => node.kind === 'line').map(node => node.id);
const rowOf = (id: string) => id.slice('line:'.length);
const rest = () => new Promise(resolve => setTimeout(resolve, LAYOUT_SAVE_DELAY + 100));

test('a drag of a line moves its box and its arrows, saves once it ends, and opens nothing', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await openGraph();
  const graph = graphOf();
  const box = sizedBox();
  box.scrollLeft = 50;
  const [first, second] = lineIds(graph) as [string, string];
  const line = $(`#detail [data-node="${first}"]`)!;
  const start = drawnAt(first);
  const otherStart = drawnAt(second);
  const arrows = () =>
    $$('#detail path[data-edge]')
      .filter(path => {
        const edge = graph.edges.find(known => known.id === path.dataset.edge)!;
        return edge.from === first || edge.to === first;
      })
      .map(path => path.getAttribute('d'));
  const arrowsBefore = arrows();
  assert.ok(arrowsBefore.length, 'the line has arrows');
  // Under the threshold nothing moves; past it the box follows the pointer, the drawing does not.
  line.dispatchEvent(pointer('pointerdown', 100, 100));
  line.dispatchEvent(pointer('pointermove', 102, 101));
  assert.deepEqual(drawnAt(first), start);
  line.dispatchEvent(pointer('pointermove', 160, 140));
  await settle();
  assert.deepEqual(drawnAt(first), [start[0] + 60, start[1] + 40]);
  assert.equal(box.scrollLeft, 50, 'the drawing stays where it is');
  assert.ok(box.classList.contains('moving'), 'the grabbing cursor while it moves');
  assert.notDeepEqual(arrows(), arrowsBefore, 'its arrows follow');
  assert.deepEqual(drawnAt(second), otherStart, 'the other lines stay');
  assert.deepEqual(layoutSaves(calls), [], 'nothing is saved while it moves');
  line.dispatchEvent(pointer('pointerup', 160, 140));
  line.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  assert.ok($('#detail [data-flow-graph]'), 'the click that ends the drag opens nothing');
  assert.equal(box.classList.contains('moving'), false);
  // One save, at once: every line's spot, the moved one where it was put.
  const saves = layoutSaves(calls) as { layout: GroupLayout }[];
  assert.equal(saves.length, 1);
  const nodes = saves[0]!.layout.nodes!;
  assert.deepEqual(Object.keys(nodes).sort(), lineIds(graph).map(rowOf).sort());
  assert.deepEqual(nodes[rowOf(first)], [start[0] + 60, start[1] + 40]);
  assert.deepEqual(storedLayout()?.nodes, nodes, 'and the state keeps it');
  assert.equal(state.version, 22);
});

test('the arrow keys move a focused line, Shift by a bigger step, in the automatic tab order', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await openGraph();
  const graph = graphOf();
  sizedBox();
  // Every line's box takes focus, in the graph's own order; the places' boxes do not.
  const focusable = () =>
    $$('#detail [data-flow-graph] [tabindex="0"]').map(node => node.dataset.node);
  assert.deepEqual(focusable(), lineIds(graph));
  const [first] = lineIds(graph) as [string];
  const line = $(`#detail [data-node="${first}"]`)!;
  assert.equal(line.getAttribute('role'), 'button');
  assert.ok(line.getAttribute('aria-label')!.endsWith('Enter opens it, the arrow keys move it.'));
  const start = drawnAt(first);
  line.focus();
  const key = (name: string, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', {
      key: name,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    $(`#detail [data-node="${first}"]`)!.dispatchEvent(event);
    return event;
  };
  assert.equal(key('ArrowRight').defaultPrevented, true, 'the box does not scroll');
  key('ArrowDown', true);
  await settle();
  assert.deepEqual(drawnAt(first), [start[0] + 10, start[1] + 50]);
  assert.equal(document.activeElement, $(`#detail [data-node="${first}"]`), 'focus stays on it');
  assert.deepEqual(focusable(), lineIds(graph), 'a moved line keeps its place in the tab order');
  // The nudges are saved together once they rest.
  assert.deepEqual(layoutSaves(calls), []);
  await rest();
  const saves = layoutSaves(calls) as { layout: GroupLayout }[];
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0]!.layout.nodes![rowOf(first)], [start[0] + 10, start[1] + 50]);
  // Enter opens the line, as a press does.
  key('Enter');
  await settle();
  assert.equal($('#detail [data-flow-graph]'), null, 'the line opened');
});

// The default groups with `layout` stored for the iron group.
const arrangedGroups = (layout: GroupLayout): FactoryGroups => ({
  ...groups,
  groups: groups.groups.map(group => (group.id === GROUP ? { ...group, layout } : group)),
});

test('the graph opens as it was left: the lines where they were put, the zoom and the scroll', async () => {
  const automatic = graphOf();
  const [first] = lineIds(automatic) as [string];
  const layout: GroupLayout = { nodes: { [rowOf(first)]: [900, 30] }, zoom: 0.8, pan: [40, 20] };
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await showFactories(arrangedGroups(layout));
  for (let opening = 0; opening < 2; opening++) {
    await openGraph();
    await settle();
    assert.deepEqual(drawnAt(first), [900, 30], 'the moved line is where it was put');
    assert.equal(zoomLevel(), '80%');
    const box = $('#detail [data-flow-graph]')!;
    assert.deepEqual([box.scrollLeft, box.scrollTop], [40, 20]);
    // Lines without a stored spot take their spots near their links.
    const placed = placedGraph(graphOf(), layout.nodes);
    for (const id of lineIds(automatic)) {
      const node = placed.nodes.find(known => known.id === id)!;
      assert.deepEqual(drawnAt(id), [node.x, node.y], id);
    }
    await rest();
    dialog().close();
    await settle();
  }
  assert.deepEqual(layoutSaves(calls), [], 'opening and closing saves nothing');
});

test('Reset layout goes back to the automatic layout at 100%, asking first when a line was moved', async () => {
  const automatic = graphOf();
  const [first] = lineIds(automatic) as [string];
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await showFactories(arrangedGroups({ nodes: { [rowOf(first)]: [900, 30] }, zoom: 1.5 }));
  await openGraph();
  sizedBox();
  const reset = $<HTMLButtonElement>('#detail [data-flow-layout-reset]')!;
  assert.equal(reset.textContent!.trim(), 'Reset layout');
  assert.equal(reset.type, 'button');
  // Cancelled: nothing changes.
  const asked = answerConfirms(false);
  reset.click();
  await settle();
  assert.equal(asked.length, 1);
  assert.match(asked[0]!, /go back to their automatic places/);
  assert.deepEqual(drawnAt(first), [900, 30]);
  assert.deepEqual(layoutSaves(calls), []);
  // Confirmed: the automatic layout at natural size, and the stored layout goes.
  answerConfirms(true);
  reset.click();
  await settle();
  const spot = automatic.nodes.find(node => node.id === first)!;
  assert.deepEqual(drawnAt(first), [spot.x, spot.y]);
  assert.equal(zoomLevel(), '100%');
  assert.deepEqual(layoutSaves(calls), [{ type: 'factoryGroupLayout', id: GROUP, layout: null }]);
  assert.equal(storedLayout(), undefined);
  // With only a zoom to undo it does not ask.
  const zoomOnly = answerConfirms(true);
  $<HTMLButtonElement>('#detail [data-flow-zoom="in"]')!.click();
  await settle();
  reset.click();
  await settle();
  assert.deepEqual(zoomOnly, []);
  assert.equal(zoomLevel(), '100%');
});
