<!--
  #factories/<group>/flow: one factory group's flow (#883, #894), drawn with item lanes as the
  owner approved in round 3. What comes in at the top, then the group's lines as numbered cards
  in the build plan's order, then what leaves, with the AWESOME Sink and protected storage folded
  into one summary. The links between the group's own lines run as lanes in a gutter left of the
  cards, one colour and dash per item (the key above the cards): each starts at a dot on the
  source card's output row and ends in an arrowhead touching the target card's border at the
  input row it feeds. Hovering or focusing a card lights its lanes and dims the rest. The model
  is groupFlow (group-flow.ts); the words and paths are views/group-flow-page.ts, the
  measuring ui/group-flow/lane-layout.ts. "The diagram as a table" says it all again as text.

  A milestone-only phase (#759) shows the same notice as the factories page; an address naming
  no group of the profile (a removed group, a mistyped link) says so; a profile that is not a
  calculated one draws nothing, as the other pages do.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { FLUIDS, itemBelts, lanePlan } from '../../flow.ts';
import { groupFlow } from '../../group-flow.ts';
import { linkItemWords } from '../../logistics.ts';
import {
  calcStage,
  calculated,
  checked,
  flowGroupOf,
  milestoneOnly,
  phase,
  phaseLabel,
  stage,
} from '../../session.ts';
import { buildRowName } from '../../views/calculated.ts';
import { factoryGroupsState } from '../../views/factories.ts';
import { flowNames, laneStyles, type LaneWire } from '../../views/group-flow-page.ts';
import { legacy } from '../bridge.ts';
import FlowCard from '../group-flow/FlowCard.vue';
import FlowPorts from '../group-flow/FlowPorts.vue';
import FlowTable from '../group-flow/FlowTable.vue';
import { useLaneLayout } from '../group-flow/lane-layout.ts';
import PageHeader from '../PageHeader.vue';
import MilestoneOnlyNotice from '../plan/MilestoneOnlyNotice.vue';

const page = computed(() =>
  legacy(() => {
    if (!calculated) return null;
    const groupId = flowGroupOf(location.hash.slice(1)) ?? '';
    const groups = factoryGroupsState();
    const stageKey = stage();
    const storedStage = calcStage();
    const belts = (item: string, rate: number) => itemBelts(item, rate, stageKey);
    const flow = storedStage
      ? groupFlow(
          storedStage,
          groups,
          groupId,
          belts,
          row => buildRowName(row.id),
          calculated.settings.onSite,
          // Each link in or out as the Logistics page has it (#1067): its vehicle, Water
          // Extractors at the site, or its belts with the trickle items on a mixed belt.
          link =>
            linkItemWords(
              link,
              groups.links,
              FLUIDS,
              (rate, fluid) => lanePlan(rate, fluid, stageKey),
              belts,
            ),
        )
      : null;
    return {
      name: groups.groups.find(group => group.id === groupId)?.name ?? null,
      phase: phaseLabel(phase()),
      milestones: milestoneOnly(),
      flow,
      running: (lineId: string) => checked(`calc-${stageKey}-${lineId}`),
    };
  }),
);
const flow = () => page.value?.flow ?? null;
const names = computed(() => (page.value?.flow ? flowNames(page.value.flow) : null));
const styles = computed(() => laneStyles(page.value?.flow ?? { lines: [], lanes: [] }));

const host = ref<HTMLElement | null>(null);
const { gutter, wires } = useLaneLayout(host, flow);

// The line the pointer or focus is on: its lanes are drawn bright and the others dim.
const active = ref<string | null>(null);
const wireState = (wire: LaneWire) =>
  !active.value ? '' : wire.lines.includes(active.value) ? 'hot' : 'dim';
// Lit wires last, so a shared trunk shows bright rather than under a dimmed one.
const drawOrder = computed(() =>
  [...wires.value].sort((a, b) => +(wireState(a) === 'hot') - +(wireState(b) === 'hot')),
);
const styleOf = (item: string) => styles.value.get(item) ?? { color: 'var(--muted)', dash: '' };
// Leaving a card for another element of the same card keeps it lit.
function left(event: FocusEvent, lineId: string) {
  const to = event.relatedTarget as Node | null;
  if (active.value === lineId && !(event.currentTarget as HTMLElement).contains(to))
    active.value = null;
}

const printPage = () => window.print();
</script>

<template>
  <template v-if="page">
    <PageHeader
      eyebrow="FACTORY · BUILD ORDER"
      :title="page.name ?? 'Factory'"
      :subtitle="
        page.flow?.lines.length
          ? `${page.phase} · ${page.flow.lines.length} ${page.flow.lines.length === 1 ? 'line' : 'lines'} in the order to build them, with what each one feeds.`
          : page.phase
      "
    />
    <div class="gf-bar">
      <a class="btn" href="#factories" data-gf-back>← Factories</a>
      <button v-if="page.flow?.lines.length" type="button" class="btn" @click="printPage">
        Print
      </button>
    </div>
    <MilestoneOnlyNotice />
    <p v-if="!page.milestones && page.name === null" class="notice warn" data-gf-missing>
      This profile has no factory at this address. It may have been removed or renamed on the
      Factories page.
    </p>
    <p v-else-if="page.flow && !page.flow.lines.length" class="small muted" data-gf-empty>
      No production lines of this factory produce anything in {{ page.phase }}.
    </p>
    <template v-else-if="page.flow && names">
      <p v-if="styles.size" class="small muted gf-key" data-gf-key>
        <span>Lanes inside the factory:</span>
        <span v-for="[item, style] in styles" :key="item" class="gf-key-item"
          ><svg class="gf-swatch" width="22" height="8" aria-hidden="true">
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
      <FlowPorts id="gf-in-h" title="Comes in" :ports="page.flow.ins" />
      <div ref="host" class="gf-host" :style="{ paddingLeft: gutter + 'px' }">
        <svg v-if="wires.length" class="gf-lanes" aria-hidden="true">
          <g
            v-for="wire in drawOrder"
            :key="wire.key"
            :class="['gf-wire', wireState(wire)]"
            :data-from-row="wire.fromRow"
            :data-to-row="wire.toRow"
          >
            <path
              :d="wire.path"
              :style="{
                stroke: styleOf(wire.item).color,
                strokeDasharray: styleOf(wire.item).dash,
              }"
            />
            <circle
              class="gf-dot"
              :cx="wire.dot.x"
              :cy="wire.dot.y"
              r="3.5"
              :style="{ fill: styleOf(wire.item).color }"
            />
            <path class="gf-tip" :d="wire.arrow" :style="{ fill: styleOf(wire.item).color }" />
          </g>
        </svg>
        <ol class="gf-stack">
          <li
            v-for="line in page.flow.lines"
            :key="line.id"
            @mouseenter="active = line.id"
            @mouseleave="active = null"
            @focusin="active = line.id"
            @focusout="left($event, line.id)"
          >
            <FlowCard
              :line="line"
              :names="names"
              :running="page.running(line.id)"
              :hot="active === line.id"
            />
          </li>
        </ol>
      </div>
      <FlowPorts id="gf-out-h" title="Leaves" :ports="page.flow.outs" :fold="page.flow.fold" />
      <FlowTable :flow="page.flow" :names="names" />
      <p v-if="page.flow.split" class="small muted">
        Split lines show this factory's share of their machines and rates.
      </p>
    </template>
  </template>
</template>
