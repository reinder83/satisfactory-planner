<!--
  One factory's part of the handover from the phase before (#1069), under its heading on the
  Factories page, or over the ungrouped lines (`place` UNGROUPED): the build plan's handover
  sentence counted over the factory's lines (handoverText), unfolding to those lines by what the
  phase does with them (handoverLines and placeHandover in app/handover.ts): the ones kept as they
  run, the ones to add machines to or change a clock on with the build-plan step's own sentence
  (carriedChange), the ones new in this phase, the ones the phase before built but did not mark
  running, and the lines retired (the retire step's list, retiredLineText). The places are the
  page's: a factory's lines are the rows with a membership in it (membershipsOf), the retired
  ones by their row id, and Ungrouped's the rows in none. It follows the build plan's summary
  (HandoverSummary.vue): nothing in Phase 1, Post Phase 5, a plan guide's or a milestone-only
  phase, and nothing once every line of the place is marked running. It counts the factory's
  lines in this phase, whatever the search and the chips show, and it reads the saved ticks and
  ticks nothing; a native <details>, so it folds by itself and remembers nothing.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { handoverLines, handoverText, placeHandover } from '../../handover.ts';
import { UNGROUPED } from '../../group-order.ts';
import { calculated, factoryEditing, phase, phaseLabel, state } from '../../session.ts';
import { buildRowName } from '../../views/calculated.ts';
import { membershipsOf } from '../../views/factories.ts';
import { retiredLineText } from '../../../progression.ts';
import { listNames } from '../../../wording.ts';
import { legacy } from '../bridge.ts';
import type { CalcRow } from '../../../types/index.ts';

// The factory group's id, or UNGROUPED for the lines in no factory.
const props = defineProps<{ place: string }>();

const view = computed(() =>
  legacy(() => {
    if (!calculated || factoryEditing) return null;
    const handover = handoverLines(calculated, state.checks, phase());
    if (!handover) return null;
    const inPlace =
      props.place === UNGROUPED
        ? (row: Pick<CalcRow, 'id'>) => !membershipsOf(row.id).length
        : (row: Pick<CalcRow, 'id'>) => membershipsOf(row.id).some(m => m.group === props.place);
    const found = placeHandover(handover, inPlace);
    if (!found) return null;
    const names = (lines: { row: CalcRow }[]) => listNames(lines.map(l => buildRowName(l.row.id)));
    const parts = [
      { status: 'keep', label: 'Keep as is', entries: [names(found.keep)] },
      {
        status: 'add',
        label: 'Add or change',
        entries: found.add.map(line => `${buildRowName(line.row.id)}: ${line.change}`),
      },
      { status: 'new', label: 'New in ' + phaseLabel(phase()), entries: [names(found.new)] },
      {
        status: 'build',
        label: `Not marked running in Phase ${handover.from}`,
        entries: [names(found.build)],
      },
      { status: 'retire', label: 'Retire', entries: found.retire.map(retiredLineText) },
    ];
    return {
      text: handoverText(found.counts),
      parts: parts.filter(part => part.entries.some(entry => entry)),
    };
  }),
);
</script>

<template>
  <details v-if="view" class="factory-handover" :data-factory-handover="place">
    <summary><b>Handover.</b> {{ view.text }}</summary>
    <dl>
      <template v-for="part in view.parts" :key="part.status">
        <dt :data-handover-status="part.status">{{ part.label }}</dt>
        <dd v-for="(entry, i) in part.entries" :key="i">{{ entry }}</dd>
      </template>
    </dl>
  </details>
</template>
