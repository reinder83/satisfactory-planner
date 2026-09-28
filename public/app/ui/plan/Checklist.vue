<!--
  The build plan's checklist for the current phase, on both profile kinds: the step search
  and "Hide completed" (view state only), the steps that pass them or a message saying why
  none do, and while editing the steps removed from this phase. The steps are planTasks():
  the generated ones with this profile's edits, plus its personal tasks. The step being
  edited shows its edit form instead.

  Outside edit mode (SP-42, #277) the first unfinished step leads the list, unfolded, with
  Mark done and its Open factory. The other unfinished steps follow in order, and completed
  ones fold into "Done (n)" under the list, so ticking the lead step promotes the next one.
  With every step done, a line says the phase checklist is complete. While editing, the list
  stays flat in the plan's order, since ↑ / ↓ move a step past its neighbour on screen.
-->
<script setup lang="ts">
import { computed } from 'vue';
import {
  checked,
  editingTask,
  hideDone,
  planEditing,
  query,
  setHideDone,
  setQuery,
} from '../../session.ts';
import { render } from '../../shell.ts';
import {
  basePlanTasks,
  filteredPlanTasks,
  planTasks,
  taskEditsState,
  taskIcon,
  taskLink,
  taskLinkChoices,
} from '../../tasks.ts';
import { legacy } from '../bridge.ts';
import PlanStep from './PlanStep.vue';
import RemovedSteps from './RemovedSteps.vue';
import StepEditForm from './StepEditForm.vue';
import type { PlanStepView, RemovedStepView } from '../../tasks.ts';

const list = computed(() =>
  legacy(() => {
    const ts = planTasks(),
      shown = filteredPlanTasks(ts);
    const removed = new Set(taskEditsState().removed);
    const steps = shown.map(
      (t): PlanStepView => ({
        id: t.id,
        title: t.title,
        body: t.body,
        done: checked(t.id),
        icon: taskIcon(t),
        link: taskLink(t),
        custom: t.id.startsWith('custom-'),
        form: planEditing && editingTask === t.id ? taskLinkChoices(t) : null,
      }),
    );
    return {
      total: ts.length,
      query,
      hideDone,
      editing: planEditing,
      count: shown.length !== ts.length ? shown.length + ' of ' + ts.length + ' steps' : '',
      empty: !ts.length
        ? 'Every step of this phase is removed. Use Removed steps below to restore them.'
        : query.trim()
          ? 'No steps match this search.'
          : 'Every step of this phase is completed. Untick “Hide completed” to review them.',
      steps,
      // Outside edit mode: the unfinished steps (the first leads) and the completed ones.
      open: steps.filter(s => !s.done),
      done: steps.filter(s => s.done),
      // Every step of the phase is ticked (not only the ones the search shows).
      complete: ts.length > 0 && ts.every(t => checked(t.id)),
      removed: planEditing
        ? basePlanTasks()
            .filter(t => removed.has(t.id))
            .map((t): RemovedStepView => ({ id: t.id, title: t.title, icon: taskIcon(t) }))
        : [],
    };
  }),
);

// The step search, as you type.
function search(e: Event) {
  setQuery((e.target as HTMLInputElement).value);
  render();
}

function toggleHideDone(e: Event) {
  setHideDone((e.target as HTMLInputElement).checked);
  render();
}
</script>

<template>
  <div v-if="list.total > 0" class="checklist-tools">
    <input
      id="plan-search"
      class="search"
      placeholder="Find a step…"
      aria-label="Find a step"
      :value="list.query"
      @input="search"
    /><label class="check-row small"
      ><input
        type="checkbox"
        id="hide-done"
        :checked="list.hideDone"
        @change="toggleHideDone"
      />Hide completed</label
    ><span class="small muted">{{ list.count }}</span>
  </div>
  <div v-if="list.editing" class="checklist">
    <template v-if="list.steps.length">
      <template v-for="s in list.steps" :key="s.id">
        <StepEditForm v-if="s.form" :step="s" :options="s.form.options" :current="s.form.current" />
        <PlanStep v-else :step="s" :editing="list.editing" />
      </template>
    </template>
    <div v-else class="empty-state">{{ list.empty }}</div>
  </div>
  <template v-else>
    <div v-if="list.open.length" class="checklist" data-open-steps>
      <PlanStep v-for="(s, i) in list.open" :key="s.id" :step="s" :lead="i === 0" />
    </div>
    <div v-else-if="list.complete && !list.query.trim()" class="checklist">
      <div class="task lead is-complete" data-phase-complete>
        <div class="step-no">Phase checklist complete</div>
        <div class="lead-done">
          <b>Ready for the next phase</b>
          <p>Verify the delivery, then choose your next phase using the selector above.</p>
          <p v-if="list.hideDone">Untick “Hide completed” to review the steps.</p>
        </div>
      </div>
    </div>
    <div v-else-if="!list.done.length" class="checklist">
      <div class="empty-state">{{ list.empty }}</div>
    </div>
    <details v-if="list.done.length" class="done-group">
      <summary>Done ({{ list.done.length }})</summary>
      <div class="checklist">
        <PlanStep v-for="s in list.done" :key="s.id" :step="s" />
      </div>
    </details>
  </template>
  <RemovedSteps v-if="list.removed.length" :steps="list.removed" />
</template>
