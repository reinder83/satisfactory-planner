<!--
  Review: what the plan drew from the production you already run. For each declared item, the
  largest rate any phase from the current one onward drew (it asks for at most what you
  declared), and the phases that could not keep the credit (stage.supplyDropped). Nothing
  when nothing is declared, as for a plan saved before existing production was asked.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import ItemIcon from '../ItemIcon.vue';
import type { ItemRates, StoredCalculatedPlan, StoredStage } from '../../../types/index.ts';

const props = defineProps<{ plan: StoredCalculatedPlan }>();

const view = computed(() => {
  const plan = props.plan,
    declared = plan.settings?.existingSupply || {};
  if (!Object.keys(declared).length) return null;
  const start = Number(plan.settings.phase || 1);
  const used: ItemRates = {};
  for (const [phase, stageResult] of Object.entries(plan.stages) as [string, StoredStage][])
    if (Number(phase) >= start)
      for (const [item, rate] of Object.entries(stageResult.supplied || {}))
        used[item] = Math.max(used[item] || 0, rate);
  return {
    lines: Object.entries(declared).map(([item, rate]) => ({
      name: item,
      rate: num(rate),
      drawn: (used[item] || 0) > 0.002 ? num(used[item]) : '',
    })),
    dropped: (Object.entries(plan.stages) as [string, StoredStage][])
      .filter(([phase, stageResult]) => stageResult.supplyDropped && Number(phase) >= start)
      .map(([phase]) => phase),
  };
});
</script>

<template>
  <div v-if="view" class="notice info supply-notice">
    <b>Crediting production you already run.</b> These lines are not planned again, and neither is
    the chain behind them.
    <ul class="supply-summary">
      <li v-for="line in view.lines" :key="line.name">
        <ItemIcon :name="line.name" /><span
          ><b>{{ line.name }}</b> {{ line.rate }}/min declared{{
            line.drawn
              ? ` · the plan draws up to ${line.drawn}/min of it, and builds no line for it`
              : ' · this plan has no use for it, so nothing changes'
          }}</span
        >
      </li>
    </ul>
    <p class="small">
      Their ore and their power are already spent in your world, so the resource budgets and the
      spare-power figure should be entered net of them — the same rule that makes "spare existing
      power" spare.
    </p>
    <p v-if="view.dropped.length" class="small">
      <b>{{ view.dropped.length > 1 ? 'Phases' : 'Phase' }} {{ view.dropped.join(' and ') }}</b>
      could not be fitted to whole machines while crediting them, so
      {{ view.dropped.length > 1 ? 'those phases are' : 'that phase is' }} planned as if you built
      all of it yourself. Nothing is lost — the plan is simply the larger one. Exact ratios instead
      of whole machines usually keeps the credit.
    </p>
  </div>
</template>
