// The phase tabs of a factory's flow graph dialog (#1317, ui/PhaseTabs.vue in
// ui/detail/FlowGraphDialog.vue): one tab per phase, opening on the phase on screen and marked
// "· current"; another phase's graph is the stored layout applied to the boxes the two phases
// share and the automatic layout for the rest, and it is read-only: a drag, the arrow keys, a
// press on a line, "Reset layout", the tags switch, a zoom and a scroll never write the stored
// layout (or anything else), and switching the tab never switches the profile's phase. The tab
// is in the dialog's own state: opening the graph again opens the phase on screen's. The profile
// is the planner's default, made for Phase 3: fg-oilcp1 has 5 lines in Phase 3 and 8 in Phase 5.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { itemRate } from '../../public/app/flow.ts';
import { flowGraph, type FlowGraph } from '../../public/app/flow-graph.ts';
import { phase, setQuery, state } from '../../public/app/session.ts';
import { shownGroupFlow } from '../../public/app/shown-group-flow.ts';
import { render } from '../../public/app/shell.ts';
import { LAYOUT_SAVE_DELAY } from '../../public/app/ui/detail/graph-layout-save.ts';
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
const base: FactoryGroups = defaultFactoryGroups(plan);
const GROUP = 'fg-oilcp1';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const rest = () => new Promise(resolve => setTimeout(resolve, LAYOUT_SAVE_DELAY + 100));
const dialog = () => $<HTMLDialogElement>('#detail')!;
const tabs = () => $$<HTMLButtonElement>('#detail [data-phase-tabs="fg"] [role="tab"]');
const tab = (id: string) => $<HTMLButtonElement>(`#detail [data-phase-tab="${id}"]`)!;
const openKey = () =>
  tabs().find(el => el.getAttribute('aria-selected') === 'true')?.dataset.phaseTab;
const graphOf = (stageKey: '3' | '5'): FlowGraph => {
  const flow = shownGroupFlow(GROUP, stageKey);
  assert.ok(flow);
  return flowGraph(flow, itemRate, () => '');
};
const lineIds = (graph: FlowGraph) =>
  graph.nodes.filter(node => node.kind === 'line').map(node => node.id);
const rowOf = (id: string) => id.slice('line:'.length);
const drawnAt = (id: string): [number, number] | null => {
  const transform = $(`#detail [data-node="${id}"]`)?.getAttribute('transform');
  const found = transform?.match(/translate\(([-\d.]+),([-\d.]+)\)/);
  return found ? [Number(found[1]), Number(found[2])] : null;
};
const layoutSaves = (calls: [string, UpdateOp][]) =>
  calls.filter(([path, body]) => path === '/api/update' && body.type === 'factoryGroupLayout');
const storedLayout = (): GroupLayout | undefined =>
  state.factoryGroups.groups.find(group => group.id === GROUP)?.layout;
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
function sizedBox() {
  const box = $('#detail [data-flow-graph]')!;
  Object.defineProperty(box, 'clientWidth', { configurable: true, value: 400 });
  Object.defineProperty(box, 'clientHeight', { configurable: true, value: 300 });
  return box;
}

// The five lines of Phase 3 stored at spots of their own, the layout of the phase on screen.
const SPOTS: Record<string, [number, number]> = {};
const arranged = (): FactoryGroups => {
  lineIds(graphOf('3')).forEach((id, i) => (SPOTS[rowOf(id)] = [100 + i * 400, 20 + i * 250]));
  const layout: GroupLayout = { nodes: SPOTS };
  return {
    ...base,
    groups: base.groups.map(group => (group.id === GROUP ? { ...group, layout } : group)),
  };
};
async function showFactories(factoryGroups: FactoryGroups = base) {
  page();
  setQuery('');
  open({ calculated: structuredClone(plan), phase: '3', state: { factoryGroups } });
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
  sizedBox();
}
async function pick(key: string) {
  tab(key).click();
  await settle();
}

beforeEach(() => showFactories());
afterEach(async () => {
  if (!dialog().open) return;
  dialog().close();
  await settle();
});

