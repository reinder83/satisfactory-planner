<!--
  The build plan's one progress indicator (SP-43, #278), under the "Build sequence" heading on
  both profile kinds: the phase checklist's bar with "2 of 9 done" beside it ("done", since the
  count beside the step search already reads "8 of 9 steps"). The steps are planTasks(), this
  profile's edits and personal tasks included, as the checklist lists them, a step done by its own
  condition counted done (stepDone, #1070). A phase without steps
  draws an empty bar (#725), since a full one reads as a finished phase, and keeps a range of 0 to
  1, since a progress bar's maximum must be above its minimum. A production line's step not ticked
  yet with some of its machines counted built (#1300, stepBuiltShare in views/calculated.ts) fills
  the bar by its share, and the bar's text says how many are partly built; the count beside it
  stays the steps done.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { planTasks, stepDone } from '../../tasks.ts';
import { stepBuiltShare } from '../../views/calculated.ts';
import { legacy } from '../bridge.ts';

const progress = computed(() =>
  legacy(() => {
    const tasks = planTasks(),
      done = tasks.filter(stepDone).length,
      shares = tasks.filter(task => !stepDone(task)).map(task => stepBuiltShare(task.id)),
      partly = shares.filter(share => share > 0).length,
      filled = done + shares.reduce((sum, share) => sum + share, 0);
    return {
      done,
      filled: Math.round(filled * 100) / 100,
      total: tasks.length,
      max: Math.max(tasks.length, 1),
      percent: tasks.length ? Math.round((filled / tasks.length) * 100) : 0,
      text: tasks.length
        ? done + ' of ' + tasks.length + ' steps done' + (partly ? `, ${partly} partly built` : '')
        : 'No steps in this phase',
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
      :aria-valuenow="progress.filled"
      :aria-valuetext="progress.text"
    >
      <span :style="{ width: progress.percent + '%' }"></span>
    </div>
    <span class="small muted" data-plan-progress aria-hidden="true"
      >{{ progress.done }} of {{ progress.total }} done in this phase</span
    >
  </div>
</template>
