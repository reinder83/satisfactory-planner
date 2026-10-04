<!-- "Edit steps" / "Done editing" above the build plan's checklist. Either way it closes any
     step's edit form. View state only: nothing is saved. Done waits while a step's edit form
     holds text not saved yet (finishStepEditing in ui/actions.ts, #969). -->
<script setup lang="ts">
import { computed } from 'vue';
import { planEditing, setEditingTask, setPlanEditing } from '../../session.ts';
import { render } from '../../shell.ts';
import { legacy } from '../bridge.ts';
import { finishStepEditing } from '../actions.ts';

const editing = computed(() => legacy(() => planEditing));

function toggle() {
  if (planEditing) {
    finishStepEditing();
    return;
  }
  setPlanEditing(true);
  setEditingTask(null);
  render();
}
</script>

<template>
  <button :class="['btn', editing ? 'primary' : '']" data-toggle-plan-edit @click="toggle">
    {{ editing ? 'Done editing' : 'Edit steps' }}
  </button>
</template>
