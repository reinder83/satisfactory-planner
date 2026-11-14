// The selection panel of a factory's flow graph (FG-5, #1344, ui/detail/FlowGraphPanel.vue in
// ui/detail/FlowGraphDialog.vue): a press on a line's box without a drag, or Enter on it, selects
// the line instead of opening it. Its arrows (and no others) stay lit, the box is marked, and a
// panel under the graph lists what comes in (rate, belts, source) and what leaves (rate, belts,
// consumer), with Mark running (the factories card's Running box), "Open line" (the production
// line's dialog in the graph's place) and "Open in build order" (the factory's flow page, the
// line's card focused). A press on the background or "Clear selection" clears it. On another
// phase's tab the facts stay and the three actions go (flow-graph-phase-tabs.test.ts).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { itemRate } from '../../public/app/flow.ts';
import { flowGraph, type FlowGraph } from '../../public/app/flow-graph.ts';
import { setQuery, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { shownGroupFlow } from '../../public/app/shown-group-flow.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { $, $$, applyUpdate, generated, go, open, page, stubFetch } from './setup.ts';
import type { FactoryGroups, UpdateOp } from '../../public/types/index.ts';

const plan = generated();
const groups: FactoryGroups = defaultFactoryGroups(plan);
const GROUP = 'fg-iron01';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const dialog = () => $<HTMLDialogElement>('#detail')!;
async function showFactories() {
  page();
  setQuery('');
  open({
    calculated: structuredClone(plan),
    phase: '3',
    state: { factoryGroups: structuredClone(groups) },
  });
  go('factories');
  render();
  await settle();
}
async function openGraph() {
  const opener = $<HTMLButtonElement>(`#main [data-group-graph="${GROUP}"]`)!;
  opener.focus();
  opener.click();
  await settle();
  assert.ok(dialog().open, 'the dialog is open');
}
const graphOf = (): FlowGraph => {
  const flow = shownGroupFlow(GROUP);
  assert.ok(flow);
  return flowGraph(flow, itemRate, () => '');
};
// A line of the group that takes something in and gives something out.
const busyLine = (graph: FlowGraph) => {
  const id = graph.nodes
    .filter(node => node.kind === 'line')
    .map(node => node.id)
    .find(
      line =>
        graph.edges.some(edge => edge.to === line && !edge.note) &&
        graph.edges.some(edge => edge.from === line && !edge.note),
    );
  assert.ok(id, 'a line with inputs and outputs');
  return id;
};
const rowOf = (id: string) => id.slice('line:'.length);
const lineBox = (id: string) => $(`#detail [data-node="${id}"]`)!;
const press = async (id: string) => {
  lineBox(id).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
};
const panel = () => $('#detail [data-flow-graph-selection]');
const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

beforeEach(showFactories);
afterEach(async () => {
  if (!dialog().open) return;
  dialog().close();
  await settle();
});

test('selecting a line lights its edges and opens the panel with its in and out rates, belts and sources', async () => {
  await openGraph();
  const graph = graphOf();
  const id = busyLine(graph);
  assert.equal(panel(), null, 'nothing is selected on opening');
  assert.equal(lineBox(id).getAttribute('aria-pressed'), 'false');
  await press(id);
  const shown = panel()!;
  assert.ok(shown, 'the panel opens');
  assert.equal(shown.getAttribute('role'), 'region');
  assert.match(shown.getAttribute('aria-label')!, /^Selected production line: /);
  assert.equal(
    text(shown.querySelector('[data-selection-name]')!),
    graph.nodes.find(node => node.id === id)!.label,
  );
  assert.equal(lineBox(id).getAttribute('aria-pressed'), 'true');
  assert.ok(lineBox(id).classList.contains('sel'), 'the box is marked');
  // The graph stays, the line's dialog is not opened.
  assert.ok($('#detail [data-flow-graph]'));
  assert.equal($('#detail .eyebrow')!.textContent, 'FACTORY · FLOW GRAPH');

  const ins = graph.edges.filter(edge => edge.to === id);
  const outs = graph.edges.filter(edge => edge.from === id);
  const inList = $$('#detail [data-selection-in] li');
  const outList = $$('#detail [data-selection-out] li');
  assert.equal(inList.length, ins.length);
  assert.equal(outList.length, outs.length);
  ins.forEach((edge, i) => {
    const row = text(inList[i]!);
    assert.ok(row.includes(edge.item), row);
    assert.ok(row.includes(edge.rateText), row);
    assert.ok(row.includes('from ' + edge.fromText), row);
    if (edge.belts) assert.ok(row.includes(edge.belts), row);
  });
  outs.forEach((edge, i) => {
    const row = text(outList[i]!);
    assert.ok(row.includes(edge.item), row);
    assert.ok(row.includes(edge.rateText), row);
    assert.ok(row.includes('to ' + edge.toText), row);
    if (edge.belts) assert.ok(row.includes(edge.belts), row);
  });
  assert.ok(
    [...ins, ...outs].some(edge => edge.belts),
    'the flow page words belts for some of them',
  );

  // Exactly the line's arrows are lit, every other one faded.
  const lit = new Set([...ins, ...outs].map(edge => edge.id));
  for (const edge of graph.edges) {
    const path = $(`#detail [data-edge="${edge.id}"]`);
    if (!path) continue;
    assert.equal(path.classList.contains('hl'), lit.has(edge.id), edge.id + ' lit');
    assert.equal(path.classList.contains('faded'), !lit.has(edge.id), edge.id + ' faded');
  }

  // The selection stays when the pointer visits another box and leaves it.
  const other = graph.nodes.find(node => node.kind === 'line' && node.id !== id)!;
  lineBox(other.id).dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
  lineBox(other.id).dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }));
  await settle();
  assert.ok(lineBox(id).classList.contains('on'), 'the selected line is lit again');

  // Another line takes the selection over; the background clears it.
  await press(other.id);
  assert.equal(text($('#detail [data-selection-name]')!), other.label);
  assert.equal(lineBox(id).getAttribute('aria-pressed'), 'false');
  $('#detail svg')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  assert.equal(panel(), null, 'a press on the background clears it');
  assert.equal($('#detail [data-edge].hl'), null);
});

