// A factory's flow graph (#1192, ui/detail/FlowGraphDialog.vue), opened from "Flow graph ↗" on its
// heading on the Factories page, on the planner's default Phase 3 plan with the default factory
// groups: by keyboard it opens and closes with focus back on the button, the drawing has one
// arrow per flow the group's flow figures give (flowGraph of shownGroupFlow), and "The graph as
// a table" lists every one of them, self links included. Pan and zoom (#1223): the wheel over the
// drawing zooms it, a drag on its background moves it while a press on a line's box without a
// drag opens that line, and − / + / Fit zoom it. Rearranging (#1224): a drag of a line's box moves
// it and saves the layout once it ends, an arrow key moves a focused line, Reset layout goes back
// to the automatic layout, and the graph opens again as it was left. Storage and the sink (#1231):
// their arrows are quiet until lit, a box pointed at or focused lights up its own arrows with
// their labels (a line's quiet ones too, #1242) and fades the rest, and "Show storage and sink as tags" draws them as named tags, saved with the
// layout. Inputs and outputs (#1240): a drag (mouse or finger) or the arrow keys move them too,
// their arrows follow and they are saved with the layout (version 25), kept while storage and the
// sink are tags and put back by Reset layout; every move snaps to a 5 px grid. Where the boxes land
// is checked in a real browser (browser-check.ts); happy-dom lays nothing out, so a test gives the
// box its size.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { itemRate } from '../../public/app/flow.ts';
import { flowGraph, type FlowGraph } from '../../public/app/flow-graph.ts';
import { placedGraph, snapSpot, snapUnit } from '../../public/app/graph-layout.ts';
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
  // The arrows and their labels are the table's; every box is there for the keyboard and screen
  // readers (#1224), the places' too since #1231, named with what comes in or goes out.
  for (const hidden of box.querySelectorAll(
    'path[data-edge], path[data-edge-hit], [data-edge-label], defs',
  ))
    assert.equal(hidden.getAttribute('aria-hidden'), 'true');
  const places = [...box.querySelectorAll<SVGElement>('[data-node]:not([data-node^="line:"])')];
  assert.ok(places.length, 'the graph has places');
  for (const place of places) {
    assert.equal(place.getAttribute('aria-hidden'), null);
    assert.equal(place.getAttribute('tabindex'), '0');
    assert.equal(place.getAttribute('role'), 'img');
    assert.match(place.getAttribute('aria-label')!, /^.+, .+\. (In|Out): .+\.$/);
  }
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
  // Every flow but a line's own output back into itself is drawn, each once, those into storage
  // and the sink first, behind the others (#1231).
  const drawn = $$('#detail [data-flow-graph] path[data-edge]').map(path => path.dataset.edge);
  const shown = graph.edges.filter(edge => edge.note !== 'self');
  assert.deepEqual(drawn, [
    ...shown.filter(edge => edge.quiet).map(edge => edge.id),
    ...shown.filter(edge => !edge.quiet).map(edge => edge.id),
  ]);
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
  // While it moves it snaps to the 5 px grid (#1240).
  line.dispatchEvent(pointer('pointermove', 162, 143));
  await settle();
  assert.deepEqual(drawnAt(first), snapSpot(start[0] + 62, start[1] + 43));
  line.dispatchEvent(pointer('pointermove', 160, 140));
  await settle();
  const dropped = snapSpot(start[0] + 60, start[1] + 40);
  assert.deepEqual(drawnAt(first), dropped);
  assert.equal(box.scrollLeft, 50, 'the drawing stays where it is');
  assert.ok(box.classList.contains('moving'), 'the grabbing cursor while it moves');
  assert.notDeepEqual(arrows(), arrowsBefore, 'its arrows follow');
  assert.deepEqual(drawnAt(second), snapSpot(...otherStart), 'the other lines stay, on the grid');
  assert.ok(Math.abs(drawnAt(second)[0] - otherStart[0]) <= 2.5);
  assert.ok(Math.abs(drawnAt(second)[1] - otherStart[1]) <= 2.5);
  assert.deepEqual(layoutSaves(calls), [], 'nothing is saved while it moves');
  line.dispatchEvent(pointer('pointerup', 160, 140));
  line.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  assert.ok($('#detail [data-flow-graph]'), 'the click that ends the drag opens nothing');
  assert.equal(box.classList.contains('moving'), false);
  // One save, at once: every line's spot on the grid, the moved one where it was put.
  const saves = layoutSaves(calls) as { layout: GroupLayout }[];
  assert.equal(saves.length, 1);
  const nodes = saves[0]!.layout.nodes!;
  assert.deepEqual(Object.keys(nodes).sort(), lineIds(graph).map(rowOf).sort());
  assert.deepEqual(nodes[rowOf(first)], dropped);
  for (const [x, y] of Object.values(nodes)) assert.deepEqual([x % 5, y % 5], [0, 0]);
  assert.equal(saves[0]!.layout.places, undefined, 'no input or output moved');
  assert.deepEqual(storedLayout()?.nodes, nodes, 'and the state keeps it');
  assert.equal(state.version, 22);
});

