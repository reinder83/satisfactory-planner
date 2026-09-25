<!--
  A table of impure/normal/pure counts, one row per resource in `names`, with the rate each
  row yields at the survey's miner and clock. `kind` is 'node' (ores, crude oil nodes) or
  'well' (resource-well satellites). The inputs are named "node:<name>:<purity>" and
  "well:<name>:<purity>", which readExtraction in wizard/extraction.js reads back.
-->
<script setup>
import { computed } from 'vue';
import { blankCounts, nodeYield, purities3, wellYield } from '../../../preferences.js';
import { num } from '../../format.ts';
import { wizard } from '../../session.js';
import { extractionOf } from '../../wizard/extraction.js';
import { legacy } from '../bridge.js';
import ItemIcon from '../ItemIcon.vue';

const props = defineProps({
  kind: { type: String, required: true },
  names: { type: Array, required: true },
});

const rows = computed(() =>
  legacy(() => {
    if (!wizard) return [];
    const e = extractionOf(wizard),
      map = props.kind === 'well' ? e.wells : e.nodes;
    return props.names.map(name => {
      const counts = { ...blankCounts(), ...(map[name] || {}) };
      const total = purities3.reduce(
        (a, [k]) =>
          a +
          (Number(counts[k]) || 0) *
            (props.kind === 'well' ? wellYield(k, e) : nodeYield(name, k, e)),
        0,
      );
      return {
        name,
        cells: purities3.map(([key, label]) => ({ key, label, value: counts[key] || 0 })),
        total: total ? num(Math.round(total)) + '/min' : '—',
      };
    });
  }),
);
</script>

<template>
  <div class="count-table">
    <div v-for="r in rows" :key="r.name" class="count-row">
      <span class="count-name"
        ><ItemIcon :name="r.name" /><span>{{ r.name }}</span></span
      >
      <label v-for="c in r.cells" :key="c.key" class="field count-cell"
        ><span>{{ c.label }}</span
        ><input
          :name="kind + ':' + r.name + ':' + c.key"
          type="number"
          min="0"
          max="10000"
          step="1"
          :value="c.value"
          :aria-label="`${c.label} ${r.name} ${kind === 'well' ? 'well satellites' : 'nodes'}`"
      /></label>
      <span class="count-total">{{ r.total }}</span>
    </div>
  </div>
</template>
