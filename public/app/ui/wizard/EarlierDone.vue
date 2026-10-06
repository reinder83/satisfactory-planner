<!--
  Review, "What you already have" (#1068): for a profile made for Phase 2 or later, one box,
  "Everything before Phase N is done", which ticks every step the milestone-only phases before the
  start phase list (stepsBeforeStart in progression.ts: HUB milestones and MAM research, all
  unlock-<id> keys) when the profile is created, so a mid-game start does not open on a list of
  earlier steps. Off by default. The choice is the draft's `earlierDone`, set as the box changes
  (so a redraw keeps it), and createProfile sends the keys as the new profile's `built` work
  (earlierDoneKeys in wizard/wizard.ts); nothing new is stored. Draws nothing for a Phase 1 plan.
  The build plan offers the same later, on a milestone-only phase (ui/plan/MilestoneOnlyNotice.vue).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { draft, phaseLabel, progressionData } from '../../session.ts';
import { legacy } from '../bridge.ts';
import { earlierPhasesWords, milestoneOnlyPhases, stepsBeforeStart } from '../../../progression.ts';

const view = computed(() =>
  legacy(() => {
    const wizardDraft = draft(),
      plan = wizardDraft.preview;
    if (!plan) return null;
    const count = stepsBeforeStart(plan, { checks: {} }, progressionData).length;
    if (!count) return null;
    return {
      start: phaseLabel(String(plan.settings.phase)),
      earlier: earlierPhasesWords(milestoneOnlyPhases(plan)),
      steps: count === 1 ? '1 step' : `${count} steps`,
      on: !!wizardDraft.earlierDone,
    };
  }),
);

function choose(event: Event) {
  draft().earlierDone = (event.target as HTMLInputElement).checked;
}
</script>

<template>
  <section v-if="view" class="panel earlier-done" data-earlier-done-panel>
    <h3>What you already have</h3>
    <label class="check-row"
      ><input
        type="checkbox"
        name="earlierDone"
        data-earlier-done
        :checked="view.on"
        @change="choose"
      /><span
        ><b>Everything before {{ view.start }} is done</b><br /><small class="muted"
          >Ticks the {{ view.steps }} {{ view.earlier }} list: HUB milestones and MAM research. The
          plan then opens on {{ view.start }}. You can untick any of them later.</small
        ></span
      ></label
    >
  </section>
</template>
