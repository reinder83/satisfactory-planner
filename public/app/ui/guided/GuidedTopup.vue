<!--
  On the guided stock question: the materials you carry out by hand, as chips. A floor for one
  of them costs about 1% more buildings, where the general construction rate that would reach
  the same number costs 81-425%, because it applies to all eighteen at once. Ticked chips
  (name="topup") become storageOverrides of GUIDED_TOPUP_RATE each in readGuidedForm. Nothing
  when no storage is stocked.
-->
<script setup>
import { computed } from 'vue';
import { GUIDED_TOPUP_RATE, guidedTopupItems } from '../../../preferences.ts';
import { num } from '../../format.ts';
import { wizard } from '../../session.ts';
import { legacy } from '../bridge.ts';
import HelpTip from '../form/HelpTip.vue';
import ItemIcon from '../ItemIcon.vue';

const rate = num(GUIDED_TOPUP_RATE);
const view = computed(() =>
  legacy(() => {
    const s = wizard.settings;
    if (s.storage === 'none') return null;
    const over = s.storageOverrides || {};
    return guidedTopupItems.map(n => ({ name: n, on: over[n] !== undefined }));
  }),
);
</script>

<template>
  <fieldset v-if="view" class="guided-topup">
    <legend>Which of these do you keep running out of? <HelpTip name="guidedTopup" /></legend>
    <p class="small muted">
      Containers fill from surplus on their own — a default Phase 3 plan already spills 29 Wire and
      19 Iron Plate a minute into storage. These get a guaranteed {{ rate }}/min on top, which costs
      about 1% more buildings each. Concrete is picked for you because it is the one the plan leaves
      least spare.
    </p>
    <div class="guided-chips">
      <label v-for="c in view" :key="c.name" :class="['guided-chip', c.on ? 'is-picked' : '']"
        ><input
          type="checkbox"
          name="topup"
          :value="c.name"
          :aria-label="`Guarantee ${rate} ${c.name} a minute`"
          :checked="c.on"
        /><ItemIcon :name="c.name" /><span>{{ c.name }}</span></label
      >
    </div>
  </fieldset>
</template>
