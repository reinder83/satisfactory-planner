<!--
  Over a calculated profile's build plan, the production lines you built that the plan of the
  phase shown no longer has and nothing in it takes over (#1175, formerLines in
  views/calculated.ts, phaseChanges in app/built-lines.ts): what each was and its machines, as a
  table in #1136's style, and that they can be dismantled or kept. A carry kept their machines in
  `builtMachines` rather than dropping them; this only reads that and changes nothing. Post Phase
  5 shows Phase 5's.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { formerTable } from '../../built-lines.ts';
import { calculated, phase, phaseLabel } from '../../session.ts';
import { formerLines } from '../../views/calculated.ts';
import { legacy } from '../bridge.ts';
import StepTable from './StepTable.vue';

const former = computed(() =>
  legacy(() => {
    if (!calculated) return null;
    const lines = formerLines();
    const shown = phase() === 'post' ? '5' : phase();
    return lines.length ? formerTable(lines, phaseLabel(shown)) : null;
  }),
);
</script>

<template>
  <div v-if="former" class="notice info" data-former-lines>
    <b>No longer needed.</b>
    <StepTable :table="former" />
  </div>
</template>
