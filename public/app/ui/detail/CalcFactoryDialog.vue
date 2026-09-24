<!--
  The dialog for one row of a calculated plan at the current phase: flow diagram, machine
  setup (machineSetup in views/calculated.js), lane advice, outputs, expansion by phase and
  the note saved under `factory-<row id>`. The easier rounded setting is left out when the
  profile already runs whole machines. Opened by openCalculatedFactory in factory-detail.js.
-->
<script setup>
import { computed } from 'vue';
import { num } from '../../format.js';
import { calcFlowModel } from '../../flow.js';
import { calcStage, calculated, phase, phaseLabel } from '../../session.js';
import { calcExpansion, machineSetup } from '../../views/calculated.js';
import { inputText } from '../../views/storage.js';
import { power } from '../../wizard/fields.js';
import { legacy } from '../bridge.js';
import DetailNote from './DetailNote.vue';
import DialogFrame from './DialogFrame.vue';
import FlowDiagram from './FlowDiagram.vue';
import LaneAdvice from './LaneAdvice.vue';

const props = defineProps({ id: { type: String, required: true } });

const view = computed(() =>
  legacy(() => {
    const r = calcStage()?.rows?.find(r => r.id === props.id);
    if (!r) return null;
    const m = machineSetup(r);
    return {
      r,
      subtitle: phaseLabel(phase()),
      icon: Object.keys(r.outputs || {})[0] || '',
      flow: calcFlowModel(r),
      setup: m,
      clock: num(m.clock),
      easy:
        m.easy && !calculated?.settings.wholeMachines
          ? {
              clock: m.easy.clock,
              output:
                inputText(m.easy.output) ||
                num(((r.generationMW / (r.equivalent || 1)) * m.easy.clock) / 100) + ' MW',
              inputs: inputText(m.easy.inputs),
              extra: inputText(m.easy.extraOutputs) || 'Additional generation',
            }
          : null,
      outputs: inputText(r.outputs) || power(r.generationMW),
      expansion: calcExpansion(r.id),
    };
  }),
);
</script>

<template>
  <DialogFrame v-if="view" :title="view.r.name" :subtitle="view.subtitle" :icon="view.icon">
    <FlowDiagram :model="view.flow" />
    <h3>Machine setup</h3>
    <p>
      <b>{{ view.setup.summary }}</b>
    </p>
    <table>
      <thead>
        <tr>
          <th>Machines</th>
          <th>Clock each</th>
          <th>Output per machine</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="view.setup.whole > 0">
          <td>{{ view.setup.whole }} full-speed</td>
          <td>100%</td>
          <td>{{ view.setup.fullOutput }}</td>
        </tr>
        <tr v-if="view.setup.partial">
          <td>1 adjustable</td>
          <td>≈ {{ view.clock }}%</td>
          <td>≈ {{ view.setup.lastOutput }}</td>
        </tr>
      </tbody>
    </table>
    <div v-if="view.easy" class="notice blue">
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
    <h3>Outputs per minute</h3>
    <p>{{ view.outputs }}</p>
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
