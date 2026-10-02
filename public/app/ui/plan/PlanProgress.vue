<!--
  The build plan's one progress indicator (SP-43, #278), under the "Build sequence" heading on
  both profile kinds: the phase checklist's bar with "2 of 9 done" beside it ("done", since the
  count beside the step search already reads "8 of 9 steps"). The steps are planTasks(), this
  profile's edits and personal tasks included, as the checklist lists them. A phase without steps
  draws an empty bar (#725), since a full one reads as a finished phase, and keeps a range of 0 to
  1, since a progress bar's maximum must be above its minimum.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { checked } from '../../session.ts';
import { planTasks } from '../../tasks.ts';
import { legacy } from '../bridge.ts';

const progress = computed(() =>
  legacy(() => {
    const tasks = planTasks(),
      done = tasks.filter(t => checked(t.id)).length;
    return {
      done,
      total: tasks.length,
      max: Math.max(tasks.length, 1),
      percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
      text: tasks.length ? done + ' of ' + tasks.length + ' steps done' : 'No steps in this phase',
    };
  }),
);
</script>

<template>
  <div class="plan-progress">
    <div
      class="progress-track"
      role="progressbar"
      aria-label="Phase checklist"
      aria-valuemin="0"
      :aria-valuemax="progress.max"
      :aria-valuenow="progress.done"
      :aria-valuetext="progress.text"
    >
      <span :style="{ width: progress.percent + '%' }"></span>
    </div>
    <span class="small muted" data-plan-progress aria-hidden="true"
      >{{ progress.done }} of {{ progress.total }} done</span
    >
  </div>
</template>
