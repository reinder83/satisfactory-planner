<!--
  The notice on the build plan and the Factories page when the somersloop pins asked for (the
  progress state's `sloopPins`, saved from a line's dialog, SloopPinChoice.vue) are not the ones the
  open plan was calculated with (sloopPinsChange in app/sloop-pins.ts, #1235). The plan is never
  recalculated by itself (AGENTS.md): the notice names the lines that would change, and the phases
  whose pins add up to more than the amplification budget, which a recalculation would plan
  without them. "Recalculate in place with somersloop pins" recalculates this profile in place with
  settings.sloopPins set to the pins asked for, after a confirmation that names the backup kept of
  the current version (recalculateOffer in ui/recalc-offer.ts, #1071), as ExactClocksRecalc.vue.
-->
<script setup lang="ts">
import { computed } from 'vue';
import {
  pinChangeWords,
  pinsOverBudget,
  sloopPinsChange,
  sloopPinsSettings,
} from '../../sloop-pins.ts';
import { calculated, state } from '../../session.ts';
import { isTranscribed, RESOLVE_WARNING } from '../../../handbook-migration.ts';
import { listNames, localeNumber } from '../../../wording.ts';
import { legacy } from '../bridge.ts';
import { IN_PLACE_NOTE, recalculateOffer } from '../recalc-offer.ts';

const LABEL = 'Recalculate in place with somersloop pins';

const change = computed(() =>
  legacy(() => {
    const found = calculated ? sloopPinsChange(calculated, state) : null;
    if (!calculated || !found) return null;
    const over = pinsOverBudget(calculated, found.wanted);
    const budget = calculated.settings.amplifySloops ?? 0;
    return {
      wanted: found.wanted,
      lines: pinChangeWords(found.lines),
      over: over.length
        ? `The pins of ${over.length > 1 ? 'Phases' : 'Phase'} ${listNames(over.map(([phase, total]) => `${phase} (${localeNumber(total)})`))} add up to more than the ${localeNumber(budget)} somersloop${budget === 1 ? '' : 's'} production amplification may place in a phase, so a recalculation would plan ${over.length > 1 ? 'those phases' : 'that phase'} without them: raise the amplification budget on step 2 of Edit settings, or lower the pins.`
        : '',
    };
  }),
);
// A plan transcribed from the retired handbook says what a recalculation does to it (#480).
const transcribed = computed(() => legacy(() => isTranscribed(calculated)));

function recalculate(event: Event) {
  const wanted = change.value?.wanted;
  if (!calculated || !wanted) return;
  void recalculateOffer(event.currentTarget as HTMLButtonElement, {
    settings: sloopPinsSettings(calculated.settings, wanted),
    change: 'with the somersloop pins you chose',
    label: LABEL,
  });
}
</script>

<template>
  <div v-if="change" class="notice warn sloop-pins-recalc" role="status" data-sloop-pins-recalc>
    <p>
      <strong>This plan needs a recalculation.</strong>
      <span data-sloop-pins-asked>Somersloop pins changed: {{ change.lines }}.</span>
      Nothing changes until you start it.
    </p>
    <p v-if="change.over" data-sloop-pins-over>{{ change.over }}</p>
    <p>
      <button class="btn primary" data-recalc-sloop-pins @click="recalculate">{{ LABEL }}</button>
      {{ IN_PLACE_NOTE
      }}<template v-if="transcribed"
        ><br /><span data-resolve-warning>{{ RESOLVE_WARNING }}</span></template
      >
    </p>
  </div>
</template>
