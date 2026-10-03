<!-- PROTOTYPE for #883 (branch proto-883-group-flow, never merged): a factory group's flow
     diagram, opened from "Flow diagram ↗" beside "Build order ↗" on a group. The tabs switch
     between the three sketched directions; each has the same text equivalent under it. Model:
     groupFlow() in app/group-flow.ts. Uses only the :root tokens and existing classes; the few
     layout rules it needs are in the unscoped <style> below. -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { itemRate } from '../../flow.ts';
import { num } from '../../format.ts';
import { groupFlow, type FlowEdge, type FlowLine, type FlowPort } from '../../group-flow.ts';
import { calcStage, checked, phaseLabel, stage } from '../../session.ts';
import { clockText, factoryGroupsState } from '../../views/factories.ts';
import { legacy } from '../bridge.ts';
import { factoryLink } from '../actions.ts';
import { power } from '../../wizard/fields.ts';
import DialogFrame from './DialogFrame.vue';
import ItemIcon from '../ItemIcon.vue';

const props = defineProps<{ id: string }>();
type Direction = 'layers' | 'columns' | 'matrix';
const DIRECTIONS: { id: Direction; label: string }[] = [
  { id: 'layers', label: 'B · Build order' },
  { id: 'columns', label: 'A · Left to right' },
  { id: 'matrix', label: 'C · Grid' },
];
const initial = (new URLSearchParams(location.search).get('gf') as Direction) || 'layers';
const direction = ref<Direction>(DIRECTIONS.some(d => d.id === initial) ? initial : 'layers');
// The line or port the pointer or focus is on: its links are drawn bright, the rest dim.
const active = ref<string | null>(null);

const view = computed(() =>
  legacy(() => {
    const groups = factoryGroupsState();
    const group = groups.groups.find(g => g.id === props.id);
    const storedStage = calcStage();
    if (!group || !storedStage) return null;
    const flow = groupFlow(storedStage, groups, props.id);
    return { name: group.name, phase: phaseLabel(stage()), stageKey: stage(), ...flow };
  }),
);

const rateText = (item: string, rate: number) => itemRate(item, rate);
const lineByKey = computed(() => new Map((view.value?.lines || []).map(l => [l.key, l])));
const portByKey = computed(
  () => new Map([...(view.value?.ins || []), ...(view.value?.outs || [])].map(p => [p.key, p])),
);
const pad = (n: number) => String(n).padStart(2, '0');
const machinesText = (line: FlowLine) =>
  (line.share < 1 - 1e-6
    ? `≈ ${num(line.here)} of ${num(line.machines)}`
    : num(line.machines)) + ` × ${line.machine}`;
const clockOf = (line: FlowLine) => {
  const clock = clockText(line.lastClock);
  return clock ? (line.machines > 1 ? `last at ${clock}%` : `at ${clock}%`) : 'all at 100%';
};
const running = (line: FlowLine) =>
  view.value ? checked('calc-' + view.value.stageKey + '-' + line.id) : false;

// Where an edge starts and ends on the page: an output row of a line ('o|line|item'), an input
// row of a line ('i|edge index') or a port row ('p|port key').
const sourceAnchor = (edge: FlowEdge) =>
  edge.from.startsWith('line:') ? `o|${edge.from}|${edge.item}` : `p|${edge.from}`;
const targetAnchor = (edge: FlowEdge, i: number) =>
  edge.to.startsWith('line:') ? `i|${i}` : `p|${edge.to}`;
const fromText = (edge: FlowEdge) => {
  if (edge.loop) return 'loop · seed a starter batch';
  const line = lineByKey.value.get(edge.from);
  if (line) return `from ${pad(line.no)} ${line.recipe}`;
  return portByKey.value.get(edge.from)?.placeLabel ?? '';
};
// Each line's input rows: one per link into it.
const inputsOf = (line: FlowLine) =>
  (view.value?.edges || [])
    .map((edge, i) => ({ edge, i }))
    .filter(({ edge }) => edge.to === line.key);
