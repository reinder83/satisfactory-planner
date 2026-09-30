<!--
  The notices above a calculated profile's plan, factories and resources pages for the current
  phase: the infeasible-draft warning with its options (draftFixes in views/calculated.ts), and
  extra power headroom for whole buildings with what that phase can build for it (headroomAdvice,
  #331). It draws nothing without a calculated profile.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { calcStage, calculated, phase } from '../../session.ts';
import { draftFixes, draftHeading, headroomAdvice } from '../../views/calculated.ts';
import { power } from '../../wizard/fields.ts';
import { legacy } from '../bridge.ts';

const notices = computed(() =>
  legacy(() => {
    const stageResult = calcStage();
    if (!stageResult) return { draft: null, headroom: '', advice: '' };
    return {
      draft: !stageResult.feasible && {
        heading: draftHeading(stageResult),
        reason: stageResult.reason,
        fixes: draftFixes(stageResult, calculated?.settings),
      },
      headroom:
        (stageResult.additionalHeadroomMW ?? 0) > 0.01
          ? power(stageResult.additionalHeadroomMW!)
          : '',
      advice: headroomAdvice(stageResult, phase()),
    };
  }),
);
</script>

<template>
  <div v-if="notices.draft" class="notice warn">
    <b>{{ notices.draft.heading }}</b>
    {{ notices.draft.reason
    }}<template v-if="notices.draft.fixes.length"
      ><p><b>Options</b></p>
      <ul>
        <li v-for="fix in notices.draft.fixes" :key="fix">{{ fix }}</li>
      </ul>
      <p class="small">
        Profiles are calculated snapshots: create a new profile with adjusted settings to apply an
        option.
      </p></template
    >
  </div>
  <div v-if="notices.headroom" class="notice warn">
    Allow another {{ notices.headroom }} for whole-building power headroom.
    {{ notices.advice }}
  </div>
</template>
