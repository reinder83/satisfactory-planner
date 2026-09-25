<!-- A fixed checklist on the storage page (the build checklist, the workshop): each step's
     checkbox writes its saved key, drawn as a build-plan step without edit tools. `steps` are
     { id, title, body }. -->
<script setup>
import { computed } from 'vue';
import { checked } from '../../session.ts';
import { taskIcon } from '../../tasks.ts';
import { legacy } from '../bridge.ts';
import PlanStep from '../plan/PlanStep.vue';

const props = defineProps({ steps: { type: Array, required: true } });

const rows = computed(() =>
  legacy(() =>
    props.steps.map(t => ({ ...t, done: checked(t.id), icon: taskIcon(t), link: null })),
  ),
);
</script>

<template>
  <div class="checklist"><PlanStep v-for="s in rows" :key="s.id" :step="s" /></div>
</template>
