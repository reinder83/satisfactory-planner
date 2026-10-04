<!--
  The Factories page's notice when the group lines made on site that the factory groups' marks
  (factoryGroups.local, saved by OnSitePicker.vue) would give in a recalculation are not the ones
  the open plan has (onSiteChange in app/on-site-picker.ts, #877, #938, #970). The plan is never
  recalculated by itself (AGENTS.md): the notice says what changed, in words for the cause (#985):
  a change to the marks, or a group whose lines no longer use, or now use, an item it marks, and
  what a recalculation would give against what the plan has. "Recalculate with items made
  on site", after the unsaved-notes check, creates a new profile in this save with settings.onSite
  worked out from the groups now (onSiteSettings), carrying this profile's progress the way a new
  profile does (ticks with no single line to land on are kept for review, #876). It opens; this
  profile stays as it is. As "Recalculate with transport fuel" (GroupLinks.vue): the button shows
  the calculation's progress, busy (app/busy.ts) so it keeps focus (#299), and the new profile's
  page has no notice, so focus then goes to its heading (refocusOnOpenedPage, #300, #304).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { allowSwitch, post, toast, writeQueue } from '../../api.ts';
import {
  calculated,
  currentProfile,
  currentSave,
  loadContext,
  setWorkspace,
} from '../../session.ts';
import { render } from '../../shell.ts';
import { onSiteChange, onSiteRecalcSettings } from '../../on-site-picker.ts';
import { factoryGroupsState } from '../../views/factories.ts';
import { isTranscribed, RESOLVE_WARNING } from '../../../handbook-migration.ts';
import { calcProgress } from '../../wizard/wizard.ts';
import { legacy } from '../bridge.ts';
import { isBusy, whileBusy } from '../../busy.ts';
import { refocusOnOpenedPage } from '../refocus.ts';
import type { WorkspaceSummary } from '../../../types/index.ts';

const LABEL = 'Recalculate with items made on site';
const SUFFIX = ' · made on site';

const change = computed(() =>
  legacy(() => (calculated ? onSiteChange(calculated, factoryGroupsState()) : null)),
);
// A plan transcribed from the retired handbook says what a recalculation does to it (#480).
const transcribed = computed(() => legacy(() => isTranscribed(calculated)));

async function recalculate(event: Event) {
  const button = event.currentTarget as HTMLButtonElement,
    wanted = change.value;
  if (isBusy(button) || !calculated || !wanted || !(await allowSwitch())) return;
  const settings = onSiteRecalcSettings(calculated.settings, wanted),
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
          name: (currentProfile.name.replace(/ · made on site$/, '') + SUFFIX).slice(0, 80),
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
        'Created a profile that plans the items made on site. ' +
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
  <div v-if="change" class="notice warn on-site-recalc" role="status" data-on-site-recalc>
    <p>
      <strong>This plan needs a recalculation.</strong>
      <template v-if="change.marksChanged"
        >What your factories make on site differs from this plan.
      </template>
      <template v-for="use in change.uses" :key="use"
        ><span data-on-site-use>{{ use }}.</span>
      </template>
      <template v-if="change.now">Now: {{ change.now }}.</template
      ><template v-else>Now no factory makes anything on site.</template>
      <template v-if="change.had"> This plan: {{ change.had }}.</template
      ><template v-else> This plan makes everything on central lines.</template>
      Nothing changes until you start it.
    </p>
    <p>
      <button class="btn primary" data-recalc-on-site @click="recalculate">{{ LABEL }}</button>
      creates a new profile that plans it and opens it; this profile stays as it is.<template
        v-if="transcribed"
        ><br /><span data-resolve-warning>{{ RESOLVE_WARNING }}</span></template
      >
    </p>
  </div>
</template>
