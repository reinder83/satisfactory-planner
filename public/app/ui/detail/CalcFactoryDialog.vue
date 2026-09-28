<!--
  The dialog for one row of a calculated plan at the current phase: its Running box in the
  sticky header (#239), writing `calc-<stage>-<row id>` like the row's card and build-plan
  step, and under the title the card's headline rate (SP-21, #256); then the flow diagram,
  machine setup (machineSetup in views/calculated.ts, drawn as the three MachineCells, SP-20),
  lane advice, the outputs (only where the headline does not already say them), expansion by
  phase and the note saved under `factory-<row id>`. The easier rounded setting is left out
  when the profile already runs whole machines. Opened by openCalculatedFactory in
  factory-detail.ts.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { num } from '../../format.ts';
import { calcFlowModel, FLUIDS } from '../../flow.ts';
import { calcStage, checked, phase, phaseLabel, stage } from '../../session.ts';
import { calcExpansion, easierSetup, machineSetup, rowIcon } from '../../views/calculated.ts';
import { machineCounts } from '../../views/factories.ts';
import { inputText } from '../../views/storage.ts';
import { power } from '../../wizard/fields.ts';
import { legacy } from '../bridge.ts';
import DetailNote from './DetailNote.vue';
import DialogFrame from './DialogFrame.vue';
import FlowDiagram from './FlowDiagram.vue';
import LaneAdvice from './LaneAdvice.vue';
import MachineCells from './MachineCells.vue';
import { toggleCheck } from '../actions.ts';

const props = defineProps<{ id: string }>();

const view = computed(() =>
  legacy(() => {
    const r = calcStage()?.rows?.find(r => r.id === props.id);
    if (!r) return null;
    const m = machineSetup(r),
      counts = machineCounts(r.machines, m.partial ? m.clock : 100),
      easy = easierSetup(m);
    const check = 'calc-' + stage() + '-' + r.id;
    // The card's headline (SP-21): a generator's power, even when it also makes waste (#371),
    // else the main output. The outputs list below stays only where the card lists them too: a
    // generator's waste, more than one, or one that is not what the row is named after.
    const outputs = Object.entries(r.outputs || {}),
      [main, rate] = outputs[0] || [],
      generator = r.generationMW > 0;
    return {
      r,
      check,
      done: checked(check),
      running: `Running at ${phaseLabel(stage())} target`,
      subtitle: phaseLabel(phase()),
      summary:
        main && !generator
          ? num(rate) + (FLUIDS.has(main) ? '\u00a0m³/min' : '/min')
          : power(r.generationMW),
      icon: rowIcon(r),
      flow: calcFlowModel(r),
      setup: m,
      // The three machine cells (SP-20), from the count and clock the row's card shows; the
      // captions keep the output per machine and the calculated clock this table used to show.
      machines: {
        counts,
        total:
          r.machine +
          (r.peakMW > 0
            ? ' · peak load ' + power(r.peakMW)
            : r.generationMW > 0
              ? ' · generates ' + power(r.generationMW)
              : ''),
        full: counts.full ? m.fullOutput + ' each' : '',
        adjustable: counts.clock
          ? '≈ ' + num(m.clock) + '% → ≈ ' + m.lastOutput
          : 'No underclock needed',
      },
      easy: easy
        ? {
            clock: easy.clock,
            output:
              inputText(easy.output) ||
              num(((r.generationMW / (r.equivalent || 1)) * easy.clock) / 100) + ' MW',
            inputs: inputText(easy.inputs),
            extra: inputText(easy.extraOutputs) || 'Additional generation',
          }
        : null,
      outputs:
        (generator && main) || outputs.length > 1 || (main && main !== r.name)
          ? inputText(r.outputs)
          : '',
      expansion: calcExpansion(r.id),
    };
  }),
);
</script>

<template>
  <DialogFrame
    v-if="view"
    :title="view.r.name"
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
    <FlowDiagram :model="view.flow" />
    <h3>Machine setup</h3>
    <MachineCells
      :counts="view.machines.counts"
      :total-caption="view.machines.total"
      :full-caption="view.machines.full"
      :adjustable-caption="view.machines.adjustable"
    />
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
        <tr v-for="e in view.expansion" :key="e.phase">
          <td>{{ e.phase }}</td>
          <td>{{ e.required }}</td>
          <td>{{ e.add }}</td>
        </tr>
      </tbody>
    </table>
    <p class="small muted">
      The optimizer may choose a different recipe in another phase. Keep earlier buildings until the
      replacement chain runs. Screws and wire can be made beside consumers.
    </p>
    <DetailNote :note-key="'factory-' + view.r.id" />
  </DialogFrame>
</template>
