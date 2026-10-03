<!-- PROTOTYPE for #883 (branch proto-883-group-flow, never merged): a factory group's flow page,
     #factories/<group>/flow, which takes over from the build-order dialog. Direction B from the
     first round: what comes in at the top, the lines as numbered cards in build order, what
     leaves at the bottom. The "Link style" switch compares the reworked in-group links:
       item  - every link drawn as a lane in the left gutter, one colour and dash per item;
       short - links to the very next card drawn as a connector between the two cards, only
               the longer links as lanes;
       chips - no lanes: "from 01" / "to 03" buttons that jump to the card they name.
     Model: groupFlow() in app/group-flow.ts. Uses only the :root tokens and existing classes. -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { beltTxt, FLUIDS, itemRate, lanePlan } from '../../flow.ts';
import { num } from '../../format.ts';
import { OUTSIDE } from '../../group-links.ts';
import { groupFlow, type FlowEdge, type FlowLine, type FlowPort } from '../../group-flow.ts';
import { calcStage, checked, flowGroupOf, phaseLabel, stage } from '../../session.ts';
import { clockText, factoryGroupsState } from '../../views/factories.ts';
import { power } from '../../wizard/fields.ts';
import { legacy } from '../bridge.ts';
import { factoryLink } from '../actions.ts';
import ItemIcon from '../ItemIcon.vue';
import PageHeader from '../PageHeader.vue';
import MilestoneOnlyNotice from '../plan/MilestoneOnlyNotice.vue';

type LinkStyle = 'item' | 'short' | 'chips';
const STYLES: { id: LinkStyle; label: string }[] = [
  { id: 'chips', label: 'Chips' },
  { id: 'short', label: 'Short lanes' },
  { id: 'item', label: 'Item lanes' },
];
const asked = new URLSearchParams(location.search).get('lanes') as LinkStyle;
const linkStyle = ref<LinkStyle>(STYLES.some(s => s.id === asked) ? asked : 'chips');
// The line the pointer or focus is on: its links are drawn bright, the rest dim.
const active = ref<string | null>(null);
// The input or output row a chip jumped to, outlined for a moment.
const flashed = ref<string | null>(null);

// The group the address names, even in a phase without production (a milestone-only phase).
const groupName = computed(() =>
  legacy(() => {
    const id = flowGroupOf(location.hash.slice(1)) ?? '';
    return factoryGroupsState().groups.find(g => g.id === id)?.name ?? null;
  }),
);
const view = computed(() =>
  legacy(() => {
    const id = flowGroupOf(location.hash.slice(1)) ?? '';
    const groups = factoryGroupsState();
    const group = groups.groups.find(g => g.id === id);
    const storedStage = calcStage();
    if (!group || !storedStage) return null;
    const flow = groupFlow(storedStage, groups, id);
    return { name: group.name, phase: phaseLabel(stage()), stageKey: stage(), ...flow };
  }),
);

const rateText = (item: string, rate: number) => itemRate(item, rate);
const belts = (item: string, rate: number) =>
  beltTxt(lanePlan(rate, FLUIDS.has(item), view.value?.stageKey));
const lineByKey = computed(() => new Map((view.value?.lines || []).map(l => [l.key, l])));
const portByKey = computed(
  () => new Map([...(view.value?.ins || []), ...(view.value?.outs || [])].map(p => [p.key, p])),
);
const pad = (n: number) => String(n).padStart(2, '0');
const machinesText = (line: FlowLine) =>
  (line.share < 1 - 1e-6 ? `≈ ${num(line.here)} of ${num(line.machines)}` : num(line.machines)) +
  ` × ${line.machine}`;
const clockOf = (line: FlowLine) => {
  const clock = clockText(line.lastClock);
  return clock ? (line.machines > 1 ? `last at ${clock}%` : `at ${clock}%`) : 'all at 100%';
};
const running = (line: FlowLine) =>
  view.value ? checked('calc-' + view.value.stageKey + '-' + line.id) : false;
