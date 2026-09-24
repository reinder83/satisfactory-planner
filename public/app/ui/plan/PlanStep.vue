<!--
  One step of the build-plan checklist. Its checkbox writes the step's saved checklist key
  (data-check, the shared handler in events/views.js, which the storage page's checklists
  use too). In edit mode it adds move, edit and remove tools. `step` is a row from
  Checklist.vue: the step as the user sees it, with its icon, link and checkmark.
-->
<script setup>
import { save } from '../../api.js';
import { phase, setEditingTask } from '../../session.js';
import { render } from '../../shell.js';
import { planTasks } from '../../tasks.js';
import StepIcon from './StepIcon.vue';

const props = defineProps({
  step: { type: Object, required: true },
  editing: { type: Boolean, default: false },
});

// ↑ / ↓: swap the step with its neighbour and save this phase's whole order (taskOrder).
// Nothing happens at either end of the list.
async function move(dir) {
  const ids = planTasks().map(t => t.id),
    i = ids.indexOf(props.step.id),
    j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  try {
    await save({ type: 'taskOrder', phase: phase(), ids });
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
      :aria-label="'Complete: ' + step.title"
      :checked="step.done"
    /><StepIcon :icon="step.icon" />
    <details :data-task="step.id">
      <summary>{{ step.title }}</summary>
      <p>{{ step.body || 'Your own task for this phase.' }}</p>
      <button
        v-if="step.link"
        class="btn quiet task-link"
        :data-factory="step.link.calc ? null : step.link.id"
        :data-calc-factory="step.link.calc ? step.link.id : null"
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
