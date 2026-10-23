<!--
  The notices above a calculated profile's plan, factories and resources pages for the current
  phase: the infeasible-draft warning with what runs out and the options (DraftAdvice.vue,
  #1222), and the power the phase still needs with what that phase can build for it
  (headroomAdvice, #331), from the one power model every page reads (powerView in
  public/power.ts, #1064). A plan made
  before #1064 keeps its own wording: extra headroom for whole buildings. Then a stored plan that
  commits more somersloops than it has (SloopOverCommit, #1059), and one that amplifies lines
  before the Production Amplifier research (EarlyAmplification, #1056). It draws nothing without a
  calculated profile.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { calcStage, calculated, phase, stage, workspace } from '../../session.ts';
import { draftHeading, headroomAdvice } from '../../views/calculated.ts';
import { draftAdvice } from '../../draft-advice.ts';
import { power } from '../../wizard/fields.ts';
import { powerView } from '../../../power.ts';
import { legacy } from '../bridge.ts';
import SloopOverCommit from './SloopOverCommit.vue';
import EarlyAmplification from './EarlyAmplification.vue';
import DraftAdvice from './DraftAdvice.vue';

const notices = computed(() =>
  legacy(() => {
    const stageResult = calcStage();
    if (!stageResult) return { draft: null, headroom: '', modelled: false, advice: '' };
    const view = powerView(stageResult, calculated?.settings ?? { availablePowerGW: 0 });
    return {
      draft: !stageResult.feasible && {
        heading: draftHeading(stageResult),
        reason: stageResult.reason,
        advice: draftAdvice(stageResult, calculated?.settings, {
          phase: Number(stage()),
          alternates: workspace?.catalog?.alternates,
        }),
      },
      headroom: view.shortMW > 0 ? power(view.shortMW) : '',
      modelled: view.modelled,
      advice: headroomAdvice(stageResult, phase()),
    };
  }),
);
</script>

<template>
  <div v-if="notices.draft" class="notice warn" data-draft>
    <b>{{ notices.draft.heading }}</b>
    {{ notices.draft.reason }}<DraftAdvice :advice="notices.draft.advice" actions />
  </div>
  <div v-if="notices.headroom" class="notice warn" data-power-short>
    <template v-if="notices.modelled"
      >This phase needs another {{ notices.headroom }} of power.</template
    ><template v-else
      >Allow another {{ notices.headroom }} for whole-building power headroom.</template
    >
    {{ notices.advice }}
  </div>
  <SloopOverCommit />
  <EarlyAmplification />
</template>
