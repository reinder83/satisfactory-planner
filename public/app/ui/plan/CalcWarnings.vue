<!--
  The notices above a calculated profile's pages for the current phase: the infeasible-draft
  warning with its options (draftFixes in views/calculated.js), and extra power headroom for
  whole buildings. calcWarnings() in views/calculated.js draws the same for the pages that
  are not components yet.
-->
<script setup>
import { computed } from 'vue';
import { calcStage, calculated } from '../../session.js';
import { draftFixes } from '../../views/calculated.js';
import { power } from '../../wizard/fields.js';
import { legacy } from '../bridge.js';

const notices = computed(() =>
  legacy(() => {
    const x = calcStage();
    return {
      draft: !x.feasible && {
        reason: x.reason,
        fixes: draftFixes(x, calculated?.settings),
      },
      headroom: x.additionalHeadroomMW > 0.01 ? power(x.additionalHeadroomMW) : '',
    };
  }),
);
</script>

<template>
  <div v-if="notices.draft" class="notice">
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
  <div v-if="notices.headroom" class="notice">
    Allow another {{ notices.headroom }} for whole-building power headroom. Phase 1 needs biomass or
    existing generation.
  </div>
</template>