test('the arrow keys move a focused line, Shift by a bigger step, in the automatic tab order', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await openGraph();
  const graph = graphOf();
  sizedBox();
  // Every box takes focus, in the graph's own order (the places' too since #1231).
  const focusable = () =>
    $$('#detail [data-flow-graph] [tabindex="0"]').map(node => node.dataset.node);
  assert.deepEqual(
    focusable(),
    graph.nodes.map(node => node.id),
  );
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
  // A grid step (5 px, #1240) at a time, Shift ten of them; a spot off the grid lands on it.
  assert.equal(key('ArrowRight').defaultPrevented, true, 'the box does not scroll');
  key('ArrowDown', true);
  await settle();
  const nudged = [snapUnit(start[0] + 5), snapUnit(start[1]) + 50];
  assert.deepEqual(drawnAt(first), nudged);
  assert.equal(document.activeElement, $(`#detail [data-node="${first}"]`), 'focus stays on it');
  assert.deepEqual(
    focusable(),
    graph.nodes.map(node => node.id),
    'a moved line keeps its place in the tab order',
  );
  // The nudges are saved together once they rest.
  assert.deepEqual(layoutSaves(calls), []);
  await rest();
  const saves = layoutSaves(calls) as { layout: GroupLayout }[];
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0]!.layout.nodes![rowOf(first)], nudged);
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

// #1231: the classes an arrow, its label and a box have now.
const edgeEl = (id: string) => $<SVGPathElement>(`#detail path[data-edge="${id}"]`)!;
const labelEl = (id: string) => $<SVGGElement>(`#detail [data-edge-label="${id}"]`)!;
const nodeEl = (id: string) => $<SVGGElement>(`#detail [data-node="${id}"]`)!;
const has = (el: Element, name: string) => el.classList.contains(name);
const enter = (el: Element) => el.dispatchEvent(new PointerEvent('pointerenter'));
const leave = (el: Element) => el.dispatchEvent(new PointerEvent('pointerleave'));

test('the arrows into storage and the sink are quiet: no label or arrowhead until pointed at', async () => {
  await openGraph();
  const graph = graphOf();
  const quiet = graph.edges.filter(edge => edge.quiet && edge.path);
  const loud = graph.edges.filter(edge => !edge.quiet && edge.path);
  assert.ok(quiet.length && loud.length, 'the iron group sends to storage or the sink');
  for (const edge of quiet) {
    assert.ok(has(edgeEl(edge.id), 'quiet'), edge.id);
    assert.equal(edgeEl(edge.id).getAttribute('marker-end'), null, 'no arrowhead');
    assert.ok(has(labelEl(edge.id), 'hidden'), 'no label');
  }
  for (const edge of loud) {
    assert.equal(has(edgeEl(edge.id), 'quiet'), false, edge.id);
    assert.equal(edgeEl(edge.id).getAttribute('marker-end'), 'url(#fgraph-arrow)');
    assert.equal(has(labelEl(edge.id), 'hidden'), false);
  }
  // Every arrow has a hover title with its value; pointing at a quiet one lights it with its label.
  const first = quiet[0]!;
  const hit = $(`#detail path[data-edge-hit="${first.id}"]`)!;
  assert.equal(
    hit.querySelector('title')!.textContent,
    `${first.item}: ${first.rateText} from ${first.fromText} to ${first.toText}`,
  );
  enter(hit);
  await nextTick();
  assert.ok(has(edgeEl(first.id), 'hover'));
  assert.ok(has(labelEl(first.id), 'lit'), 'its label shows');
  leave(hit);
  await nextTick();
  assert.ok(has(labelEl(first.id), 'hidden'), 'and goes again');
});

