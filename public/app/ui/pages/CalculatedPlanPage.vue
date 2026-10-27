<!--
  #plan on a calculated profile: the calculation's warnings, the notice that the lines asked to run
  at exact clocks need a recalculation (ui/plan/ExactClocksRecalc.vue, #1066), the same for the
  somersloop pins asked for (ui/plan/SloopPinsRecalc.vue, #1235) and the Power Shard pins asked for
  (ui/plan/ShardPinsRecalc.vue, #1239), the offer to plan with
  what the ticks show you already have (ui/plan/OwnedTicksNotice.vue, #1068), a summary line (factories,
  storage and power, each linking to its page, and the delivery time, what is left of it once a
  delivery count is saved, #1062; SP-43), the next phase once the delivery is complete
  (ui/plan/NextPhase.vue, #1069) or Post Phase 5's finish card, the handover from the phase before
  (ui/plan/HandoverSummary.vue, #1069), the production lines built under an earlier plan that this
  one no longer needs (ui/plan/FormerLines.vue, #1175), why it opened on an
  earlier phase than the saved one when it did (ui/plan/OpenedEarlierNotice.vue, #666), the checklist
  with its progress bar (calcTasks in views/calculated.ts, with this profile's edits and personal tasks) with a
  link to the phase notes (on the Notes page, #243), and a side column with the Space Elevator deliveries,
  "Built so far" (ui/plan/BuildStatusPanel.vue), what whole machines cost (ui/plan/RoundingCost.vue,
  #1066) and the profile's assumptions, the best next hard drive (ui/plan/PayoffPanel.vue, the
  hard-drive payoff table, #1075) and where a somersloop pays off most
  (ui/plan/SloopPayoffPanel.vue, #1215).

  Tabs under the phase title sort them (#1243, ui/plan/plan-tabs.ts): Build sequence, which the
  page opens on, holds the notices about which phase the steps are for (OpenedEarlierNotice,
  MilestoneOnlyNotice, and for an infeasible phase the draft's heading with a button to Overview,
  where its reason and options are, #1020), the checklist and the side column; Overview the
  warnings, the recalculation offers, the summary line, the next phase or finish card, the
  handover and the former lines; Hard drives the payoff table; Somersloops the somersloop ranking.
  A tab whose panel draws nothing is left out, the tab list too when Build sequence is all that is left, and a
  tab counts the notices in it that ask for something. Everything
  reads the frozen calculation snapshot through calcStage(). A delivery's id is
  `<stage>-<item slug>`, a saved key. A milestone-only phase before the profile's start phase
  (#759) has no stage to read: its checklist is its milestones, with ui/plan/MilestoneOnlyNotice.vue
  above it (which also says why it opened there, in place of OpenedEarlierNotice, #786), and it has
  no summary line and no side column: deliveries, build status and profile assumptions are all
  about production.
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUpdated, ref } from 'vue';
import { deliveryHoursLeft } from '../../delivered.ts';
import { deliveryKey } from '../../../progression.ts';
import { durationOfHours, num } from '../../format.ts';
import {
  calcStage,
  calculated,
  checked,
  currentProfile,
  milestoneOnly,
  phase,
  phaseLabel,
  stage,
  startPhase,
  state,
} from '../../session.ts';
import type { StoredCalculatedPlan, StoredStage } from '../../../types/index.ts';
import { currentCarry, draftHeading } from '../../views/calculated.ts';
import { storageBays } from '../../views/storage.ts';
import { power } from '../../wizard/fields.ts';
import { legacy } from '../bridge.ts';
import PageHeader from '../PageHeader.vue';
import AddTaskForm from '../plan/AddTaskForm.vue';
import BuildStatusPanel from '../plan/BuildStatusPanel.vue';
import CalcWarnings from '../plan/CalcWarnings.vue';
import Checklist from '../plan/Checklist.vue';
import DeliveryCounter from '../plan/DeliveryCounter.vue';
import EditStepsToggle from '../plan/EditStepsToggle.vue';
import ExactClocksRecalc from '../plan/ExactClocksRecalc.vue';
import SloopPinsRecalc from '../plan/SloopPinsRecalc.vue';
import ShardPinsRecalc from '../plan/ShardPinsRecalc.vue';
import FormerLines from '../plan/FormerLines.vue';
import HandoverSummary from '../plan/HandoverSummary.vue';
import MilestoneOnlyNotice from '../plan/MilestoneOnlyNotice.vue';
import NextPhase from '../plan/NextPhase.vue';
import OpenedEarlierNotice from '../plan/OpenedEarlierNotice.vue';
import OwnedTicksNotice from '../plan/OwnedTicksNotice.vue';
import PlanEditBar from '../plan/PlanEditBar.vue';
import PlanProgress from '../plan/PlanProgress.vue';
import PlanSummary from '../plan/PlanSummary.vue';
import PayoffPanel from '../plan/PayoffPanel.vue';
import SloopPayoffPanel from '../plan/SloopPayoffPanel.vue';
import { powerView } from '../../../power.ts';
import RoundingCost from '../plan/RoundingCost.vue';
import {
  PLAN_TABS,
  tabContents,
  tabKeyTarget,
  type PlanTab,
  type PlanTabContent,
} from '../plan/plan-tabs.ts';

// The summary's power line, from the one power model every page reads (powerView in
// public/power.ts, #1064): what the phase has against what it needs, as the Resources page's bar
// and the power step give them. A plan made before #1064 keeps its old line: the new generation,
// what Phase 5's augmenters add and the spare existing power, split as the bar and "Power
// available now" split them (#1020): the augmenters' boost on the new generators goes with the
// new power, and the augmenters' part is their 500 MW each and their boost on installed
// generation (the bar's "Augmenter boost", #1050 review).
function powerSummary(stagePlan: StoredStage, settings: StoredCalculatedPlan['settings']): string {
  const view = powerView(stagePlan, settings);
  if (view.modelled) return `${power(view.availableMW)} of power for ${power(view.needMW)} needed`;
  const augmenters = stagePlan.augmenters ?? 0,
    boosted = view.generationMW - (stagePlan.generationMW || 0) > 0.01;
  return (
    `${power(view.generationMW)} new power` +
    (boosted ? " with the augmenters' boost" : '') +
    (view.augmenterMW > 0.01
      ? ` + ${power(view.augmenterMW)} from ${num(augmenters)} augmenter${augmenters === 1 ? '' : 's'}`
      : '') +
    (settings.availablePowerGW > 0
      ? ` + ${power(settings.availablePowerGW * 1000)} existing spare power`
      : '')
  );
}

// The summary's delivery time (#1062): the plan's own at steady state until a count is saved,
// then what the rest of the delivery takes at the plan's rates, and complete once every part is.
// A part without a rate (a plan migrated from the handbook) leaves the plan's own time standing.
function deliveryTime(stagePlan: StoredStage): string {
  const left = deliveryHoursLeft(stagePlan, stage(), state.deliveries);
  if (left === 0) return 'Elevator delivery complete';
  if (left === null || !Number.isFinite(left))
    return `Delivery in ${durationOfHours(stagePlan.hours || 0)} at steady state`;
  return `Rest of the delivery in ${durationOfHours(left)} at steady state`;
}

// null once the open profile is no longer a calculated one: until render() swaps this page
// out, it draws nothing rather than reading a plan that is not there.
const page = computed(() =>
  legacy(() => {
    const stagePlan = calcStage(),
      milestones = milestoneOnly();
    if (!calculated || (!stagePlan && !milestones)) return null;
    // A production line's Running box is its checklist step, `calc-<stage>-<row id>`.
    const rows = stagePlan?.rows || [];
    const running = rows.filter(r => checked('calc-' + stage() + '-' + r.id)).length;
    // Lines not ticked here that run from the phase before (#1069), counted apart.
    const carry = currentCarry(),
      carried = carry?.shares.size || 0;
    const slots = storageBays()
      .flatMap(b => b.items)
      .filter(s => s.name);
    const ready = slots.filter(s => checked('slot-' + s.id + '-verified')).length;
    const buildings = num(rows.reduce((total, row) => total + row.machines, 0));
    return {
      title: phaseLabel(phase()),
      profileName: currentProfile.name,
      post: phase() === 'post',
      // Post Phase 5's finish card (#1069): whether Phase 5's delivery is complete.
      finished: phase() === 'post' && deliveryHoursLeft(stagePlan, '5', state.deliveries) === 0,
      // A plan guide's steps replace the generated ones (#466).
      guided: !!calculated.guide,
      milestones,
      start: phaseLabel(startPhase()),
      summary: !stagePlan
        ? []
        : [
            {
              key: 'factories',
              href: '#factories',
              text: `${running} of ${rows.length} production lines running, ${buildings} buildings`,
            },
            ...(carry && carried
              ? [
                  {
                    key: 'carried',
                    href: '#factories',
                    text: `${carried} more ${carried === 1 ? 'line' : 'lines'} running since Phase ${carry.from}`,
                  },
                ]
              : []),
            {
              key: 'storage',
              href: '#storage',
              text: `${ready} of ${slots.length} storage positions verified`,
            },
            {
              key: 'power',
              href: '#resources',
              text: powerSummary(stagePlan, calculated.settings),
            },
            {
              key: 'hours',
              text: deliveryTime(stagePlan),
            },
          ],
      deliveries: Object.entries(stagePlan?.delivery || {}).map(([item, delivery]) => ({
        id: deliveryKey(stage(), item),
        name: item,
        ...delivery,
      })),
      warnings: calculated.warnings,
      // What whole machines cost in the phase on screen (#1066).
      rounding: [{ phase: stage(), stage: stagePlan }],
    };
  }),
);

// The open tab (#1243): Build sequence until another is picked, never stored.
const active = ref<PlanTab>('build');
// An infeasible phase's draft heading, which Build sequence repeats over its steps (#1020): the
// steps are the draft's, and the reason with what runs out and the options is in Overview. ''
// for a phase that fits and for a milestone-only phase, which has no stage.
const draftNotice = computed(() =>
  legacy(() => {
    const stagePlan = calcStage();
    return stagePlan && !stagePlan.feasible ? draftHeading(stagePlan) : '';
  }),
);
// Opens Overview from the draft notice and moves the focus to its tab, as the arrow keys do.
function showOverview() {
  active.value = 'overview';
  void nextTick(() =>
    document.querySelector<HTMLButtonElement>('[data-plan-tab="overview"]')?.focus(),
  );
}
const overviewPanel = ref<HTMLElement | null>(null);
const hardDrivesPanel = ref<HTMLElement | null>(null);
const sloopsPanel = ref<HTMLElement | null>(null);
// What each panel drew, read after every redraw (null until the page is mounted).
const contents = ref<Record<PlanTab, PlanTabContent> | null>(null);

function measureTabs() {
  const found = tabContents({
    overview: overviewPanel.value,
    'hard-drives': hardDrivesPanel.value,
    somersloops: sloopsPanel.value,
  });
  if (JSON.stringify(found) !== JSON.stringify(contents.value)) contents.value = found;
  // A tab that went empty (another phase, a notice dismissed) hands over to Build sequence.
  if (!found[active.value].filled) active.value = 'build';
}
onMounted(measureTabs);
onUpdated(measureTabs);

const tabs = computed(() =>
  PLAN_TABS.filter(([id]) => contents.value?.[id].filled ?? id === 'build').map(([id, label]) => ({
    id,
    label,
    news: contents.value?.[id].news ?? 0,
  })),
);
// No tab list for Build sequence alone (a milestone-only phase without notices).
const tabbed = computed(() => tabs.value.length > 1);

// A panel's attributes: a tab panel while there is a tab list, hidden unless its tab is open.
const panelAttrs = (tab: PlanTab) => ({
  id: 'plan-panel-' + tab,
  role: tabbed.value ? 'tabpanel' : undefined,
  'aria-labelledby': tabbed.value ? 'plan-tab-' + tab : undefined,
  tabindex: tabbed.value ? 0 : undefined,
  hidden: active.value !== tab || undefined,
});

// Arrow keys, Home and End move between the tabs and open the one they reach.
function tabKey(event: KeyboardEvent) {
  const at = tabs.value.findIndex(tab => tab.id === active.value);
  const next = tabKeyTarget(event.key, at, tabs.value.length);
  if (next === null) return;
  event.preventDefault();
  const target = tabs.value[next]!.id; // tabKeyTarget stays inside the list
  active.value = target;
  void nextTick(() =>
    document.querySelector<HTMLButtonElement>(`[data-plan-tab="${target}"]`)?.focus(),
  );
}
</script>

<template>
  <template v-if="page">
    <PageHeader
      eyebrow="CALCULATED BUILD SEQUENCE"
      :title="page.title"
      :subtitle="page.profileName"
    />
    <PlanEditBar />
    <!-- A tab's count is part of its name as words ("Overview, 1 new"); the figure drawn beside
         the label is hidden from a screen reader, as the storage room's floor tabs do. -->
    <div
      v-if="tabbed"
      class="tabs plan-tabs"
      role="tablist"
      aria-label="Build plan"
      data-plan-tabs
      @keydown="tabKey"
    >
      <button
        v-for="tab in tabs"
        :id="'plan-tab-' + tab.id"
        :key="tab.id"
        type="button"
        role="tab"
        :class="['tab', tab.id === active ? 'active' : '']"
        :aria-selected="tab.id === active ? 'true' : 'false'"
        :aria-controls="'plan-panel-' + tab.id"
        :tabindex="tab.id === active ? 0 : -1"
        :data-plan-tab="tab.id"
        @click="active = tab.id"
      >
        {{ tab.label
        }}<template v-if="tab.news"
          ><span class="count" aria-hidden="true" data-plan-tab-count>{{ tab.news }}</span
          ><span class="visually-hidden">, {{ tab.news }} new</span></template
        >
      </button>
    </div>
    <div v-bind="panelAttrs('build')" data-plan-panel="build">
      <div v-if="draftNotice" class="notice warn" data-draft-steps>
        <b>{{ draftNotice }}</b> These steps are the draft’s: this phase does not fit as set.
        <template v-if="tabbed"
          >Overview says why, what runs out and what to change.
          <button type="button" class="btn quiet" data-draft-overview @click="showOverview">
            Open Overview
          </button></template
        >
      </div>
      <OpenedEarlierNotice />
      <MilestoneOnlyNotice />
      <div :class="page.milestones ? undefined : 'split'">
        <section>
          <div class="section-head">
            <h2>Build sequence</h2>
            <EditStepsToggle />
          </div>
          <PlanProgress />
          <!-- A guided plan's steps are the guide's own (#466), not the startup, unlock and factory
               steps this describes (#479). -->
          <p v-if="page.guided" class="small muted" data-guided-intro>
            Work through the steps in order and tick each one as it is done.
          </p>
          <p v-else-if="page.milestones" class="small muted" data-milestone-intro>
            Mark each HUB milestone and MAM node as you complete it; these carry across phases.
            Production starts in {{ page.start }}, so gather, handcraft or build a starter supply of
            what each one costs.
          </p>
          <p v-else class="small muted">
            Start with construction stock and currently available power. Mark HUB, MAM and recipe
            unlocks as you complete them; these carry across phases. Milestone cost guidance updates
            from production lines marked running. Full-phase production lines follow the startup and
            unlock steps.
          </p>
          <p v-if="!page.milestones && !page.guided" class="small" data-session-link-row>
            <a href="#session" data-session-link>Today's session: the next builds, printable →</a>
          </p>
          <Checklist />
          <AddTaskForm placeholder="Add a task…" />
          <p class="small"><a href="#notes" data-phase-notes-link>Phase notes →</a></p>
        </section>
        <aside v-if="!page.milestones">
          <section class="panel">
            <h2>Elevator delivery</h2>
            <DeliveryCounter
              v-for="delivery in page.deliveries"
              :key="delivery.id"
              :delivery="delivery"
            />
          </section>
          <BuildStatusPanel />
          <RoundingCost :entries="page.rounding" />
          <section class="panel">
            <h2>Profile assumptions</h2>
            <p v-for="(warning, i) in page.warnings" :key="i" class="small">{{ warning }}</p>
          </section>
        </aside>
      </div>
    </div>
    <div ref="overviewPanel" v-bind="panelAttrs('overview')" data-plan-panel="overview">
      <CalcWarnings />
      <ExactClocksRecalc />
      <SloopPinsRecalc />
      <ShardPinsRecalc />
      <OwnedTicksNotice />
      <PlanSummary v-if="!page.milestones" :items="page.summary" />
      <NextPhase />
      <div v-if="page.post" class="notice info" data-finish-card>
        <b>{{ page.finished ? 'Project Assembly complete.' : 'After Phase 5.' }}</b> Post Phase 5 is
        not a sixth phase: it has no Space Elevator delivery and no new production lines.<br />
        Retain these Phase 5 capacities. Prioritize storage and teleporter supply; reduce former
        elevator exports as needed and sink spare parts.
      </div>
      <HandoverSummary />
      <FormerLines v-if="!page.milestones" />
    </div>
    <div ref="hardDrivesPanel" v-bind="panelAttrs('hard-drives')" data-plan-panel="hard-drives">
      <PayoffPanel />
    </div>
    <div ref="sloopsPanel" v-bind="panelAttrs('somersloops')" data-plan-panel="somersloops">
      <SloopPayoffPanel />
    </div>
  </template>
</template>