const inside = (edge: FlowEdge) => edge.from.startsWith('line:') && edge.to.startsWith('line:');
const noOf = (key: string) => lineByKey.value.get(key)?.no ?? 0;
// A link to the very next card: the short style draws it between the two cards.
const neighbour = (edge: FlowEdge) =>
  inside(edge) && !edge.loop && noOf(edge.to) === noOf(edge.from) + 1;

// One colour and dash per item carried inside the group, in order of first use, so the same
// item looks the same on every lane, swatch and connector.
const COLOURS = ['--accent', '--blue', '--green', '--gold', '--ink', '--red'];
const DASHES = ['', '7 4', '2 3'];
const itemStyles = computed(() => {
  const styles = new Map<string, { color: string; dash: string }>();
  const edges = [...(view.value?.edges || [])]
    .filter(inside)
    .sort((a, b) => noOf(a.from) - noOf(b.from));
  for (const edge of edges)
    if (!styles.has(edge.item)) {
      const n = styles.size;
      styles.set(edge.item, {
        color: `var(${COLOURS[n % COLOURS.length]})`,
        dash: DASHES[Math.floor(n / COLOURS.length) % DASHES.length]!,
      });
    }
  return styles;
});
const styleOf = (item: string) => itemStyles.value.get(item) ?? { color: 'var(--muted)', dash: '' };

const fromText = (edge: FlowEdge) => {
  const line = lineByKey.value.get(edge.from);
  if (line) return `from ${pad(line.no)} ${line.recipe}`;
  return portByKey.value.get(edge.from)?.placeLabel ?? '';
};
const inputsOf = (line: FlowLine) =>
  (view.value?.edges || [])
    .map((edge, i) => ({ edge, i }))
    .filter(({ edge }) => edge.to === line.key);
// Where one output goes: one entry per link, a line (with its number) or a place outside.
const usesOf = (line: FlowLine, item: string) =>
  (view.value?.edges || [])
    .map((edge, i) => ({ edge, i }))
    .filter(({ edge }) => edge.from === line.key && edge.item === item)
    .map(({ edge, i }) => {
      const to = lineByKey.value.get(edge.to);
      return {
        i,
        edge,
        no: to ? pad(to.no) : '',
        to: to?.key ?? '',
        label: to ? pad(to.no) : (portByKey.value.get(edge.to)?.placeLabel ?? ''),
      };
    });
// Links into this line that come from the card just above (the short style's connectors).
const fromAbove = (line: FlowLine) =>
  (view.value?.edges || []).filter(edge => edge.to === line.key && neighbour(edge));

// Ports grouped by place for the Comes in and Leaves bands. The sink and protected storage
// fold into one "Sink & storage" summary.
const FOLDED = new Set<string>([OUTSIDE.surplus, OUTSIDE.storage]);
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
const inPlaces = computed(() => byPlace(view.value?.ins || []));
const outPlaces = computed(() =>
  byPlace((view.value?.outs || []).filter(port => !FOLDED.has(port.place))),
);
const folded = computed(() => {
  const ports = (view.value?.outs || []).filter(port => FOLDED.has(port.place));
  return {
    ports,
    places: byPlace(ports),
    items: new Set(ports.map(port => port.item)).size,
    total: ports.reduce((sum, port) => sum + port.rate, 0),
    fluid: ports.some(port => FLUIDS.has(port.item)),
  };
});

// A chip: show the card it names and outline the row of the link.
function jump(lineKey: string, row: string) {
  const card = document.querySelector<HTMLElement>(`[data-line="${CSS.escape(lineKey)}"]`);
  if (!card) return;
  card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  card.querySelector<HTMLElement>('.gf-head button')?.focus({ preventScroll: true });
  flashed.value = row;
  setTimeout(() => {
    if (flashed.value === row) flashed.value = null;
  }, 1600);
}

// The connections as a table: the text equivalent of the diagram.
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
      belts: belts(edge.item, edge.rate),
      note: edge.loop ? 'loop: seed a starter batch' : '',
    };
  }),
);