test('Enter and Space on a focused line select it; Clear selection clears it; an input is no selection', async () => {
  await openGraph();
  const id = busyLine(graphOf());
  lineBox(id).focus();
  const key = (name: string) => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    lineBox(id).dispatchEvent(event);
    return event;
  };
  assert.equal(key('Enter').defaultPrevented, true);
  await settle();
  assert.ok(panel(), 'Enter selects');
  $<HTMLButtonElement>('#detail [data-selection-clear]')!.click();
  await settle();
  assert.equal(panel(), null);
  key(' ');
  await settle();
  assert.ok(panel(), 'Space selects');
  assert.equal(document.activeElement, lineBox(id), 'focus stays on the box');
  // A press on an input or output box selects nothing.
  const place = $('#detail [data-node^="in:"]')!;
  place.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  assert.equal(
    text($('#detail [data-selection-name]')!),
    graphOf().nodes.find(node => node.id === id)!.label,
  );
  assert.equal(lineBox(id).getAttribute('aria-pressed'), 'true', 'the line stays selected');
});

test('Mark running ticks the line like the factories card does, and unticks it', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await openGraph();
  const id = busyLine(graphOf());
  const check = 'calc-3-' + rowOf(id);
  await press(id);
  const box = $<HTMLInputElement>('#detail [data-selection-running]')!;
  assert.equal(box.dataset.check, check, "the factories card's own check");
  assert.equal(box.checked, false);
  assert.equal(state.checks[check], undefined);
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.equal(state.checks[check], true, 'saved as a check');
  assert.ok(calls.length > 0);
  assert.equal($<HTMLInputElement>('#detail [data-selection-running]')!.checked, true);
  assert.ok($('#detail [data-flow-graph]'), 'the graph stays');
  const again = $<HTMLInputElement>('#detail [data-selection-running]')!;
  again.checked = false;
  again.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.ok(!state.checks[check], 'unticked');
});

test('Open line opens the production line dialog in the graph’s place', async () => {
  await openGraph();
  const id = busyLine(graphOf());
  await press(id);
  $<HTMLButtonElement>('#detail [data-selection-line]')!.click();
  await settle();
  assert.equal($('#detail [data-flow-graph]'), null, 'the graph made way');
  assert.ok(dialog().open, 'the dialog stays open');
  assert.notEqual($('#detail .eyebrow')!.textContent, 'FACTORY · FLOW GRAPH');
});

test('Open in build order closes the graph and goes to the factory’s flow page with the line focused', async () => {
  await openGraph();
  const id = busyLine(graphOf());
  await press(id);
  $<HTMLButtonElement>('#detail [data-selection-order]')!.click();
  await settle();
  assert.equal(dialog().open, false, 'the dialog closed');
  assert.equal(location.hash, `#factories/${GROUP}/flow?phase=3`);
  // The page under the test has no hashchange listener: draw the page the address names, as the
  // listener does. The card for the line then takes focus.
  render();
  const card = () => $<HTMLElement>(`#main .gf-card[data-line="${rowOf(id)}"]`);
  for (let i = 0; i < 20 && document.activeElement !== card(); i++) await settle();
  assert.ok(card(), 'the flow page has a card for the line');
  assert.equal(document.activeElement, card(), 'the line’s card has focus');
});