test('the tabs open on the phase on screen, marked current, and name the panel', async () => {
  await openGraph();
  const list = $('#detail [data-phase-tabs="fg"]')!;
  assert.equal(list.getAttribute('role'), 'tablist');
  assert.deepEqual(
    tabs().map(el =>
      el
        .textContent!.replace(/\s+/g, ' ')
        .replace(/, no lines.*/, '')
        .trim(),
    ),
    ['Phase 1', 'Phase 2', 'Phase 3 · current', 'Phase 4', 'Phase 5'],
  );
  assert.equal(openKey(), '3');
  assert.equal(tab('1').getAttribute('aria-disabled'), 'true');
  assert.equal(tab('1').title, 'No lines in Phase 1');
  const panel = $('#detail [role="tabpanel"]')!;
  assert.equal(panel.getAttribute('aria-labelledby'), tab('3').id);
  assert.equal(tab('3').getAttribute('aria-controls'), panel.id);
  assert.match($('#detail .dialog-summary, #detail .dialog-head')!.textContent!, /Phase 3/);
  assert.equal($$('#detail [data-node^="line:"]').length, 5);
  assert.equal($('#detail [data-flow-graph-readonly]'), null);
});

test('another phase draws its own graph and changes neither the phase nor anything saved', async () => {
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await openGraph();
  const before = JSON.stringify(state);
  const hash = location.hash;
  await pick('5');
  assert.equal(openKey(), '5');
  assert.equal($$('#detail [data-node^="line:"]').length, 8, 'Phase 5 has 8 lines');
  assert.match($('#detail [data-flow-graph]')!.getAttribute('aria-label')!, /Phase 5 · 8 lines/);
  assert.match($('#detail [data-flow-graph-readonly]')!.textContent!, /Viewing Phase 5/);
  assert.equal(phase(), '3');
  assert.equal(JSON.stringify(state), before);
  assert.equal(location.hash, hash, 'the tab is not in the address');
  await rest();
  assert.deepEqual(calls, [], 'no request at all');
  await pick('3');
  assert.equal($$('#detail [data-node^="line:"]').length, 5);
});

test('another phase reuses the saved spots of the boxes both phases have, the rest automatic', async () => {
  await showFactories(arranged());
  await openGraph();
  const current = lineIds(graphOf('3'));
  for (const id of current) assert.deepEqual(drawnAt(id), SPOTS[rowOf(id)], id);
  await pick('5');
  const later = lineIds(graphOf('5'));
  const common = later.filter(id => current.includes(id));
  const fresh = later.filter(id => !current.includes(id));
  assert.ok(common.length > 0 && fresh.length > 0, 'the phases share some lines, not all');
  for (const id of common) assert.deepEqual(drawnAt(id), SPOTS[rowOf(id)], 'kept: ' + id);
  for (const id of fresh) assert.ok(drawnAt(id), 'drawn: ' + id);
  assert.equal(new Set(later.map(id => drawnAt(id)!.join())).size, later.length, 'none on another');
});

test('a drag, the arrow keys, Reset layout, the tags, a zoom and a scroll never write the layout', async () => {
  await showFactories(arranged());
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await openGraph();
  const stored = JSON.stringify(storedLayout());
  await pick('5');
  const box = sizedBox();
  const [first] = lineIds(graphOf('5')).filter(id => SPOTS[rowOf(id)]) as [string];
  const line = $(`#detail [data-node="${first}"]`)!;
  const at = drawnAt(first);
  assert.equal(line.getAttribute('role'), 'img', 'a line is no button here');
  assert.doesNotMatch(line.getAttribute('aria-label')!, /Enter opens it|arrow keys move/);
  // A drag past the threshold moves no box and ends with no save.
  line.dispatchEvent(pointer('pointerdown', 100, 100));
  line.dispatchEvent(pointer('pointermove', 160, 150));
  await settle();
  line.dispatchEvent(pointer('pointermove', 200, 190));
  line.dispatchEvent(pointer('pointerup', 200, 190));
  line.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  assert.deepEqual(drawnAt(first), at, 'the box stays');
  assert.equal(box.classList.contains('moving'), false);
  assert.ok($('#detail [data-flow-graph]'), 'a press opens no line');
  // The arrow keys move nothing and are left to the page.
  line.focus();
  const key = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
  line.dispatchEvent(key);
  line.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle();
  assert.equal(key.defaultPrevented, false);
  assert.deepEqual(drawnAt(first), at);
  assert.ok($('#detail [data-flow-graph]'), 'Enter opens no line');
  // Reset layout and the tags switch are not offered.
  assert.equal($('#detail [data-flow-layout-reset]'), null);
  assert.equal($('#detail [data-flow-tags]'), null);
  // A zoom and a scroll are looked at, never stored.
  $<HTMLButtonElement>('#detail [data-flow-zoom="in"]')!.click();
  box.scrollLeft = 40;
  box.dispatchEvent(new Event('scroll'));
  await settle();
  await rest();
  assert.deepEqual(layoutSaves(calls), [], 'nothing was saved');
  assert.equal(JSON.stringify(storedLayout()), stored, 'the stored layout is as it was');
  assert.deepEqual(calls, []);
});

