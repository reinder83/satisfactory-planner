<!--
  #plan on a calculated profile: the calculation's warnings, a summary line (factories,
  storage and power, each linking to its page, and the delivery time; SP-43), the checklist
  with its progress bar (calcTasks in views/calculated.ts, with this profile's edits and personal tasks) with a
  link to the phase notes (on the Notes page, #243), and a side column with the Space Elevator deliveries,
  "Built so far" (ui/plan/BuildStatusPanel.vue) and the profile's assumptions, then the
  hard-drive payoff table (ui/plan/PayoffPanel.vue) across the page's width. Everything
  reads the frozen calculation snapshot through calcStage(). A delivery's id is
  `<stage>-<item slug>`, a saved key.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num, slug } from '../../format.ts';
import {
  calcStage,
  calculated,
  checked,
  currentProfile,
  phase,
  phaseLabel,
  stage,
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
import PlanEditBar from '../plan/PlanEditBar.vue';
import PlanProgress from '../plan/PlanProgress.vue';
import PlanSummary from '../plan/PlanSummary.vue';
import PayoffPanel from '../plan/PayoffPanel.vue';

// null once the open profile is no longer a calculated one: until render() swaps this page
// out, it draws nothing rather than reading a plan that is not there.
const page = computed(() =>
  legacy(() => {
    const x = calcStage();
    if (!calculated || !x) return null;
    // A production line's Running box is its checklist step, `calc-<stage>-<row id>`.
    const rows = x.rows || [];
    const running = rows.filter(r => checked('calc-' + stage() + '-' + r.id)).length;
    const slots = storageBays()
      .flatMap(b => b.items)
      .filter(s => s.name);
    const ready = slots.filter(s => checked('slot-' + s.id + '-verified')).length;
    const buildings = num(rows.reduce((a, r) => a + r.machines, 0));
    return {
      title: phaseLabel(phase()),
      profileName: currentProfile.name,
      post: phase() === 'post',
      summary: [
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
        { key: 'power', href: '#resources', text: `${power(x.generationMW)} new power` },
        { key: 'hours', text: `Delivery in ${num(x.hours)} h at steady state` },
      ],
      deliveries: Object.entries(x.delivery || {}).map(([n, d]) => ({
        id: stage() + '-' + slug(n),
        name: n,
        ...d,
        initial: 0,
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
    <PlanSummary :items="page.summary" />
    <div v-if="page.post" class="notice info">
      Retain these Phase 5 capacities. Prioritize storage and teleporter supply; reduce former
      elevator exports as needed and sink spare parts.
    </div>
    <div class="split">
      <section>
        <div class="section-head">
          <h2>Build sequence</h2>
          <EditStepsToggle />
        </div>
        <PlanProgress />
        <p class="small muted">
          Start with construction stock and currently available power. Mark HUB, MAM and recipe
          unlocks as you complete them; these carry across phases. Milestone cost guidance updates
          from factories marked running. Full-phase factory targets follow the startup and unlock
          steps.
        </p>
        <Checklist />
        <AddTaskForm placeholder="Add a task…" />
        <p class="small"><a href="#notes" data-phase-notes-link>Phase notes →</a></p>
      </section>
      <aside>
        <section class="panel">
          <h2>Elevator delivery</h2>
          <DeliveryCounter v-for="d in page.deliveries" :key="d.id" :delivery="d" />
        </section>
        <BuildStatusPanel />
        <section class="panel">
          <h2>Profile assumptions</h2>
          <p v-for="(w, i) in page.warnings" :key="i" class="small">{{ w }}</p>
        </section>
      </aside>
    </div>
    <PayoffPanel />
  </template>
</template>
