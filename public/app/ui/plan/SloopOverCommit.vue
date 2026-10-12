<!--
  A stored plan that commits more somersloops than its settings have (#1059): its augmenters,
  hand-fed uses and amplification budget need more than "Somersloops available to spend". A plan
  calculated now cannot (settings() refuses it, public/somersloops.ts), but one stored before
  keeps its numbers, Phase 5's power from those augmenters included: nothing recalculates it or
  changes its settings. This warning says so on the plan, factories and resources pages
  (CalcWarnings), whatever phase is shown, and offers Edit settings on step 2, where the ledger
  shows the same count; its Review recalculates in place only when the user presses
  "Recalculate in place". It draws nothing without a calculated profile or when the plan fits.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { calculated, currentProfile, currentSave } from '../../session.ts';
import { startEdit } from '../../wizard/wizard.ts';
import { toast } from '../../api.ts';
import { legacy } from '../bridge.ts';
import { num } from '../../format.ts';
import { sloopCommitment, sloopOverWords } from '../../../somersloops.ts';

const notice = computed(() =>
  legacy(() => {
    if (!calculated) return null;
    const commitment = sloopCommitment(calculated.settings);
    if (!commitment.over) return null;
    return {
      words: sloopOverWords(commitment),
      augmenters: commitment.augmenters ? num(commitment.augmenters) : '',
      plural: commitment.augmenters > 1 ? 's' : '',
    };
  }),
);

const toPreferences = () =>
  void startEdit(currentSave.id, currentProfile.id, 2).catch(error =>
    toast((error as Error).message, true),
  );
</script>

<template>
  <div v-if="notice" class="notice warn" data-sloop-overcommit>
    <b>More somersloops than you have.</b> {{ notice.words }} The plan was calculated before plans
    were held to that budget, so it keeps its numbers<template v-if="notice.augmenters"
      >, Phase 5’s power from {{ notice.augmenters }} augmenter{{
        notice.plural
      }}
      included</template
    >. Recalculating it is refused until the somersloops it commits fit the ones available.
    <button type="button" class="btn quiet" data-sloop-preferences @click="toPreferences">
      Change somersloops in Edit settings →
    </button>
  </div>
</template>
