<!-- "Removed steps in this phase", shown while editing the build plan, with a Restore button
     per step. Removed steps keep their checklist key and checkmark, so restoring loses
     nothing. `steps` are { id, title, icon }. -->
<script setup>
import { save } from '../../api.js';
import { render } from '../../shell.js';
import StepIcon from './StepIcon.vue';

defineProps({ steps: { type: Array, required: true } });

async function restore(id) {
  try {
    await save({ type: 'taskRestore', id });
    render();
  } catch {}
}
</script>

<template>
  <details class="panel removed-steps">
    <summary>Removed steps in this phase ({{ steps.length }})</summary>
    <div v-for="s in steps" :key="s.id" class="removed-step">
      <span><StepIcon :icon="s.icon" />{{ s.title }}</span
      ><button class="btn quiet" :data-restore-task="s.id" @click="restore(s.id)">Restore</button>
    </div>
  </details>
</template>
