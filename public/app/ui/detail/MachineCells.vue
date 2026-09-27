<!--
  The machine instructions of a factory dialog as three compact stat cells (SP-20, #255): Total,
  At 100% and Adjustable (with its clock), from machineCounts in views/factories.ts so the card
  line and the dialog agree. A description list, so a screen reader hears each number with its
  label. The captions carry what the sentence used to say: the machine and peak load under
  Total, the output per machine and the precise clock under the others.
-->
<script setup lang="ts">
import { num } from '../../format.ts';
import type { MachineCounts } from '../../views/factories.ts';

withDefaults(
  defineProps<{
    counts: MachineCounts;
    totalCaption: string;
    fullCaption?: string;
    adjustableCaption?: string;
  }>(),
  { fullCaption: '', adjustableCaption: '' },
);
</script>

<template>
  <dl class="stats compact machine-cells">
    <div class="stat compact">
      <dt class="eyebrow">Total</dt>
      <dd>
        <strong>{{ num(counts.total) }}</strong
        ><small>{{ totalCaption }}</small>
      </dd>
    </div>
    <div class="stat compact">
      <dt class="eyebrow">At 100%</dt>
      <dd>
        <strong>{{ num(counts.full) }}</strong
        ><small>{{ fullCaption }}</small>
      </dd>
    </div>
    <div class="stat compact">
      <dt class="eyebrow">Adjustable</dt>
      <dd>
        <strong
          >{{ num(counts.adjustable)
          }}<span v-if="counts.clock" class="fraction"> at {{ counts.clock }}%</span></strong
        ><small>{{ adjustableCaption }}</small>
      </dd>
    </div>
  </dl>
</template>
