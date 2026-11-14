// Steps in a factory's flow graph (FG-8, #1345): every column of lines has a header that is named
// "Step 1", "Step 2" … and can be renamed in place (Enter saves, Esc cancels, an empty name is the
// default again; stored with the layout, state version 32); a line is pushed to a later step by
// dropping its box in the "New step" column that shows at the right while a box is dragged, or with
// "Move to step …" in the selection panel's ⋯ menu, the keyboard's way; a step a line cannot reach
// says "needs 03 first" and nothing moves; a move offers Undo; Tidy up asks before it puts the
// pushed lines back; and the build order page shows the same names and follows the new order. The
// model and both editions are in tests/flow-graph-steps.test.ts; where the boxes land is checked
// in a real browser (browser-check.ts).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { itemRate } from '../../public/app/flow.ts';
import { flowGraph, type FlowGraph } from '../../public/app/flow-graph.ts';
import { flowFeeds, lineSteps } from '../../public/app/flow-steps.ts';
import { flowRoute, setQuery, state, viewOf } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { shownGroupFlow } from '../../public/app/shown-group-flow.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import {
  $,
  $$,
  answerConfirms,
  applyUpdate,
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
  location.hash = '#factories';
  open({ calculated: structuredClone(plan), phase: '3', state: { factoryGroups } });
  go('factories');
  render();
  await settle();
}
const arranged = (layout: GroupLayout): FactoryGroups => ({
  ...groups,
  groups: groups.groups.map(group => (group.id === GROUP ? { ...group, layout } : group)),
});
const dialog = () => $<HTMLDialogElement>('#detail')!;
// happy-dom lays nothing out: the scrolling box is given a size, or a press counts as one on its
// scrollbar.
function sizedBox() {
  const box = $('#detail [data-flow-graph]')!;
  Object.defineProperty(box, 'clientWidth', { configurable: true, value: 600 });
  Object.defineProperty(box, 'clientHeight', { configurable: true, value: 400 });
  return box;
}
async function openGraph(id = GROUP) {
  $<HTMLButtonElement>(`#main [data-group-graph="${id}"]`)!.click();
  await settle();
  assert.ok(dialog().open, 'the dialog is open');
  sizedBox();
}
const graphOf = (floors?: Record<string, number>): FlowGraph => {
  const flow = shownGroupFlow(GROUP, undefined, floors);
  assert.ok(flow);
  return flowGraph(flow, itemRate, () => '', { steps: floors ?? {} });
};
const lineIds = (graph: FlowGraph) =>
  graph.nodes.filter(node => node.kind === 'line').map(node => node.id);
const rowOf = (id: string) => id.slice('line:'.length);
const storedLayout = (): GroupLayout | undefined =>
  state.factoryGroups.groups.find(group => group.id === GROUP)?.layout;
const layoutSaves = (calls: [string, UpdateOp][]) =>
  calls
    .filter(([path, body]) => path === '/api/update' && body.type === 'factoryGroupLayout')
    .map(([, body]) => body);
// The build order page of the iron factory, as a deep link or a reload opens it.
async function showFlowPage() {
  location.hash = '#' + flowRoute(GROUP);
  go(viewOf(location.hash.slice(1)));
  render();
  await settle();
}
const headers = () =>
  $$('#detail [data-step-name]').map(head => ({
    step: Number(head.getAttribute('data-step-name')),
    text: head.querySelector('text')!.textContent!.trim(),
  }));
const note = () => $('#detail [data-flow-step-note]')?.textContent?.trim();
const undoText = () => $('#detail [data-flow-undo-text]')?.textContent?.trim();
const key = (name: string, target: Element, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};
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
// Selects line `id`: a press that hardly moves and its click, as a user does.
async function select(id: string) {
  const rect = $(`#detail [data-node="${id}"] rect`)!;
  rect.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  assert.ok($('#detail [data-flow-graph-selection]'), 'the panel is open');
}
// The ⋯ menu's choices of the selected line, by step.
async function menu() {
  $<HTMLButtonElement>('#detail [data-selection-move]')!.click();
  await settle();
  return $$<HTMLButtonElement>('#fgraph-move-menu [data-move-step]');
}
// A line in the first step that feeds another, and the line fed (so it can be pushed later and
// pulls a line with it), and a line in a later step.
const picks = (graph: FlowGraph) => {
  const lines = graph.nodes.filter(node => node.kind === 'line');
  const first = lines.find(node => node.layer === Math.min(...lines.map(known => known.layer)))!;
  const later = lines.find(node => node.layer > first.layer)!;
  return { first, later };
};

