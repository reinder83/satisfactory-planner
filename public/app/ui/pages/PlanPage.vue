<!--
  #plan for the original handbook: a summary line (factories, storage, power, each linking to its
  page; SP-43), the phase checklist with its progress bar and edit toggle,
  personal tasks and a link to the phase notes (on the Notes page, #243), and a side column
  with the Space Elevator deliveries. The next step leads the checklist itself (SP-42). Post-game ('post') reads the Phase 5
  stage of the handbook: stage() maps it to '5'. A calculated profile gets
  CalculatedPlanPage.vue instead.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { checked, phase, phaseLabel, plan, stage } from '../../session.ts';
import { storageBays } from '../../views/storage.ts';
import { legacy } from '../bridge.ts';
import PageHeader from '../PageHeader.vue';
import AddTaskForm from '../plan/AddTaskForm.vue';
import Checklist from '../plan/Checklist.vue';
import DeliveryCounter from '../plan/DeliveryCounter.vue';
import EditStepsToggle from '../plan/EditStepsToggle.vue';
import PlanEditBar from '../plan/PlanEditBar.vue';
import PlanProgress from '../plan/PlanProgress.vue';
import PlanSummary from '../plan/PlanSummary.vue';

const page = computed(() =>
  legacy(() => {
    // Factory and storage counters. The check keys are saved progress and must not change:
    // `factory-<stage>-<id>` is a factory's Running box, `slot-<address>-verified` the last
    // of a container's four checks (see slotKeys in views/storage.ts).
    const factories = plan.factories.filter(f => f.stages[stage()]);
    const slots = storageBays()
      .flatMap(b => b.items)
      .filter(slot => slot.name);
    const built = factories.filter(f => checked('factory-' + stage() + '-' + f.id)).length,
      ready = slots.filter(slot => checked('slot-' + slot.id + '-verified')).length;
    return {
      title: phaseLabel(phase()) + ' field plan',
      post: phase() === 'post',
      summary: [
        {
          key: 'factories',
          href: '#factories',
          text: `${built} of ${factories.length} factories running`,
        },
        {
          key: 'storage',
          href: '#storage',
          text: `${ready} of ${slots.length} storage positions verified`,
        },
        { key: 'power', href: '#resources', text: `${num(plan.power[stage()])} GW planned power` },
      ],
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
  <PlanSummary :items="page.summary" />
  <div class="split">
    <section>
      <div class="section-head">
        <h2>Build sequence</h2>
        <EditStepsToggle />
      </div>
      <PlanProgress />
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
          ><DeliveryCounter
            v-for="delivery in page.deliveries"
            :key="delivery.id"
            :delivery="delivery"
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
