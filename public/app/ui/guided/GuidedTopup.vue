<!--
  On the guided stock question: the materials you carry out by hand, as chips. A floor for one
  of them costs 1 to 4 more buildings on a default plan since #1061 (storage takes the surplus
  first, and a storage-only line tops up the rest), where the general construction rate that would
  reach the same number costs 81-425%, because it applies to all eighteen at once. Ticked chips
  (name="topup") become storageOverrides of GUIDED_TOPUP_RATE each in readGuidedForm. Nothing
  when no storage is stocked. A chip for an item the start phase cannot make yet says from which
  phase (guidedTopupFrom): the plan still covers that phase, and the text quotes no phase (#1072).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { GUIDED_TOPUP_RATE, guidedTopupFrom, guidedTopupItems } from '../../../preferences.ts';
import { num } from '../../format.ts';
import { draft } from '../../session.ts';
import { legacy } from '../bridge.ts';
import HelpTip from '../form/HelpTip.vue';
import ItemIcon from '../ItemIcon.vue';

const rate = num(GUIDED_TOPUP_RATE);
const view = computed(() =>
  legacy(() => {
    const settings = draft().settings;
    if (settings.storage === 'none') return null;
    const over = settings.storageOverrides || {},
      phase = Number(settings.phase || 1);
    return guidedTopupItems.map(item => {
      const from = guidedTopupFrom[item] || 1;
      return { name: item, on: over[item] !== undefined, from: from > phase ? from : 0 };
    });
  }),
);
</script>

<template>
  <fieldset v-if="view" class="guided-topup">
    <legend>Which of these do you keep running out of? <HelpTip name="guidedTopup" /></legend>
    <p class="small muted">
      Containers fill from the plan’s surplus on their own. These get a guaranteed {{ rate }}/min:
      what the surplus leaves of it comes from a storage-only line, optional and built last, 1 to 4
      more buildings each on a default plan. Concrete is picked for you because it is the one the
      plan leaves least spare.
    </p>
    <div class="guided-chips">
      <label
        v-for="chip in view"
        :key="chip.name"
        :class="['guided-chip', chip.on ? 'is-picked' : '']"
        ><input
          type="checkbox"
          name="topup"
          :value="chip.name"
          :aria-label="`Guarantee ${rate} ${chip.name} a minute${chip.from ? ` from Phase ${chip.from}` : ''}`"
          :checked="chip.on"
        /><ItemIcon :name="chip.name" /><span
          >{{ chip.name
          }}<small v-if="chip.from" class="muted" data-topup-from>
            from Phase {{ chip.from }}</small
          ></span
        ></label
      >
    </div>
  </fieldset>
</template>