// Lanes, measured after layout from the rows' positions in `host`.
const host = ref<HTMLElement | null>(null);
interface Wire {
  d: string;
  key: string;
  from: string;
  to: string;
  color: string;
  dash: string;
  marker: number;
  start: { x: number; y: number };
}
const wires = ref<Wire[]>([]);
const canvas = ref({ w: 0, h: 0 });
function measure() {
  const el = host.value,
    v = view.value;
  if (!el || !v || linkStyle.value === 'chips') {
    wires.value = [];
    return;
  }
  const base = el.getBoundingClientRect();
  canvas.value = { w: el.scrollWidth, h: el.scrollHeight };
  const box = (anchor: string) => {
    const node = el.querySelector(`[data-anchor="${CSS.escape(anchor)}"]`);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { y: r.top - base.top + Math.min(r.height / 2, 11) };
  };
  const spans = v.edges
    .map((edge, i) => ({
      edge,
      i,
      a: box(`o|${edge.from}|${edge.item}`),
      b: box(`i|${i}`),
    }))
    .filter(s => inside(s.edge) && s.a && s.b)
    .filter(s => linkStyle.value === 'item' || !neighbour(s.edge))
    .map(s => ({ ...s, lo: Math.min(s.a!.y, s.b!.y), hi: Math.max(s.a!.y, s.b!.y) }))
    .sort((p, q) => p.hi - p.lo - (q.hi - q.lo) || p.lo - q.lo);
  // Shorter lanes nearer the cards; a lane is reused once the link before it has ended.
  const lanes: { lo: number; hi: number }[][] = [];
  const placed = spans.map(s => {
    let lane = lanes.findIndex(taken => taken.every(t => s.hi < t.lo - 4 || s.lo > t.hi + 4));
    if (lane < 0) lane = lanes.push([]) - 1;
    lanes[lane]!.push(s);
    return { ...s, lane };
  });
  const gutter = el.querySelector('.gf-stack')?.getBoundingClientRect();
  const left = gutter ? gutter.left - base.left : 60;
  const step = Math.min(11, (left - 12) / Math.max(1, lanes.length));
  wires.value = placed.map(s => {
    const x = left - 9 - s.lane * step;
    const style = styleOf(s.edge.item);
    return {
      d: `M${left},${s.a!.y} H${x} V${s.b!.y} H${left - 2}`,
      key: String(s.i),
      from: s.edge.from,
      to: s.edge.to,
      color: style.color,
      dash: style.dash,
      marker: COLOURS.findIndex(c => style.color === `var(${c})`),
      start: { x: left, y: s.a!.y },
    };
  });
}

let observer: ResizeObserver | null = null;
const observe = () => {
  observer?.disconnect();
  if (host.value) observer?.observe(host.value);
};
onMounted(() => {
  observer = new ResizeObserver(() => measure());
  observe();
  void nextTick(measure);
});
onBeforeUnmount(() => observer?.disconnect());
watch([linkStyle, view], async () => {
  await nextTick();
  observe();
  measure();
});
const printPage = () => window.print();
const wireState = (wire: Wire) =>
  !active.value ? '' : wire.from === active.value || wire.to === active.value ? 'hot' : 'dim';
</script>