beforeEach(() => showFactories());
afterEach(async () => {
  if (!dialog().open) return;
  dialog().close();
  await settle();
});

test('every column has a header, "Step 1", "Step 2" …, in the order of the columns', async () => {
  await openGraph();
  const graph = graphOf();
  assert.ok(graph.columns.length >= 2, 'the default iron factory has several steps');
  assert.deepEqual(
    headers(),
    graph.columns.map(column => ({ step: column.step, text: `Step ${column.step}` })),
  );
  const first = $('#detail [data-step-name="1"]')!;
  assert.equal(first.getAttribute('role'), 'button');
  assert.equal(first.getAttribute('tabindex'), '0');
  assert.equal(first.getAttribute('aria-label'), 'Step 1. Enter renames it.');
  // The headers are in the drawing after every box, so the boxes keep the tab order.
  const all = $$('#detail [data-flow-graph] [tabindex="0"]');
  assert.equal(all[all.length - 1], $$('#detail [data-step-name]').at(-1));
});

test('a press on a header renames the step in place: Enter saves, Esc cancels, empty is the default', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await openGraph();
  const head = () => $<SVGElement>('#detail [data-step-name="1"]')!;
  const input = () => $<HTMLInputElement>('#detail [data-step-input]');
  assert.equal(input(), null);
  head().dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  assert.ok(input(), 'an input replaces the header');
  assert.equal(input()!.getAttribute('aria-label'), 'Name of step 1');
  assert.equal(input()!.maxLength, 40);
  assert.equal(document.activeElement, input(), 'it has focus');
  // Esc cancels: nothing saved, the dialog stays open, focus is back on the header.
  input()!.value = 'Nope';
  input()!.dispatchEvent(new Event('input', { bubbles: true }));
  const esc = key('Escape', input()!);
  await settle();
  assert.equal(esc.defaultPrevented, true, 'the dialog does not take the Escape');
  assert.equal(input(), null);
  assert.equal(head().querySelector('text')!.textContent!.trim(), 'Step 1');
  assert.deepEqual(layoutSaves(calls), []);
  assert.ok(dialog().open);
  assert.equal(document.activeElement, head(), 'focus returns to the header');
  // Enter on the header opens it too; Enter in the input saves, trimmed.
  key('Enter', head());
  await settle();
  assert.ok(input());
  input()!.value = '  Smelting ';
  input()!.dispatchEvent(new Event('input', { bubbles: true }));
  key('Enter', input()!);
  await settle();
  assert.equal(head().querySelector('text')!.textContent!.trim(), 'Smelting');
  assert.equal(head().getAttribute('aria-label'), 'Step 1 · Smelting. Enter renames it.');
  assert.deepEqual(layoutSaves(calls), [
    { type: 'factoryGroupLayout', id: GROUP, layout: { stepNames: { '1': 'Smelting' } } },
  ]);
  assert.deepEqual(storedLayout(), { stepNames: { '1': 'Smelting' } });
  assert.equal(state.version, 32);
  // An unchanged name saves nothing; an empty one is the default again, and version 32 goes.
  head().dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  key('Enter', input()!);
  await settle();
  assert.equal(layoutSaves(calls).length, 1, 'unchanged: nothing saved');
  head().dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  input()!.value = '   ';
  input()!.dispatchEvent(new Event('input', { bubbles: true }));
  key('Enter', input()!);
  await settle();
  assert.equal(head().querySelector('text')!.textContent!.trim(), 'Step 1');
  assert.equal(layoutSaves(calls).length, 2);
  assert.equal(storedLayout(), undefined);
  assert.ok(state.version < 22, 'version ' + state.version);
});

