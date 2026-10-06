<!--
  A production line's clocks in its dialog (#1066), under Machine setup, in a whole-machine plan.
  A line that rounds to whole machines (roundsWholeLine in app/exact-clocks.ts) has "Exact clocks
  for this line": ticked, its last machine is to be underclocked to the exact remainder instead of
  sending the overflow to storage or the sink. The box saves the choice (`exactClocks`, the whole
  map, through save() in api.ts) and recalculates nothing: the note under it says the plan runs the
  line as it was calculated until the user starts "Recalculate with exact clocks" on the build plan
  (ExactClocksRecalc.vue). Choosing what the plan already has forgets the saved choice (null), so a
  state goes back to the version it had. A fluid line, and a nuclear one, always runs at exact
  clocks and says so instead, as does a storage-only line (#1061); generators and amplified lines
  show nothing.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { save } from '../../api.ts';
import { whileBusy } from '../../busy.ts';
import {
  exactClockIn,
  fluidLines,
  plannedExactClocks,
  roundsWholeLine,
  sameExactClocks,
  wantedExactClocks,
  withExactClock,
} from '../../exact-clocks.ts';
import { FLUIDS, itemRate } from '../../flow.ts';
import { exactClocksKeep, sinkCause } from '../../sink-cause.ts';
import { calcStage, calculated, stage, state, workspace } from '../../session.ts';
import { render } from '../../shell.ts';
import { legacy } from '../bridge.ts';
import type { CalcRow } from '../../../types/index.ts';

const props = defineProps<{ row: CalcRow }>();

const view = computed(() =>
  legacy(() => {
    const row = props.row;
    // The catalog's storage items are the solid, sinkable ones roundsWholeLine asks about; a
    // catalog without them (none is loaded) shows nothing rather than guess.
    const items = workspace.catalog?.storageItems;
    if (!calculated?.settings.wholeMachines || row.amplified || row.generationMW > 0 || !items)
      return null;
    const sinkable = new Set(items.map(item => item.name));
    // A storage-only line (#1061) is planned at exact clocks by definition.
    if (row.stock)
      return {
        fixed:
          'A storage-only line always runs at exact clocks: it makes only what its containers take, so the last machine is underclocked to the exact remainder.',
      };
    if (!roundsWholeLine(row, sinkable, fluidLines(calculated, FLUIDS)))
      return {
        fixed: Object.keys(row.outputs || {}).some(item => FLUIDS.has(item))
          ? 'A fluid line always runs at exact clocks: a pipe cannot overflow, so the last machine is underclocked to the exact remainder.'
          : 'This line balances exactly, so it always runs at exact clocks.',
      };
    const phase = stage(),
      planned = exactClockIn(plannedExactClocks(calculated), phase, row.id),
      wanted = exactClockIn(wantedExactClocks(calculated, state), phase, row.id);
    // The main product's overflow in this phase: what the phase makes of it beyond every use, and
    // why (sinkCause, #1063): exact clocks remove only what rounding to whole machines explains.
    const [main] = Object.keys(row.outputs || {}).filter(item => sinkable.has(item));
    const current = calcStage();
    const spare = (main && current?.surplus?.[main]) || 0;
    const keep =
      main && current && spare > 0.005
        ? exactClocksKeep(sinkCause(row, main, spare, current, true, item => FLUIDS.has(item)))
        : undefined;
    const note =
      planned !== wanted
        ? 'Saved. The plan keeps running this line as it was calculated until you recalculate: the build plan offers “Recalculate with exact clocks”, which makes a new profile and leaves this one as it is.'
        : planned
          ? 'This plan runs the line at exact clocks: whole machines at 100% and the last one underclocked to the exact remainder.'
          : spare > 0.005 && main
            ? `This plan runs the line on whole machines at 100%. This phase makes ${itemRate(main, spare)} more ${main} than it uses, which goes to storage or the sink. ${keep ?? 'Exact clocks underclock the last machine to the exact remainder instead, and the lines feeding it shrink with it.'}`
            : 'This plan runs the line on whole machines at 100%. Exact clocks underclock the last machine to the exact remainder instead, and the lines feeding it shrink with it.';
    return { id: row.id, wanted, note, noteId: 'exact-clock-note-' + row.id };
  }),
);

// The box: the whole map of lines asked for, with this one changed; null when that is what the
// plan already has, so the saved choice is forgotten. A failed write puts the box back.
function toggle(event: Event) {
  const box = event.target as HTMLInputElement,
    on = box.checked;
  if (!calculated) return;
  const next = withExactClock(wantedExactClocks(calculated, state), stage(), props.row.id, on);
  const value = sameExactClocks(next, plannedExactClocks(calculated)) ? null : next;
  return whileBusy(box, async () => {
    try {
      await save({ type: 'exactClocks', value });
      render();
    } catch {
      box.checked = !on;
    }
  });
}
</script>

<template>
  <p v-if="view && 'fixed' in view" class="small muted" data-exact-clock-fixed>{{ view.fixed }}</p>
  <div v-else-if="view" class="exact-clock" data-exact-clock-choice>
    <label class="check-row"
      ><input
        type="checkbox"
        :data-exact-clock="view.id"
        :checked="view.wanted"
        :aria-describedby="view.noteId"
        @change="toggle"
      />Exact clocks for this line</label
    >
    <p :id="view.noteId" class="small muted" data-exact-clock-note>{{ view.note }}</p>
  </div>
</template>
