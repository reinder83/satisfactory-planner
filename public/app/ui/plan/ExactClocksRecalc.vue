<!--
  The notice on the build plan and the Factories page when the production lines asked to run at
  exact clocks (the progress state's `exactClocks`, saved from a line's dialog, ExactClockChoice.vue)
  are not the ones the open plan was calculated with (exactClocksChange in app/exact-clocks.ts,
  #1066). The plan is never recalculated by itself (AGENTS.md): the notice names the lines that
  would change. "Recalculate in place with exact clocks" recalculates this profile in place with
  settings.exactClocks set to the lines asked for, after a confirmation that names the backup kept
  of the current version (recalculateOffer in ui/recalc-offer.ts, #1071, as Edit settings does:
  progress carried, a line that grew left for review). As "Recalculate in place with items made on
  site" (OnSiteRecalc.vue).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { exactClockNames, exactClocksChange, exactClocksSettings } from '../../exact-clocks.ts';
import { calculated, state } from '../../session.ts';
import { isTranscribed, RESOLVE_WARNING } from '../../../handbook-migration.ts';
import { legacy } from '../bridge.ts';
import { IN_PLACE_NOTE, recalculateOffer } from '../recalc-offer.ts';

const LABEL = 'Recalculate in place with exact clocks';

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

function recalculate(event: Event) {
  const wanted = change.value?.wanted;
  if (!calculated || !wanted) return;
  void recalculateOffer(event.currentTarget as HTMLButtonElement, {
    settings: exactClocksSettings(calculated.settings, wanted),
    change: 'with the production lines at the clocks you chose',
    label: LABEL,
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
      {{ IN_PLACE_NOTE
      }}<template v-if="transcribed"
        ><br /><span data-resolve-warning>{{ RESOLVE_WARNING }}</span></template
      >
    </p>
  </div>
</template>
