<!--
  A factory group's flow graph (#1192, part of #1079) in the shared #detail dialog, opened by
  "Flow graph ↗" on the group's heading on the Factories page (openFlowGraph in
  factory-detail.ts) for the phase shown. The model is flowGraph (flow-graph.ts) of the group's
  flow (shownGroupFlow, the flow page's own figures), so every arrow is one of the flow page's
  connections. Left to right: what comes in, the group's lines in layers, what leaves (other
  factories, storage, the AWESOME Sink), each arrow labelled with its item and rate per minute.
  The dialog takes the window's width and most of its height (#1223). The drawing scrolls inside
  its own box (focusable, so the keyboard scrolls it too) and never widens the dialog; the wheel
  over it zooms around the pointer, a drag on its background moves it, two fingers pinch, and
  − / + / Fit zoom it (useGraphPanZoom, graph-pan-zoom.ts). A press on a line's box without a
  drag, or Enter on it, selects it (FG-5, #1344): its arrows stay lit and a panel under the graph
  (FlowGraphPanel.vue) lists what comes in (rate, belts, source) and what leaves (rate, belts,
  consumer), with Mark running, "Open line" (that production line's dialog in this one's place) and
  "Open in build order" (the factory's flow page for the phase on screen, the line's card focused,
  focusFlowLine). A press on the background or "Clear selection" clears it. The instructions are
  behind the "?" at the end of the toolbar (FG-6, `flowGraphHelp`, HelpPopover.vue).
  Rearranging (#1224): a drag of a line's box moves it and its arrows follow (placedGraph,
  graph-layout.ts); a line's box takes focus in the automatic order wherever it sits, Enter opens
  it and the arrow keys move it (Shift: bigger steps). Where the lines sit, the zoom and the
  scroll offsets are stored per factory (useGraphLayout, graph-layout-save.ts; groups[].layout,
  state version 22) and put back on the next opening; "Tidy up" (FG-3, #1343) lays the graph out
  again as the automatic layout draws it (layered, with few crossings, FG-1: flowGraph) at natural
  size, replacing where boxes were moved, and offers Undo (the button beside it, or Ctrl+Z: a
  dialog is open, so the toast's shortcut stays quiet here) until the next move of a box. Inputs and outputs (#1240): a
  drag of an input's or an output's box, or the arrow keys on it, moves it the same way (stored by
  node id, `places`, state version 25; the lines are held where they are on its first move), and
  every move snaps to a 5 px grid (GRAPH_GRID, graph-layout.ts), the arrow keys a grid step at a
  time (Shift: ten). Storage and the sink keep their stored spots while they are tags.
  "The graph as a table" lists every arrow again as text, which the drawing's accessible name
  points to. A group gone since the dialog opened says so.
  Storage and the sink (#1231): the arrows into Protected storage and the AWESOME Sink are quiet
  (thin, grey, behind the others, no label or arrowhead); pointing at one lights it up with its
  label. "Show storage and sink as tags", stored with the layout (`tags`, state version 23),
  draws them as tags on their lines instead and leaves out the two boxes. Pointing at a box or
  focusing it lights up its arrows (and tags) and fades the rest, every lit arrow with its label,
  the quiet ones too (a line's arrows to storage and the sink since #1242, and every arrow into
  storage or the sink), and the lit labels are spread so none overlap (spreadLabels,
  graph-labels.ts); one with no room is left out, its value in its arrow's hover title and the
  table. At rest a label with no free spot on its curve is left out too (`crowded`, #1019), until
  its arrow is pointed at or its box lit. Every box and tag takes focus and is named; a box the
  keyboard focuses is scrolled into view, as one it moves is.
  Phase tabs (#1317, PhaseTabs.vue, phase-tabs.ts): one per phase of the plan above the graph, on
  the phase on screen ("Phase 4 · current") when it opens, to look at the factory's graph in
  another phase without switching the profile's phase. The tab is in this component's state only.
  Another phase's graph is the stored layout applied to the boxes it has in common with the phase
  on screen (the spots are by row id and node id) and the automatic layout for the rest
  (placedGraph), and is read-only: a drag of a box pans the drawing, the arrow keys do not move a
  box, a press on a line selects it and the panel shows its facts only (Mark running, Open line and Open in
  build order would reach the phase on screen's line), "Tidy up"
  and the tags switch are left out, and the layout is never saved while such a tab is open
  (useGraphLayout's `readonly`: not the spots, the tags, the zoom or the scroll). Switching tab
  first saves what a zoom or scroll of the phase on screen's tab was still waiting to save.
  Steps (FG-8, #1345): each column of lines is a step, headed "Step 1", "Step 2" … above the
  graph (`data-step-name`), a name the user can change in place (a press or Enter on the header;
  Enter saves, Esc cancels, an empty name is the default again; `stepNames`, state version 32) and
  the build order page shows the same names. There is no way to add a step by hand: the steps come
  from what feeds what. To build a line later, drag its box into the "New step" column that shows
  at the right edge of the drawing while a box is dragged (`data-flow-newstep`), or choose "Move to
  step …" in the ⋯ menu of the selection panel (the keyboard's way): the line then sits in that
  step at the earliest (`steps`, state version 32, a floor per line), the lines it feeds follow it,
  and the build order follows (groupFlow, flow-steps.ts). A step a line cannot reach because a line
  feeding it sits in or after it says "needs 03 first" and nothing moves. A move offers Undo (the
  button beside Tidy up, or Ctrl+Z) like Tidy up does, which also puts every line back in its own
  step, after asking. The drop only changes the step: the box goes back to where it was drawn, so
  a graph arranged by hand keeps its arrangement.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { openCalculatedFactory } from '../../factory-detail.ts';
import { earliestStep, flowFeeds, lineSteps, movedFloors } from '../../flow-steps.ts';
import { lineNumber } from '../../views/group-flow-page.ts';
import { confirmAction } from '../confirm.ts';
import { closeDetail } from '../actions.ts';
import { focusFlowLine } from '../flow-line-focus.ts';
import FlowGraphPanel from './FlowGraphPanel.vue';
import HelpPopover from '../HelpPopover.vue';
import { itemRate } from '../../flow.ts';
import {
  flowGraph,
  GRAPH,
  labelObstacles,
  shortText,
  tagBox,
  type GraphEdge,
  type GraphNode,
  type GraphTag,
} from '../../flow-graph.ts';
import { spreadLabels, type PlacedLabel } from '../../graph-labels.ts';
import type { FlowLine } from '../../group-flow.ts';
import { num } from '../../format.ts';
import { openTab, phaseTabs, tabId } from '../../phase-tabs.ts';
import { flowRoute, phase, phaseLabel, stage } from '../../session.ts';
import { shownGroupFlow } from '../../shown-group-flow.ts';
import type { StageKey } from '../../../types/index.ts';
import PhaseTabs from '../PhaseTabs.vue';
import { factoryGroupsState, machineLine } from '../../views/factories.ts';
import { legacy } from '../bridge.ts';
import DialogFrame from './DialogFrame.vue';
import { GRAPH_ZOOM, type GraphPoint, type GraphView } from '../../graph-view.ts';
import {
  heldSpots,
  isPlaceNode,
  lineRowOf,
  nudgedSpot,
  placedGraph,
  snapSpot,
} from '../../graph-layout.ts';
import { useGraphPanZoom } from './graph-pan-zoom.ts';
import { useGraphLayout } from './graph-layout-save.ts';

const props = defineProps<{ id: string }>();

// A line's machines as the flow page's table writes them: a split line its share first.
const machines = (line: FlowLine) =>
  (line.share < 1 - 1e-6 ? `≈ ${num(line.machinesHere)} of ` : '') +
  machineLine(line.machines, line.machine, line.lastClock, line.clock);

// The scrolling box. The stored layout and the lines' spots while the dialog is open; the view
// on screen is the zoom and the box's scroll offsets.
const box = ref<HTMLElement | null>(null);
const layout = useGraphLayout(
  props.id,
  () =>
    box.value ? { zoom: zoom.value, left: box.value.scrollLeft, top: box.value.scrollTop } : null,
  () => readonly.value,
);

// The phase tab open (#1317), null for the phase on screen's. Component state only.
const picked = ref<StageKey | null>(null);
const tabs = computed(() => legacy(() => phaseTabs(props.id)));
const shown = computed<StageKey>(() => openTab(tabs.value, picked.value));
// Another phase's graph is only looked at: nothing of it moves or is saved.
const readonly = computed(() => shown.value !== legacy(() => stage()));
// The view of the phase on screen's tab while another phase's tab is open (#1019): a zoom or a
// scroll made on a read-only tab is only looked at, so coming back puts this one back.
let home: GraphView | null = null;
// Saves what the phase on screen's tab was waiting to save, then shows the tab.
function pickTab(key: StageKey) {
  layout.now();
  tidied.value = null;
  activeNode.value = null;
  selected.value = null;
  hoveredEdge.value = null;
  const leaving = !readonly.value;
  if (leaving && box.value)
    home = { zoom: zoom.value, left: box.value.scrollLeft, top: box.value.scrollTop };
  picked.value = key;
  if (!leaving && home && key === legacy(() => stage())) {
    const back = home;
    home = null;
    void nextTick().then(() => show(back));
  }
}

const view = computed(() =>
  legacy(() => {
    const name = factoryGroupsState().groups.find(group => group.id === props.id)?.name ?? null;
    const flow = name === null ? null : shownGroupFlow(props.id, shown.value, layout.steps.value);
    const graph = flow?.lines.length
      ? flowGraph(flow, itemRate, machines, { tags: layout.tags.value, steps: layout.steps.value })
      : null;
    // The tags switch is offered while something goes to storage or the sink.
    const quiet = !!graph?.edges.some(edge => edge.quiet);
    return {
      name,
      phase: phaseLabel(readonly.value ? shown.value : phase()),
      working: phaseLabel(phase()),
      flow,
      graph,
      quiet,
    };
  }),
);

const count = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;
const summary = computed(() => {
  const graph = view.value.graph;
  if (!graph) return view.value.phase;
  const lines = graph.nodes.filter(node => node.kind === 'line').length;
  return `${view.value.phase} · ${count(lines, 'line', 'lines')} · ${count(graph.edges.length, 'flow', 'flows')}`;
});
const graphName = computed(
  () =>
    `Flow graph of ${view.value.name}, ${summary.value}. The graph as a table, below it, lists every flow.`,
);

// The words after an arrow's item in the table, as the flow page's table has them.
const NOTES: Record<GraphEdge['note'], string> = {
  '': '',
  loop: 'loop: seed a starter batch',
  self: 'back into the same line',
};
// Until a box is first moved, a stored layout's boxes that grew to show their rates (#1308) are
// drawn below the ones they would cover; that move stores the layout as drawn (putNode).
const settling = ref(true);
// The graph as drawn: the automatic one with the stored and dragged spots of lines and places.
const placed = computed(
  () =>
    view.value.graph &&
    placedGraph(view.value.graph, layout.spots.value, layout.places.value, settling.value),
);
// The drawn arrows, the quiet ones (into storage and the sink, #1231) first, so every other arrow
// is drawn over them.
const drawn = computed(() => {
  const edges = placed.value?.edges.filter(edge => edge.path) ?? [];
  return [...edges.filter(edge => edge.quiet), ...edges.filter(edge => !edge.quiet)];
});

// The box under the pointer or with keyboard focus, and the arrow under the pointer (#1231).
const activeNode = ref<string | null>(null);
// The line selected by a press or Enter (FG-5): its arrows stay lit and the panel below describes
// it, until another is selected, a press on the background or "Clear selection".
const selected = ref<string | null>(null);
const hoveredEdge = ref<string | null>(null);
const leaveNode = (id: string) => {
  if (activeNode.value === id) activeNode.value = null;
};
const leaveEdge = (id: string) => {
  if (hoveredEdge.value === id) hoveredEdge.value = null;
};
// What the active box lights up: its arrows and tags, and where the lit labels go, spread so none
// overlap (null: no room, left out). Every lit arrow has its label: a production line's quiet
// arrows to storage and the sink too (#1242), and on storage or the sink every arrow in.
const lit = computed(() => {
  const graph = placed.value,
    id = activeNode.value ?? selected.value;
  if (!graph || !id || !graph.nodes.some(node => node.id === id)) return null;
  const edges = new Set(
    drawn.value.filter(edge => edge.from === id || edge.to === id).map(edge => edge.id),
  );
  const labelled = drawn.value.filter(edge => edges.has(edge.id) && edge.label && edge.curve);
  const labels: Map<string, PlacedLabel | null> = spreadLabels(
    labelled.map(edge => ({ id: edge.id, width: edge.label!.width, curves: [edge.curve!] })),
    GRAPH.labelHeight,
    labelObstacles(graph.nodes, graph.tags),
    false,
  );
  const tags = new Set(graph.tags.filter(tag => tag.node === id).map(tag => tag.id));
  return { node: id, edges, labels, tags };
});

// Where a side of the arrow ends in the drawing: an item coming in, between lines, or leaving;
// quiet, and lit or faded by the active box, or under the pointer.
const edgeClass = (edge: GraphEdge) => {
  const on = lit.value;
  const shining = !!on?.edges.has(edge.id);
  return [
    'fgraph-edge',
    edge.from.startsWith('in:') ? 'from-place' : edge.to.startsWith('out:') ? 'to-place' : 'inside',
    edge.note,
    {
      quiet: edge.quiet,
      hl: shining,
      faded: !!on && !shining,
      hover: hoveredEdge.value === edge.id,
    },
  ];
};
// A quiet arrow has its arrowhead only while its box lights it up.
const arrowOf = (edge: GraphEdge) =>
  !edge.quiet || lit.value?.edges.has(edge.id) ? 'url(#fgraph-arrow)' : undefined;
// An arrow's hover title, which keeps its value where its label has no room.
// and, as the dialog's table has it, the belts or pipes that carry it (FG-2).
const edgeTitle = (edge: GraphEdge) =>
  `${edge.item}: ${edge.rateText} from ${edge.fromText} to ${edge.toText}${edge.belts ? ' · ' + edge.belts : ''}`;
// Where an arrow's label is drawn, and how: lit and spread, faded with its arrow, hidden (a quiet
// or crowded arrow's not lit or pointed at, or a lit label with no room), or as it is at rest.
function labelOf(edge: GraphEdge): { x: number; y: number; state: string } {
  // Every drawn arrow has its label (placeEdgeLabels).
  const rest = edge.label!;
  const on = lit.value;
  if (on?.edges.has(edge.id)) {
    const spot = on.labels.get(edge.id);
    return spot ? { x: spot.x, y: spot.y, state: 'lit' } : { ...rest, state: 'hidden' };
  }
  if (edge.quiet || rest.crowded)
    return { ...rest, state: hoveredEdge.value === edge.id ? 'lit' : 'hidden' };
  return { ...rest, state: on ? 'faded' : '' };
}
// The tags of the line with box `node`, and where each sits (its top-left corner).
const tagsOf = (node: GraphNode): (GraphTag & { left: number; top: number })[] =>
  (placed.value?.tags ?? [])
    .filter(tag => tag.node === node.id)
    .map(tag => {
      const at = tagBox(tag, node);
      return { ...tag, left: at.x - at.width / 2, top: at.y - at.height / 2 };
    });
const tagClass = (tag: GraphTag) => {
  const on = lit.value;
  return ['fgraph-tag', { hl: !!on?.tags.has(tag.id), faded: !!on && !on.tags.has(tag.id) }];
};
const rateTitle = (node: GraphNode) =>
  `${node.kind === 'line' ? 'Makes' : node.kind === 'in' ? 'Draws' : 'Receives'}: ${node.rateTitle}`;
// A box's hover title: its whole name where the box cuts or changes it (FG-4), then what it makes,
// draws or receives, every item whole (#1308).
const nodeTitle = (node: GraphNode) =>
  [node.shortLabel !== node.label ? node.label : '', node.rateTitle ? rateTitle(node) : '']
    .filter(Boolean)
    .join(' · ');
// "Show storage and sink as tags": redrawn at once and saved with the layout.
function setTags(on: boolean) {
  if (readonly.value) return;
  layout.tags.value = on;
  activeNode.value = null;
  hoveredEdge.value = null;
  layout.now();
}

// Where a box is, for a drag to move it; none on another phase's tab, where a drag pans.
const nodeAt = (node: string): GraphPoint | null => {
  if (readonly.value) return null;
  const spot = placed.value?.nodes.find(known => known.id === node);
  return spot ? { x: spot.x, y: spot.y } : null;
};
// The box of `node` (a line's or, since #1240, an input's or an output's) put at `to`, every line
// of the graph kept where it is drawn now (so none takes a new spot round a moved place).
const putNode = (node: string, to: [number, number]) => {
  const graph = placed.value;
  if (!graph) return;
  // A move after Tidy up is a newer edit than the one Undo would put back over it.
  tidied.value = null;
  const row = lineRowOf(node);
  const held = heldSpots(graph, layout.spots.value);
  // The first move keeps the boxes settled below the ones they grew into where they are drawn.
  if (settling.value) {
    settling.value = false;
    const places = { ...layout.places.value };
    for (const [id, spot] of Object.entries(graph.nudged ?? {})) {
      const nudgedRow = lineRowOf(id);
      if (nudgedRow !== null) held[nudgedRow] = spot;
      else if (isPlaceNode(id)) places[id] = spot;
    }
    layout.places.value = places;
  }
  layout.spots.value = row === null ? held : { ...held, [row]: to };
  if (row === null && isPlaceNode(node))
    layout.places.value = { ...layout.places.value, [node]: to };
};
// A dragged box follows the pointer on the grid (#1240).
const moveNode = (node: string, to: GraphPoint) => putNode(node, snapSpot(to.x, to.y));
const { zoom, panning, moving, show, zoomIn, zoomOut, fit, handlers, onClickCapture } =
  useGraphPanZoom(box, () => placed.value, {
    at: nodeAt,
    grab: grabNode,
    move: dragMove,
    drop: dropNode,
  });
const zoomText = computed(() => `${Math.round(zoom.value * 100)}%`);

// On a phone the graph is mostly empty space (MOB-3, #1354), so the dialog opens on a list of the
// lines with what comes in and what leaves each, and a toggle shows the graph. Wider than the
// phone layout (720px, as style.css) there is only the graph, as before. Both stay mounted, one
// hidden (the graph's box is zero-sized meanwhile), so the selection, the layout and the table
// are the same in both; the graph's view (zoom and scroll) is put back when it is shown again.
const phone = globalThis.matchMedia?.('(max-width: 720px)');
const narrow = ref(phone?.matches === true);
const mode = ref<'list' | 'graph'>(narrow.value ? 'list' : 'graph');
const showList = computed(() => narrow.value && mode.value === 'list');
let listView: GraphView | null = null;
const wanted = (view: GraphView | null) => {
  const stored = view ?? layout.storedView;
  return stored.zoom !== 1 || stored.left || stored.top ? stored : null;
};
async function setMode(next: 'list' | 'graph') {
  if (next === mode.value) return;
  if (next === 'list' && box.value)
    listView = { zoom: zoom.value, left: box.value.scrollLeft, top: box.value.scrollTop };
  mode.value = next;
  if (next === 'graph') {
    await nextTick();
    const view = wanted(listView);
    if (view) await show(view);
  }
}
const phoneChanged = async (event: MediaQueryListEvent) => {
  narrow.value = event.matches;
  if (!event.matches && mode.value === 'list') {
    await nextTick();
    const view = wanted(listView);
    if (view) await show(view);
  }
};
// The list's rows: the lines of the graph left to right, as the steps build them, with the
// arrows into each and out of it as the flow page words them ("Iron Ore 315/min").
const listed = computed(() => {
  const graph = placed.value;
  if (!graph) return [];
  const words = (edges: typeof graph.edges) =>
    edges.map(edge => `${edge.item} ${edge.rateText}`).join(', ');
  return graph.nodes
    .filter(node => node.kind === 'line')
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map(node => ({
      node,
      ins: words(graph.edges.filter(edge => edge.to === node.id)),
      outs: words(graph.edges.filter(edge => edge.from === node.id)),
    }));
});

// The stored view back on opening; neither it nor the scroll it causes is a change to save.
onMounted(async () => {
  phone?.addEventListener?.('change', phoneChanged);
  const view = showList.value ? null : wanted(null);
  if (view) await show(view);
  layout.settled();
});
onBeforeUnmount(() => phone?.removeEventListener?.('change', phoneChanged));
// A zoom or a scroll is saved once it has rested.
watch(zoom, () => layout.later());

// A press on a line's box without a drag (a drag or pinch swallows its click, onClickCapture), or
// Enter on it, selects it (FG-5): its arrows stay lit and the panel under the graph opens. It works
// on another phase's tab too, which only looks.
const selectNode = (id: string) => {
  if (lineRowOf(id) === null) return;
  const opening = selected.value === null;
  selected.value = id;
  if (opening) void nextTick().then(() => panel.value?.$el.scrollIntoView?.({ block: 'nearest' }));
};
// A press on the drawing's background (not on a box, a tag or an arrow) clears the selection.
function onBackground(e: MouseEvent) {
  if ((e.target as Element).closest('[data-node], [data-tag], [data-edge-hit], [data-step]'))
    return;
  selected.value = null;
}
const panel = ref<InstanceType<typeof FlowGraphPanel> | null>(null);
// What the panel shows: the selected line's box and its arrows in and out, from every arrow of the
// graph (the quiet ones and the tags' too), and the plan row.
const selection = computed(() => {
  const id = selected.value,
    graph = view.value.graph,
    node = id && graph?.nodes.find(known => known.id === id);
  const row = id ? lineRowOf(id) : null;
  if (!node || !graph || row === null) return null;
  return {
    node,
    row,
    ins: graph.edges.filter(edge => edge.to === node.id),
    outs: graph.edges.filter(edge => edge.from === node.id),
  };
});
// "Open line": the production line's own dialog, in the graph's place.
const openLine = () => {
  const row = selection.value?.row;
  if (row && !readonly.value) openCalculatedFactory(row);
};
// "Open in build order": the factory's flow page for the phase on screen, with the line's card in
// focus. The dialog closes first (it may ask about a note); it stays if the user keeps the note.
async function openOrder() {
  const row = selection.value?.row,
    group = props.id;
  if (!row || readonly.value) return;
  await closeDetail();
  if (document.querySelector<HTMLDialogElement>('#detail')?.open) return;
  location.hash = '#' + flowRoute(group);
  focusFlowLine(row);
}
// A line's box takes focus: its name, and what Enter and the arrow keys do.
const lineAttrs = (node: GraphNode) => ({
  tabindex: 0,
  role: 'button',
  'aria-pressed': selected.value === node.id,
  'aria-label': `${node.label}, ${node.caption}.${node.rateTitle ? ' Makes ' + node.rateTitle + '.' : ''} Enter selects it${readonly.value ? '.' : ', the arrow keys move it.'}`,
});
// A place's box takes focus too (#1231), so the keyboard lights up its arrows: named with what
// comes in from it or goes out to it.
const flowList = (edges: GraphEdge[], end: (edge: GraphEdge) => string) =>
  edges.map(edge => `${edge.item} ${edge.rateText} ${end(edge)}`).join(', ');
function placeAttrs(node: GraphNode) {
  const edges = placed.value?.edges ?? [];
  const into = edges.filter(edge => edge.to === node.id),
    out = edges.filter(edge => edge.from === node.id);
  const parts = [
    ...(into.length ? [`In: ${flowList(into, edge => 'from ' + edge.fromText)}`] : []),
    ...(out.length ? [`Out: ${flowList(out, edge => 'to ' + edge.toText)}`] : []),
  ];
  return {
    tabindex: 0,
    role: 'img',
    'aria-label':
      [`${node.label}, ${node.caption}`, ...parts].join('. ') +
      (readonly.value ? '.' : '. The arrow keys move it.'),
  };
}
// Brings the box of `node` into view inside the scrolling box, as far as it is out of it.
async function keepInView(node: string) {
  await nextTick();
  const el = box.value;
  const shown = placed.value?.nodes.find(known => known.id === node);
  if (!el || !shown) return;
  const scale = zoom.value;
  const into = (start: number, end: number, offset: number, visible: number) =>
    start < offset ? start - 8 : end > offset + visible ? end - visible + 8 : offset;
  el.scrollLeft = into(
    shown.x * scale,
    (shown.x + shown.width) * scale,
    el.scrollLeft,
    el.clientWidth,
  );
  el.scrollTop = into(
    shown.y * scale,
    (shown.y + shown.height) * scale,
    el.scrollTop,
    el.clientHeight,
  );
}
// A box the keyboard focuses lights up its arrows and is brought into view (#1019): a focused box
// of the drawing at the scroll box's edge stayed where it was. Focus from a press leaves the scroll
// alone, so a drag starts where it was pressed.
function onNodeFocus(e: FocusEvent, node: GraphNode) {
  activeNode.value = node.id;
  if ((e.currentTarget as Element).matches(':focus-visible')) void keepInView(node.id);
}
// Enter or Space selects a focused line (on another phase's tab too, FG-5); an arrow key moves a
// focused box (a line's, an input's or an output's, #1240) a grid step, Shift by a bigger one.
function onNodeKey(e: KeyboardEvent, node: GraphNode) {
  if (lineRowOf(node.id) !== null && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    return selectNode(node.id);
  }
  if (readonly.value) return;
  // Where it is now: a key held down repeats before the drawing is redrawn.
  const at = nodeAt(node.id) ?? node;
  const to = nudgedSpot([at.x, at.y], e.key, e.shiftKey);
  if (!to) return;
  e.preventDefault();
  e.stopPropagation();
  putNode(node.id, to);
  layout.later();
  void keepInView(node.id);
}
// What the last change replaced, for Undo (FG-3, FG-8): the spots of the lines, inputs and
// outputs, the lines pushed to a later step and, for Tidy up, the view; `text` says what was done.
// Null when there is nothing to undo.
const tidied = ref<{
  text: string;
  // A move of one line: its words are made when shown, from the line's number as the graph shows
  // it now (the move renumbers the lines, #1355), so Undo never names its old number.
  moved?: { row: string; step: number };
  spots: Record<string, [number, number]>;
  places: Record<string, [number, number]>;
  steps: Record<string, number>;
  view: GraphView | null;
} | null>(null);

// Steps (FG-8, #1345). A step's name is the user's or "Step 3"; in a list "Step 3 · Steel".
const stepName = (step: number) => layout.stepNames.value[String(step)] || `Step ${step}`;
const stepWords = (step: number) => {
  const name = layout.stepNames.value[String(step)];
  return name ? `Step ${step} · ${name}` : `Step ${step}`;
};
// What a move of a line needs to know: the lines in build order, what feeds what, the step each
// sits in now and how many steps there are.
const stepFacts = computed(() => {
  const flow = view.value.flow,
    graph = view.value.graph;
  if (!flow || !graph) return null;
  const ids = flow.lines.map(line => line.id),
    feeds = flowFeeds(flow.lines);
  return {
    flow,
    ids,
    feeds,
    steps: lineSteps(ids, feeds, layout.steps.value),
    count: graph.columns.length,
  };
});
// A message with nothing to undo (a move that did not happen), in the toolbar's status.
const stepNote = ref('');
const lineName = (row: string) =>
  view.value.graph?.nodes.find(node => node.id === 'line:' + row)?.label ?? row;
// Puts line `row` in step `step` at the earliest, or back in its own (`'own'`). A step before one a
// line feeding it sits in snaps back with "needs 03 first", and one that changes nothing says so.
// Offers Undo. Returns whether the line moved.
function moveToStep(row: string, step: number | 'own'): boolean {
  const facts = stepFacts.value;
  if (!facts || readonly.value) return false;
  const { ids, feeds, steps, flow } = facts;
  const { step: earliest, after } = earliestStep(row, ids, feeds, steps);
  const target = step === 'own' ? earliest : step;
  if (target < earliest) {
    const needed = flow.lines.find(line => line.id === after);
    stepNote.value = `Needs ${needed ? lineNumber(needed.no) : ''} first: the line stays where it is.`;
    return false;
  }
  const floors = movedFloors(layout.steps.value, steps, row, target, earliest);
  const result = lineSteps(ids, feeds, floors);
  if (ids.every(id => result.get(id) === steps.get(id))) {
    stepNote.value = `${lineName(row)} is already in ${stepWords(steps.get(row) ?? 1)}.`;
    return false;
  }
  stepNote.value = '';
  tidied.value = {
    text: '',
    moved: { row, step: result.get(row) ?? target },
    spots: { ...layout.spots.value },
    places: { ...layout.places.value },
    steps: { ...layout.steps.value },
    view: null,
  };
  layout.steps.value = floors;
  activeNode.value = null;
  layout.now();
  return true;
}
// The steps the selected line can be moved to, for the panel's menu: every other step, and a new
// one after the last unless the line is alone in it. A step it cannot reach is listed with the
// line it needs first.
const moveChoices = computed(() => {
  const facts = stepFacts.value,
    row = selection.value?.row;
  if (!facts || !row || readonly.value) return { moves: [], own: false };
  const here = facts.steps.get(row);
  const { step: earliest, after } = earliestStep(row, facts.ids, facts.feeds, facts.steps);
  const needed = facts.flow.lines.find(line => line.id === after);
  const alone = [...facts.steps.values()].filter(step => step === facts.count).length === 1;
  const moves: { step: number; label: string; needs: string | null }[] = [];
  for (let step = 1; step <= facts.count + 1; step++) {
    if (step === here || (step === facts.count + 1 && here === facts.count && alone)) continue;
    moves.push({
      step,
      label: step > facts.count ? 'a new step at the end' : stepWords(step),
      needs: step < earliest && needed ? lineNumber(needed.no) : null,
    });
  }
  return { moves, own: (layout.steps.value[row] ?? 1) > 1 };
});

// A drag of a line's box shows the "New step" column at the right edge of the box; dropping it
// there pushes the line to a new step after the last. The boxes go back where they were drawn
// before the drag, so only the step changes.
const dragging = ref<string | null>(null);
const overNewStep = ref(false);
const newStepZone = ref<HTMLElement | null>(null);
let held: {
  spots: Record<string, [number, number]>;
  places: Record<string, [number, number]>;
  settling: boolean;
} | null = null;
function grabNode(node: string) {
  if (readonly.value || lineRowOf(node) === null) return;
  held = {
    spots: { ...layout.spots.value },
    places: { ...layout.places.value },
    settling: settling.value,
  };
  dragging.value = node;
  stepNote.value = '';
}
const inNewStep = (pointer?: GraphPoint) => {
  const zone = newStepZone.value?.getBoundingClientRect();
  return (
    !!zone &&
    !!pointer &&
    pointer.x >= zone.left &&
    pointer.x <= zone.right &&
    pointer.y >= zone.top &&
    pointer.y <= zone.bottom
  );
};
function dragMove(node: string, to: GraphPoint, pointer?: GraphPoint) {
  moveNode(node, to);
  overNewStep.value = dragging.value !== null && inNewStep(pointer);
}
function dropNode(node: string, pointer?: GraphPoint) {
  const row = lineRowOf(node),
    was = held,
    into = dragging.value !== null && inNewStep(pointer);
  dragging.value = null;
  overNewStep.value = false;
  held = null;
  if (into && row !== null && was) {
    layout.spots.value = was.spots;
    layout.places.value = was.places;
    settling.value = was.settling;
    const count = stepFacts.value?.count ?? 0;
    moveToStep(row, count + 1);
  }
  layout.now();
}

// A step's name changed in place (FG-8): Enter saves, Esc cancels, an empty name is the default.
const editingStep = ref<number | null>(null);
const draft = ref('');
const nameInput = ref<HTMLInputElement | null>(null);
const setNameInput = (el: unknown) => {
  nameInput.value = el instanceof HTMLInputElement ? el : null;
};
async function startRename(step: number) {
  if (readonly.value) return;
  editingStep.value = step;
  draft.value = layout.stepNames.value[String(step)] ?? '';
  await nextTick();
  nameInput.value?.focus();
  nameInput.value?.select();
}
async function endRename(save: boolean) {
  const step = editingStep.value;
  if (step === null) return;
  editingStep.value = null;
  if (save) {
    const name = draft.value.trim(),
      next = { ...layout.stepNames.value };
    if (name) next[String(step)] = name;
    else delete next[String(step)];
    if (JSON.stringify(next) !== JSON.stringify(layout.stepNames.value)) {
      layout.stepNames.value = next;
      layout.now();
    }
  }
  await nextTick();
  document.querySelector<HTMLElement>(`[data-step-name="${step}"]`)?.focus();
}
function onStepKey(e: KeyboardEvent, step: number) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  void startRename(step);
}
// Lays the graph out again as the automatic layout draws it, at natural size, from the top-left
// corner: the moved boxes' spots go (saved like a drag, layout.now). No question is asked, since
// Undo puts everything back.
async function tidyUp() {
  if (readonly.value) return;
  // Lines pushed to a later step go back too: that changes the build order, so it is asked first.
  if (
    Object.keys(layout.steps.value).length &&
    !(await confirmAction({
      title: 'Put every line back in its own step?',
      body: 'Tidy up also clears the lines you pushed to a later step, so the build order follows what feeds what again. The names of the steps stay. Undo brings the steps back.',
      confirmLabel: 'Tidy up',
    }))
  )
    return;
  const el = box.value;
  const before = {
    spots: { ...layout.spots.value },
    places: { ...layout.places.value },
    steps: { ...layout.steps.value },
    view: { zoom: zoom.value, left: el?.scrollLeft ?? 0, top: el?.scrollTop ?? 0 },
  };
  const moved =
    Object.keys(before.spots).length +
      Object.keys(before.places).length +
      Object.keys(before.steps).length >
    0;
  stepNote.value = '';
  layout.spots.value = {};
  layout.places.value = {};
  layout.steps.value = {};
  await show({ zoom: 1, left: 0, top: 0 });
  layout.now();
  // Undo is offered when something was replaced: a moved box, or a zoom or scroll the reset undid.
  const viewed = before.view.zoom !== 1 || before.view.left !== 0 || before.view.top !== 0;
  tidied.value = moved || viewed ? { text: 'Tidied up.', ...before } : null;
}
// What Undo says was done, with the line's name and the step's as they read now.
const undoText = computed(() => {
  const back = tidied.value;
  if (!back) return '';
  return back.moved
    ? `Moved ${lineName(back.moved.row)} to ${stepWords(back.moved.step)}.`
    : back.text;
});
// Undo of Tidy up: the boxes and the view back as they were, saved.
async function undoTidy() {
  const back = tidied.value;
  if (!back || readonly.value) return;
  tidied.value = null;
  layout.spots.value = back.spots;
  layout.places.value = back.places;
  layout.steps.value = back.steps;
  layout.now();
  if (back.view) await show(back.view);
  layout.now();
}
// Ctrl+Z (⌘Z) while the graph is open undoes Tidy up, unless it is typing in a field.
function onPanelKey(e: KeyboardEvent) {
  if (!tidied.value || readonly.value) return;
  if (e.defaultPrevented || e.shiftKey || e.altKey) return;
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
  if ((e.target as Element | null)?.closest?.('input:not([type="checkbox"]), textarea, select'))
    return;
  e.preventDefault();
  void undoTidy();
}
</script>

<template>
  <DialogFrame :title="view.name ?? 'Factory'" subtitle="FACTORY · FLOW GRAPH" :summary="summary">
    <PhaseTabs
      v-if="view.name !== null"
      :tabs="tabs"
      :open="shown"
      prefix="fg"
      panel="fg-panel"
      label="Phase"
      @pick="pickTab"
    />
    <div
      id="fg-panel"
      :role="view.name !== null ? 'tabpanel' : undefined"
      :aria-labelledby="view.name !== null ? tabId('fg', shown) : undefined"
      data-flow-graph-panel
      @keydown="onPanelKey"
    >
      <p v-if="view.name === null" class="notice warn" data-flow-graph-missing>
        This profile has no such factory any more. It may have been removed on the Factories page.
      </p>
      <p v-else-if="!placed" class="small muted" data-flow-graph-empty>
        No production lines of this factory produce anything in {{ view.phase }}.
      </p>
      <template v-else>
        <p v-if="readonly" class="notice info" data-flow-graph-readonly>
          Viewing {{ view.phase }} — switch phase to tick or edit. Your phase is {{ view.working }};
          the layout can only be changed there.
        </p>
        <div
          v-if="narrow"
          class="fgraph-mode"
          role="group"
          aria-label="Show the flow as"
          data-flow-mode
        >
          <button
            class="btn"
            type="button"
            :aria-pressed="showList"
            data-flow-mode-set="list"
            @click="setMode('list')"
          >
            List
          </button>
          <button
            class="btn"
            type="button"
            :aria-pressed="!showList"
            data-flow-mode-set="graph"
            @click="setMode('graph')"
          >
            Graph
          </button>
        </div>
        <ul
          v-show="showList"
          class="fgraph-list"
          aria-label="Production lines of this factory"
          data-flow-graph-list
        >
          <li v-for="item in listed" :key="item.node.id" class="fgraph-list-item">
            <button
              type="button"
              :class="['fgraph-list-line', { selected: selected === item.node.id }]"
              :aria-pressed="selected === item.node.id"
              :data-flow-list-line="item.node.id"
              @click="selectNode(item.node.id)"
            >
              <strong>{{ item.node.label }}</strong>
              <span class="small muted">{{ item.node.caption }}</span>
            </button>
            <p class="fgraph-list-rates small" data-flow-list-in>
              <span class="muted">In</span> {{ item.ins || 'Nothing comes in' }}
            </p>
            <p class="fgraph-list-rates small" data-flow-list-out>
              <span class="muted">Out</span> {{ item.outs || 'Nothing leaves it' }}
            </p>
          </li>
        </ul>
        <div v-show="!showList" class="fgraph-tools" data-flow-graph-tools>
          <button
            class="btn"
            type="button"
            aria-label="Zoom out"
            data-flow-zoom="out"
            :disabled="zoom <= GRAPH_ZOOM.min"
            @click="zoomOut"
          >
            −
          </button>
          <span class="fgraph-zoom" data-flow-zoom-level>{{ zoomText }}</span>
          <button
            class="btn"
            type="button"
            aria-label="Zoom in"
            data-flow-zoom="in"
            :disabled="zoom >= GRAPH_ZOOM.max"
            @click="zoomIn"
          >
            +
          </button>
          <button
            class="btn"
            type="button"
            aria-label="Fit the whole graph"
            data-flow-zoom="fit"
            @click="fit"
          >
            Fit
          </button>
          <button
            v-if="!readonly"
            class="btn"
            type="button"
            title="Lay the graph out again, replacing where you moved boxes (Ctrl+Z undoes it)"
            data-flow-tidy
            @click="tidyUp"
          >
            Tidy up
          </button>
          <span class="fgraph-undo small muted" role="status">
            <template v-if="tidied && !readonly">
              <span data-flow-undo-text>{{ undoText }}</span>
              <button class="btn" type="button" data-flow-tidy-undo @click="undoTidy">Undo</button>
              <kbd>Ctrl+Z</kbd>
            </template>
            <span v-else-if="stepNote" data-flow-step-note>{{ stepNote }}</span>
          </span>
          <HelpPopover name="flowGraphHelp" topic="Flow graph" />
          <label v-if="view.quiet && !readonly" class="fgraph-switch">
            <input
              type="checkbox"
              data-flow-tags
              :checked="layout.tags.value"
              @change="setTags(($event.target as HTMLInputElement).checked)"
            />
            Show storage and sink as tags
          </label>
        </div>
        <div v-show="!showList" class="fgraph-wrap">
          <div
            v-if="dragging"
            ref="newStepZone"
            :class="['fgraph-newstep', { over: overNewStep }]"
            data-flow-newstep
            aria-hidden="true"
          >
            <strong>New step</strong>
            <span>Drop here to build this line later</span>
          </div>
          <div
            ref="box"
            :class="['fgraph-scroll', { panning, moving }]"
            tabindex="0"
            role="group"
            :aria-label="graphName"
            data-flow-graph
            v-on="handlers"
            @click.capture="onClickCapture"
            @click="onBackground"
            @scroll="layout.later()"
          >
            <svg
              class="fgraph"
              :width="placed.width * zoom"
              :height="placed.height * zoom"
              :viewBox="`0 0 ${placed.width} ${placed.height}`"
              role="none"
            >
              <defs aria-hidden="true">
                <marker
                  id="fgraph-arrow"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="8"
                  markerHeight="8"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8 Z" />
                </marker>
              </defs>
              <template v-for="edge in drawn" :key="edge.id">
                <path
                  :class="edgeClass(edge)"
                  :d="edge.path!"
                  :data-edge="edge.id"
                  :marker-end="arrowOf(edge)"
                  aria-hidden="true"
                />
                <path
                  class="fgraph-hit"
                  :d="edge.path!"
                  :data-edge-hit="edge.id"
                  aria-hidden="true"
                  @pointerenter="hoveredEdge = edge.id"
                  @pointerleave="leaveEdge(edge.id)"
                >
                  <title>{{ edgeTitle(edge) }}</title>
                </path>
              </template>
              <template v-for="node in placed.nodes" :key="node.id">
                <g
                  :class="[
                    'fgraph-node',
                    node.kind,
                    { on: lit?.node === node.id, sel: selected === node.id },
                  ]"
                  :data-node="node.id"
                  :transform="`translate(${node.x},${node.y})`"
                  v-bind="node.kind === 'line' ? lineAttrs(node) : placeAttrs(node)"
                  @click="selectNode(node.id)"
                  @keydown="onNodeKey($event, node)"
                  @pointerenter="activeNode = node.id"
                  @pointerleave="leaveNode(node.id)"
                  @focus="onNodeFocus($event, node)"
                  @blur="leaveNode(node.id)"
                >
                  <title v-if="node.rateTitle || node.shortLabel !== node.label">
                    {{ nodeTitle(node) }}
                  </title>
                  <rect :width="node.width" :height="node.height" />
                  <text class="fgraph-name" x="10" y="19">{{ node.shortLabel }}</text>
                  <g v-if="node.alt" class="fgraph-alt" data-node-alt>
                    <rect :x="node.width - 38" y="6" width="30" height="16" />
                    <text :x="node.width - 23" y="18" text-anchor="middle">ALT</text>
                  </g>
                  <text class="fgraph-caption" x="10" y="37">{{ node.shortCaption }}</text>
                  <text
                    v-for="(text, i) in node.rateLines"
                    :key="i"
                    class="fgraph-caption fgraph-rate"
                    :data-node-rate="i"
                    x="10"
                    :y="37 + (i + 1) * GRAPH.textLine"
                  >
                    {{ text }}
                  </text>
                  <text
                    v-if="node.selfNote"
                    class="fgraph-caption"
                    x="10"
                    :y="37 + (node.rateLines.length + 1) * GRAPH.textLine"
                  >
                    {{ shortText(node.selfNote, GRAPH.captionChars) }}
                  </text>
                </g>
                <g
                  v-for="tag in tagsOf(node)"
                  :key="tag.id"
                  :class="tagClass(tag)"
                  :data-tag="tag.id"
                  :transform="`translate(${tag.left},${tag.top})`"
                  tabindex="0"
                  role="img"
                  :aria-label="tag.name"
                >
                  <title>{{ tag.name }}</title>
                  <rect :width="tag.width" :height="GRAPH.tagHeight" rx="2" />
                  <text x="6" y="12.5">{{ tag.text }}</text>
                </g>
              </template>
              <g
                v-for="edge in drawn"
                :key="'label-' + edge.id"
                :class="['fgraph-label', labelOf(edge).state, { quiet: edge.quiet }]"
                :data-edge-label="edge.id"
                :transform="`translate(${labelOf(edge).x},${labelOf(edge).y})`"
                aria-hidden="true"
              >
                <rect
                  :x="-edge.label!.width / 2"
                  :y="-GRAPH.labelHeight / 2"
                  :width="edge.label!.width"
                  :height="GRAPH.labelHeight"
                />
                <text text-anchor="middle" y="-2">{{ edge.item }}</text>
                <text text-anchor="middle" y="11">{{ edge.rateText }}</text>
              </g>
              <g
                v-if="placed.outs"
                class="fgraph-step fgraph-outs"
                data-outs-head
                :transform="`translate(${placed.outs.x},0)`"
              >
                <g class="fgraph-step-head">
                  <rect :width="GRAPH.nodeWidth" height="18" />
                  <text x="0" y="13">Leaves the factory</text>
                </g>
              </g>
              <g
                v-for="column in placed.columns"
                :key="'step-' + column.step"
                :class="['fgraph-step', { named: !!layout.stepNames.value[String(column.step)] }]"
                :data-step="column.step"
                :transform="`translate(${column.x},0)`"
              >
                <foreignObject
                  v-if="editingStep === column.step"
                  x="0"
                  y="0"
                  :width="GRAPH.nodeWidth"
                  height="26"
                >
                  <input
                    :ref="setNameInput"
                    v-model="draft"
                    class="fgraph-step-input"
                    maxlength="40"
                    :placeholder="'Step ' + column.step"
                    :aria-label="'Name of step ' + column.step"
                    data-step-input
                    @keydown.enter.prevent="endRename(true)"
                    @keydown.esc.prevent.stop="endRename(false)"
                    @blur="endRename(true)"
                    @pointerdown.stop
                  />
                </foreignObject>
                <g
                  v-else
                  :class="['fgraph-step-head', { edit: !readonly }]"
                  :data-step-name="column.step"
                  :tabindex="readonly ? undefined : 0"
                  :role="readonly ? undefined : 'button'"
                  :aria-label="
                    readonly ? undefined : `${stepWords(column.step)}. Enter renames it.`
                  "
                  @click="startRename(column.step)"
                  @keydown="onStepKey($event, column.step)"
                >
                  <title v-if="!readonly">Rename this step</title>
                  <rect :width="GRAPH.nodeWidth" height="18" />
                  <text x="0" y="13">{{ shortText(stepName(column.step), GRAPH.nameChars) }}</text>
                </g>
              </g>
            </svg>
          </div>
        </div>
        <FlowGraphPanel
          v-if="selection"
          ref="panel"
          :node="selection.node"
          :ins="selection.ins"
          :outs="selection.outs"
          :row="selection.row"
          :readonly="readonly"
          :moves="moveChoices.moves"
          :own="moveChoices.own"
          :note="stepNote"
          :undo-text="undoText"
          @undo="undoTidy"
          @move="moveToStep(selection.row, $event)"
          @own="moveToStep(selection.row, 'own')"
          @clear="selected = null"
          @line="openLine"
          @order="openOrder"
        />
        <details class="gf-text" data-flow-graph-table>
          <summary>The graph as a table</summary>
          <div class="table-wrap">
            <table>
              <caption class="small muted">
                Every flow of the graph, per minute
              </caption>
              <thead>
                <tr>
                  <th scope="col">From</th>
                  <th scope="col">Item</th>
                  <th scope="col">Rate</th>
                  <th scope="col">To</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="edge in placed.edges" :key="edge.id" :data-flow-edge="edge.id">
                  <td class="gf-cell-name">{{ edge.fromText }}</td>
                  <td>
                    {{ edge.item }}<template v-if="edge.note"> · {{ NOTES[edge.note] }}</template>
                  </td>
                  <td class="number">{{ edge.rateText }}</td>
                  <td class="gf-cell-name">{{ edge.toText }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </template>
    </div>
  </DialogFrame>
</template>
