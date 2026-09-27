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

const v = computed(() => {
  const x = props.plan.stages?.['5']?.fuelVerdict;
  if (!x) return null;
  // Without an unfueled plan the count is compared with nothing (null counts as 0).
  const delta = x.buildings - (x.buildingsUnfueled ?? 0);
  return {
    carrying: !x.unfueledFeasible,
    worth: x.worthIt,
    matrix: num(x.matrixRate),
    before: num(x.buildingsUnfueled),
    after: num(x.buildings),
    delta: (delta > 0 ? '+' : '') + num(delta),
    demandBefore: power(x.requiredMWUnfueled),
    demandAfter: power(x.requiredMW),
    availableBefore: power(x.availableMWUnfueled),
    availableAfter: power(x.availableMW),
    plural: (props.plan.settings.augmenters ?? 0) > 1 ? 's' : '',
  };
});
</script>

<template>
  <template v-if="v">
    <div v-if="v.carrying" class="notice info">
      <b>Fueled augmenters are carrying this plan.</b> Phase 5 does not fit its budgets without
      them, so the {{ v.matrix }} Alien Power Matrix/min is doing real work.
    </div>
    <div v-else class="notice" :class="v.worth ? 'info' : 'warn'">
      <b>{{
        v.worth
          ? 'Fueling these augmenters pays off.'
          : 'Fueling these augmenters costs more than it returns.'
      }}</b>
      Producing {{ v.matrix }} Alien Power Matrix/min takes Phase 5 from {{ v.before }} buildings to
      {{ v.after }} ({{ v.delta }}) and from {{ v.demandBefore }} to {{ v.demandAfter }} of demand,
      while the boost raises available power from {{ v.availableBefore }} to {{ v.availableAfter }}.
      {{
        v.worth
          ? 'The extra 20% is worth more than the fuel line costs at this scale.'
          : `At this scale the fuel line costs more than the extra 20% returns. Build the augmenter${v.plural} unfueled, or put 4 somersloops in the Alien Power Matrix encoder — that halves the whole chain behind it and moves the break-even down.`
      }}
    </div>
  </template>
</template>
