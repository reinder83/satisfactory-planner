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
  const p = props.plan,
    declared = p.settings?.existingSupply || {};
  if (!Object.keys(declared).length) return null;
  const start = Number(p.settings.phase || 1);
  const used: ItemRates = {};
  for (const [ph, st] of Object.entries(p.stages) as [string, StoredStage][])
    if (Number(ph) >= start)
      for (const [n, q] of Object.entries(st.supplied || {})) used[n] = Math.max(used[n] || 0, q);
  return {
    lines: Object.entries(declared).map(([n, q]) => ({
      name: n,
      rate: num(q),
      drawn: (used[n] || 0) > 0.002 ? num(used[n]) : '',
    })),
    dropped: (Object.entries(p.stages) as [string, StoredStage][])
      .filter(([ph, st]) => st.supplyDropped && Number(ph) >= start)
      .map(([ph]) => ph),
  };
});
</script>

<template>
  <div v-if="view" class="notice info supply-notice">
    <b>Crediting production you already run.</b> These lines are not planned again, and neither is
    the chain behind them.
    <ul class="supply-summary">
      <li v-for="l in view.lines" :key="l.name">
        <ItemIcon :name="l.name" /><span
          ><b>{{ l.name }}</b> {{ l.rate }}/min declared{{
            l.drawn
              ? ` · the plan draws up to ${l.drawn}/min of it, and builds no line for it`
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
      <b>Phase {{ view.dropped.join(' and ') }}</b> could not be fitted to whole machines while
      crediting them, so
      {{ view.dropped.length > 1 ? 'those phases are' : 'that phase is' }} planned as if you built
      all of it yourself. Nothing is lost — the plan is simply the larger one. Exact ratios instead
      of whole machines usually keeps the credit.
    </p>
  </div>
</template>