// Each output row's destinations, for the row's caption.
const usesOf = (line: FlowLine, item: string) => {
  const edges = (view.value?.edges || []).filter(e => e.from === line.key && e.item === item);
  return edges
    .map(edge => {
      const to = lineByKey.value.get(edge.to);
      return to ? pad(to.no) : (portByKey.value.get(edge.to)?.placeLabel ?? '');
    })
    .join(', ');
};
// Ports grouped by place, for the In and Out columns and boxes.
const byPlace = (ports: FlowPort[]) => {
  const places = new Map<string, { label: string; place: string; ports: FlowPort[] }>();
  for (const port of ports) {
    const key = port.kind === 'raw' || port.kind === 'supply' ? port.kind : port.place;
    const entry = places.get(key) ?? { label: port.placeLabel, place: key, ports: [] };
    entry.ports.push(port);
    places.set(key, entry);
  }
  return [...places.values()].map(p => ({
    ...p,
    label: p.place === 'raw' ? 'Raw resources' : p.place === 'supply' ? 'Existing supply' : p.label,
  }));
};
// Ports ordered by the build-order number of the lines they feed or come from, so wires cross less.
const lineNoOf = (portKey: string, dir: "in" | "out") => {
  const nos = (view.value?.edges || [])
    .filter(e => (dir === "in" ? e.from : e.to) === portKey)
    .map(e => lineByKey.value.get(dir === "in" ? e.to : e.from)?.no ?? 99);
  return nos.length ? nos.reduce((a, b) => a + b, 0) / nos.length : 99;
};
const ordered = (ports: FlowPort[], dir: "in" | "out") =>
  byPlace([...ports].sort((a, b) => lineNoOf(a.key, dir) - lineNoOf(b.key, dir)))
    .map(place => ({ ...place, at: Math.min(...place.ports.map(p => lineNoOf(p.key, dir))) }))
    .sort((a, b) => a.at - b.at);
const inPlaces = computed(() => ordered(view.value?.ins || [], "in"));
const outPlaces = computed(() => ordered(view.value?.outs || [], "out"));
const columns = computed(() => {
  const lines = view.value?.lines || [];
  const depth = Math.max(0, ...lines.map(l => l.depth));
  return Array.from({ length: depth + 1 }, (_, d) => lines.filter(l => l.depth === d));
});
const touches = (edge: FlowEdge) =>
  !active.value || edge.from === active.value || edge.to === active.value;

// The grid (C): every place that sends something by row, every place that takes something by
// column, a cell per pair with the items and rates.
const matrix = computed(() => {
  const v = view.value;
  if (!v) return null;
  const rowKeys = [
    ...inPlaces.value.map(p => ({ key: 'place:' + p.place, label: p.label, no: '' })),
    ...v.lines.map(l => ({ key: l.key, label: l.recipe, no: pad(l.no) })),
  ];
  const colKeys = [
    ...v.lines.map(l => ({ key: l.key, label: l.recipe, no: pad(l.no) })),
    ...outPlaces.value.map(p => ({ key: 'place:' + p.place, label: p.label, no: '' })),
  ];
  const placeKey = (key: string) => {
    const port = portByKey.value.get(key);
    if (!port) return key;
    return 'place:' + (port.kind === 'raw' || port.kind === 'supply' ? port.kind : port.place);
  };
  const cells = new Map<string, { item: string; rate: number; loop: boolean }[]>();
  for (const edge of v.edges) {
    const key = placeKey(edge.from) + '>' + placeKey(edge.to);
    const list = cells.get(key) ?? [];
    list.push({ item: edge.item, rate: edge.rate, loop: edge.loop });
    cells.set(key, list);
  }
  return { rowKeys, colKeys, cells };
});

// The connections as a table, the text equivalent of every direction.
const connections = computed(() =>
  (view.value?.edges || []).map(edge => {
    const name = (key: string) => {
      const line = lineByKey.value.get(key);
      if (line) return `${pad(line.no)} ${line.recipe}`;
      return portByKey.value.get(key)?.placeLabel ?? key;
    };
    return {
      from: name(edge.from),
      to: name(edge.to),
      item: edge.item,
      rate: rateText(edge.item, edge.rate),
      note: edge.loop ? 'loop: seed a starter batch' : '',
    };
  }),
);

