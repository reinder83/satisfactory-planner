<!--
  At the top of a calculated profile's build plan, the handover from the phase before (#1069,
  phaseHandover in app/handover.ts): the lines kept running from that phase with the machines
  added and clocks changed on them, the other lines to build and the lines retired. Each kept
  line's step says what to add or change. Drawn from the profile's start phase + 1 on, while a
  line of the phase is not marked running yet; nothing in Post Phase 5, which works on Phase 5's
  steps, nor on a plan guide's or a milestone-only phase. It reads the saved ticks and ticks
  nothing.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { handoverText, phaseHandover } from '../../handover.ts';
import { calculated, phase, phaseLabel, state } from '../../session.ts';
import { legacy } from '../bridge.ts';

const handover = computed(() =>
  legacy(() => {
    if (!calculated) return null;
    const found = phaseHandover(calculated, state.checks, phase());
    return found ? { text: handoverText(found), phase: phaseLabel(phase()) } : null;
  }),
);
</script>

<template>
  <div v-if="handover" class="notice info" data-handover>
    <b>Handover.</b> {{ handover.text }} A kept line's step says what to add or change; tick it
    Running here once it matches {{ handover.phase }}.
  </div>
</template>
