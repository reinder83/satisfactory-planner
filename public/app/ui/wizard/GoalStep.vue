<!--
  All settings step 3, goal: the goal cards (radio "goal", with the one these settings suggest
  marked), the profile name (the goal's name until one is typed), hours per phase, what the
  target time applies to, and the rounding and whole-machine checkboxes. readWizard reads the
  two checkboxes only on this step, since an unticked box is absent from the form.
-->
<script setup>
import { computed } from 'vue';
import { wizard, workspace } from '../../session.ts';
import { legacy } from '../bridge.ts';
import InputField from '../form/InputField.vue';
import SelectField from '../form/SelectField.vue';

const PHASE_TIME = [
  ['every', 'Every phase'],
  ['final', 'The final phase; earlier phases run as fast as their kept buildings allow'],
];

const view = computed(() =>
  legacy(() => {
    const w = wizard,
      s = w.settings;
    const goals = workspace.catalog.goals;
    return {
      timed: s.multiplier > 5,
      goals: goals.map(g => ({ ...g, on: s.goal === g.id })),
      recommended: s.multiplier > 5 ? 'timed' : 'balanced',
      name: w.name || goals.find(g => g.id === s.goal).name,
      hours: s.hours,
      phaseTime: s.phaseTime || 'every',
      roundRates: !!s.roundRates,
      wholeMachines: s.wholeMachines !== false,
    };
  }),
);
</script>

<template>
  <h2>Choose your production goal</h2>
  <p>
    {{
      view.timed
        ? 'Your elevator multiplier makes completion time a useful starting point.'
        : 'Balanced progression is a practical starting point for these settings.'
    }}
    Storage and your selected preferences apply to every option.
  </p>
  <div class="goal-grid">
    <label v-for="g in view.goals" :key="g.id" class="goal-card"
      ><input type="radio" name="goal" :value="g.id" :checked="g.on" /><strong>{{ g.name }}</strong
      ><span v-if="view.recommended === g.id" class="badge orange">Suggested</span>
      <p>{{ g.description }}</p></label
    >
  </div>
  <div class="form-grid">
    <InputField
      label="Profile name"
      name="profileName"
      :value="view.name"
      type="text"
      required
      maxlength="80"
    />
    <InputField
      label="Hours per phase (target-time option)"
      name="hours"
      :value="view.hours"
      min="0.25"
      max="2000"
      step="0.25"
      required
    />
    <SelectField
      label="Target time applies to"
      name="phaseTime"
      :options="PHASE_TIME"
      :value="view.phaseTime"
    />
  </div>
  <label class="check-row"
    ><input type="checkbox" name="roundRates" :checked="view.roundRates" />Round delivery rates to
    convenient numbers (may change completion time)</label
  ><label class="check-row"
    ><input type="checkbox" name="wholeMachines" :checked="view.wholeMachines" />Run solid-part
    machines at 100%; send surplus to storage, then the sink</label
  >
  <p class="small muted">
    Inputs and byproducts are recalculated. Fluid, generator and nuclear/recycling lines may still
    need balancing. Recipe choices are selected first, then whole-machine counts are fitted within
    your budgets.
  </p>
  <p class="small muted">
    Maximum output means fastest simultaneous elevator completion, within your resource budgets. It
    does not maximize sink points. Rounding is ignored for maximum output.
  </p>
</template>