// Measured wires: drawn after layout from the rows' positions in `host`.
const host = ref<HTMLElement | null>(null);
interface Wire {
  d: string;
  cls: string;
  key: string;
  from: string;
  to: string;
}
const wires = ref<Wire[]>([]);
const canvas = ref({ w: 0, h: 0 });
function measure() {
  const el = host.value,
    v = view.value;
  if (!el || !v || direction.value === 'matrix') {
    wires.value = [];
    return;
  }
  const base = el.getBoundingClientRect();
  canvas.value = { w: el.scrollWidth, h: el.scrollHeight };
  const box = (anchor: string) => {
    const node = el.querySelector(`[data-anchor="${CSS.escape(anchor)}"]`);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return {
      left: r.left - base.left,
      right: r.right - base.left,
      y: r.top - base.top + r.height / 2,
    };
  };
  const out: Wire[] = [];
  if (direction.value === 'columns') {
    v.edges.forEach((edge, i) => {
      const a = box(sourceAnchor(edge)),
        b = box(targetAnchor(edge, i));
      if (!a || !b) return;
      const x1 = a.right,
        x2 = b.left - 6;
      const bend = Math.max(40, Math.abs(x2 - x1) / 2);
      out.push({
        d: `M${x1},${a.y} C${x1 + bend},${a.y} ${x2 - bend},${b.y} ${x2},${b.y}`,
        cls: wireClass(edge),
        key: String(i),
        from: edge.from,
        to: edge.to,
      });
    });
  } else {
    // Build order: in-group links as lanes in the left gutter, lanes reused once free.
    const spans = v.edges
      .map((edge, i) => ({ edge, i, a: box(sourceAnchor(edge)), b: box(targetAnchor(edge, i)) }))
      .filter(s => s.edge.from.startsWith('line:') && s.edge.to.startsWith('line:') && s.a && s.b)
      .map(s => ({ ...s, lo: Math.min(s.a!.y, s.b!.y), hi: Math.max(s.a!.y, s.b!.y) }))
      .sort((p, q) => p.lo - q.lo);
    const laneEnds: number[] = [];
    // How many lanes the links need, so they share the gutter evenly when it is narrow.
    const ends: number[] = [];
    for (const s of spans) {
      const free = ends.findIndex(end => end < s.lo - 4);
      if (free < 0) ends.push(s.hi);
      else ends[free] = s.hi;
    }
    const laneCount = ends.length;
    const gutter = el.querySelector('.gf-stack')?.getBoundingClientRect();
    const left = gutter ? gutter.left - base.left : 60;
    for (const s of spans) {
      let lane = laneEnds.findIndex(end => end < s.lo - 4);
      if (lane < 0) lane = laneEnds.push(0) - 1;
      laneEnds[lane] = s.hi;
      const x = left - 8 - lane * Math.min(9, (left - 10) / Math.max(1, laneCount));
      out.push({
        d: `M${left},${s.a!.y} H${x} V${s.b!.y} H${left - 6}`,
        cls: wireClass(s.edge),
        key: String(s.i),
        from: s.edge.from,
        to: s.edge.to,
      });
    }
  }
  wires.value = out;
}
const wireClass = (edge: FlowEdge) =>
  'gf-wire ' +
  (edge.loop
    ? 'loop'
    : !edge.from.startsWith('line:')
      ? 'in'
      : !edge.to.startsWith('line:')
        ? 'out'
        : 'inside');

let observer: ResizeObserver | null = null;
onMounted(() => {
  document.querySelector('#detail')?.classList.add('gf-wide');
  observer = new ResizeObserver(() => measure());
  if (host.value) observer.observe(host.value);
  void nextTick(measure);
});
onBeforeUnmount(() => {
  document.querySelector('#detail')?.classList.remove('gf-wide');
  observer?.disconnect();
});
watch([direction, view], async () => {
  await nextTick();
  if (host.value && observer) {
    observer.disconnect();
    observer.observe(host.value);
  }
  measure();
});
</script>

