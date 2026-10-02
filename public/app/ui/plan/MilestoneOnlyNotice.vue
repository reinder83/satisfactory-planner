<!--
  On a calculated profile's build plan, factories and resources pages while a milestone-only phase
  is shown (#759, milestoneOnly() in session.ts): a phase before the profile's start phase, which
  lists only the milestones that belong there. Says so, and where production starts, so an empty
  factories or resources page is not taken for a missing plan. Draws nothing in any other phase.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { milestoneOnly, phase, phaseLabel, startPhase } from '../../session.ts';
import { legacy } from '../bridge.ts';

const notice = computed(() =>
  legacy(() =>
    milestoneOnly() ? { shown: phaseLabel(phase()), start: phaseLabel(startPhase()) } : null,
  ),
);
</script>

<template>
  <div v-if="notice" class="notice info" data-milestone-only>
    This profile plans production from {{ notice.start }} on. {{ notice.shown }} lists only the HUB
    milestones and MAM research that belong to it: no production lines, storage or power to build
    here.
  </div>
</template>
