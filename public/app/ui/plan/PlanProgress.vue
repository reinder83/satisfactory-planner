<!--
  The build plan's one progress indicator (SP-43, #278), under the "Build sequence" heading on
  both profile kinds: the phase checklist's bar with "2 of 9 done" beside it ("done", since the
  count beside the step search already reads "8 of 9 steps"). The steps are planTasks(), this
  profile's edits and personal tasks included, as the checklist lists them.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { checked } from '../../session.ts';
import { planTasks } from '../../tasks.ts';
import { legacy } from '../bridge.ts';

const progress = computed(() =>
  legacy(() => {
    const ts = planTasks(),
      done = ts.filter(t => checked(t.id)).length;
    return {
      done,
      total: ts.length,
      pct: ts.length ? Math.round((done / ts.length) * 100) : 100,
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
      :aria-valuemax="progress.total"
      :aria-valuenow="progress.done"
      :aria-valuetext="progress.done + ' of ' + progress.total + ' steps done'"
    >
      <span :style="{ width: progress.pct + '%' }"></span>
    </div>
    <span class="small muted" data-plan-progress aria-hidden="true"
      >{{ progress.done }} of {{ progress.total }} done</span
    >
  </div>
</template>