// Where a label is drawn (its middle), from its transform.
const labelSpot = (id: string) => {
  const [, x, y] = labelEl(id)
    .getAttribute('transform')!
    .match(/translate\(([-\d.]+),([-\d.]+)\)/)!;
  return { x: Number(x), y: Number(y) };
};
// No two of the shown labels of `edges` overlap.
function assertApart(edges: FlowGraph['edges']) {
  for (const one of edges)
    for (const other of edges)
      if (one !== other) {
        const a = labelSpot(one.id),
          b = labelSpot(other.id);
        assert.ok(
          Math.abs(a.x - b.x) >= (one.label!.width + other.label!.width) / 2 - 0.2 ||
            Math.abs(a.y - b.y) >= 30 - 0.2,
          `${one.id} and ${other.id} overlap`,
        );
      }
}

test('pointing at a line lights up its arrows, its quiet ones with labels too, and fades the rest', async () => {
  await openGraph();
  const graph = graphOf();
  // The line with the most arrows to storage and the sink.
  const quietFrom = (id: string) => graph.edges.filter(e => e.quiet && e.path && e.from === id);
  const source = graph.nodes
    .map(node => node.id)
    .sort((a, b) => quietFrom(b).length - quietFrom(a).length)[0]!;
  assert.ok(quietFrom(source).length, 'a line of the iron group sends to storage or the sink');
  const own = graph.edges.filter(edge => edge.path && (edge.from === source || edge.to === source));
  const others = graph.edges.filter(edge => edge.path && !own.includes(edge));
  enter(nodeEl(source));
  await nextTick();
  assert.ok(has(nodeEl(source), 'on'), 'the box gets the accent outline');
  for (const edge of own) {
    assert.ok(has(edgeEl(edge.id), 'hl'), edge.id + ' lit');
    assert.equal(edgeEl(edge.id).getAttribute('marker-end'), 'url(#fgraph-arrow)', 'arrowhead');
    if (edge.quiet) assert.ok(has(labelEl(edge.id), 'lit'), edge.id + ' with its label (#1242)');
    else
      assert.ok(
        ['lit', 'hidden'].some(state => has(labelEl(edge.id), state)),
        edge.id,
      );
  }
  // The quiet ones' labels go through the same spreading as the others: none overlap.
  assertApart(own.filter(edge => has(labelEl(edge.id), 'lit')));
  for (const edge of others) {
    assert.ok(has(edgeEl(edge.id), 'faded'), edge.id + ' faded');
    if (edge.quiet) assert.ok(has(labelEl(edge.id), 'hidden'), edge.id + ' another line’s');
    else assert.ok(has(labelEl(edge.id), 'faded'));
  }
  // Leaving the box puts everything back: the quiet arrows unlabelled again.
  leave(nodeEl(source));
  await nextTick();
  assert.equal($$('#detail .fgraph-edge.hl, #detail .fgraph-edge.faded').length, 0);
  assert.equal(has(nodeEl(source), 'on'), false);
  for (const edge of quietFrom(source)) assert.ok(has(labelEl(edge.id), 'hidden'), edge.id);
});

test('focusing the sink or storage lights up every arrow into it with its label, spread apart', async () => {
  await openGraph();
  const graph = graphOf();
  const place = graph.edges.find(edge => edge.quiet && edge.path)!.to;
  const into = graph.edges.filter(edge => edge.to === place && edge.path);
  nodeEl(place).dispatchEvent(new FocusEvent('focus'));
  await nextTick();
  assert.ok(has(nodeEl(place), 'on'), 'focus lights it as the pointer does');
  for (const edge of into) assert.ok(has(edgeEl(edge.id), 'hl'), edge.id);
  const shown = into.filter(edge => has(labelEl(edge.id), 'lit'));
  assert.ok(shown.length, 'the lit arrows show their labels');
  assertApart(shown);
  nodeEl(place).dispatchEvent(new FocusEvent('blur'));
  await nextTick();
  assert.equal(has(nodeEl(place), 'on'), false);
  for (const edge of into) assert.ok(has(labelEl(edge.id), 'hidden'), 'back at rest');
});

