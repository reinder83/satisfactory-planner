// A factory's flow graph (#1192, ui/detail/FlowGraphDialog.vue), opened from "Flow graph ↗" on its
// heading on the Factories page, on the planner's default Phase 3 plan with the default factory
// groups: by keyboard it opens and closes with focus back on the button, the drawing has one
// arrow per flow the group's flow figures give (flowGraph of shownGroupFlow), and "The graph as
// a table" lists every one of them, self links included. Where the boxes land is checked in a
// real browser (browser-check.ts); happy-dom lays nothing out.
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
