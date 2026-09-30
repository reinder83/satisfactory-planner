<!--
  A table of impure/normal/pure counts, one row per resource in `names`, with the rate each
  row yields at the survey's miner and clock. `kind` is 'node' (ores, crude oil nodes) or
  'well' (resource-well satellites). The inputs are named "node:<name>:<purity>" and
  "well:<name>:<purity>", which readExtraction in wizard/extraction.ts reads back.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { blankCounts, nodeYield, purities3, wellYield } from '../../../preferences.ts';
import { itemRate } from '../../flow.ts';
import { wizard } from '../../session.ts';
import { extractionOf } from '../../wizard/extraction.ts';
import { legacy } from '../bridge.ts';
import ItemIcon from '../ItemIcon.vue';

// kind 'node' counts ore nodes, 'well' resource-well satellites; names are the resources.
const props = defineProps<{ kind: 'node' | 'well'; names: string[] }>();

const rows = computed(() =>
  legacy(() => {
    if (!wizard) return [];
    const extraction = extractionOf(wizard),
      map = props.kind === 'well' ? extraction.wells : extraction.nodes;
    return props.names.map(name => {
      const counts = { ...blankCounts(), ...(map?.[name] || {}) };
      const total = purities3.reduce(
        (sum, [purity]) =>
          sum +
          (Number(counts[purity]) || 0) *
            (props.kind === 'well'
              ? wellYield(purity, extraction)
              : nodeYield(name, purity, extraction)),
        0,
      );
      return {
        name,
        cells: purities3.map(([key, label]) => ({ key, label, value: counts[key] || 0 })),
        // Crude oil and nitrogen are fluids, so their totals read m³/min (#363).
        total: total ? itemRate(name, Math.round(total)) : '—',
      };
    });
  }),
);
</script>

<template>
  <div class="count-table">
    <div v-for="row in rows" :key="row.name" class="count-row">
      <span class="count-name"
        ><ItemIcon :name="row.name" /><span>{{ row.name }}</span></span
      >
      <label v-for="cell in row.cells" :key="cell.key" class="field count-cell"
        ><span>{{ cell.label }}</span
        ><input
          :name="kind + ':' + row.name + ':' + cell.key"
          type="number"
          min="0"
          max="10000"
          step="1"
          :value="cell.value"
          :aria-label="`${cell.label} ${row.name} ${kind === 'well' ? 'well satellites' : 'nodes'}`"
      /></label>
      <span class="count-total">{{ row.total }}</span>
    </div>
  </div>
</template>
