<!-- The sticky "Editing steps · Done editing" bar (ui/EditBar.vue, SP-13) while the build plan's
     steps are edited; Done does what EditStepsToggle's Done does, waiting while a step's edit
     form holds text not saved yet (finishStepEditing in ui/actions.ts, #969). -->
<script setup lang="ts">
import { computed } from 'vue';
import { planEditing } from '../../session.ts';
import { legacy } from '../bridge.ts';
import { finishStepEditing } from '../actions.ts';
import EditBar from '../EditBar.vue';

const editing = computed(() => legacy(() => planEditing));
</script>

<template>
  <EditBar
    v-if="editing"
    label="Editing steps"
    toggle="[data-toggle-plan-edit]"
    :done="finishStepEditing"
  />
</template>
