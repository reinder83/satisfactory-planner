<!-- The sticky "Editing steps · Done editing" bar (ui/EditBar.vue, SP-13) while the build plan's
     steps are edited; Done does what EditStepsToggle's Done does. -->
<script setup lang="ts">
import { computed } from 'vue';
import { planEditing, setEditingTask, setPlanEditing } from '../../session.ts';
import { render } from '../../shell.ts';
import { legacy } from '../bridge.ts';
import EditBar from '../EditBar.vue';

const editing = computed(() => legacy(() => planEditing));

function done() {
  setPlanEditing(false);
  setEditingTask(null);
  render();
}
</script>

<template>
  <EditBar v-if="editing" label="Editing steps" toggle="[data-toggle-plan-edit]" :done="done" />
</template>
