<!--
  The Factories page's notice when the group lines made on site that the factory groups' marks
  (factoryGroups.local, saved by OnSitePicker.vue) would give in a recalculation are not the ones
  the open plan has (onSiteChange in app/on-site-picker.ts, #877, #938, #970). The plan is never
  recalculated by itself (AGENTS.md): the notice says what changed, in words for the cause (#985):
  a change to the marks, or a group whose lines no longer use, or now use, an item it marks, and
  what a recalculation would give against what the plan has. "Recalculate in place with items
  made on site" recalculates this profile in place with settings.onSite worked out from the groups
  now (onSiteSettings), after a confirmation that names the backup kept of the current version
  (recalculateOffer in ui/recalc-offer.ts, #1071): the progress is carried as Edit settings
  carries it, and ticks with no single line to land on are kept for review (#876). As
  "Recalculate in place with transport fuel" (GroupLinks.vue).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { calculated } from '../../session.ts';
import { onSiteChange, onSiteRecalcSettings } from '../../on-site-picker.ts';
import { factoryGroupsState } from '../../views/factories.ts';
import { isTranscribed, RESOLVE_WARNING } from '../../../handbook-migration.ts';
import { legacy } from '../bridge.ts';
import { IN_PLACE_NOTE, recalculateOffer } from '../recalc-offer.ts';

const LABEL = 'Recalculate in place with items made on site';

const change = computed(() =>
  legacy(() => (calculated ? onSiteChange(calculated, factoryGroupsState()) : null)),
);
// A plan transcribed from the retired handbook says what a recalculation does to it (#480).
const transcribed = computed(() => legacy(() => isTranscribed(calculated)));

function recalculate(event: Event) {
  const wanted = change.value;
  if (!calculated || !wanted) return;
  void recalculateOffer(event.currentTarget as HTMLButtonElement, {
    settings: onSiteRecalcSettings(calculated.settings, wanted),
    change: 'with the items your factories make on site',
    label: LABEL,
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
      {{ IN_PLACE_NOTE
      }}<template v-if="transcribed"
        ><br /><span data-resolve-warning>{{ RESOLVE_WARNING }}</span></template
      >
    </p>
  </div>
</template>
