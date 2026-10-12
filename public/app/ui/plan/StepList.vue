<!--
  A build-plan step's body as a list (#1136, StepList in step-table.ts): the short line above it,
  one line per item and the line after it, where a table does not fit, such as a production line's
  byproduct advice (one paragraph per byproduct or input). PlanStep.vue draws it in place of the
  step's text, which stays the step's `body` for search and copying.
-->
<script setup lang="ts">
import type { StepList } from '../../../step-table.ts';

defineProps<{ list: StepList }>();
</script>

<template>
  <div class="step-list" data-step-list>
    <p v-if="list.intro">{{ list.intro }}</p>
    <ul :aria-label="list.label">
      <li v-for="(item, index) in list.items" :key="index" data-step-list-item>{{ item }}</li>
    </ul>
    <p v-if="list.after" data-step-list-after>{{ list.after }}</p>
  </div>
</template>
