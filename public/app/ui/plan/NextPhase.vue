<!--
  On a calculated profile's build plan, once the phase's Space Elevator delivery is complete
  (#1062, deliveryHoursLeft in app/delivered.ts is 0): says the phase is delivered and offers the
  next one (#1069), "Go to Phase 3", or after Phase 5 "Go to Post Phase 5", which picks it the way
  the phase track does: saved, the search cleared and the page redrawn. Only on the saved working
  phase: a phase shown before it (opened earlier, or named by a route) leaves the way back to
  OpenedEarlierNotice. Nothing in Post Phase 5 (its finish card is on the page) or a
  milestone-only phase. It only reads the delivery counts: no tick is written.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { allowSwitch, save } from '../../api.ts';
import { deliveryHoursLeft } from '../../delivered.ts';
import {
  calcStage,
  milestoneOnly,
  phase,
  phaseLabel,
  setOpenedPhase,
  setQuery,
  stage,
  state,
} from '../../session.ts';
import { render } from '../../shell.ts';
import { legacy } from '../bridge.ts';
import { refocusOnOpenedPage } from '../refocus.ts';
import type { Phase } from '../../../types/index.ts';

const next = computed(() =>
  legacy(() => {
    const shown = phase();
    if (shown === 'post' || milestoneOnly() || state.settings.phase !== shown) return null;
    const stagePlan = calcStage();
    if (!stagePlan?.delivery || deliveryHoursLeft(stagePlan, stage(), state.deliveries) !== 0)
      return null;
    const target: Phase = shown === '5' ? 'post' : (String(Number(shown) + 1) as Phase);
    return {
      target,
      heading:
        shown === '5'
          ? 'Phase 5 delivered: Project Assembly is complete.'
          : `${phaseLabel(shown)} delivered.`,
      text:
        shown === '5'
          ? 'Post Phase 5 is not a sixth phase: it keeps these lines running for storage and teleporter supply.'
          : `Every Space Elevator part of this phase is handed in. ${phaseLabel(target)} starts from the lines marked running here.`,
      label: 'Go to ' + phaseLabel(target),
    };
  }),
);

// While the next phase is being saved the button is busy (#299), so a second press sends nothing.
const busy = ref(false);
async function goOn(event: Event) {
  const target = next.value?.target;
  if (busy.value || !target) return;
  const refocus = refocusOnOpenedPage(event.currentTarget);
  busy.value = true;
  try {
    if (!(await allowSwitch())) return;
    await save({ type: 'phase', value: target });
    setOpenedPhase(null);
    setQuery('');
    render();
    await refocus();
  } catch {
    // A failed write reports through the error toast; the page stays on this phase.
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="next" class="notice info" data-next-phase>
    <b>{{ next.heading }}</b> {{ next.text }}<br /><button
      type="button"
      class="btn"
      data-go-to-next-phase
      :aria-disabled="busy || undefined"
      @click="goOn"
    >
      {{ next.label }}
    </button>
  </div>
</template>