test('"Show storage and sink as tags" draws them as named tags, keeps the table and is saved per factory', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await openGraph();
  const lines = graphOf();
  const toggle = $<HTMLInputElement>('#detail [data-flow-tags]')!;
  assert.equal(toggle.type, 'checkbox');
  assert.equal(toggle.checked, false, 'off by default');
  assert.equal(toggle.closest('label')!.textContent!.trim(), 'Show storage and sink as tags');
  toggle.checked = true;
  toggle.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  const tagged = flowGraph(shownGroupFlow(GROUP)!, itemRate, () => '', { tags: true });
  // The two boxes and their arrows go; each line with such flows has its tags, named.
  assert.equal($('#detail [data-node="out:storage"], #detail [data-node="out:sink"]'), null);
  assert.equal($$('#detail path[data-edge].quiet').length, 0);
  const tags = $$('#detail [data-tag]');
  assert.ok(tags.length, 'the lines have tags');
  assert.deepEqual(
    tags.map(tag => tag.dataset.tag),
    tagged.tags.map(tag => tag.id),
  );
  for (const [i, tag] of tags.entries()) {
    const model = tagged.tags[i]!;
    assert.equal(tag.getAttribute('tabindex'), '0');
    assert.equal(tag.getAttribute('role'), 'img');
    assert.equal(tag.getAttribute('aria-label'), model.name);
    assert.match(model.name, /^To (protected storage|the AWESOME Sink): .+/);
    assert.equal(tag.querySelector('title')!.textContent, model.name);
    assert.equal(tag.querySelector('text')!.textContent, model.text);
  }
  // A tag follows its line in the tab order.
  const order = $$('#detail [data-flow-graph] [tabindex="0"]').map(
    el => el.dataset.node ?? el.dataset.tag,
  );
  for (const tag of tagged.tags)
    assert.equal(order.indexOf(tag.id) > order.indexOf(tag.node), true, tag.id);
  // Pointing at a line lights its tags and fades the others.
  const line = tagged.tags[0]!.node;
  enter(nodeEl(line));
  await nextTick();
  for (const tag of tags) {
    const mine = tagged.tags.find(model => model.id === tag.dataset.tag)!.node === line;
    assert.ok(has(tag, mine ? 'hl' : 'faded'), tag.dataset.tag);
  }
  leave(nodeEl(line));
  // The table still lists every flow.
  assert.deepEqual(
    $$('#detail [data-flow-graph-table] [data-flow-edge]').map(row => row.dataset.flowEdge),
    lines.edges.map(edge => edge.id),
  );
  // Saved at once with the layout: version 23, and it opens that way again.
  assert.deepEqual(layoutSaves(calls), [
    { type: 'factoryGroupLayout', id: GROUP, layout: { tags: true } },
  ]);
  assert.deepEqual(storedLayout(), { tags: true });
  assert.equal(state.version, 23);
  dialog().close();
  await settle();
  await openGraph();
  assert.equal($<HTMLInputElement>('#detail [data-flow-tags]')!.checked, true);
  assert.ok($('#detail [data-tag]'));
  // Off again: the lines are back and the layout says nothing.
  const again = $<HTMLInputElement>('#detail [data-flow-tags]')!;
  again.checked = false;
  again.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.ok($('#detail path[data-edge].quiet'));
  assert.equal($('#detail [data-tag]'), null);
  assert.equal(storedLayout(), undefined);
  assert.ok(state.version < 22);
});

test('a layout stored before the switch opens with storage and the sink as lines', async () => {
  const automatic = graphOf();
  const [first] = lineIds(automatic) as [string];
  await showFactories(arrangedGroups({ nodes: { [rowOf(first)]: [900, 30] } }));
  await openGraph();
  assert.equal($<HTMLInputElement>('#detail [data-flow-tags]')!.checked, false);
  assert.equal($('#detail [data-tag]'), null);
  assert.ok($('#detail path[data-edge].quiet'));
  assert.deepEqual(drawnAt(first), [900, 30]);
});

// #1240: inputs and outputs move too, everything on a 5 px grid.
const placeIds = (graph: FlowGraph, kind: 'in' | 'out') =>
  graph.nodes.filter(node => node.kind === kind).map(node => node.id);
