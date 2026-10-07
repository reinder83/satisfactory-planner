<!--
  #plan on a calculated profile: the calculation's warnings, the notice that the lines asked to run
  at exact clocks need a recalculation (ui/plan/ExactClocksRecalc.vue, #1066), a summary line (factories,
  storage and power, each linking to its page, and the delivery time, what is left of it once a
  delivery count is saved, #1062; SP-43), the next phase once the delivery is complete
  (ui/plan/NextPhase.vue, #1069) or Post Phase 5's finish card, the handover from the phase before
  (ui/plan/HandoverSummary.vue, #1069), why it opened on an
  earlier phase than the saved one when it did (ui/plan/OpenedEarlierNotice.vue, #666), the checklist
  with its progress bar (calcTasks in views/calculated.ts, with this profile's edits and personal tasks) with a
  link to the phase notes (on the Notes page, #243), and a side column with the Space Elevator deliveries,
  "Built so far" (ui/plan/BuildStatusPanel.vue), what whole machines cost (ui/plan/RoundingCost.vue,
  #1066) and the profile's assumptions, then the
  hard-drive payoff table (ui/plan/PayoffPanel.vue) across the page's width. Everything
  reads the frozen calculation snapshot through calcStage(). A delivery's id is
  `<stage>-<item slug>`, a saved key. A milestone-only phase before the profile's start phase
  (#759) has no stage to read: its checklist is its milestones, with ui/plan/MilestoneOnlyNotice.vue
  above it (which also says why it opened there, in place of OpenedEarlierNotice, #786), and it has
  no summary line and no side column: deliveries, build status and profile assumptions are all
  about production.
-->
<script setup lang="ts">
import { computed } from 'vue';
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
import { currentCarry } from '../../views/calculated.ts';
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
import HandoverSummary from '../plan/HandoverSummary.vue';
import MilestoneOnlyNotice from '../plan/MilestoneOnlyNotice.vue';
import NextPhase from '../plan/NextPhase.vue';
import OpenedEarlierNotice from '../plan/OpenedEarlierNotice.vue';
import PlanEditBar from '../plan/PlanEditBar.vue';
import PlanProgress from '../plan/PlanProgress.vue';
import PlanSummary from '../plan/PlanSummary.vue';
import PayoffPanel from '../plan/PayoffPanel.vue';
import { powerView } from '../../../power.ts';
import RoundingCost from '../plan/RoundingCost.vue';

// The summary's power line, from the one power model every page reads (powerView in
// public/power.ts, #1064): what the phase has against what it needs, as the Resources page's bar
// and the power step give them. A plan made before #1064 keeps its old line: the new generation,
// what Phase 5's augmenters add (their 500 MW each and their boost on new and installed
// generation, the bar's "Augmenter boost", #1050 review) and the spare existing power.
function powerSummary(stagePlan: StoredStage, settings: StoredCalculatedPlan['settings']): string {
  const view = powerView(stagePlan, settings);
  if (view.modelled) return `${power(view.availableMW)} of power for ${power(view.needMW)} needed`;
  const boost = view.supply.find(part => part.key === 'boost')?.mw ?? 0;
  return (
    `${power(stagePlan.generationMW)} new power` +
    (boost > 0.01 ? ` + ${power(boost)} augmenter boost` : '') +
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
</script>

<template>
  <template v-if="page">
    <PageHeader
      eyebrow="CALCULATED BUILD SEQUENCE"
      :title="page.title"
      :subtitle="page.profileName"
    />
    <PlanEditBar />
    <CalcWarnings />
    <ExactClocksRecalc />
    <PlanSummary v-if="!page.milestones" :items="page.summary" />
    <NextPhase />
    <div v-if="page.post" class="notice info" data-finish-card>
      <b>{{ page.finished ? 'Project Assembly complete.' : 'After Phase 5.' }}</b> Post Phase 5 is
      not a sixth phase: it has no Space Elevator delivery and no new production lines.<br />
      Retain these Phase 5 capacities. Prioritize storage and teleporter supply; reduce former
      elevator exports as needed and sink spare parts.
    </div>
    <OpenedEarlierNotice />
    <MilestoneOnlyNotice />
    <HandoverSummary />
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
        <Checklist />
        <AddTaskForm placeholder="Add a task…" />
        <p class="small"><a href="#notes" data-phase-notes-link>Phase notes →</a></p>
      </section>
      <aside v-if="!page.milestones">
        <section v-if="!page.milestones" class="panel">
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
    <PayoffPanel />
  </template>
</template>