test('the name is kept as the graph is opened again, and the build order shows it over its lines', async () => {
  await showFactories(arranged({ stepNames: { '1': 'Smelting', '2': 'Steel' } }));
  await openGraph();
  assert.deepEqual(
    headers()
      .slice(0, 2)
      .map(head => head.text),
    ['Smelting', 'Steel'],
  );
  dialog().close();
  await settle();
  // The build order page: a step named in the graph heads its first line, others have no heading.
  await showFlowPage();
  // Every line in a named step says so, in the list and over its card or row; the steps are the
  // graph's (lineSteps), so a line's name is its step's.
  const flow = shownGroupFlow(GROUP)!;
  const steps = lineSteps(
    flow.lines.map(line => line.id),
    flowFeeds(flow.lines),
    {},
  );
  const named = flow.lines.filter(line => steps.get(line.id)! <= 2);
  assert.ok(named.length >= 2);
  const expected = named.map(line =>
    steps.get(line.id) === 1 ? 'Step 1 · Smelting' : 'Step 2 · Steel',
  );
  const tags = (hook: string) =>
    $$('#main ' + hook).map(head => head.textContent!.replace(/\s+/g, ' ').trim());
  assert.deepEqual(tags('[data-gf-navhead]'), expected);
  assert.deepEqual(tags('[data-gf-stephead]'), expected);
  // Without a name nothing changes on the page.
  await showFactories();
  await showFlowPage();
  assert.equal($$('#main [data-gf-navhead]').length, 0);
});

test('the ⋯ menu moves the selected line to a later step; the build order follows and Undo puts it back', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await openGraph();
  const automatic = graphOf();
  const { first } = picks(automatic);
  await select(first.id);
  const items = await menu();
  const count = automatic.columns.length;
  // Every other step and a new one at the end; the one it is in is not offered, nor "own step".
  assert.deepEqual(
    items.map(item => Number(item.dataset.moveStep)),
    Array.from({ length: count + 1 }, (_, i) => i + 1).filter(step => step !== 1),
  );
  assert.equal($('#fgraph-move-menu [data-move-own]'), null);
  const last = items[items.length - 1]!;
  assert.match(last.textContent!, /Move to a new step at the end/);
  assert.equal(last.getAttribute('role'), 'menuitem');
  last.click();
  await settle();
  const floors = { [rowOf(first.id)]: count + 1 };
  assert.deepEqual(layoutSaves(calls), [
    { type: 'factoryGroupLayout', id: GROUP, layout: { steps: floors } },
  ]);
  assert.deepEqual(storedLayout(), { steps: floors });
  assert.equal(state.version, 32);
  // The graph is the one flowGraph gives with that step; the build order's order follows.
  const pushed = graphOf(floors);
  assert.deepEqual(
    $$('#detail [data-node^="line:"]').map(node => node.getAttribute('data-node')),
    lineIds(pushed),
  );
  assert.ok(pushed.columns.length >= count, 'the line and what it feeds sit in later steps');
  const flow = shownGroupFlow(GROUP)!;
  assert.equal(flow.lines.at(0)?.id !== rowOf(first.id), true, 'it is not built first any more');
  // Undo (the button, or Ctrl+Z) puts it back and saves the layout as it was. The panel repeats
  // what was done, with its own Undo, since the toolbar is out of sight from there.
  assert.match(undoText()!, /^Moved .+ to Step \d+\.$/);
  assert.match(
    $('#detail [data-selection-note]')!.textContent!,
    /^\s*Moved .+ to Step \d+\.\s*Undo\s*$/,
  );
  assert.ok($('#detail [data-selection-undo]'), 'the panel has an Undo');
  $<HTMLButtonElement>('#detail [data-flow-tidy-undo]')!.click();
  await settle();
  assert.equal(storedLayout(), undefined);
  assert.equal(layoutSaves(calls).length, 2);
  assert.equal(shownGroupFlow(GROUP)!.lines[0]!.id, rowOf(first.id));
  // "Back to its own step" shows while it is pushed, and takes the push out.
  await select(first.id);
  (await menu()).at(-1)!.click();
  await settle();
  assert.ok(storedLayout()?.steps);
  await select(first.id);
  await menu();
  $<HTMLButtonElement>('#fgraph-move-menu [data-move-own]')!.click();
  await settle();
  assert.equal(storedLayout(), undefined);
  assert.match(undoText()!, /^Moved .+ to Step 1\.$/);
});