const arrowsOf = (graph: FlowGraph, id: string) =>
  $$('#detail path[data-edge]')
    .filter(path => {
      const edge = graph.edges.find(known => known.id === path.dataset.edge)!;
      return edge.from === id || edge.to === id;
    })
    .map(path => path.getAttribute('d'));
// A drag of the box of node `id` by (dx, dy) screen px at 100%, ended with the click a browser sends.
async function dragBox(id: string, dx: number, dy: number, pointerType = 'mouse') {
  const rect = $(`#detail [data-node="${id}"] rect`)!;
  rect.dispatchEvent(pointer('pointerdown', 100, 100, { pointerType }));
  rect.dispatchEvent(pointer('pointermove', 100 + dx / 2, 100 + dy / 2, { pointerType }));
  rect.dispatchEvent(pointer('pointermove', 100 + dx, 100 + dy, { pointerType }));
  await settle();
  rect.dispatchEvent(pointer('pointerup', 100 + dx, 100 + dy, { pointerType }));
  rect.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
}

test('a drag of an input or an output moves it on the grid, its arrows follow, and it is saved as version 25', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await openGraph();
  const graph = graphOf();
  const box = sizedBox();
  box.scrollLeft = 30;
  const [input] = placeIds(graph, 'in') as [string];
  const [output] = placeIds(graph, 'out') as [string];
  assert.ok(input && output, 'the iron group has inputs and outputs');
  const [line] = lineIds(graph) as [string];
  const inStart = drawnAt(input),
    lineStart = drawnAt(line);
  const before = arrowsOf(graph, input);
  assert.ok(before.length, 'the input has arrows');
  await dragBox(input, 37, 152);
  assert.deepEqual(drawnAt(input), snapSpot(inStart[0] + 37, inStart[1] + 152));
  assert.notDeepEqual(arrowsOf(graph, input), before, 'its arrows follow');
  assert.deepEqual(drawnAt(line), snapSpot(...lineStart), 'the lines stay, on the grid');
  assert.equal(box.scrollLeft, 30, 'the drawing does not move');
  assert.ok($('#detail [data-flow-graph]'), 'the click that ends the drag opens nothing');
  // Saved at once: the lines held where they are, the input where it was put.
  let saves = layoutSaves(calls) as { layout: GroupLayout }[];
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0]!.layout.places, {
    [input]: snapSpot(inStart[0] + 37, inStart[1] + 152),
  });
  assert.deepEqual(Object.keys(saves[0]!.layout.nodes!).sort(), lineIds(graph).map(rowOf).sort());
  assert.deepEqual(storedLayout()?.places, saves[0]!.layout.places, 'and the state keeps it');
  assert.equal(state.version, 25);
  const outStart = drawnAt(output);
  // An output moves the same way, here with a finger, and is saved beside the input.
  await dragBox(output, 64, -33, 'touch');
  const outSpot = snapSpot(outStart[0] + 64, Math.max(0, outStart[1] - 33));
  assert.deepEqual(drawnAt(output), outSpot);
  saves = layoutSaves(calls) as { layout: GroupLayout }[];
  assert.equal(saves.length, 2);
  assert.deepEqual(Object.keys(saves[1]!.layout.places!).sort(), [input, output].sort());
  assert.deepEqual(saves[1]!.layout.places![output], outSpot);
  // Every box is on the grid now.
  for (const node of graph.nodes) {
    const [x, y] = drawnAt(node.id);
    assert.deepEqual([x % 5, y % 5], [0, 0], node.id);
  }
  // Pointing at the moved input still lights up its arrows.
  enter(nodeEl(input));
  await nextTick();
  for (const edge of graph.edges.filter(edge => edge.from === input && edge.path))
    assert.ok(has(edgeEl(edge.id), 'hl'), edge.id);
  leave(nodeEl(input));
  // A press on a place without a drag opens nothing and saves nothing.
  const rect = $(`#detail [data-node="${input}"] rect`)!;
  rect.dispatchEvent(pointer('pointerdown', 100, 100));
  rect.dispatchEvent(pointer('pointermove', 102, 101));
  rect.dispatchEvent(pointer('pointerup', 102, 101));
  rect.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  assert.ok($('#detail [data-flow-graph]'), 'still the graph');
  assert.equal(layoutSaves(calls).length, 2);
});

