<!--
  Above the build plan on both profile kinds, while the profile opened on an earlier phase than
  its saved working phase because that phase still has open steps (#570, openedFrom() in
  session.ts): says so, with the open steps counted as the progress bar counts them
  (openStepCount() in tasks.ts), and offers the saved phase back (#666). ADA's `opened-earlier`
  remark says the same as flavour, from the same count (#974), but ADA may be muted or showing
  another remark. Draws nothing on the saved phase, and nothing in
  a milestone-only phase (#759), where ui/plan/MilestoneOnlyNotice.vue says the same in its one
  notice (#786).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { allowSwitch } from '../../api.ts';
import {
  milestoneOnly,
  openedFrom,
  phase,
  phaseLabel,
  setOpenedPhase,
  setQuery,
} from '../../session.ts';
import { render } from '../../shell.ts';
import { openStepCount } from '../../tasks.ts';
import { legacy } from '../bridge.ts';
import { refocusOnOpenedPage } from '../refocus.ts';

const notice = computed(() =>
  legacy(() => {
    const saved = openedFrom();
    if (!saved || milestoneOnly()) return null;
    const open = openStepCount(),
      shown = phaseLabel(phase());
    return {
      saved: phaseLabel(saved),
      reason: open
        ? `${shown} still has ${open} open ${open === 1 ? 'step' : 'steps'}, so the plan starts here.`
        : `All ${shown} steps are done now.`,
    };
  }),
);

// Shows the saved working phase, as picking it on the phase track does (Shell.vue): an unsaved
// note is asked about first, the search is cleared and the page redrawn. The saved phase already
// is that phase, so nothing is written. The button goes with the notice, so focus goes to the
// page's heading, which now names the saved phase.
async function goToSavedPhase(event: Event) {
  if (!openedFrom()) return;
  const refocus = refocusOnOpenedPage(event.currentTarget);
  if (!(await allowSwitch())) return;
  setOpenedPhase(null);
  setQuery('');
  render();
  await refocus();
}
</script>

<template>
  <div v-if="notice" class="notice info" data-opened-earlier>
    You are working on {{ notice.saved }}. {{ notice.reason }}<br /><button
      type="button"
      class="btn"
      data-go-to-saved-phase
      @click="goToSavedPhase"
    >
      Go to {{ notice.saved }}
    </button>
  </div>
</template>
