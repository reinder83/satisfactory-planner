<!-- "Removed steps in this phase", shown while editing the build plan, with a Restore button
     per step. Removed steps keep their checklist key and checkmark, so restoring loses
     nothing. `steps` are { id, title, icon }. -->
<script setup lang="ts">
import { save } from '../../api.ts';
import { render } from '../../shell.ts';
import { refocusAfterRemoval } from '../refocus.ts';
import StepIcon from './StepIcon.vue';
import type { RemovedStepView } from '../../tasks.ts';

defineProps<{ steps: RemovedStepView[] }>();

// "Restore": the step goes back into the checklist and its Restore leaves this list, so focus goes
// to the next removed step's Restore, else the previous one's, and once none is left to the
// restored step's Remove in the checklist, else the personal task field (ui/refocus.ts, #290).
async function restore(event: Event, id: string) {
  const refocus = refocusAfterRemoval(event.currentTarget, {
    row: '#main .removed-steps .removed-step',
    control: '[data-restore-task]',
    fallback: [`#main .checklist [data-remove-step="${CSS.escape(id)}"]`, '#add-task [name=title]'],
  });
  try {
    await save({ type: 'taskRestore', id });
    render();
    await refocus();
  } catch {}
}
</script>

<template>
  <details class="panel removed-steps">
    <summary>Removed steps in this phase ({{ steps.length }})</summary>
    <div v-for="step in steps" :key="step.id" class="removed-step">
      <span><StepIcon :icon="step.icon" />{{ step.title }}</span
      ><button class="btn quiet" :data-restore-task="step.id" @click="restore($event, step.id)">
        Restore
      </button>
    </div>
  </details>
</template>