<template>
  <PageHeader
    eyebrow="FACTORY GROUP · BUILD ORDER"
    :title="groupName ?? 'Factory group'"
    :subtitle="
      view
        ? `${view.phase} · ${view.lines.length} lines in the order to build them, with what each one feeds.`
        : ''
    "
  />
  <div class="gf-bar">
    <a class="btn" href="#factories">← Factories</a>
    <button class="btn" @click="printPage">Print</button>
  </div>
  <MilestoneOnlyNotice />
  <p v-if="!groupName" class="notice">This profile has no factory group with this address.</p>
  <template v-if="view">
    <div class="notice info gf-proto">
      <b>Prototype for #883.</b> Compare the link styles:
      <div class="tabs" role="group" aria-label="Link style">
        <button
          v-for="s in STYLES"
          :key="s.id"
          :class="['tab', linkStyle === s.id ? 'active' : '']"
          :aria-pressed="linkStyle === s.id"
          :data-gf-links="s.id"
          @click="linkStyle = s.id"
        >
          {{ s.label }}
        </button>
      </div>
    </div>
    <p v-if="!view.lines.length" class="small muted">
      No factories from this group produce anything in the current phase.
    </p>
    <template v-else>
      <p v-if="itemStyles.size" class="small muted gf-legend" aria-hidden="true">
        <span>Inside the group:</span>
        <span v-for="[item, style] in itemStyles" :key="item"
          ><svg class="gf-swatch" width="22" height="8">
            <line
              x1="0"
              y1="4"
              x2="22"
              y2="4"
              :style="{ stroke: style.color, strokeDasharray: style.dash }"
            /></svg
          >{{ item }}</span
        >
      </p>

      <section class="gf-band" aria-labelledby="gf-in-h">
        <h2 id="gf-in-h" class="gf-colcap">Comes in</h2>
        <div class="gf-ports">
          <section v-for="place in inPlaces" :key="place.place" class="gf-port">
            <h3>{{ place.label }}</h3>
            <div v-for="port in place.ports" :key="port.key" class="gf-row">
              <ItemIcon :name="port.item" /><span class="gf-item">{{ port.item }}</span
              ><span class="gf-num"
                ><b>{{ rateText(port.item, port.rate) }}</b
                ><small>{{ belts(port.item, port.rate) }}</small></span
              >
            </div>
          </section>
        </div>
      </section>

      <div ref="host" :class="['gf-host', linkStyle === 'chips' ? 'no-lanes' : '']">
        <svg
          v-if="linkStyle !== 'chips'"
          class="gf-svg"
          :width="canvas.w"
          :height="canvas.h"
          aria-hidden="true"
        >
          <defs>
            <marker
              v-for="(c, n) in COLOURS"
              :id="'gf-arrow-' + n"
              :key="c"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 z" :style="{ fill: `var(${c})` }" />
            </marker>
          </defs>
          <g v-for="wire in wires" :key="wire.key" :class="['gf-wire', wireState(wire)]">
            <circle
              :cx="wire.start.x - 2"
              :cy="wire.start.y"
              r="2.5"
              :style="{ fill: wire.color }"
            />
            <path
              :d="wire.d"
              :marker-end="'url(#gf-arrow-' + wire.marker + ')'"
              :style="{ stroke: wire.color, strokeDasharray: wire.dash }"
            />
          </g>
        </svg>
        <ol class="gf-stack">
          <li v-for="line in view.lines" :key="line.key">
            <div
              v-if="linkStyle === 'short' && fromAbove(line).length"
              class="gf-next"
              aria-hidden="true"
            >
              <span v-for="(edge, n) in fromAbove(line)" :key="n"
                ><svg class="gf-swatch down" width="8" height="18">
                  <line
                    x1="4"
                    y1="0"
                    x2="4"
                    y2="18"
                    :style="{
                      stroke: styleOf(edge.item).color,
                      strokeDasharray: styleOf(edge.item).dash,
                    }"
                  /></svg
                >{{ edge.item }} {{ rateText(edge.item, edge.rate) }} ↓</span
              >
            </div>
            <article
              :class="['gf-card', active === line.key ? 'hot' : '']"
              :data-line="line.key"
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
                    :class="[
                      'gf-row',
                      'gf-in',
                      inside(edge) ? '' : 'outside',
                      flashed === 'i|' + i ? 'flash' : '',
                    ]"
                    :data-anchor="'i|' + i"
                  >
                    <svg
                      v-if="inside(edge)"
                      class="gf-swatch"
                      width="14"
                      height="8"
                      aria-hidden="true"
                    >
                      <line
                        x1="0"
                        y1="4"
                        x2="14"
                        y2="4"
                        :style="{
                          stroke: styleOf(edge.item).color,
                          strokeDasharray: styleOf(edge.item).dash,
                        }"
                      />
                    </svg>
                    <span class="gf-item"
                      >← {{ edge.item }}
                      <small v-if="edge.loop" class="chain-loop">loop · seed a starter batch</small>
                      <button
                        v-if="linkStyle === 'chips' && inside(edge)"
                        class="gf-chip"
                        :style="{ borderLeftColor: styleOf(edge.item).color }"
                        :aria-label="'From ' + fromText(edge) + ': go to its card'"
                        @click="jump(edge.from, 'o|' + edge.from + '|' + edge.item)"
                      >
                        from {{ pad(noOf(edge.from)) }}
                      </button>
                      <small v-else class="muted">{{ fromText(edge) }}</small></span
                    ><span class="gf-num"
                      ><b>{{ rateText(edge.item, edge.rate) }}</b
                      ><small>{{ belts(edge.item, edge.rate) }}</small></span
                    >
                  </div>
                </div>
                <div>
                  <div
                    v-for="output in line.outputs"
                    :key="'o' + output.item"
                    :class="[
                      'gf-row',
                      'gf-out',
                      flashed === 'o|' + line.key + '|' + output.item ? 'flash' : '',
                    ]"
                    :data-anchor="'o|' + line.key + '|' + output.item"
                  >
                    <svg
                      v-if="itemStyles.has(output.item)"
                      class="gf-swatch"
                      width="14"
                      height="8"
                      aria-hidden="true"
                    >
                      <line
                        x1="0"
                        y1="4"
                        x2="14"
                        y2="4"
                        :style="{
                          stroke: styleOf(output.item).color,
                          strokeDasharray: styleOf(output.item).dash,
                        }"
                      />
                    </svg>
                    <span class="gf-item"
                      >→ {{ output.item }}
                      <template v-if="linkStyle === 'chips'">
                        <template v-for="use in usesOf(line, output.item)" :key="use.i">
                          <button
                            v-if="use.to"
                            class="gf-chip"
                            :style="{ borderLeftColor: styleOf(output.item).color }"
                            :aria-label="`To ${use.no}, ${rateText(output.item, use.edge.rate)}: go to its card`"
                            @click="jump(use.to, 'i|' + use.i)"
                          >
                            to {{ use.no }} · {{ rateText(output.item, use.edge.rate) }}
                          </button>
                          <small v-else class="muted gf-dest"
                            >{{ use.label }} {{ rateText(output.item, use.edge.rate) }}</small
                          >
                        </template>
                      </template>
                      <small v-else class="muted"
                        >to
                        {{
                          usesOf(line, output.item)
                            .map(u => u.label)
                            .join(', ')
                        }}</small
                      ></span
                    ><span class="gf-num"
                      ><b>{{ rateText(output.item, output.rate) }}</b></span
                    >
                  </div>
                  <div v-if="line.mw" class="gf-row gf-out">
                    <span class="gf-item">→ Power grid</span
                    ><span class="gf-num"
                      ><b>{{ power(line.mw) }}</b></span
                    >
                  </div>
                </div>
              </div>
            </article>
          </li>
        </ol>
      </div>

      <section class="gf-band" aria-labelledby="gf-out-h">
        <h2 id="gf-out-h" class="gf-colcap">Leaves</h2>
        <div class="gf-ports">
          <section v-for="place in outPlaces" :key="place.place" class="gf-port">
            <h3>{{ place.label }}</h3>
            <div v-for="port in place.ports" :key="port.key" class="gf-row">
              <ItemIcon :name="port.item" /><span class="gf-item">{{ port.item }}</span
              ><span class="gf-num"
                ><b>{{ rateText(port.item, port.rate) }}</b
                ><small>{{ belts(port.item, port.rate) }}</small></span
              >
            </div>
          </section>
          <details v-if="folded.ports.length" class="gf-port gf-fold" data-gf-fold>
            <summary>
              <h3>Sink &amp; storage</h3>
              <span class="small muted"
                >{{ folded.items }} item{{ folded.items === 1 ? '' : 's' }} ·
                {{ num(folded.total) }}/min in all<template v-if="folded.fluid">
                  (with fluids in m³)</template
                ></span
              >
            </summary>
            <template v-for="place in folded.places" :key="place.place">
              <h4>{{ place.label }}</h4>
              <div v-for="port in place.ports" :key="port.key" class="gf-row">
                <ItemIcon :name="port.item" /><span class="gf-item">{{ port.item }}</span
                ><span class="gf-num"
                  ><b>{{ rateText(port.item, port.rate) }}</b></span
                >
              </div>
            </template>
          </details>
        </div>
      </section>

      <details class="gf-text" data-gf-text>
        <summary>The diagram as a table</summary>
        <div class="table-wrap">
          <table>
            <caption class="small muted">
              Lines in build order
            </caption>
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
            <caption class="small muted">
              Connections
            </caption>
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">Item</th>
                <th scope="col">Rate</th>
                <th scope="col">Belts or pipes</th>
                <th scope="col">To</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(c, n) in connections" :key="n">
                <td>{{ c.from }}</td>
                <td>
                  {{ c.item }}<template v-if="c.note"> · {{ c.note }}</template>
                </td>
                <td class="number">{{ c.rate }}</td>
                <td>{{ c.belts }}</td>
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
  </template>
