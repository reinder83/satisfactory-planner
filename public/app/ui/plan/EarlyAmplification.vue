<!--
  A stored plan that amplifies production lines before the MAM's Production Amplifier research
  (#1056): machines take somersloops only once it is researched, from Phase 3 (AMPLIFIER_PHASE in
  public/somersloops.ts), and a plan calculated now places no amplified lines before that. One
  stored before keeps its numbers, those lines included: nothing recalculates it. This warning
  says so on the plan, factories and resources pages (CalcWarnings), whatever phase is shown, and
  offers Edit settings on step 2, where the amplification budget is; its Review recalculates in
  place only when the user presses "Recalculate in place". It draws nothing without a calculated
  profile or when no phase before the research has an amplified line.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { calculated, currentProfile, currentSave } from '../../session.ts';
import { startEdit } from '../../wizard/wizard.ts';
import { toast } from '../../api.ts';
import { legacy } from '../bridge.ts';
import { num } from '../../format.ts';
import { listNames } from '../../../wording.ts';
import { isAmplified } from '../../../progression.ts';
import { AMPLIFIER_PHASE, AMPLIFIER_RESEARCH } from '../../../somersloops.ts';

const notice = computed(() =>
  legacy(() => {
    if (!calculated) return null;
    const early = Object.entries(calculated.stages)
      .filter(([phase]) => Number(phase) < AMPLIFIER_PHASE)
      .map(([phase, stage]) => [phase, (stage?.rows || []).filter(isAmplified).length] as const)
      .filter(([, lines]) => lines > 0);
    if (!early.length) return null;
    const lines = early.reduce((total, [, count]) => total + count, 0);
    return {
      phases: `${early.length > 1 ? 'Phases' : 'Phase'} ${listNames(early.map(([phase]) => phase))}`,
      verb: early.length > 1 ? 'have' : 'has',
      lines: `${num(lines)} amplified line${lines > 1 ? 's' : ''}`,
    };
  }),
);

const toPreferences = () =>
  void startEdit(currentSave.id, currentProfile.id, 2).catch(error =>
    toast((error as Error).message, true),
  );
</script>

<template>
  <div v-if="notice" class="notice warn" data-amp-early>
    <b>Amplified before the research.</b> {{ notice.phases }} of this plan {{ notice.verb }}
    {{ notice.lines }}, but machines take somersloops only after the MAM research
    {{ AMPLIFIER_RESEARCH }}, whose SAM Fluctuators and Circuit Boards first come in Phase
    {{ AMPLIFIER_PHASE }}. The plan was calculated before amplification waited for that research, so
    it keeps its numbers. Recalculate it in place to plan those phases without amplification.
    <button type="button" class="btn quiet" data-amp-early-preferences @click="toPreferences">
      Recalculate in Edit settings →
    </button>
  </div>
</template>