test('the arrow keys move a focused input or output a grid step, and the graph opens with it there', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await openGraph();
  const graph = graphOf();
  sizedBox();
  const [output] = placeIds(graph, 'out') as [string];
  const place = $(`#detail [data-node="${output}"]`)!;
  assert.match(place.getAttribute('aria-label')!, /\. The arrow keys move it\.$/);
  const start = drawnAt(output);
  place.focus();
  const key = (name: string, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', {
      key: name,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    $(`#detail [data-node="${output}"]`)!.dispatchEvent(event);
    return event;
  };
  assert.equal(key('ArrowLeft').defaultPrevented, true, 'the box does not scroll');
  key('ArrowDown', true);
  await settle();
  const spot = [snapUnit(start[0] - 5), snapUnit(start[1]) + 50];
  assert.deepEqual(drawnAt(output), spot);
  assert.equal(document.activeElement, $(`#detail [data-node="${output}"]`), 'focus stays on it');
  // Enter on a place opens nothing.
  assert.equal(key('Enter').defaultPrevented, false);
  await settle();
  assert.ok($('#detail [data-flow-graph]'));
  await rest();
  const saves = layoutSaves(calls) as { layout: GroupLayout }[];
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0]!.layout.places, { [output]: spot });
  dialog().close();
  await settle();
  await openGraph();
  assert.deepEqual(drawnAt(output), spot, 'it opens where it was put');
});

test('Reset layout puts moved inputs and outputs back too, asking first', async () => {
  const automatic = graphOf();
  const [input] = placeIds(automatic, 'in') as [string];
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await showFactories(arrangedGroups({ places: { [input]: [15, 400] } }));
  await openGraph();
  sizedBox();
  assert.deepEqual(drawnAt(input), [15, 400]);
  const asked = answerConfirms(true);
  $<HTMLButtonElement>('#detail [data-flow-layout-reset]')!.click();
  await settle();
  assert.equal(asked.length, 1, 'a moved input is work to redo');
  assert.match(asked[0]!, /production lines, inputs and outputs you moved/);
  const spot = automatic.nodes.find(node => node.id === input)!;
  assert.deepEqual(drawnAt(input), [spot.x, spot.y]);
  assert.deepEqual(layoutSaves(calls), [{ type: 'factoryGroupLayout', id: GROUP, layout: null }]);
  assert.equal(storedLayout(), undefined);
  assert.ok(state.version < 22);
});

test('storage and the sink keep their stored spots while they are tags', async () => {
  const automatic = graphOf();
  const quiet = automatic.edges.find(edge => edge.quiet && edge.path)!.to;
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await showFactories(arrangedGroups({ places: { [quiet]: [1500, 20] } }));
  await openGraph();
  sizedBox();
  assert.deepEqual(drawnAt(quiet), [1500, 20]);
  const toggle = () => {
    const input = $<HTMLInputElement>('#detail [data-flow-tags]')!;
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  toggle();
  await settle();
  assert.equal($(`#detail [data-node="${quiet}"]`), null, 'a tag now');
  assert.deepEqual(layoutSaves(calls).at(-1), {
    type: 'factoryGroupLayout',
    id: GROUP,
    layout: { tags: true, places: { [quiet]: [1500, 20] } },
  });
  toggle();
  await settle();
  assert.deepEqual(drawnAt(quiet), [1500, 20], 'back where it was put');
  assert.deepEqual(storedLayout(), { places: { [quiet]: [1500, 20] } });
});

test('a layout stored before #1240 opens as it was: its lines unmoved, inputs and outputs automatic', async () => {
  const automatic = graphOf();
  const [first] = lineIds(automatic) as [string];
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await showFactories(arrangedGroups({ nodes: { [rowOf(first)]: [903, 31] } }));
  await openGraph();
  assert.deepEqual(drawnAt(first), [903, 31], 'a spot off the grid stays where it is');
  for (const id of [...placeIds(automatic, 'in'), ...placeIds(automatic, 'out')]) {
    const spot = automatic.nodes.find(node => node.id === id)!;
    const [x, y] = drawnAt(id);
    assert.ok(Math.abs(x - spot.x) <= 2.5 && Math.abs(y - spot.y) <= 2.5, id);
  }
  await rest();
  assert.deepEqual(layoutSaves(calls), [], 'opening it saves nothing');
});
