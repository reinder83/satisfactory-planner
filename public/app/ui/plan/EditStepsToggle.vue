<!-- "Edit steps" / "Done editing" above the build plan's checklist. Either way it closes any
     step's edit form. View state only: nothing is saved. -->
<script setup lang="ts">
import { computed } from 'vue';
import { planEditing, setEditingTask, setPlanEditing } from '../../session.ts';
import { render } from '../../shell.ts';
import { legacy } from '../bridge.ts';

const editing = computed(() => legacy(() => planEditing));

function toggle() {
  setPlanEditing(!planEditing);
  setEditingTask(null);
  render();
}
</script>

<template>
  <button :class="['btn', editing ? 'primary' : '']" data-toggle-plan-edit @click="toggle">
    {{ editing ? 'Done editing' : 'Edit steps' }}
  </button>
</template>
