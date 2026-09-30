<!-- A fixed checklist on the storage page (the build checklist, the workshop): each step's
     checkbox writes its saved key, drawn as a build-plan step without edit tools. `steps` are
     { id, title, body }. -->
<script setup lang="ts">
import { computed } from 'vue';
import { checked } from '../../session.ts';
import { taskIcon } from '../../tasks.ts';
import { legacy } from '../bridge.ts';
import PlanStep from '../plan/PlanStep.vue';
import type { PlanStepView, Step } from '../../tasks.ts';

const props = defineProps<{ steps: Step[] }>();

const rows = computed(() =>
  legacy(() =>
    props.steps.map(
      (task): PlanStepView => ({
        ...task,
        done: checked(task.id),
        icon: taskIcon(task),
        link: null,
      }),
    ),
  ),
);
</script>

<template>
  <div class="checklist"><PlanStep v-for="step in rows" :key="step.id" :step="step" /></div>
</template>
