<!--
  The notice on the build plan and the Factories page when the Power Shard pins asked for (the
  progress state's `lineClocks`, saved from a line's dialog, ShardPinChoice.vue) are not the clocks
  the open plan was calculated with (lineClocksChange in app/shard-pins.ts, #1239). The plan is
  never recalculated by itself (AGENTS.md): the notice names the lines that would change, and the
  pins on a recipe the game data no longer has, which a recalculation drops (#1271). "Recalculate
  in place with Power Shard pins" recalculates this profile in place with settings.lineClocks set
  to the clocks asked for, after a confirmation that names the backup kept of the current version
  (recalculateOffer in ui/recalc-offer.ts, #1071), as SloopPinsRecalc.vue.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { clockChangeWords, lineClocksChange, lineClocksSettings } from '../../shard-pins.ts';
import { calculated, state } from '../../session.ts';
import { catalogRecipeBook } from '../../built-capacity.ts';
import { isTranscribed, RESOLVE_WARNING } from '../../../handbook-migration.ts';
import { legacy } from '../bridge.ts';
import { IN_PLACE_NOTE, recalculateOffer } from '../recalc-offer.ts';

const LABEL = 'Recalculate in place with Power Shard pins';

const change = computed(() =>
  legacy(() => {
    const found = calculated ? lineClocksChange(calculated, state, catalogRecipeBook()) : null;
    if (!calculated || !found) return null;
    return { wanted: found.wanted, lines: clockChangeWords(found.lines), stale: found.stale };
  }),
);
// A plan transcribed from the retired handbook says what a recalculation does to it (#480).
const transcribed = computed(() => legacy(() => isTranscribed(calculated)));

function recalculate(event: Event) {
  const wanted = change.value?.wanted;
  if (!calculated || !wanted) return;
  void recalculateOffer(event.currentTarget as HTMLButtonElement, {
    settings: lineClocksSettings(calculated.settings, wanted, catalogRecipeBook()),
    change: 'with the Power Shard pins you chose',
    label: LABEL,
  });
}
</script>

<template>
  <div v-if="change" class="notice warn shard-pins-recalc" role="status" data-shard-pins-recalc>
    <p>
      <strong>This plan needs a recalculation.</strong>
      <span data-shard-pins-asked>Power Shard pins changed: {{ change.lines }}.</span>
      Nothing changes until you start it.
    </p>
    <p v-if="change.stale" data-shard-pins-stale>{{ change.stale }}</p>
    <p>
      <button class="btn primary" data-recalc-shard-pins @click="recalculate">{{ LABEL }}</button>
      {{ IN_PLACE_NOTE
      }}<template v-if="transcribed"
        ><br /><span data-resolve-warning>{{ RESOLVE_WARNING }}</span></template
      >
    </p>
  </div>
</template>
