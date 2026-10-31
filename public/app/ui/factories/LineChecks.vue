<!--
  A train line's checks (#1284, slice 3), on its card on the Logistics page's Trains tab and in the
  line editor: advice, shown and never blocking (lineChecks in app/train-lines.ts). A check that has
  a way forward offers it: "Add rear locomotive" (`fix`) and, on the card, the station's editor
  ("Edit station ↗: <name>", `station`). None means "Train and stops match."
-->
<script setup lang="ts">
import type { TrainCheck } from '../../train-lines.ts';

const props = withDefaults(
  defineProps<{
    checks: TrainCheck[];
    // The station buttons: on the card, not in the editor (which would close the draft).
    stationNames?: Record<string, string>;
    lineName: string;
  }>(),
  { stationNames: () => ({}) },
);
const emit = defineEmits<{ fix: [check: TrainCheck]; station: [id: string] }>();
const stationName = (id: string | undefined) => (id ? props.stationNames[id] : undefined);
</script>

<template>
  <div class="line-checks" data-line-checks>
    <p v-if="!checks.length" class="small line-checks-ok" data-line-checks-ok>
      ✓ Train and stops match.
    </p>
    <ul v-else class="notice warn line-check-list" :aria-label="`Checks: ${lineName}`">
      <li v-for="check in checks" :key="check.key" :data-line-check="check.key">
        {{ check.text }}
        <button
          v-if="check.fix === 'rearLoco'"
          type="button"
          class="btn"
          data-line-fix="rearLoco"
          :aria-label="`Add rear locomotive: ${lineName}`"
          @click="emit('fix', check)"
        >
          Add rear locomotive
        </button>
        <button
          v-else-if="stationName(check.station)"
          type="button"
          class="btn"
          :data-line-check-station="check.station"
          :aria-label="`Edit station ↗: ${stationName(check.station)}`"
          @click="emit('station', check.station!)"
        >
          Edit station ↗
        </button>
      </li>
    </ul>
  </div>
</template>
