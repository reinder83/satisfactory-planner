<!--
  #plan for the original handbook: summary tiles, the phase checklist with its edit toggle,
  personal tasks and phase notes, and a side column with the next step and the Space
  Elevator deliveries. Post-game ('post') reads the Phase 5 stage of the handbook: stage()
  maps it to '5'. A calculated profile gets CalculatedPlanPage.vue instead. The notes'
  "Save notes" button uses saveNote in ui/actions.js.
-->
<script setup>
import { computed } from 'vue';
import { num } from '../../format.js';
import { checked, phase, phaseLabel, plan, stage, state } from '../../session.js';
import { planTasks } from '../../tasks.js';
import { storageBays } from '../../views/storage.js';
import { legacy } from '../bridge.js';
import PageHeader from '../PageHeader.vue';
import StatTile from '../StatTile.vue';
import AddTaskForm from '../plan/AddTaskForm.vue';
import Checklist from '../plan/Checklist.vue';
import DeliveryCounter from '../plan/DeliveryCounter.vue';
import EditStepsToggle from '../plan/EditStepsToggle.vue';
import { saveNote } from '../actions.js';

const page = computed(() =>
  legacy(() => {
    // Checklist progress: planTasks() already applies this profile's step edits.
    const ts = planTasks(),
      done = ts.filter(t => checked(t.id)).length,
      next = ts.find(t => !checked(t.id));
    // Factory and storage counters. The check keys are saved progress and must not change:
    // `factory-<stage>-<id>` is a factory's Running box, `slot-<address>-verified` the last
    // of a container's four checks (see slotKeys in views/storage.js).
    const fs = plan.factories.filter(f => f.stages[stage()]);
    const slots = storageBays()
      .flatMap(b => b.items)
      .filter(x => x.name);
    return {
      phase: phase(),
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
      next: next && { title: next.title, body: next.body },
      note: state.notes['phase-' + phase()] || '',
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
      <section class="panel">
        <h2>Phase notes</h2>
        <p class="small muted">Locations, train routes, things to check on your next session.</p>
        <textarea
          id="phase-note"
          class="notes"
          maxlength="6000"
          aria-label="Phase notes"
          :value="page.note"
        ></textarea>
        <div class="note-save">
          <span class="small muted">Saved only when you click Save notes.</span
          ><button
            class="btn"
            :data-save-note="'phase-' + page.phase"
            @click="saveNote"
            data-input="phase-note"
          >
            Save notes
          </button>
        </div>
      </section>
    </section>
    <aside class="side-panels">
      <section class="panel next-card">
        <div class="step-no">
          {{ page.next ? 'NEXT UNFINISHED STEP' : 'PHASE CHECKLIST COMPLETE' }}
        </div>
        <h2>{{ page.next?.title || 'Ready for the next phase' }}</h2>
        <p>
          {{
            page.next?.body ||
            'Verify the delivery, then choose your next phase using the selector above.'
          }}
        </p>
        <a class="btn primary full" href="#factories">Open factory targets →</a>
      </section>
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
