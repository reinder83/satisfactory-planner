<!-- "Edit steps" above the build plan's checklist. It closes any step's edit form and starts
     the mode; View state only: nothing is saved. While the mode is on this button is gone: the
     one "Done editing" is the sticky bar's (PlanEditBar.vue, BP-9, #1340), which waits while a
     step's edit form holds text not saved yet (finishStepEditing in ui/actions.ts, #969). -->
<script setup lang="ts">
import { computed } from 'vue';
import { planEditing, setEditingTask, setPlanEditing } from '../../session.ts';
import { render } from '../../shell.ts';
import { legacy } from '../bridge.ts';

const editing = computed(() => legacy(() => planEditing));

function toggle() {
  setPlanEditing(true);
  setEditingTask(null);
  render();
}
</script>

<template>
  <button v-if="!editing" type="button" class="btn" data-toggle-plan-edit @click="toggle">
    Edit steps
  </button>
</template>
