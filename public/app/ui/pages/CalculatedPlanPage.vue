<!--
  #plan on a calculated profile: the calculation's warnings, summary tiles, the checklist
  (calcTasks in views/calculated.js, with this profile's edits and personal tasks) with
  phase notes (`phase-<phase>`), and a side column with the Space Elevator deliveries and
  the profile's assumptions. Everything reads the frozen calculation snapshot through
  calcStage(). A delivery's id is `<stage>-<item slug>`, a saved key.
-->
<script setup>
import { computed } from 'vue';
import { num, slug } from '../../format.js';
import {
  calcStage,
  calculated,
  checked,
  currentProfile,
  phase,
  phaseLabel,
  stage,
  state,
} from '../../session.js';
import { planTasks } from '../../tasks.js';
import { power } from '../../wizard/fields.js';
import { legacy } from '../bridge.js';
import PageHeader from '../PageHeader.vue';
import StatTile from '../StatTile.vue';
import AddTaskForm from '../plan/AddTaskForm.vue';
import CalcWarnings from '../plan/CalcWarnings.vue';
import Checklist from '../plan/Checklist.vue';
import DeliveryCounter from '../plan/DeliveryCounter.vue';
import EditStepsToggle from '../plan/EditStepsToggle.vue';

// null once the open profile is no longer a calculated one: until render() swaps this page
// out, it draws nothing rather than reading a plan that is not there.
const page = computed(() =>
  legacy(() => {
    if (!calculated) return null;
    const x = calcStage(),
      ts = planTasks();
    return {
      phase: phase(),
      title: phaseLabel(phase()),
      profileName: currentProfile.name,
      post: phase() === 'post',
      progress: ts.filter(t => checked(t.id)).length + '/' + ts.length,
      hours: num(x.hours) + ' h',
      buildings: num(x.rows?.reduce((a, r) => a + r.machines, 0)),
      power: power(x.generationMW),
      note: state.notes['phase-' + phase()] || '',
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
    <CalcWarnings />
    <div class="stats">
      <StatTile label="Progress" :value="page.progress" caption="Checklist steps" />
      <StatTile
        label="Delivery time"
        :value="page.hours"
        caption="At steady state; excludes construction"
      />
      <StatTile label="Buildings" :value="page.buildings" caption="Includes new power generation" />
      <StatTile label="New power" :value="page.power" caption="Existing spare power is separate" />
    </div>
    <div v-if="page.post" class="notice blue">
      Retain these Phase 5 capacities. Prioritize storage and teleporter supply; reduce former
      elevator exports as needed and sink spare parts.
    </div>
    <div class="split">
      <section>
        <div class="section-head">
          <h2>Build sequence</h2>
          <EditStepsToggle />
        </div>
        <p class="small muted">
          Start with construction stock and currently available power. Mark HUB, MAM and recipe
          unlocks as you complete them; these carry across phases. Milestone cost guidance updates
          from factories marked running. Full-phase factory targets follow the startup and unlock
          steps.
        </p>
        <Checklist />
        <AddTaskForm placeholder="Add a task…" />
        <h2>Phase notes</h2>
        <textarea id="phase-note" class="notes" maxlength="6000" :value="page.note"></textarea>
        <button class="btn" :data-save-note="'phase-' + page.phase" data-input="phase-note">
          Save notes
        </button>
      </section>
      <aside>
        <section class="panel">
          <h2>Elevator delivery</h2>
          <DeliveryCounter v-for="d in page.deliveries" :key="d.id" :delivery="d" />
        </section>
        <section class="panel">
          <h2>Profile assumptions</h2>
          <p v-for="(w, i) in page.warnings" :key="i" class="small">{{ w }}</p>
        </section>
      </aside>
    </div>
  </template>
</template>