test('closing while another phase is open saves nothing either', async () => {
  await showFactories(arranged());
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await openGraph();
  await pick('5');
  $<HTMLButtonElement>('#detail [data-flow-zoom="in"]')!.click();
  await settle();
  dialog().close();
  await settle();
  await rest();
  assert.deepEqual(calls, []);
});

test('back on the phase on screen the layout can be moved and Reset layout is there again', async () => {
  await showFactories(arranged());
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await openGraph();
  await pick('5');
  await pick('3');
  sizedBox();
  assert.ok($('#detail [data-flow-layout-reset]'));
  const [first] = lineIds(graphOf('3')) as [string];
  const line = $(`#detail [data-node="${first}"]`)!;
  assert.equal(line.getAttribute('role'), 'button');
  const at = drawnAt(first)!;
  line.dispatchEvent(pointer('pointerdown', 100, 100));
  line.dispatchEvent(pointer('pointermove', 160, 140));
  line.dispatchEvent(pointer('pointerup', 160, 140));
  line.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  assert.notDeepEqual(drawnAt(first), at, 'the box moved');
  assert.equal(layoutSaves(calls).length, 1, 'and the drag saved once');
  answerConfirms(true);
});

test('the tab is kept in the dialog only: the graph opens on the phase on screen again', async () => {
  await openGraph();
  await pick('4');
  assert.equal(openKey(), '4');
  dialog().close();
  await settle();
  await openGraph();
  assert.equal(openKey(), '3');
  assert.equal($('#detail [data-flow-graph-readonly]'), null);
});

test('arrow keys, Home and End move between the tabs, skipping Phases 1 and 2', async () => {
  await openGraph();
  tab('3').focus();
  assert.equal(tab('3').tabIndex, 0);
  assert.equal(tab('4').tabIndex, -1);
  const press = (name: string) =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
    );
  press('ArrowRight');
  await settle();
  assert.equal(openKey(), '4');
  assert.equal(document.activeElement, tab('4'));
  press('End');
  await settle();
  assert.equal(openKey(), '5');
  press('ArrowRight');
  await settle();
  assert.equal(openKey(), '3', 'it wraps past the unavailable Phases 1 and 2');
  press('ArrowLeft');
  await settle();
  assert.equal(openKey(), '5');
  press('Home');
  await settle();
  assert.equal(openKey(), '3');
});

test('back on the phase on screen its own zoom and scroll are shown, and a scroll saves those (#1019)', async () => {
  await showFactories(arranged());
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await openGraph();
  const zoomText = () => $('#detail [data-flow-zoom-level]')!.textContent;
  // The phase on screen's own view, stored.
  $<HTMLButtonElement>('#detail [data-flow-zoom="in"]')!.click();
  await settle();
  await rest();
  const own = zoomText();
  const storedZoom = storedLayout()?.zoom;
  assert.ok(storedZoom && storedZoom !== 1, 'a zoom of its own is stored');
  const saves = layoutSaves(calls).length;
  // Another phase's tab is zoomed and scrolled, which only looks.
  await pick('5');
  const box = sizedBox();
  $<HTMLButtonElement>('#detail [data-flow-zoom="in"]')!.click();
  $<HTMLButtonElement>('#detail [data-flow-zoom="in"]')!.click();
  await settle();
  box.scrollLeft = 40;
  box.dispatchEvent(new Event('scroll'));
  await settle();
  assert.notEqual(zoomText(), own, 'the read-only tab is zoomed on');
  // Back: the stored view is what is on screen.
  await pick('3');
  await settle();
  assert.equal(zoomText(), own, 'the zoom of the phase on screen is back');
  // The next scroll saves the restored view, not the read-only one.
  box.dispatchEvent(new Event('scroll'));
  await settle();
  await rest();
  assert.equal(storedLayout()?.zoom, storedZoom, 'the stored zoom is unchanged');
  assert.equal(layoutSaves(calls).length, saves, 'nothing new was saved');
});
