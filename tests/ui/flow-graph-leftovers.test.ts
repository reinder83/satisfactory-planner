// The flow graph's leftovers from #1343: a hovered arrow names its belts (FG-2) and the outputs sit
// under a "Leaves the factory" header (FG-4). The ALT tag is tested in tests/flow-graph.test.ts.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, test } from 'vitest';
import { itemRate } from '../../public/app/flow.ts';
import { flowGraph, type FlowGraph } from '../../public/app/flow-graph.ts';
import { setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { shownGroupFlow } from '../../public/app/shown-group-flow.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { $, $$, generated, go, open, page } from './setup.ts';
import type { FactoryGroups } from '../../public/types/index.ts';

const plan = generated();
const groups: FactoryGroups = defaultFactoryGroups(plan);
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const dialog = () => $<HTMLDialogElement>('#detail')!;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function openGraphOf(id: string) {
  page();
  setQuery('');
  history.replaceState(null, '', '#factories');
  open({
    calculated: structuredClone(plan),
    phase: '3',
    state: { factoryGroups: structuredClone(groups) },
  });
  go('factories');
  render();
  await settle();
  const opener = $<HTMLButtonElement>(`#main [data-group-graph="${id}"]`)!;
  opener.focus();
  opener.click();
  await settle();
  assert.ok(dialog().open);
}
// A factory's graph as the dialog draws it, found by what the test needs of it.
const graphOf = (id: string): FlowGraph => flowGraph(shownGroupFlow(id)!, itemRate, () => '');
const factoryWith = (has: (graph: FlowGraph) => boolean): string => {
  page();
  open({
    calculated: structuredClone(plan),
    phase: '3',
    state: { factoryGroups: structuredClone(groups) },
  });
  const id = groups.groups.map(group => group.id).find(group => has(graphOf(group)));
  assert.ok(id, 'a factory of the plan has what the test needs');
  return id;
};

afterEach(async () => {
  if (dialog()?.open) {
    dialog().close();
    await settle();
  }
});

test('a graph with an output has the "Leaves the factory" header over its output column', async () => {
  const id = factoryWith(graph => !!graph.outs);
  await openGraphOf(id);
  const head = $('#detail [data-outs-head]')!;
  assert.equal(text(head), 'Leaves the factory');
  const outs = graphOf(id).nodes.filter(node => node.kind === 'out');
  const left = Math.min(...outs.map(node => node.x));
  assert.equal(head.getAttribute('transform'), `translate(${left},0)`);
  assert.equal(graphOf(id).outs!.x, left);
});

test('an arrow names its belts in its hover title', async () => {
  const id = factoryWith(graph => graph.edges.some(edge => edge.belts));
  await openGraphOf(id);
  const edge = graphOf(id).edges.find(entry => entry.belts && entry.path)!;
  const title = [...$$('#detail .fgraph-edges title, #detail svg title')]
    .map(text)
    .find(entry => entry.startsWith(`${edge.item}: ${edge.rateText} from `));
  assert.ok(title, 'the arrow has a title');
  assert.ok(title.includes(' · ') && /belt|pipe/.test(title), title);
});
