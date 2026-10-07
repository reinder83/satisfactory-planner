<!--
  The dialog for one row of a calculated plan at the current phase: its Running box in the
  sticky header (#239), writing `calc-<stage>-<row id>` like the row's card and build-plan
  step, and under the title the card's headline rate (SP-21, #256); then the flow diagram, the
  byproduct advice (RecycleAdvice.vue, #1022), machine setup (machineSetup in
  views/calculated.ts, drawn as the three MachineCells, SP-20) with the line's clocks in a
  whole-machine plan (ExactClockChoice.vue, #1066),
  lane advice, the outputs (only where the headline does not already say them), expansion by
  phase and the note saved under `factory-<row id>`. The easier rounded setting is left out
  when the profile already runs whole machines. Opened by openCalculatedFactory in
  factory-detail.ts. Headed as the row's build-plan step is titled (buildRowName), so a factory
  group's own line made on site is "Wire for Alpha", as the links that open it say, and the
  dialog's accessible name tells it from the central "Wire" line (#946).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { calcFlowModel, FLUIDS } from '../../flow.ts';
import { calcStage, calculated, checked, phase, phaseLabel, stage } from '../../session.ts';
import {
  buildRowName,
  calcExpansion,
  carriedLineText,
  easierSetup,
  machineSetup,
  rowIcon,
} from '../../views/calculated.ts';
import { machineCounts } from '../../views/factories.ts';
import { inputText } from '../../views/storage.ts';
import { power } from '../../wizard/fields.ts';
import { lineLoad } from '../../../power.ts';
import type { CalcRow } from '../../../types/index.ts';
import { legacy } from '../bridge.ts';
import DetailNote from './DetailNote.vue';
import DialogFrame from './DialogFrame.vue';
import ExactClockChoice from './ExactClockChoice.vue';
import FlowDiagram from './FlowDiagram.vue';
import LaneAdvice from './LaneAdvice.vue';
import MachineCells from './MachineCells.vue';
import RecycleAdvice from './RecycleAdvice.vue';
import { toggleCheck } from '../actions.ts';

const props = defineProps<{ id: string }>();

// What the line draws or gives, after its machine: in a plan made since #1064 (its stage has a
// grid) a consumer at its clocked power, a Particle Accelerator, Converter or Quantum Encoder at
// its peak and its average, and a generator line its output and its whole generators' capacity;
// in an older plan its whole-machine peak or its output, as before.
function loadText(row: CalcRow): string {
  if (!calcStage()?.grid)
    return row.peakMW > 0
      ? ' · peak load ' + power(row.peakMW)
      : row.generationMW > 0
        ? ' · generates ' + power(row.generationMW)
        : '';
  const factor = calculated?.settings.powerFactor ?? 1,
    { peak, average } = lineLoad(row);
  if (row.power < 0)
    return ` · generates ${power(row.generationMW)}, up to ${power(row.machines * -row.power)}`;
  if (peak <= 0) return '';
  return average < peak - 1e-6
    ? ` · draws ${power(peak * factor)} at peak, ${power(average * factor)} on average`
    : ' · draws ' + power(peak * factor);
}

const view = computed(() =>
  legacy(() => {
    const row = calcStage()?.rows?.find(r => r.id === props.id);
    if (!row) return null;
    const setup = machineSetup(row),
      counts = machineCounts(row.machines, setup.partial ? setup.clock : 100),
      easy = easierSetup(setup);
    const check = 'calc-' + stage() + '-' + row.id;
    // The card's headline (SP-21): a generator's power, even when it also makes waste (#371),
    // else the main output. The outputs list below stays only where the card lists them too: a
    // generator's waste, more than one, or one that is not what the row is named after.
    const guide = calculated?.guide?.factories?.[row.id];
    const outputs = Object.entries(row.outputs || {}),
      [main, rate] = outputs[0] || [],
      generator = row.generationMW > 0;
    return {
      row,
      title: buildRowName(row.id),
      check,
      done: checked(check),
      running: `Running at ${phaseLabel(stage())} target`,
      // A plan guide's printed page and note for the row (#468).
      subtitle:
        phaseLabel(phase()) + (guide?.page !== undefined ? ` · Printed page ${guide.page}` : ''),
      note: guide?.note ?? '',
      // A row the guide builds at the nuclear site, as the handbook's dialog says (#478).
      nuclear: !!guide?.nuclear,
      summary:
        main && !generator
          ? num(rate) + (FLUIDS.has(main) ? '\u00a0m³/min' : '/min')
          : power(row.generationMW),
      icon: rowIcon(row),
      flow: calcFlowModel(row),
      setup,
      // The three machine cells (SP-20), from the count and clock the row's card shows; the
      // captions keep the output per machine and the calculated clock this table used to show.
      machines: {
        counts,
        total: row.machine + loadText(row),
        full: counts.full ? setup.fullOutput + ' each' : '',
        adjustable: counts.clock
          ? '≈ ' + num(setup.clock) + '% → ≈ ' + setup.lastOutput
          : 'No underclock needed',
      },
      easy: easy
        ? {
            clock: easy.clock,
            output:
              inputText(easy.output) ||
              num(((row.generationMW / (row.equivalent || 1)) * easy.clock) / 100) + ' MW',
            inputs: inputText(easy.inputs),
            extra: inputText(easy.extraOutputs) || 'Additional generation',
          }
        : null,
      outputs:
        (generator && main) || outputs.length > 1 || (main && main !== row.name)
          ? inputText(row.outputs)
          : '',
      expansion: calcExpansion(row.id),
      // What runs from the phase before and what this phase changes on it (#1069).
      carried: carriedLineText(row),
    };
  }),
);
</script>

<template>
  <DialogFrame
    v-if="view"
    :title="view.title"
    :subtitle="view.subtitle"
    :summary="view.summary"
    :icon="view.icon"
  >
    <template #actions
      ><label class="check-row"
        ><input
          type="checkbox"
          :data-check="view.check"
          @change="toggleCheck"
          :checked="view.done"
        />{{ view.running }}</label
      ></template
    >
    <div v-if="view.note" class="notice info" data-guide-note>{{ view.note }}</div>
    <div v-if="view.nuclear" class="notice info" data-guide-nuclear>
      Process buffer at the nuclear site. Keep radioactive recycling flows balanced; do not apply a
      generic storage surplus.
    </div>
    <FlowDiagram :model="view.flow" />
    <RecycleAdvice :id="view.row.id" />
    <h3>Machine setup</h3>
    <MachineCells
      :counts="view.machines.counts"
      :total-caption="view.machines.total"
      :full-caption="view.machines.full"
      :adjustable-caption="view.machines.adjustable"
    />
    <ExactClockChoice :row="view.row" />
    <div v-if="view.easy" class="notice info">
      <b>Easier optional setting: set only the adjustable machine to {{ view.easy.clock }}%.</b>
      <p>Its output: {{ view.easy.output }}.</p>
      <p>
        Extra inputs needed: {{ view.easy.inputs }}.<br />Extra outputs/byproducts:
        {{ view.easy.extra }}.
      </p>
      <p>
        This is extra capacity, not a recalculated balanced plan. Supply the extra inputs and handle
        every extra output before using it. The totals below remain the original calculated targets.
      </p>
    </div>
    <p v-if="view.setup.partial" class="small muted">
      Calculated percentages and outputs are displayed rounded. Keep the calculated setting for
      tightly balanced recycling; do not round nuclear or waste-processing lines independently.
    </p>
    <LaneAdvice :model="view.flow" />
    <template v-if="view.outputs"
      ><h3>Outputs per minute</h3>
      <p>{{ view.outputs }}</p></template
    >
    <h3>Expansion by phase</h3>
    <table>
      <thead>
        <tr>
          <th>Phase</th>
          <th>Machines</th>
          <th>Add</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="expansionRow in view.expansion"
          :key="expansionRow.phase"
          :class="expansionRow.current ? 'current-phase' : undefined"
          :aria-current="expansionRow.current ? 'true' : undefined"
        >
          <td>
            {{ expansionRow.label
            }}<small v-if="expansionRow.tag" class="phase-tag">{{ expansionRow.tag }}</small
            ><small v-if="expansionRow.running" class="phase-tag running-tag" data-expansion-running
              >marked running</small
            >
          </td>
          <td>{{ expansionRow.required }}</td>
          <td>{{ expansionRow.add }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="view.carried" class="small" data-expansion-carried>{{ view.carried }}</p>
    <p class="small muted">
      The optimizer may choose a different recipe in another phase. Keep earlier buildings until the
      replacement chain runs. Screws and wire can be made beside consumers.
    </p>
    <DetailNote :note-key="'factory-' + view.row.id" />
  </DialogFrame>
</template>
