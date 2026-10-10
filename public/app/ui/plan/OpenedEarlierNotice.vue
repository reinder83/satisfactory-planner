<!--
  Above the build plan while the tab shows another phase than the saved working phase
  (workingPhaseNotShown() in session.ts): one picked in the phase picker to look at (#1053), one a
  flow page's address named (#926), or the earlier phase a profile opened on because it still has
  open steps (#570, openedFrom()). Names the working phase and offers it back, "Go to Phase N"
  (#666), which only shows it: nothing is saved. When the profile opened here it also says why,
  with the open steps counted as the progress bar counts them (openStepCount() in tasks.ts); ADA's
  `opened-earlier` remark says the same as flavour, from the same count (#974), but ADA may be
  muted or showing another remark. "Work on Phase N" in the top bar saves the phase shown as the
  working phase instead. Draws nothing on the working phase, and nothing in a milestone-only phase
  (#759), where ui/plan/MilestoneOnlyNotice.vue says the same in its one notice (#786).
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
  workingPhaseNotShown,
} from '../../session.ts';
import { render } from '../../shell.ts';
import { openStepCount } from '../../tasks.ts';
import { legacy } from '../bridge.ts';
import { refocusOnOpenedPage } from '../refocus.ts';

const notice = computed(() =>
  legacy(() => {
    const working = workingPhaseNotShown();
    if (!working || milestoneOnly()) return null;
    const shown = phaseLabel(phase()),
      open = openedFrom() ? openStepCount() : null;
    return {
      saved: phaseLabel(working),
      reason:
        open === null
          ? ''
          : open
            ? `${shown} still has ${open} open ${open === 1 ? 'step' : 'steps'}, so the plan starts here.`
            : `All ${shown} steps are done now.`,
    };
  }),
);

// Shows the saved working phase, as picking it in the phase picker does (Shell.vue): an unsaved
// note is asked about first, the search is cleared and the page redrawn. The saved phase already
// is that phase, so nothing is written. The button goes with the notice, so focus goes to the
// page's heading, which now names the working phase.
async function goToSavedPhase(event: Event) {
  if (!workingPhaseNotShown()) return;
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
    You are working on {{ notice.saved }}.{{ notice.reason && ' ' + notice.reason }}<br /><button
      type="button"
      class="btn"
      data-go-to-saved-phase
      @click="goToSavedPhase"
    >
      Go to {{ notice.saved }}
    </button>
  </div>
</template>
