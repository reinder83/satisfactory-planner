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

  Phase tabs (#1317, PhaseTabs.vue) under the buttons: one per phase of the plan, opening on the
  phase on screen ("Phase 4 · current"), to look at what the factory builds in another phase (its
  lines, lanes and table, from shownGroupFlow's stage key) without switching the profile's phase
  or saving anything. Another phase's tab is read-only: its lines are plain names and say nothing
  of whether they run, and a note says which phase is shown. The tab open is in the address
  (?view=<phase>, flowRoute in session.ts), written without a history entry so Back, a reload and
  a link return to it; a phase it does not name or one with no lines of the factory opens the
  phase on screen. The tab is not stored.

  A milestone-only phase (#759) shows the same notice as the factories page; an address naming
  no group of the profile (a removed group, a mistyped link) says so; a profile that is not a
  calculated one draws nothing, as the other pages do.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { replaceShownRoute } from '../../api.ts';
import { openTab, phaseTabs, tabId } from '../../phase-tabs.ts';
import { shownGroupFlow, storedStageOf } from '../../shown-group-flow.ts';
import {
  calculated,
  checked,
  flowGroupOf,
  flowRoute,
  flowViewOf,
  milestoneOnly,
  phase,
  phaseLabel,
  stage,
} from '../../session.ts';
import type { StageKey } from '../../../types/index.ts';
import { factoryGroupsState } from '../../views/factories.ts';
import { flowNames, laneStyles, type LaneWire } from '../../views/group-flow-page.ts';
import { legacy } from '../bridge.ts';
import FlowCard from '../group-flow/FlowCard.vue';
import FlowPorts from '../group-flow/FlowPorts.vue';
import FlowTable from '../group-flow/FlowTable.vue';
import { useLaneLayout } from '../group-flow/lane-layout.ts';
import PageHeader from '../PageHeader.vue';
import PhaseTabs from '../PhaseTabs.vue';
import MilestoneOnlyNotice from '../plan/MilestoneOnlyNotice.vue';

// The tab picked here, with the address it was written to: while the address is still that one the
// pick stands; any other address (Back, a link) is read afresh.
const picked = ref<{ hash: string; view: string } | null>(null);
const asked = () =>
  picked.value?.hash === location.hash ? picked.value.view : flowViewOf(location.hash.slice(1));
const groupOf = () => flowGroupOf(location.hash.slice(1)) ?? '';

const page = computed(() =>
  legacy(() => {
    if (!calculated) return null;
    const groupId = groupOf();
    const groups = factoryGroupsState();
    const tabs = phaseTabs(groupId);
    // The phase tab shown; the phase on screen unless another tab is open (#1317).
    const shown: StageKey = openTab(tabs, asked());
    const current = shown === stage();
    const flow = shownGroupFlow(groupId, shown);
    return {
      name: groups.groups.find(group => group.id === groupId)?.name ?? null,
      phase: phaseLabel(current ? phase() : shown),
      working: phaseLabel(phase()),
      tabs,
      shown,
      readonly: !current,
      milestones: current && milestoneOnly(),
      snapshot: current ? undefined : storedStageOf(shown),
      flow,
      running: (lineId: string) => checked(`calc-${shown}-${lineId}`),
    };
  }),
);
// A tab picked: shown at once, and named in the address without a history entry, so Back and a
// reload come back to it. The phase on screen's tab names none.
function pickTab(key: StageKey) {
  const group = groupOf();
  if (!group) return;
  replaceShownRoute(flowRoute(group, phase(), key === stage() ? null : key));
  picked.value = { hash: location.hash, view: key };
}
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
    <PhaseTabs
      v-if="page.name !== null"
      :tabs="page.tabs"
      :open="page.shown"
      prefix="gf"
      panel="gf-panel"
      label="Phase"
      @pick="pickTab"
    />
    <div
      id="gf-panel"
      :role="page.name !== null ? 'tabpanel' : undefined"
      :aria-labelledby="page.name !== null ? tabId('gf', page.shown) : undefined"
      :tabindex="page.name !== null ? 0 : undefined"
      class="gf-panel"
      data-gf-panel
    >
      <MilestoneOnlyNotice v-if="!page.readonly" />
      <p v-if="page.readonly && page.name !== null" class="notice info" data-gf-readonly>
        Viewing {{ page.phase }} — switch phase to tick or edit. Your phase is {{ page.working }}.
      </p>
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
                :group="page.flow.group"
                :names="names"
                :running="page.running(line.id)"
                :hot="active === line.id"
                :readonly="page.readonly"
                :snapshot="page.snapshot"
              />
            </li>
          </ol>
        </div>
        <FlowPorts id="gf-out-h" title="Leaves" :ports="page.flow.outs" :fold="page.flow.fold" />
        <FlowTable :flow="page.flow" :names="names" :snapshot="page.snapshot" />
        <p v-if="page.flow.split" class="small muted">
          Split lines show this factory's share of their machines and rates.
        </p>
      </template>
    </div>
  </template>
</template>
