<!--
  One step of the build-plan checklist. Its checkbox writes the step's saved checklist key
  (toggleCheck in ui/actions.ts, which the storage page's checklists use too); its
  "Open factory" link is a factoryLink(). In edit mode it adds move, edit and remove tools. `step` is a row from
  Checklist.vue: the step as the user sees it, with its icon, link and checkmark.
-->
<script setup lang="ts">
import { save } from '../../api.ts';
import { phase, setEditingTask } from '../../session.ts';
import { render } from '../../shell.ts';
import { filteredPlanTasks, planTasks, taskOrderSlots } from '../../tasks.ts';
import StepIcon from './StepIcon.vue';
import { factoryLink, toggleCheck } from '../actions.ts';
import type { PlanStepView } from '../../tasks.ts';

const props = withDefaults(defineProps<{ step: PlanStepView; editing?: boolean }>(), {
  editing: false,
});

// ↑ / ↓: move the step past its neighbour on screen and save this phase's whole order
// (taskOrder). Steps hidden by "Hide completed" or the search keep their places, so a step
// never trades places with one the user cannot see. Nothing happens at either end of the
// visible list. Removed steps and saved places of steps not in the plan now keep their slots
// (taskOrderSlots), so restoring a step puts it back where it was.
async function move(dir: number) {
  const ts = planTasks(),
    ids = ts.map(t => t.id),
    shown = filteredPlanTasks(ts).map(t => t.id),
    past = shown[shown.indexOf(props.step.id) + dir];
  if (!shown.includes(props.step.id) || !past) return;
  ids.splice(ids.indexOf(props.step.id), 1);
  ids.splice(ids.indexOf(past) + (dir > 0 ? 1 : 0), 0, props.step.id);
  const listed = new Set(ids);
  let next = 0;
  const order = taskOrderSlots().map(id => (listed.has(id) ? ids[next++]! : id));
  try {
    await save({ type: 'taskOrder', phase: phase(), ids: order });
    render();
  } catch {}
}

// "Edit": swap the step for its edit form (StepEditForm.vue).
function edit() {
  setEditingTask(props.step.id);
  render();
}

// "Remove", after a confirmation. A personal task (id custom-…) is deleted; a plan step is
// only hidden (taskRemove) and keeps its checkmark, so it can be put back from "Removed
// steps in this phase".
async function remove() {
  const id = props.step.id;
  if (id.startsWith('custom-')) return deletePersonal();
  if (
    !confirm(
      'Remove this step from your build plan? Its checkmark is kept and you can restore the step while editing.',
    )
  )
    return;
  try {
    await save({ type: 'taskRemove', id });
    render();
  } catch {}
}

// "Delete personal task" (inside a personal task's details outside edit mode, or Remove on
// one while editing), after a confirmation.
async function deletePersonal() {
  if (!confirm('Delete this personal task?')) return;
  try {
    await save({ type: 'removeTask', id: props.step.id });
    render();
  } catch {}
}
</script>

<template>
  <article :class="['task', editing ? 'is-editing' : '']">
    <input
      type="checkbox"
      :data-check="step.id"
      @change="toggleCheck"
      :aria-label="'Complete: ' + step.title"
      :checked="step.done"
    /><StepIcon :icon="step.icon" />
    <details :data-task="step.id">
      <summary>{{ step.title }}</summary>
      <p>{{ step.body || 'Your own task for this phase.' }}</p>
      <button
        v-if="step.link"
        class="btn quiet task-link"
        v-bind="
          factoryLink(step.link.calc ? { calcFactory: step.link.id } : { factory: step.link.id })
        "
      >
        Open factory: {{ step.link.name }} ↗</button
      ><button
        v-if="step.custom && !editing"
        class="delete-task"
        :data-remove="step.id"
        @click="deletePersonal"
      >
        Delete personal task
      </button>
    </details>
    <span v-if="editing" class="task-tools"
      ><button
        class="btn quiet"
        :data-move-task="step.id"
        data-dir="-1"
        :aria-label="'Move up: ' + step.title"
        @click="move(-1)"
      >
        ↑</button
      ><button
        class="btn quiet"
        :data-move-task="step.id"
        data-dir="1"
        :aria-label="'Move down: ' + step.title"
        @click="move(1)"
      >
        ↓</button
      ><button class="btn quiet" :data-edit-task="step.id" @click="edit">Edit</button
      ><button class="btn quiet danger" :data-remove-step="step.id" @click="remove">
        Remove
      </button></span
    >
  </article>
</template>