</template>

<style>
.gf-bar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 0 0 12px;
}
.gf-proto .tabs {
  margin-top: 8px;
}
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
  text-align: left;
}
.gf-head .rail-link:hover {
  color: var(--accent-hi);
  border-bottom-color: var(--accent-hi);
}
.gf-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
}
.gf-legend > span {
  white-space: nowrap;
}
.gf-swatch {
  flex: none;
  vertical-align: middle;
  margin-right: 4px;
}
.gf-swatch line {
  stroke-width: 3;
}
.gf-host {
  position: relative;
  padding-left: 96px;
}
.gf-host.no-lanes {
  padding-left: 0;
}
.gf-svg {
  position: absolute;
  inset: 0 auto auto 0;
  pointer-events: none;
  overflow: visible;
}
.gf-wire path {
  fill: none;
  stroke-width: 2.5;
}
.gf-wire {
  transition: opacity 0.12s;
}
.gf-wire.dim {
  opacity: 0.12;
}
.gf-wire.hot path {
  stroke-width: 3.5;
}
.gf-colcap {
  margin: 0;
  font-size: 10.5px;
  font-weight: 400;
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
  min-width: 0;
}
.gf-card.hot {
  border-color: var(--accent);
}
.gf-port h3,
.gf-port h4 {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--bright);
}
.gf-port h4 {
  margin-top: 8px;
  color: var(--muted);
}
.gf-fold summary {
  cursor: pointer;
}
.gf-fold summary h3 {
  display: inline;
  margin-right: 8px;
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
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  padding: 3px 0;
  border-top: 1px solid var(--line2);
}
.gf-row > .gf-swatch {
  margin-top: 5px;
}
.gf-row.flash {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
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
.gf-num {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.gf-num b {
  white-space: nowrap;
  color: var(--bright);
}
.gf-num small {
  color: var(--muted);
  font-size: 10.5px;
}
.gf-in.outside {
  box-shadow: inset 2px 0 0 var(--blue);
  padding-left: 6px;
}
.gf-chip {
  display: inline-block;
  margin: 1px 2px 1px 0;
  padding: 0 6px;
  font: inherit;
  font-size: 11px;
  line-height: 18px;
  color: var(--ink);
  background: var(--panel2);
  border: 1px solid var(--line);
  border-left-width: 3px;
  cursor: pointer;
  white-space: nowrap;
}
.gf-chip:hover,
.gf-chip:focus-visible {
  color: var(--bright);
  background: var(--row);
}
.gf-dest {
  white-space: nowrap;
  margin-right: 6px;
}
.gf-band {
  margin: 10px 0;
}
.gf-ports {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr));
  gap: 8px;
  margin-top: 6px;
}
.gf-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.gf-next {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 14px;
  margin: -4px 0 6px 18px;
  font-size: 11px;
  color: var(--muted);
}
.gf-next span {
  display: inline-flex;
  align-items: center;
}
.gf-io {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 16px;
  margin-top: 4px;
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
  .gf-host {
    padding-left: 52px;
  }
  .gf-host.no-lanes {
    padding-left: 0;
  }
}
@media print {
  .gf-bar,
  .gf-proto {
    display: none;
  }
}
</style>
