<!--
  The notice on the build plan and the Factories page when the production lines asked to run at
  exact clocks (the progress state's `exactClocks`, saved from a line's dialog, ExactClockChoice.vue)
  are not the ones the open plan was calculated with (exactClocksChange in app/exact-clocks.ts,
  #1066). The plan is never recalculated by itself (AGENTS.md): the notice names the lines that
  would change. "Recalculate with exact clocks", after the unsaved-notes check, creates a new profile
  in this save with settings.exactClocks set to the lines asked for, carrying this profile's
  progress the way a new profile does (a line that grew is left for review). It opens; this
  profile stays as it is. As "Recalculate with items made on site" (OnSiteRecalc.vue): the button
  shows the calculation's progress, busy (app/busy.ts) so it keeps focus (#299), and the new
  profile's page has no notice, so focus then goes to its heading (refocusOnOpenedPage, #300).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { allowSwitch, post, toast, writeQueue } from '../../api.ts';
import { isBusy, whileBusy } from '../../busy.ts';
import { exactClockNames, exactClocksChange, exactClocksSettings } from '../../exact-clocks.ts';
import {
  calculated,
  currentProfile,
  currentSave,
  loadContext,
  setWorkspace,
  state,
} from '../../session.ts';
import { render } from '../../shell.ts';
import { isTranscribed, RESOLVE_WARNING } from '../../../handbook-migration.ts';
import { calcProgress } from '../../wizard/wizard.ts';
import { legacy } from '../bridge.ts';
import { refocusOnOpenedPage } from '../refocus.ts';
import type { WorkspaceSummary } from '../../../types/index.ts';

const LABEL = 'Recalculate with exact clocks';
const SUFFIX = ' · exact clocks';

const change = computed(() =>
  legacy(() => {
    const found = calculated ? exactClocksChange(calculated, state) : null;
    return found
      ? {
          wanted: found.wanted,
          exact: exactClockNames(found.exact),
          whole: exactClockNames(found.whole),
        }
      : null;
  }),
);
// A plan transcribed from the retired handbook says what a recalculation does to it (#480).
const transcribed = computed(() => legacy(() => isTranscribed(calculated)));

async function recalculate(event: Event) {
  const button = event.currentTarget as HTMLButtonElement,
    wanted = change.value?.wanted;
  if (isBusy(button) || !calculated || !wanted || !(await allowSwitch())) return;
  const settings = exactClocksSettings(calculated.settings, wanted),
    refocus = refocusOnOpenedPage(button);
  await whileBusy(button, async () => {
    try {
      await writeQueue;
      const result = await post<{
        workspace: WorkspaceSummary;
        saveId: string;
        profileId: string;
        reviewCount: number;
      }>(
        '/api/profiles',
        {
          saveId: currentSave.id,
          name: (currentProfile.name.replace(/ · exact clocks$/, '') + SUFFIX).slice(0, 80),
          settings,
          carryFrom: currentProfile.id,
        },
        true,
        calcProgress(button, 'Recalculating…'),
      );
      setWorkspace(result.workspace);
      await loadContext(result.saveId, result.profileId);
      render();
      toast(
        'Created a profile with the production lines at the clocks you chose. ' +
          (result.reviewCount
            ? result.reviewCount +
              ' completed production line checks need review; the previous profile is unchanged.'
            : 'The previous profile is unchanged.'),
      );
      void refocus();
    } catch (error) {
      toast((error as Error).message, true);
      button.textContent = LABEL;
    }
  });
}
</script>

<template>
  <div v-if="change" class="notice warn exact-clocks-recalc" role="status" data-exact-clocks-recalc>
    <p>
      <strong>This plan needs a recalculation.</strong>
      <template v-if="change.exact"
        ><span data-exact-clocks-asked>Exact clocks asked for: {{ change.exact }}.</span>
      </template>
      <template v-if="change.whole"
        ><span data-whole-clocks-asked>Whole machines asked for again: {{ change.whole }}.</span>
      </template>
      Nothing changes until you start it.
    </p>
    <p>
      <button class="btn primary" data-recalc-exact-clocks @click="recalculate">{{ LABEL }}</button>
      creates a new profile that plans it and opens it; this profile stays as it is.<template
        v-if="transcribed"
        ><br /><span data-resolve-warning>{{ RESOLVE_WARNING }}</span></template
      >
    </p>
  </div>
</template>
