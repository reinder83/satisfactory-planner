<!--
  The build plan's checklist for the current phase, on both profile kinds: the step search
  and "Hide completed" (view state only), the steps that pass them or a message saying why
  none do, and while editing the steps removed from this phase. The steps are planTasks():
  the generated ones with this profile's edits, plus its personal tasks. The step being
  edited shows its edit form instead.
-->
<script setup>
import { computed } from 'vue';
import {
  checked,
  editingTask,
  hideDone,
  planEditing,
  query,
  setHideDone,
  setQuery,
} from '../../session.js';
import { render } from '../../shell.js';
import {
  basePlanTasks,
  filteredPlanTasks,
  planTasks,
  taskEditsState,
  taskIcon,
  taskLink,
  taskLinkChoices,
} from '../../tasks.js';
import { legacy } from '../bridge.js';
import PlanStep from './PlanStep.vue';
import RemovedSteps from './RemovedSteps.vue';
import StepEditForm from './StepEditForm.vue';

const list = computed(() =>
  legacy(() => {
    const ts = planTasks(),
      shown = filteredPlanTasks(ts);
    const removed = new Set(taskEditsState().removed);
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
      steps: shown.map(t => ({
        id: t.id,
        title: t.title,
        body: t.body,
        done: checked(t.id),
        icon: taskIcon(t),
        link: taskLink(t),
        custom: t.id.startsWith('custom-'),
        form: planEditing && editingTask === t.id ? taskLinkChoices(t) : null,
      })),
      removed: planEditing
        ? basePlanTasks()
            .filter(t => removed.has(t.id))
            .map(t => ({ id: t.id, title: t.title, icon: taskIcon(t) }))
        : [],
    };
  }),
);

// The step search, as you type.
function search(e) {
  setQuery(e.target.value);
  render();
}

function toggleHideDone(e) {
  setHideDone(e.target.checked);
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
  <div class="checklist">
    <template v-if="list.steps.length">
      <template v-for="s in list.steps" :key="s.id">
        <StepEditForm v-if="s.form" :step="s" :options="s.form.options" :current="s.form.current" />
        <PlanStep v-else :step="s" :editing="list.editing" />
      </template>
    </template>
    <div v-else class="empty-state">{{ list.empty }}</div>
  </div>
  <RemovedSteps v-if="list.removed.length" :steps="list.removed" />
</template>
