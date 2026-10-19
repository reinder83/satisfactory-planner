<!--
  A table of impure/normal/pure counts, one row per resource in `names`, with the rate each
  row yields at the survey's miner and clock. `kind` is 'node' (ores, crude oil nodes) or
  'well' (resource-well satellites). The inputs are named "node:<name>:<purity>" and
  "well:<name>:<purity>", which readExtraction in wizard/extraction.ts reads back.
  With `leaveOut` (#1183, LeaveOut.vue) it asks instead how many of the counted ones to leave out
  of the plan: a row per resource with nodes counted, each input "exclude-node:<name>:<purity>" or
  "exclude-well:…" up to the count beside its label (disabled where none is counted), and the
  rate the left-out ones give.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { blankCounts, nodeYield, purities3, wellYield } from '../../../preferences.ts';
import { itemRate } from '../../flow.ts';
import { num } from '../../format.ts';
import { wizard } from '../../session.ts';
import { extractionOf } from '../../wizard/extraction.ts';
import { legacy } from '../bridge.ts';
import ItemIcon from '../ItemIcon.vue';

// kind 'node' counts ore nodes, 'well' resource-well satellites; names are the resources.
const props = defineProps<{ kind: 'node' | 'well'; names: string[]; leaveOut?: boolean }>();

const rows = computed(() =>
  legacy(() => {
    if (!wizard) return [];
    const extraction = extractionOf(wizard),
      map = props.kind === 'well' ? extraction.wells : extraction.nodes,
      left = props.kind === 'well' ? extraction.excludedWells : extraction.excludedNodes;
    const yieldOf = (name: string, purity: string) =>
      props.kind === 'well' ? wellYield(purity, extraction) : nodeYield(name, purity, extraction);
    return props.names
      .map(name => {
        const counted = { ...blankCounts(), ...(map?.[name] || {}) };
        const counts = props.leaveOut ? { ...blankCounts(), ...(left?.[name] || {}) } : counted;
        const total = purities3.reduce(
          (sum, [purity]) => sum + (Number(counts[purity]) || 0) * yieldOf(name, purity),
          0,
        );
        return {
          name,
          counted: purities3.some(([purity]) => Number(counted[purity]) > 0),
          cells: purities3.map(([key, label]) => ({
            key,
            // A no-break space keeps the count with its "of" when the label wraps.
            label: props.leaveOut ? `${label} of ${num(Number(counted[key]) || 0)}` : label,
            value: counts[key] || 0,
            max: props.leaveOut ? Number(counted[key]) || 0 : 10000,
          })),
          // Crude oil and nitrogen are fluids, so their totals read m³/min (#363). What a row
          // leaves out is taken off the budget, so it reads as a deduction.
          total: total ? (props.leaveOut ? '−' : '') + itemRate(name, Math.round(total)) : '—',
        };
      })
      .filter(row => !props.leaveOut || row.counted);
  }),
);
const prefix = computed(() => (props.leaveOut ? 'exclude-' : '') + props.kind);
const noun = computed(() => (props.kind === 'well' ? 'well satellites' : 'nodes'));
</script>

<template>
  <div :class="['count-table', leaveOut ? 'leave-out-table' : '']">
    <div v-for="row in rows" :key="row.name" class="count-row">
      <span class="count-name"
        ><ItemIcon :name="row.name" /><span>{{ row.name }}</span></span
      >
      <label v-for="cell in row.cells" :key="cell.key" class="field count-cell"
        ><span>{{ cell.label }}</span
        ><input
          :name="prefix + ':' + row.name + ':' + cell.key"
          type="number"
          min="0"
          :max="cell.max"
          step="1"
          :value="cell.value"
          :disabled="leaveOut && !cell.max"
          :aria-label="
            leaveOut
              ? `${cell.key[0]!.toUpperCase() + cell.key.slice(1)} ${row.name} ${noun} left out of this plan, of ${cell.max}`
              : `${cell.label} ${row.name} ${noun}`
          "
      /></label>
      <span class="count-total">{{ row.total }}</span>
    </div>
    <p v-if="leaveOut && !rows.length" class="small muted">
      No {{ noun }} counted here yet, so there are none to leave out.
    </p>
  </div>
</template>
