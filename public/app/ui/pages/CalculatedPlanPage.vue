<!--
  #plan on a calculated profile: the calculation's warnings, a summary line (factories,
  storage and power, each linking to its page, and the delivery time; SP-43), why it opened on an
  earlier phase than the saved one when it did (ui/plan/OpenedEarlierNotice.vue, #666), the checklist
  with its progress bar (calcTasks in views/calculated.ts, with this profile's edits and personal tasks) with a
  link to the phase notes (on the Notes page, #243), and a side column with the Space Elevator deliveries,
  "Built so far" (ui/plan/BuildStatusPanel.vue) and the profile's assumptions, then the
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
import { durationOfHours, num, slug } from '../../format.ts';
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
} from '../../session.ts';
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
import MilestoneOnlyNotice from '../plan/MilestoneOnlyNotice.vue';
import OpenedEarlierNotice from '../plan/OpenedEarlierNotice.vue';
import PlanEditBar from '../plan/PlanEditBar.vue';
import PlanProgress from '../plan/PlanProgress.vue';
import PlanSummary from '../plan/PlanSummary.vue';
import PayoffPanel from '../plan/PayoffPanel.vue';
import { powerView } from '../../../power.ts';
import type { StoredCalculatedPlan, StoredStage } from '../../../types/index.ts';

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
    const slots = storageBays()
      .flatMap(b => b.items)
      .filter(s => s.name);
    const ready = slots.filter(s => checked('slot-' + s.id + '-verified')).length;
    const buildings = num(rows.reduce((total, row) => total + row.machines, 0));
    return {
      title: phaseLabel(phase()),
      profileName: currentProfile.name,
      post: phase() === 'post',
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
              text: `Delivery in ${durationOfHours(stagePlan.hours || 0)} at steady state`,
            },
          ],
      deliveries: Object.entries(stagePlan?.delivery || {}).map(([item, delivery]) => ({
        id: stage() + '-' + slug(item),
        name: item,
        ...delivery,
      })),
      warnings: calculated.warnings,
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
    <PlanSummary v-if="!page.milestones" :items="page.summary" />
    <div v-if="page.post" class="notice info">
      Retain these Phase 5 capacities. Prioritize storage and teleporter supply; reduce former
      elevator exports as needed and sink spare parts.
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
        <section class="panel">
          <h2>Profile assumptions</h2>
          <p v-for="(warning, i) in page.warnings" :key="i" class="small">{{ warning }}</p>
        </section>
      </aside>
    </div>
    <PayoffPanel />
  </template>
</template>
