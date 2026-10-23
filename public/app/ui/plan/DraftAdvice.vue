<!--
  What to do about a phase that does not fit (#1222), under its reason in the draft notice of the
  plan, factories and resources pages (CalcWarnings.vue) and the wizard's Review
  (ui/wizard/ReviewStep.vue): what runs out against what the map gives, and the options that apply
  to the phase (draftAdvice in app/draft-advice.ts). With `actions` (the open profile's pages) an
  option has a button where the app already has the action: Edit settings on the step that holds
  it, and for more time under a target completion time a recalculation in place at the hours that
  fit (recalculateOffer in ui/recalc-offer.ts: confirmation first, progress carried, backup kept).
  Review has no buttons: its steps are the tabs above it. Nothing is recalculated without a press.
-->
<script setup lang="ts">
import { toast } from '../../api.ts';
import { num } from '../../format.ts';
import { calculated, currentProfile, currentSave } from '../../session.ts';
import { startEdit } from '../../wizard/wizard.ts';
import { recalculateOffer } from '../recalc-offer.ts';
import type { DraftAdvice, DraftLever } from '../../draft-advice.ts';

withDefaults(defineProps<{ advice: DraftAdvice; actions?: boolean }>(), {
  actions: false,
});

const hoursLabel = (hours: number) => `Recalculate in place at ${num(hours)} h per phase`;

const edit = (lever: DraftLever) =>
  void startEdit(currentSave.id, currentProfile.id, lever.step).catch(error =>
    toast((error as Error).message, true),
  );

function recalculate(event: Event, hours: number) {
  if (!calculated) return;
  void recalculateOffer(event.currentTarget as HTMLButtonElement, {
    settings: { ...calculated.settings, hours },
    change: `with ${num(hours)} hours per phase`,
    label: hoursLabel(hours),
  });
}
</script>

<template>
  <template v-if="advice.needs.length"
    ><p><b>What runs out</b></p>
    <ul data-draft-needs>
      <li v-for="need in advice.needs" :key="need.name" :data-draft-need="need.name">
        {{ need.text }}
      </li>
    </ul></template
  ><template v-if="advice.levers.length"
    ><p><b>Options</b></p>
    <ul data-draft-levers>
      <li v-for="lever in advice.levers" :key="lever.id" :data-draft-lever="lever.id">
        {{ lever.text
        }}<template v-if="actions && lever.hours !== undefined"
          >{{ ' '
          }}<button
            type="button"
            class="btn quiet"
            data-draft-recalc-hours
            @click="recalculate($event, lever.hours)"
          >
            {{ hoursLabel(lever.hours) }}
          </button></template
        ><template v-else-if="actions && lever.step"
          >{{ ' '
          }}<button
            type="button"
            class="btn quiet"
            :data-draft-edit="lever.step"
            @click="edit(lever)"
          >
            {{ lever.label }}
          </button></template
        >
      </li>
    </ul>
    <p v-if="actions" class="small" data-draft-note>
      Edit settings opens the step that holds an option. Nothing is recalculated until you press
      Recalculate in place, which carries your progress and keeps the current version as a backup
      under Profiles.
    </p></template
  >
</template>
