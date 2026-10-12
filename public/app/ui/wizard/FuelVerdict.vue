<!--
  Review: whether fueling the augmenters pays off, from stages[5].fuelVerdict, the calculator's
  side-by-side of Phase 5 with and without the Alien Power Matrix line. It exists only when
  some augmenters are fueled and Phase 5 fits; otherwise this draws nothing.

  It compares like with like (#1059): the power the fuel adds to Phase 5's grid (`gainMW`, the
  extra 20% per fueled augmenter on the base production) against the demand it adds (the fueled
  plan's need less the unfueled plan's), both Phase 5 power, and the headline follows that
  balance. The buildings (or, for maximum output, the hours) of both plans follow as their own
  sentence, since power the plan does not need still costs the fuel line's buildings. A
  verdict calculated before #1059 has no `gainMW`: what the boost raised the available power by
  stands in for it.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { power } from '../../wizard/fields.ts';
import { durationOfHours } from '../../../wording.ts';
import type { StoredCalculatedPlan } from '../../../types/index.ts';

const props = defineProps<{ plan: StoredCalculatedPlan }>();

const verdict = computed(() => {
  const fuelVerdict = props.plan.stages?.['5']?.fuelVerdict;
  if (!fuelVerdict) return null;
  const settings = props.plan.settings;
  const augmenters = settings.augmenters ?? 0,
    fueled = settings.fueledAugmenters ?? 0;
  const gain =
      fuelVerdict.gainMW ?? (fuelVerdict.availableMW ?? 0) - (fuelVerdict.availableMWUnfueled ?? 0),
    cost = fuelVerdict.requiredMW - (fuelVerdict.requiredMWUnfueled ?? 0),
    net = gain - cost;
  // Without an unfueled plan the count is compared with nothing (null counts as 0).
  const delta = fuelVerdict.buildings - (fuelVerdict.buildingsUnfueled ?? 0);
  const maximum = settings.goal === 'maximum';
  return {
    carrying: !fuelVerdict.unfueledFeasible,
    pays: net >= 0,
    // Fewer buildings fueled (or, for maximum output, sooner): the plan's own comparison.
    cheaper: fuelVerdict.worthIt,
    matrix: num(fuelVerdict.matrixRate),
    gain: power(gain),
    cost: power(cost),
    net: power(Math.abs(net)),
    // The multiplier without and with the fuel, as the ledger words it.
    from: Math.round(10 * augmenters),
    to: Math.round(10 * (augmenters - fueled) + 30 * fueled),
    maximum,
    before: num(fuelVerdict.buildingsUnfueled),
    after: num(fuelVerdict.buildings),
    delta: (delta > 0 ? '+' : delta < 0 ? '−' : '±') + num(Math.abs(delta)),
    fewer: num(Math.abs(delta)),
    hoursBefore: durationOfHours(fuelVerdict.hoursUnfueled ?? 0),
    hoursAfter: durationOfHours(fuelVerdict.hours),
    plural: augmenters > 1 ? 's' : '',
  };
});
</script>

<template>
  <template v-if="verdict">
    <div v-if="verdict.carrying" class="notice info" data-fuel-verdict="carrying">
      <b>Fueled augmenters are carrying this plan.</b> Phase 5 does not fit its budgets without
      them, so the {{ verdict.matrix }} Alien Power Matrix/min is doing real work.
    </div>
    <div
      v-else
      class="notice"
      :class="verdict.pays ? 'info' : 'warn'"
      :data-fuel-verdict="verdict.pays ? 'pays' : 'costs'"
    >
      <b>{{
        verdict.pays
          ? 'Fueling these augmenters returns more power than it costs.'
          : 'Fueling these augmenters costs more power than it returns.'
      }}</b>
      In Phase 5 the fuel raises the multiplier from {{ verdict.from }}% to {{ verdict.to }}%, which
      adds {{ verdict.gain }} to the grid, and producing its {{ verdict.matrix }} Alien Power
      Matrix/min adds {{ verdict.cost }} to the demand:
      {{ verdict.pays ? 'a net gain of' : 'a net loss of' }} {{ verdict.net }}.
      <template v-if="verdict.maximum"
        >Phase 5 takes {{ verdict.hoursAfter }} fueled against
        {{ verdict.hoursBefore }} unfueled.</template
      ><template v-else
        >Phase 5 has {{ verdict.after }} buildings fueled against {{ verdict.before }} unfueled ({{
          verdict.delta
        }}).</template
      >
      {{
        !verdict.pays
          ? `Build the augmenter${verdict.plural} unfueled, or put 4 somersloops in the Alien Power Matrix encoder — that halves the whole chain behind it and moves the break-even down.`
          : verdict.cheaper
            ? verdict.maximum
              ? 'The extra power lets Phase 5 finish sooner.'
              : `The extra power saves more generators than the fuel line costs, so the plan builds ${verdict.fewer} fewer buildings.`
            : verdict.maximum
              ? `It does not let Phase 5 finish sooner, so fuel the augmenter${verdict.plural} when you will use the extra power elsewhere.`
              : `The generators it saves are fewer than the fuel line's buildings, so here it adds buildings: fuel the augmenter${verdict.plural} when you will use the extra power elsewhere.`
      }}
    </div>
  </template>
</template>
