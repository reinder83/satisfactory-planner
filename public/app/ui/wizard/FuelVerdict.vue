<!--
  Review: whether fueling the augmenters pays off, from stages[5].fuelVerdict, the calculator's
  side-by-side of Phase 5 with and without the Alien Power Matrix line. It exists only when
  some augmenters are fueled and Phase 5 fits; otherwise this draws nothing. The answer
  depends on the plan's own scale, so it shows the like-for-like comparison rather than a rule
  of thumb.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { power } from '../../wizard/fields.ts';
import type { StoredCalculatedPlan } from '../../../types/index.ts';

const props = defineProps<{ plan: StoredCalculatedPlan }>();

const verdict = computed(() => {
  const fuelVerdict = props.plan.stages?.['5']?.fuelVerdict;
  if (!fuelVerdict) return null;
  // Without an unfueled plan the count is compared with nothing (null counts as 0).
  const delta = fuelVerdict.buildings - (fuelVerdict.buildingsUnfueled ?? 0);
  return {
    carrying: !fuelVerdict.unfueledFeasible,
    worth: fuelVerdict.worthIt,
    matrix: num(fuelVerdict.matrixRate),
    before: num(fuelVerdict.buildingsUnfueled),
    after: num(fuelVerdict.buildings),
    delta: (delta > 0 ? '+' : '') + num(delta),
    demandBefore: power(fuelVerdict.requiredMWUnfueled),
    demandAfter: power(fuelVerdict.requiredMW),
    availableBefore: power(fuelVerdict.availableMWUnfueled),
    availableAfter: power(fuelVerdict.availableMW),
    plural: (props.plan.settings.augmenters ?? 0) > 1 ? 's' : '',
  };
});
</script>

<template>
  <template v-if="verdict">
    <div v-if="verdict.carrying" class="notice info">
      <b>Fueled augmenters are carrying this plan.</b> Phase 5 does not fit its budgets without
      them, so the {{ verdict.matrix }} Alien Power Matrix/min is doing real work.
    </div>
    <div v-else class="notice" :class="verdict.worth ? 'info' : 'warn'">
      <b>{{
        verdict.worth
          ? 'Fueling these augmenters pays off.'
          : 'Fueling these augmenters costs more than it returns.'
      }}</b>
      Producing {{ verdict.matrix }} Alien Power Matrix/min takes Phase 5 from
      {{ verdict.before }} buildings to {{ verdict.after }} ({{ verdict.delta }}) and from
      {{ verdict.demandBefore }} to {{ verdict.demandAfter }} of demand, while the boost raises
      available power from {{ verdict.availableBefore }} to {{ verdict.availableAfter }}.
      {{
        verdict.worth
          ? 'The extra 20% is worth more than the fuel line costs at this scale.'
          : `At this scale the fuel line costs more than the extra 20% returns. Build the augmenter${verdict.plural} unfueled, or put 4 somersloops in the Alien Power Matrix encoder — that halves the whole chain behind it and moves the break-even down.`
      }}
    </div>
  </template>
</template>