<template>
  <DialogFrame
    v-if="view"
    :title="view.name"
    wrap-title
    :subtitle="'Factory group · flow diagram · ' + view.phase"
  >
    <p class="notice info">
      <b>Prototype for #883.</b> Three directions on the same data: pick one below. Hover or focus a
      line to light up its links; a line's name opens its factory dialog.
    </p>
    <div class="tabs gf-tabs" role="group" aria-label="Diagram direction">
      <button
        v-for="d in DIRECTIONS"
        :key="d.id"
        :class="['tab', direction === d.id ? 'active' : '']"
        :aria-pressed="direction === d.id"
        :data-gf-direction="d.id"
        @click="direction = d.id"
      >
        {{ d.label }}
      </button>
    </div>
    <p v-if="!view.lines.length" class="small muted">
      No factories from this group produce anything in the current phase.
    </p>
    <template v-else>
      <p v-if="direction !== 'matrix'" class="small muted gf-legend" aria-hidden="true">
        <span><span class="gf-key in"></span> from outside the group</span>
        <span><span class="gf-key inside"></span> inside the group</span>
        <span><span class="gf-key out"></span> leaving the group</span>
        <span><span class="gf-key loop"></span> loop, seed first</span>
      </p>

      <!-- A · left to right: what comes in, the lines in columns by depth, what leaves. -->
      <div v-if="direction === 'columns'" class="gf-scroll" data-gf="columns">
        <div ref="host" class="gf-host gf-cols">
          <svg class="gf-svg" :width="canvas.w" :height="canvas.h" aria-hidden="true">
            <defs>
              <marker
                v-for="kind in ['in', 'inside', 'out', 'loop']"
                :id="'gf-arrow-' + kind"
                :key="kind"
                :class="['gf-arrow', kind]"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" />
              </marker>
            </defs>
            <path
              v-for="wire in wires"
              :key="wire.key"
              :d="wire.d"
              :marker-end="'url(#gf-arrow-' + wire.cls.split(' ')[1] + ')'"
              :class="[
                wire.cls,
                active && (wire.from === active || wire.to === active) ? 'hot' : '',
                active && wire.from !== active && wire.to !== active ? 'dim' : '',
              ]"
            />
          </svg>
          <div class="gf-col">
            <div class="gf-colcap">Comes in</div>
            <section v-for="place in inPlaces" :key="place.place" class="gf-port">
              <h4>{{ place.label }}</h4>
              <div
                v-for="port in place.ports"
                :key="port.key"
                class="gf-row"
                :data-anchor="'p|' + port.key"
                tabindex="0"
                @mouseenter="active = port.key"
                @mouseleave="active = null"
                @focus="active = port.key"
                @blur="active = null"
              >
                <ItemIcon :name="port.item" /><span class="gf-item">{{ port.item }}</span
                ><b class="gf-rate">{{ rateText(port.item, port.rate) }}</b>
              </div>
            </section>
          </div>
          <div v-for="(column, c) in columns" :key="c" class="gf-col">
            <div class="gf-colcap">{{ c === 0 ? 'Lines fed from outside' : 'Step ' + (c + 1) }}</div>
            <article
              v-for="line in column"
              :key="line.key"
              :class="['gf-card', active === line.key ? 'hot' : '']"
              @mouseenter="active = line.key"
              @mouseleave="active = null"
              @focusin="active = line.key"
              @focusout="active = null"
            >
              <div class="gf-head">
                <span class="chain-no">{{ pad(line.no) }}</span
                ><button class="rail-link" v-bind="factoryLink({ calcFactory: line.id })">
                  {{ line.recipe }} ↗</button
                ><span :class="['gf-run', running(line) ? 'on' : '']">{{
                  running(line) ? '● Running' : '○ Not built'
                }}</span>
              </div>
              <div class="small muted">{{ machinesText(line) }} · {{ clockOf(line) }}</div>
              <div
                v-for="{ edge, i } in inputsOf(line)"
                :key="'i' + i"
                class="gf-row gf-in"
                :data-anchor="'i|' + i"
              >
                <span class="gf-item">{{ edge.item }}</span
                ><b class="gf-rate">{{ rateText(edge.item, edge.rate) }}</b>
              </div>
              <div
                v-for="output in line.outputs"
                :key="'o' + output.item"
                class="gf-row gf-out"
                :data-anchor="'o|' + line.key + '|' + output.item"
              >
                <span class="gf-item">→ {{ output.item }}</span
                ><b class="gf-rate">{{ rateText(output.item, output.rate) }}</b>
              </div>
              <div v-if="line.mw" class="gf-row gf-out">
                <span class="gf-item">→ Power</span><b class="gf-rate">{{ power(line.mw) }}</b>
              </div>
            </article>
          </div>
          <div class="gf-col">
            <div class="gf-colcap">Leaves</div>
            <section v-for="place in outPlaces" :key="place.place" class="gf-port">
              <h4>{{ place.label }}</h4>
              <div
                v-for="port in place.ports"
                :key="port.key"
                class="gf-row"
                :data-anchor="'p|' + port.key"
                tabindex="0"
                @mouseenter="active = port.key"
                @mouseleave="active = null"
                @focus="active = port.key"
                @blur="active = null"
              >
                <ItemIcon :name="port.item" /><span class="gf-item">{{ port.item }}</span
                ><b class="gf-rate">{{ rateText(port.item, port.rate) }}</b>
              </div>
            </section>
          </div>
        </div>
      </div>

      <!-- B · build order: what comes in, the lines top to bottom in build order with their
           in-group links as lanes on the left, what leaves. -->
      <div v-else-if="direction === 'layers'" data-gf="layers">
        <div class="gf-band">
          <div class="gf-colcap">Comes in</div>
          <div class="gf-ports">
            <section v-for="place in inPlaces" :key="place.place" class="gf-port">
              <h4>{{ place.label }}</h4>
              <div v-for="port in place.ports" :key="port.key" class="gf-row">
                <ItemIcon :name="port.item" /><span class="gf-item">{{ port.item }}</span
                ><b class="gf-rate">{{ rateText(port.item, port.rate) }}</b>
              </div>
            </section>
          </div>
        </div>
        <div ref="host" class="gf-host gf-layers">
          <svg class="gf-svg" :width="canvas.w" :height="canvas.h" aria-hidden="true">
            <defs>
              <marker
                v-for="kind in ['in', 'inside', 'out', 'loop']"
                :id="'gf-arrow-' + kind"
                :key="kind"
                :class="['gf-arrow', kind]"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" />
              </marker>
            </defs>
            <path
              v-for="wire in wires"
              :key="wire.key"
              :d="wire.d"
              :marker-end="'url(#gf-arrow-' + wire.cls.split(' ')[1] + ')'"
              :class="[
                wire.cls,
                active && (wire.from === active || wire.to === active) ? 'hot' : '',
                active && wire.from !== active && wire.to !== active ? 'dim' : '',
              ]"
            />
          </svg>
          <div class="gf-stack">
            <article
              v-for="line in view.lines"
              :key="line.key"
              :class="['gf-card', active === line.key ? 'hot' : '']"
              @mouseenter="active = line.key"
              @mouseleave="active = null"
              @focusin="active = line.key"
              @focusout="active = null"
            >
              <div class="gf-head">
                <span class="chain-no">{{ pad(line.no) }}</span
                ><button class="rail-link" v-bind="factoryLink({ calcFactory: line.id })">
                  {{ line.recipe }} ↗</button
                ><span :class="['gf-run', running(line) ? 'on' : '']">{{
                  running(line) ? '● Running' : '○ Not built'
                }}</span>
              </div>
              <div class="small muted">{{ machinesText(line) }} · {{ clockOf(line) }}</div>
              <div class="gf-io">
                <div>
                  <div
                    v-for="{ edge, i } in inputsOf(line)"
                    :key="'i' + i"
                    :class="['gf-row', 'gf-in', edge.from.startsWith('line:') ? '' : 'outside']"
                    :data-anchor="'i|' + i"
                  >
                    <span class="gf-item"
                      >← {{ edge.item }} <small class="muted">{{ fromText(edge) }}</small></span
                    ><b class="gf-rate">{{ rateText(edge.item, edge.rate) }}</b>
                  </div>
                </div>
                <div>
                  <div
                    v-for="output in line.outputs"
                    :key="'o' + output.item"
                    class="gf-row gf-out"
                    :data-anchor="'o|' + line.key + '|' + output.item"
                  >
                    <span class="gf-item"
                      >→ {{ output.item }}
                      <small class="muted">to {{ usesOf(line, output.item) }}</small></span
                    ><b class="gf-rate">{{ rateText(output.item, output.rate) }}</b>
                  </div>
                  <div v-if="line.mw" class="gf-row gf-out">
                    <span class="gf-item">→ Power grid</span
                    ><b class="gf-rate">{{ power(line.mw) }}</b>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </div>
        <div class="gf-band">
          <div class="gf-colcap">Leaves</div>
          <div class="gf-ports">
            <section v-for="place in outPlaces" :key="place.place" class="gf-port">
              <h4>{{ place.label }}</h4>
              <div v-for="port in place.ports" :key="port.key" class="gf-row">
                <ItemIcon :name="port.item" /><span class="gf-item">{{ port.item }}</span
                ><b class="gf-rate">{{ rateText(port.item, port.rate) }}</b>
              </div>
            </section>
          </div>
        </div>
      </div>

      <!-- C · grid: from (rows) × to (columns). -->
      <div v-else-if="matrix" class="table-wrap gf-matrix" data-gf="matrix">
        <table>
          <thead>
            <tr>
              <th scope="col">From ↓ · to →</th>
              <th v-for="col in matrix.colKeys" :key="col.key" scope="col">
                <span v-if="col.no" class="chain-no">{{ col.no }}</span> {{ col.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in matrix.rowKeys" :key="row.key">
              <th scope="row">
                <span v-if="row.no" class="chain-no">{{ row.no }}</span> {{ row.label }}
              </th>
              <td v-for="col in matrix.colKeys" :key="col.key" class="number">
                <template v-for="(cell, n) in matrix.cells.get(row.key + '>' + col.key) || []" :key="n"
                  ><br v-if="n" /><span :class="cell.loop ? 'chain-loop' : ''"
                    >{{ cell.item }} {{ rateText(cell.item, cell.rate) }}</span
                  ></template
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <details class="gf-text" data-gf-text>
        <summary>The diagram as a table</summary>
        <div class="table-wrap">
          <table>
            <caption class="small muted">Lines in build order</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Recipe</th>
                <th scope="col">Machines</th>
                <th scope="col">Clock</th>
                <th scope="col">Makes</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="line in view.lines" :key="line.key">
                <td>{{ pad(line.no) }}</td>
                <td>{{ line.recipe }}</td>
                <td>{{ machinesText(line) }}</td>
                <td>{{ clockOf(line) }}</td>
                <td class="number">
                  <template v-for="(o, n) in line.outputs" :key="o.item"
                    ><br v-if="n" />{{ o.item }} {{ rateText(o.item, o.rate) }}</template
                  ><template v-if="line.mw">Power {{ power(line.mw) }}</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="table-wrap">
          <table>
            <caption class="small muted">Connections</caption>
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">Item</th>
                <th scope="col">Rate</th>
                <th scope="col">To</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(c, n) in connections" :key="n">
                <td>{{ c.from }}</td>
                <td>{{ c.item }}<template v-if="c.note"> · {{ c.note }}</template></td>
                <td class="number">{{ c.rate }}</td>
                <td>{{ c.to }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
      <p v-if="view.split" class="small muted">
        Split lines show this group's share of their machines and rates.
      </p>
    </template>
  </DialogFrame>
</template>

<style>
.gf-head .rail-link {
  background: none;
  border: 0;
  padding: 0;
  font-family: var(--head);
  font-weight: 600;
  font-size: 15px;
  letter-spacing: 0.04em;
  color: var(--accent);
  border-bottom: 1px solid var(--accent-sh);
  cursor: pointer;
}
.gf-head .rail-link:hover {
  color: var(--accent-hi);
  border-bottom-color: var(--accent-hi);
}
.gf-arrow path {
  fill: var(--muted);
}
.gf-arrow.in path {
  fill: var(--blue);
}
.gf-arrow.inside path,
.gf-arrow.loop path {
  fill: var(--accent);
}
.gf-arrow.out path {
  fill: var(--green);
}
#detail.gf-wide {
  max-width: 1400px;
}
.gf-tabs {
  margin: 12px 0;
}
.gf-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
}
.gf-legend > span {
  white-space: nowrap;
}
.gf-key {
  display: inline-block;
  width: 22px;
  height: 0;
  border-top: 2px solid var(--muted);
  vertical-align: middle;
}
.gf-key.in {
  border-color: var(--blue);
}
.gf-key.inside {
  border-color: var(--accent);
}
.gf-key.out {
  border-color: var(--green);
}
.gf-key.loop {
  border-top-style: dashed;
  border-color: var(--accent);
}
.gf-scroll {
  overflow-x: auto;
  border: 1px solid var(--line);
  background: var(--panel2);
}
.gf-host {
  position: relative;
}
.gf-svg {
  position: absolute;
  inset: 0 auto auto 0;
  pointer-events: none;
  overflow: visible;
}
.gf-wire {
  fill: none;
  stroke-width: 2;
  stroke: var(--muted);
  transition: opacity 0.12s;
}
.gf-wire.in {
  stroke: var(--blue);
}
.gf-wire.inside {
  stroke: var(--accent);
}
.gf-wire.out {
  stroke: var(--green);
}
.gf-wire.loop {
  stroke: var(--accent);
  stroke-dasharray: 5 4;
}
.gf-wire.dim {
  opacity: 0.12;
}
.gf-wire.hot {
  stroke-width: 3;
}
.gf-cols {
  display: flex;
  gap: 64px;
  padding: 14px;
  width: max-content;
  align-items: flex-start;
}
.gf-col {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 212px;
  position: relative;
}
.gf-colcap {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--kicker);
}
.gf-card,
.gf-port {
  border: 1px solid var(--line);
  background: var(--panel);
  padding: 8px 10px;
  position: relative;
}
.gf-card.hot {
  border-color: var(--accent);
}
.gf-port h4 {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--bright);
}
.gf-head {
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
}
.gf-head .chain-no {
  min-width: 0;
  font-size: 16px;
}
.gf-run {
  font-size: 11px;
  color: var(--muted);
  margin-left: auto;
}
.gf-run.on {
  color: var(--green);
}
.gf-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 2px 0;
  border-top: 1px solid var(--line2);
}
.gf-row .item-icon {
  width: 20px;
  height: 20px;
  flex: none;
}
.gf-item {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.gf-rate {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: var(--bright);
}
.gf-in .gf-item {
  color: var(--ink);
}
.gf-in.outside {
  box-shadow: inset 2px 0 0 var(--blue);
  padding-left: 6px;
}
.gf-band {
  margin: 10px 0;
}
.gf-ports {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
  margin-top: 6px;
}
.gf-layers {
  padding-left: 84px;
}
.gf-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.gf-io {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 16px;
  margin-top: 4px;
}
.gf-matrix th[scope='row'] {
  position: sticky;
  left: 0;
  background: var(--panel2);
  white-space: nowrap;
}
.gf-matrix .chain-no {
  font-size: 13px;
  min-width: 0;
}
.gf-text {
  margin-top: 14px;
}
.gf-text .table-wrap {
  margin-top: 8px;
}
.gf-text caption {
  text-align: left;
  padding: 6px 14px;
}
@media (max-width: 720px) {
  .gf-io {
    grid-template-columns: 1fr;
  }
  .gf-layers {
    padding-left: 44px;
  }
  .gf-col {
    width: 200px;
  }
  .gf-cols {
    gap: 48px;
  }
}
</style>
