<!-- "Removed steps in this phase", shown while editing the build plan, with a Restore button
     per step. Removed steps keep their checklist key and checkmark, so restoring loses
     nothing. `steps` are { id, title, icon }. -->
<script setup lang="ts">
import { save } from '../../api.ts';
import { render } from '../../shell.ts';
import StepIcon from './StepIcon.vue';
import type { RemovedStepView } from '../../tasks.ts';

defineProps<{ steps: RemovedStepView[] }>();

async function restore(id: string) {
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
