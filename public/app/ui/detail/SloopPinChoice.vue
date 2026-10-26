<!--
  A production line's somersloop pin in its dialog (#1235, slice 10 of #1079), under Machine setup,
  for a line that can take somersloops (pinSlots in app/sloop-pins.ts: a machine with slots that
  draws power, from Phase 3 on, not a factory's own line or a storage-only line) in a plan with an
  amplification budget, or one that pins it already. Not in "New to Satisfactory" mode (#1076). It
  says how many somersloops the plan puts on the line now, and "Pin" saves the number typed (the
  whole map, `sloopPins`, through save() in api.ts) while "Planner's choice" forgets this line's
  pin. Neither recalculates anything: the note under it says the plan keeps the line as it was
  calculated until the user starts "Recalculate in place with somersloop pins" on the build plan
  (SloopPinsRecalc.vue). Saving what the plan already has forgets the saved map (null), so a state
  goes back to the version it had. A count that does not fill whole machines is refused here with
  the reason, before anything is saved.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { save } from '../../api.ts';
import { beginnerMode } from '../../beginner.ts';
import { whileBusy } from '../../busy.ts';
import {
  pinMax,
  pinNote,
  pinOf,
  pinRecipe,
  pinSlots,
  plannedPins,
  samePins,
  validPin,
  wantedPins,
  withPin,
} from '../../sloop-pins.ts';
import { calcStage, calculated, stage, state } from '../../session.ts';
import { render } from '../../shell.ts';
import { localeNumber } from '../../../wording.ts';
import { legacy } from '../bridge.ts';
import type { CalcRow } from '../../../types/index.ts';

const props = defineProps<{ row: CalcRow }>();
const error = ref('');

const view = computed(() =>
  legacy(() => {
    const row = props.row,
      phase = stage();
    if (beginnerMode() || !calculated) return null;
    const slots = pinSlots(row, phase);
    if (!slots) return null;
    const recipe = pinRecipe(row);
    const planned = pinOf(plannedPins(calculated), phase, recipe),
      wanted = pinOf(wantedPins(calculated, state), phase, recipe);
    const budget = calculated.settings.amplifySloops ?? 0;
    if (!budget && planned === undefined && wanted === undefined) return null;
    const twin = calcStage()?.rows?.find(line => line.id === 'amp:' + recipe);
    const now = twin?.sloops ?? 0,
      amplified = twin?.machines ?? 0;
    const machine = row.machine;
    return {
      id: recipe,
      slots,
      max: pinMax(slots),
      pinned: wanted !== undefined,
      value: String(wanted ?? now),
      now: now
        ? `This plan puts ${localeNumber(now)} somersloop${now === 1 ? '' : 's'} on this line: ${localeNumber(amplified)} amplified ${machine}${amplified === 1 ? '' : 's'}, ${slots} each.`
        : `This plan puts no somersloops on this line. Each amplified ${machine} takes ${slots}.`,
      budget: budget
        ? `Production amplification may place ${localeNumber(budget)} somersloop${budget === 1 ? '' : 's'} in each phase.`
        : 'This plan has no amplification budget, so a pin above 0 cannot be kept until you give it one on step 2 of Edit settings.',
      note: pinNote(calculated, state, phase, recipe),
      inputId: 'sloop-pin-' + recipe,
      noteId: 'sloop-pin-note-' + recipe,
      errorId: 'sloop-pin-error-' + recipe,
    };
  }),
);

// Saves `sloops` as this line's pin (undefined forgets it): the whole map of pins asked for, with
// this one changed; null when that is what the plan already has, so the saved map is forgotten.
function savePin(button: HTMLButtonElement, sloops: number | undefined) {
  if (!calculated) return;
  const next = withPin(wantedPins(calculated, state), stage(), pinRecipe(props.row), sloops);
  const value = samePins(next, plannedPins(calculated)) ? null : next;
  return whileBusy(button, async () => {
    try {
      await save({ type: 'sloopPins', value });
      error.value = '';
      render();
    } catch {
      // save() has said why; the field keeps what was typed.
    }
  });
}
// "Pin": the number typed, once it fills whole machines within the limit.
function pin(event: Event) {
  const current = view.value;
  if (!current) return;
  const button = event.currentTarget as HTMLButtonElement;
  const field = document.getElementById(current.inputId) as HTMLInputElement | null;
  const sloops = Number(field?.value ?? '');
  if (!field || field.value.trim() === '' || !validPin(sloops, current.slots)) {
    // A machine with one slot takes any whole number (#1020): "a multiple of 1" says nothing.
    error.value =
      current.slots === 1
        ? `Pin a whole number from 0 to ${current.max}.`
        : `Pin a whole number of machines: a multiple of ${current.slots} from 0 to ${current.max}.`;
    field?.focus();
    return;
  }
  return savePin(button, sloops);
}
// "Planner's choice": forget this line's pin.
const unpin = (event: Event) => savePin(event.currentTarget as HTMLButtonElement, undefined);
</script>

<template>
  <fieldset v-if="view" class="sloop-pin" data-sloop-pin-choice>
    <legend>Somersloops on this line</legend>
    <p class="small muted" data-sloop-pin-now>{{ view.now }} {{ view.budget }}</p>
    <div class="sloop-pin-row">
      <label :for="view.inputId"
        >Pin to<span class="visually-hidden"> this many somersloops</span></label
      >
      <input
        :id="view.inputId"
        type="number"
        inputmode="numeric"
        min="0"
        :max="view.max"
        :step="view.slots"
        :value="view.value"
        :data-sloop-pin="view.id"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error ? `${view.errorId} ${view.noteId}` : view.noteId"
      />
      <span aria-hidden="true">somersloops</span>
      <button type="button" class="btn" data-sloop-pin-save @click="pin">Pin</button>
      <button
        v-if="view.pinned"
        type="button"
        class="btn quiet"
        data-sloop-pin-clear
        @click="unpin"
      >
        Planner’s choice
      </button>
    </div>
    <p :id="view.errorId" class="form-error" role="alert" data-sloop-pin-error v-text="error"></p>
    <p :id="view.noteId" class="small muted" data-sloop-pin-note>{{ view.note }}</p>
  </fieldset>
</template>