test('a step a line cannot reach snaps back with "needs 03 first", and nothing is saved', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await openGraph();
  const graph = graphOf();
  const { later } = picks(graph);
  await select(later.id);
  const items = await menu();
  const one = items.find(item => item.dataset.moveStep === '1')!;
  assert.ok(one, 'the first step is listed');
  assert.equal(one.getAttribute('aria-disabled'), 'true');
  assert.match(one.textContent!, /\(needs \d\d first\)/);
  one.click();
  await settle();
  assert.match(note()!, /^Needs \d\d first: the line stays where it is\.$/);
  assert.match(
    $('#detail [data-selection-note]')!.textContent!,
    /Needs \d\d first/,
    'the panel says so too',
  );
  assert.equal($('#detail [data-selection-undo]'), null, 'with nothing to undo');
  assert.deepEqual(layoutSaves(calls), []);
  assert.equal(storedLayout(), undefined);
  assert.equal($('#detail [data-flow-tidy-undo]'), null, 'nothing to undo');
  // The line it needs is the one that feeds it: named by its number in the build order.
  const needed = Number(note()!.match(/Needs (\d\d) first/)![1]);
  const flow = shownGroupFlow(GROUP)!;
  const feeder = flow.lines.find(line => line.no === needed)!;
  assert.ok(
    graph.edges.some(edge => edge.from === 'line:' + feeder.id && edge.to === later.id),
    'it feeds the line',
  );
});

test('dragging a box shows the New step column; dropping it there pushes the line, the box stays', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await openGraph();
  const automatic = graphOf();
  const { first } = picks(automatic);
  const line = $(`#detail [data-node="${first.id}"]`)!;
  const before = line.getAttribute('transform');
  assert.equal($('#detail [data-flow-newstep]'), null, 'no column while nothing is dragged');
  line.dispatchEvent(pointer('pointerdown', 100, 100));
  line.dispatchEvent(pointer('pointermove', 160, 140));
  await settle();
  const zone = $<HTMLElement>('#detail [data-flow-newstep]')!;
  assert.ok(zone, 'the New step column shows while a box is dragged');
  assert.match(zone.textContent!, /New step/);
  assert.match(zone.textContent!, new RegExp(`after step ${automatic.columns.length}`));
  assert.equal(zone.getAttribute('aria-hidden'), 'true', 'the menu is the accessible way');
  // happy-dom lays nothing out: the column is the right 200 px of a 600 x 400 box.
  zone.getBoundingClientRect = () => new DOMRect(400, 0, 200, 400);
  line.dispatchEvent(pointer('pointermove', 300, 140));
  await settle();
  assert.equal(zone.classList.contains('over'), false);
  line.dispatchEvent(pointer('pointermove', 450, 140));
  await settle();
  assert.equal(zone.classList.contains('over'), true, 'it lights up under the pointer');
  assert.deepEqual(layoutSaves(calls), [], 'nothing is saved while it moves');
  line.dispatchEvent(pointer('pointerup', 450, 140));
  line.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  assert.equal($('#detail [data-flow-newstep]'), null, 'the column goes when the drop is done');
  const floors = { [rowOf(first.id)]: automatic.columns.length + 1 };
  const saves = layoutSaves(calls) as { layout: GroupLayout }[];
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0]!.layout, { steps: floors }, 'only the step is stored, no spot');
  assert.equal(state.version, 32);
  // The graph is automatic with that step: the line is where the automatic layout puts it.
  const pushed = graphOf(floors);
  const spot = pushed.nodes.find(node => node.id === first.id)!;
  assert.equal(line.getAttribute('transform'), `translate(${spot.x},${spot.y})`);
  assert.notEqual(line.getAttribute('transform'), before);
  assert.match(undoText()!, /^Moved .+ to Step \d+\.$/);
});

