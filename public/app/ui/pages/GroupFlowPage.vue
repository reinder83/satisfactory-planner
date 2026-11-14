<!--
  #factories/<group>/flow: one factory group's build order (#883, #894, #1346), the page behind
  "Build order →". At the top, what comes in (FlowComesIn.vue, BO-3): each input with its rate and
  where it comes from, those a running line is short of in the problem colour ("Plastic 0 of
  105/min · not arriving"). Then the group's lines as numbered steps in the build plan's order
  (BO-1): a list of the steps on the left with a status each (running ✓, the count built, the one
  to build next, held back), and on the right the current step open as a card with its Built
  counter and Mark running (FlowCard.vue, BO-4), every other step a one-row fold that opens as a
  card (one at a time, or all of them with "Expand all"; printing opens them all). Each input names
  its source as a chip (BO-2): "from 01" moves to that step, another factory's name opens its
  build order. Then what leaves, with the AWESOME Sink and protected storage folded into one
  summary. "The diagram as a table" says it all again as text. The model is groupFlow
  (group-flow.ts); the words are views/group-flow-page.ts.

  Phase tabs (#1317, PhaseTabs.vue) under the buttons: one per phase of the plan, opening on the
  phase on screen ("Phase 4 · current"), to look at what the factory builds in another phase (its
  steps and table, from shownGroupFlow's stage key) without switching the profile's phase or saving
  anything. Another phase's tab is read-only: its steps are plain names with no status, counter or
  Mark running, and a note says which phase is shown. The tab open is in the address
  (?view=<phase>, flowRoute in session.ts), written without a history entry so Back, a reload and
  a link return to it; a phase it does not name or one with no lines of the factory opens the
  phase on screen. The tab is not stored.

  A milestone-only phase (#759) shows the same notice as the factories page; an address naming
  no group of the profile (a removed group, a mistyped link) says so; a profile that is not a
  calculated one draws nothing, as the other pages do.
-->
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { replaceShownRoute } from '../../api.ts';
import { openTab, phaseTabs, tabId } from '../../phase-tabs.ts';
import { shownGroupFlow, storedStageOf } from '../../shown-group-flow.ts';
import {
  calcStage,
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
import { currentBuildStatus, heldBack, lineCountOf } from '../../views/calculated.ts';
import type { CalcRow, StageKey } from '../../../types/index.ts';
import { factoryGroupsState, machineLine } from '../../views/factories.ts';
import { comesIn, flowNames, lineNumber } from '../../views/group-flow-page.ts';
import { legacy } from '../bridge.ts';
import FlowCard from '../group-flow/FlowCard.vue';
import FlowComesIn from '../group-flow/FlowComesIn.vue';
import FlowPorts from '../group-flow/FlowPorts.vue';
import FlowTable from '../group-flow/FlowTable.vue';
import PageHeader from '../PageHeader.vue';
import PhaseTabs from '../PhaseTabs.vue';
import MilestoneOnlyNotice from '../plan/MilestoneOnlyNotice.vue';

// One step of the list: how it stands, as the short mark the list shows and in words for a screen
// reader. Another phase's tab has none ('plain'), since it says nothing of what runs.
interface Step {
  id: string;
  no: string;
  name: string;
  summary: string;
  state: 'running' | 'next' | 'partial' | 'held' | 'todo' | 'plain';
  mark: string;
  words: string;
  row?: CalcRow;
}

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
    const rows = new Map((current ? (calcStage()?.rows ?? []) : []).map(row => [row.id, row]));
    const running = (lineId: string) => current && checked(`calc-${shown}-${lineId}`);
    // The step to build next: the first line of the factory not running yet.
    const next = current ? flow?.lines.find(line => !running(line.id))?.id : undefined;
    const steps: Step[] = (flow?.lines ?? []).map(line => {
      const row = rows.get(line.id);
      const base = {
        id: line.id,
        no: lineNumber(line.no),
        name: line.name,
        summary:
          machineLine(line.machines, line.machine, line.lastClock, line.clock) +
          (line.inputs.length ? ' · needs ' + line.inputs.map(input => input.item).join(', ') : ''),
        ...(row ? { row } : {}),
      };
      if (!row) return { ...base, state: 'plain', mark: '', words: '' };
      const hold = heldBack(line.id);
      const { built, needed } = lineCountOf(row);
      if (running(line.id))
        return hold
          ? { ...base, state: 'held', mark: '⚠', words: `Running, short of ${hold.shortOf}` }
          : { ...base, state: 'running', mark: '✓', words: 'Running' };
      const count = built > 0 ? `${built}/${needed}` : '';
      if (line.id === next)
        return {
          ...base,
          state: 'next',
          mark: count,
          words: count ? `Build next, ${built} of ${needed} built` : 'Build next',
        };
      return count
        ? { ...base, state: 'partial', mark: count, words: `${built} of ${needed} built` }
        : { ...base, state: 'todo', mark: '', words: 'Not built' };
    });
    // What the running lines are short of, and what the built lines make now (BO-3).
    const held = new Set<string>();
    if (current)
      for (const line of flow?.lines ?? []) {
        const hold = heldBack(line.id);
        if (hold) held.add(hold.shortOf);
      }
    const produced = current ? (currentBuildStatus()?.produced ?? {}) : {};
    return {
      name: groups.groups.find(group => group.id === groupId)?.name ?? null,
      phase: phaseLabel(current ? phase() : shown),
      working: phaseLabel(phase()),
      tabs,
      shown,
      view: current ? null : shown,
      readonly: !current,
      milestones: current && milestoneOnly(),
      snapshot: current ? undefined : storedStageOf(shown),
      flow,
      steps,
      next,
      comes: flow ? comesIn(flow.ins, held, produced) : [],
      running,
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
const names = computed(() => (page.value?.flow ? flowNames(page.value.flow) : null));

// The step open as a card: the one picked (a fold, a chip, the list, or any control of a card),
// else the step to build next, else the first. "Expand all" opens every step; printing does too.
const pinned = ref<string | null>(null);
const all = ref(false);
const open = computed(() => {
  const current = page.value;
  if (!current?.flow?.lines.length) return null;
  const ids = current.flow.lines.map(line => line.id);
  return pinned.value && ids.includes(pinned.value) ? pinned.value : (current.next ?? ids[0]!);
});
const isOpen = (id: string) => all.value || open.value === id;

// Opens a step and moves focus to its card (a fold, a chip or the list).
async function show(id: string) {
  pinned.value = id;
  await nextTick();
  document.querySelector<HTMLElement>(`.gf-card[data-line="${CSS.escape(id)}"]`)?.focus();
}

function printPage() {
  const was = all.value;
  all.value = true;
  void nextTick(() => {
    window.print();
    all.value = was;
  });
}
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
        <FlowComesIn :items="page.comes" />
        <div class="gf-order">
          <nav class="gf-steps" aria-label="Build steps" data-gf-steps>
            <h2 class="gf-colcap">Steps</h2>
            <ol>
              <li v-for="step in page.steps" :key="step.id">
                <button
                  type="button"
                  :class="['gf-step-btn', step.state, open === step.id ? 'on' : '']"
                  :aria-current="open === step.id ? 'step' : undefined"
                  :data-step-nav="step.id"
                  @click="show(step.id)"
                >
                  <span class="chain-no">{{ step.no }}</span
                  >{{ ' ' }}<span class="gf-step-name">{{ step.name }}</span
                  >{{ ' '
                  }}<span
                    v-if="step.state !== 'plain'"
                    class="gf-step-mark"
                    :data-state="step.state"
                    ><span aria-hidden="true">{{ step.mark }}</span
                    >{{ ' ' }}<span class="visually-hidden">{{ step.words }}</span></span
                  >
                </button>
              </li>
            </ol>
          </nav>
          <div class="gf-main">
            <ol class="gf-stack">
              <li v-for="step in page.steps" :key="step.id" :data-step="step.id">
                <FlowCard
                  v-if="isOpen(step.id)"
                  :line="page.flow.lines.find(line => line.id === step.id)!"
                  :group="page.flow.group"
                  :names="names"
                  :plan="step.row"
                  :running="page.running(step.id)"
                  :next="step.state === 'next'"
                  :view="page.view"
                  :readonly="page.readonly"
                  :snapshot="page.snapshot"
                  @focusin="pinned = step.id"
                  @change="pinned = step.id"
                  @click.capture="pinned = step.id"
                  @go="show"
                />
                <button
                  v-else
                  type="button"
                  :class="['gf-fold-row', step.state]"
                  aria-expanded="false"
                  :data-step-row="step.id"
                  @click="show(step.id)"
                >
                  <span class="chain-no">{{ step.no }}</span
                  >{{ ' ' }}<span class="gf-fold-name">{{ step.name }}</span
                  >{{ ' ' }}<span class="gf-fold-sum small muted">{{ step.summary }}</span
                  >{{ ' '
                  }}<span
                    v-if="step.state !== 'plain'"
                    class="gf-step-mark"
                    :data-state="step.state"
                    ><span aria-hidden="true">{{ step.mark }}</span
                    >{{ ' ' }}<span class="visually-hidden">{{ step.words }}</span></span
                  >
                </button>
              </li>
            </ol>
            <button
              v-if="page.steps.length > 1"
              type="button"
              class="btn gf-all"
              data-gf-all
              @click="all = !all"
            >
              {{ all ? 'Show the current step only' : `Expand all ${page.steps.length} steps` }}
            </button>
          </div>
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
