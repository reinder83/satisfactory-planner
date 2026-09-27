<!--
  The notices above a calculated profile's plan, factories and resources pages for the current
  phase: the infeasible-draft warning with its options (draftFixes in views/calculated.ts), and
  extra power headroom for whole buildings. It draws nothing without a calculated profile.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { calcStage, calculated } from '../../session.ts';
import { draftFixes } from '../../views/calculated.ts';
import { power } from '../../wizard/fields.ts';
import { legacy } from '../bridge.ts';

const notices = computed(() =>
  legacy(() => {
    const x = calcStage();
    if (!x) return { draft: null, headroom: '' };
    return {
      draft: !x.feasible && {
        reason: x.reason,
        fixes: draftFixes(x, calculated?.settings),
      },
      headroom: (x.additionalHeadroomMW ?? 0) > 0.01 ? power(x.additionalHeadroomMW!) : '',
    };
  }),
);
</script>

<template>
  <div v-if="notices.draft" class="notice warn">
    <b>Planning draft — resource budget exceeded or recipe combination unavailable.</b>
    {{ notices.draft.reason
    }}<template v-if="notices.draft.fixes.length"
      ><p><b>Options</b></p>
      <ul>
        <li v-for="f in notices.draft.fixes" :key="f">{{ f }}</li>
      </ul>
      <p class="small">
        Profiles are calculated snapshots: create a new profile with adjusted settings to apply an
        option.
      </p></template
    >
  </div>
  <div v-if="notices.headroom" class="notice warn">
    Allow another {{ notices.headroom }} for whole-building power headroom. Phase 1 needs biomass or
    existing generation.
  </div>
</template>