test('a drop outside the New step column is an ordinary move, and nothing is pushed', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await openGraph();
  const { first } = picks(graphOf());
  const line = $(`#detail [data-node="${first.id}"]`)!;
  line.dispatchEvent(pointer('pointerdown', 100, 100));
  line.dispatchEvent(pointer('pointermove', 160, 140));
  await settle();
  $<HTMLElement>('#detail [data-flow-newstep]')!.getBoundingClientRect = () =>
    new DOMRect(400, 0, 200, 400);
  line.dispatchEvent(pointer('pointermove', 200, 140));
  line.dispatchEvent(pointer('pointerup', 200, 140));
  await settle();
  const saves = layoutSaves(calls) as { layout: GroupLayout }[];
  assert.equal(saves.length, 1);
  assert.equal(saves[0]!.layout.steps, undefined);
  assert.ok(saves[0]!.layout.nodes, 'the box was moved and its spot saved');
});

test('Tidy up asks before it puts pushed lines back, keeps the names, and Undo brings them back', async () => {
  const automatic = graphOf();
  const { first } = picks(automatic);
  const floors = { [rowOf(first.id)]: automatic.columns.length + 1 };
  const layout: GroupLayout = { steps: floors, stepNames: { '1': 'Smelting' } };
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await showFactories(arranged(layout));
  await openGraph();
  const tidy = $<HTMLButtonElement>('#detail [data-flow-tidy]')!;
  // Cancel keeps everything.
  const no = answerConfirms(false);
  tidy.click();
  await settle();
  assert.equal(no.length, 1, 'it asked');
  assert.match(JSON.stringify(no[0]), /pushed to a later step/);
  assert.deepEqual(layoutSaves(calls), []);
  assert.deepEqual(storedLayout(), layout);
  // Confirm clears the steps and keeps the names.
  const yes = answerConfirms(true);
  tidy.click();
  await settle();
  assert.equal(yes.length, 1);
  assert.deepEqual(storedLayout(), { stepNames: { '1': 'Smelting' } });
  assert.equal(
    $$('#detail [data-node^="line:"]').length,
    lineIds(automatic).length,
    'every line is still drawn',
  );
  assert.equal(shownGroupFlow(GROUP)!.lines[0]!.id, lineIds(automatic)[0]!.slice(5));
  // Undo puts the steps back.
  $<HTMLButtonElement>('#detail [data-flow-tidy-undo]')!.click();
  await settle();
  assert.deepEqual(storedLayout(), layout);
  // With nothing pushed Tidy up asks nothing.
  await showFactories(arranged({ stepNames: { '1': 'Smelting' } }));
  await openGraph();
  const none = answerConfirms(true);
  $<HTMLButtonElement>('#detail [data-flow-tidy]')!.click();
  await settle();
  assert.deepEqual(none, []);
});

test('another phase is only looked at: its headers cannot be renamed and the panel has no menu', async () => {
  // The oil factory has lines in more than one phase, so it has phase tabs.
  await openGraph('fg-oilcp1');
  const tab = $<HTMLButtonElement>('#detail [data-phase-tab="5"]')!;
  assert.ok(tab, 'a tab for another phase');
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  tab.click();
  await settle();
  const head = $('#detail [data-step-name]')!;
  assert.ok(head, 'the steps are named there too');
  assert.equal(head.getAttribute('role'), null);
  assert.equal(head.getAttribute('tabindex'), null);
  head.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  assert.equal($('#detail [data-step-input]'), null, 'it cannot be renamed there');
  // A line can be selected, but there is no menu to move it.
  const line = $('#detail [data-node^="line:"] rect')!;
  line.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  assert.ok($('#detail [data-flow-graph-selection]'));
  assert.equal($('#detail [data-selection-move]'), null);
  assert.deepEqual(layoutSaves(calls), []);
});
