<!--
  #plan for the original handbook: summary tiles, the phase checklist with its edit toggle,
  personal tasks and a link to the phase notes (on the Notes page, #243), and a side column
  with the Space Elevator deliveries. The next step leads the checklist itself (SP-42). Post-game ('post') reads the Phase 5
  stage of the handbook: stage() maps it to '5'. A calculated profile gets
  CalculatedPlanPage.vue instead.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { checked, phase, phaseLabel, plan, stage } from '../../session.ts';
import { planTasks } from '../../tasks.ts';
import { storageBays } from '../../views/storage.ts';
import { legacy } from '../bridge.ts';
import PageHeader from '../PageHeader.vue';
import StatTile from '../StatTile.vue';
import AddTaskForm from '../plan/AddTaskForm.vue';
import Checklist from '../plan/Checklist.vue';
import DeliveryCounter from '../plan/DeliveryCounter.vue';
import EditStepsToggle from '../plan/EditStepsToggle.vue';
import PlanEditBar from '../plan/PlanEditBar.vue';

const page = computed(() =>
  legacy(() => {
    // Checklist progress: planTasks() already applies this profile's step edits.
    const ts = planTasks(),
      done = ts.filter(t => checked(t.id)).length;
    // Factory and storage counters. The check keys are saved progress and must not change:
    // `factory-<stage>-<id>` is a factory's Running box, `slot-<address>-verified` the last
    // of a container's four checks (see slotKeys in views/storage.ts).
    const fs = plan.factories.filter(f => f.stages[stage()]);
    const slots = storageBays()
      .flatMap(b => b.items)
      .filter(x => x.name);
    return {
      title: phaseLabel(phase()) + ' field plan',
      post: phase() === 'post',
      done,
      total: ts.length,
      pct: ts.length ? Math.round((done / ts.length) * 100) : 100,
      built: fs.filter(f => checked('factory-' + stage() + '-' + f.id)).length,
      factories: fs.length,
      ready: slots.filter(x => checked('slot-' + x.id + '-verified')).length,
      slots: slots.length,
      power: num(plan.power[stage()]),
      deliveries: plan.deliveries.filter(d => d.phase === phase()),
    };
  }),
);
</script>

<template>
  <PageHeader
    eyebrow="THE NEXT BUILD"
    :title="page.title"
    :subtitle="
      page.post
        ? 'Storage first. Keep the network running, then finish the remaining items.'
        : 'Build the supply chain in order. Check off each step when it is verified in your save.'
    "
    badge="YOUR SAVE · YOUR PACE"
  />
  <PlanEditBar />
  <div class="stats">
    <StatTile label="Phase checklist" caption="Steps completed"
      >{{ page.done }} <span class="fraction">/ {{ page.total }}</span></StatTile
    >
    <StatTile label="Factory targets" caption="Marked running at this phase"
      >{{ page.built }} <span class="fraction">/ {{ page.factories }}</span></StatTile
    >
    <StatTile label="Storage ready" caption="Item positions verified"
      >{{ page.ready }} <span class="fraction">/ {{ page.slots }}</span></StatTile
    >
    <StatTile label="Planned power" caption="Gross capacity at this stage"
      >{{ page.power }} <span class="fraction">GW</span></StatTile
    >
  </div>
  <div class="split">
    <section>
      <div class="section-head">
        <h2>Build sequence</h2>
        <span class="head-tools"
          ><span class="small muted">{{ page.pct }}% complete</span> <EditStepsToggle
        /></span>
      </div>
      <div class="progress-track"><span :style="{ width: page.pct + '%' }"></span></div>
      <Checklist />
      <AddTaskForm placeholder="Add a task for this phase…" />
      <p class="small"><a href="#notes" data-phase-notes-link>Phase notes →</a></p>
    </section>
    <aside class="side-panels">
      <section class="panel">
        <h2>{{ page.post ? 'Post-game priority' : 'Elevator delivery' }}</h2>
        <template v-if="page.post"
          ><p>
            Protect the storage allowances. Reduce former elevator exports when the new completion
            factories need those resources. Sink the remaining surplus.
          </p>
          <a class="btn" href="#factories">Completion modules →</a></template
        >
        <template v-else
          ><DeliveryCounter v-for="d in page.deliveries" :key="d.id" :delivery="d"
        /></template>
      </section>
      <section class="panel accent">
        <h3>Keep the corrections together</h3>
        <p class="small">
          Resource conversion is included. The old coal and temporary fuel plants retire; 44.425 GW
          of turbofuel stays. Storage includes collectables Q/R and the workshop underneath.
        </p>
        <a class="btn quiet" href="#resources">Review the resource gate →</a>
      </section>
    </aside>
  </div>
</template>
