<!--
  A production line's Power Shard pin in its dialog (#1239, slice 2), under its somersloop pin, for
  a line that can be overclocked (clockable in app/shard-pins.ts: a production machine that draws
  power, the recipe's own line, from Phase 2 on or in Phase 1 when the player can overclock), or
  one that has a pin already. Not in "New to Satisfactory" mode (#1076). It says the clock the plan
  runs the line at now and the Power Shards its machines hold, and "Pin" saves the clock chosen:
  150%, 200% or 250%, one, two or three Power Shards in every machine, or 100% for no pin (the
  whole map, `lineClocks`, through save() in api.ts). Nothing recalculates: the note under it says
  the plan keeps the line as it was calculated until the user starts "Recalculate in place with
  Power Shard pins" on the build plan (ShardPinsRecalc.vue). Saving what the plan already has
  forgets the saved map (null), so a state goes back to the version it had.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { save } from '../../api.ts';
import { beginnerMode } from '../../beginner.ts';
import { whileBusy } from '../../busy.ts';
import {
  clockable,
  shardPinNote,
  pinnedClockOf,
  clockRecipe,
  plannedClocks,
  sameClocks,
  wantedClocks,
  withClock,
} from '../../shard-pins.ts';
import { calcStage, calculated, stage, state } from '../../session.ts';
import { render } from '../../shell.ts';
import {
  gameShards,
  SHARD_PIN_CLOCKS,
  shardsPerMachine,
  powerShardWords,
} from '../../../shards.ts';
import { localeNumber } from '../../../wording.ts';
import { legacy } from '../bridge.ts';
import type { CalcRow } from '../../../types/index.ts';

const props = defineProps<{ row: CalcRow }>();

// "250% · 3 Power Shards in each machine", or "100% · no Power Shards" for no pin ('').
const optionText = (clock: number | undefined) =>
  clock === undefined
    ? '100% · no Power Shards'
    : `${localeNumber(clock)}% · ${powerShardWords(shardsPerMachine(clock))} in each machine`;

const view = computed(() =>
  legacy(() => {
    const row = props.row,
      phase = stage();
    if (beginnerMode() || !calculated) return null;
    const recipe = clockRecipe(row);
    const planned = pinnedClockOf(plannedClocks(calculated), phase, recipe),
      wanted = pinnedClockOf(wantedClocks(calculated, state), phase, recipe);
    if (
      !clockable(row, phase, calculated.settings) &&
      planned === undefined &&
      wanted === undefined
    )
      return null;
    // What the line runs at now: its plain row and its amplified twin, at the line's clock.
    const lines = (calcStage()?.rows ?? []).filter(line => clockRecipe(line) === recipe);
    const clock = lines.find(line => line.clock)?.clock;
    const machines = lines.reduce((sum, line) => sum + line.machines, 0),
      // The game's count (gameShards): a last machine at the remainder takes fewer. A storage-only
      // line (`<recipe>:stock`) runs at 100% and is not part of it.
      shards = lines.reduce((sum, line) => sum + gameShards(line), 0),
      fewer = lines.some(line => (line.shards ?? 0) > gameShards(line));
    const named = `${localeNumber(machines)} ${row.machine}${machines === 1 ? '' : 's'}`;
    // A clock a hand-edited file or a later release asked for stays choosable as it is.
    const clocks: (number | undefined)[] = [undefined, ...SHARD_PIN_CLOCKS];
    if (wanted !== undefined && !clocks.includes(wanted)) clocks.push(wanted);
    return {
      id: recipe,
      value: wanted === undefined ? '' : String(wanted),
      options: clocks.map(entry => ({
        value: entry === undefined ? '' : String(entry),
        label: optionText(entry),
      })),
      now: clock
        ? `This plan runs this line at ${localeNumber(clock)}%: ${named} with ${powerShardWords(shardsPerMachine(clock))} each${fewer ? ' (the last one fewer, at its lower clock)' : ''}, ${powerShardWords(shards)} in all.`
        : `This plan runs this line at 100%: ${named}, no Power Shards.`,
      note: shardPinNote(calculated, state, phase, recipe),
      selectId: 'shard-pin-' + recipe,
      noteId: 'shard-pin-note-' + recipe,
    };
  }),
);

// "Pin": the clock chosen as this line's pin ('' forgets it): the whole map of clocks asked for,
// with this one changed; null when that is what the plan already has, so the saved map is forgotten.
function pin(event: Event) {
  const current = view.value;
  if (!current || !calculated) return;
  const button = event.currentTarget as HTMLButtonElement;
  const field = document.getElementById(current.selectId) as HTMLSelectElement | null;
  const chosen = field?.value ? Number(field.value) : undefined;
  const next = withClock(wantedClocks(calculated, state), stage(), current.id, chosen);
  const value = sameClocks(next, plannedClocks(calculated)) ? null : next;
  return whileBusy(button, async () => {
    try {
      await save({ type: 'lineClocks', value });
      render();
    } catch {
      // save() has said why; the select keeps what was chosen.
    }
  });
}
</script>

<template>
  <fieldset v-if="view" class="shard-pin" data-shard-pin-choice>
    <legend>Power Shards on this line</legend>
    <p class="small muted" data-shard-pin-now>{{ view.now }}</p>
    <div class="shard-pin-row">
      <label :for="view.selectId">Run every machine at</label>
      <select
        :id="view.selectId"
        :value="view.value"
        :data-shard-pin="view.id"
        :aria-describedby="view.noteId"
      >
        <option v-for="option in view.options" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <button type="button" class="btn" data-shard-pin-save @click="pin">Pin</button>
    </div>
    <p :id="view.noteId" class="small muted" data-shard-pin-note>{{ view.note }}</p>
  </fieldset>
</template>
