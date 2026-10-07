<!--
  All settings step 3, goal: the goal cards (radio "goal", with the one these settings suggest
  marked), the profile name (blank until one is typed: the profile is then named after its goal,
  what changed and the date, profileNameOf in wizard/wizard.ts, #1071), hours per phase, what the
  target time applies to, and the rounding and whole-machine checkboxes. readWizard reads the
  two checkboxes only on this step, since an unticked box is absent from the form. Under the
  whole-machine box, what it costs on these settings, measured by the live estimate's
  whole-machine pass (measuredRounding in app/exact-clocks.ts, #1066), so it reads as the trade-off
  it is rather than a free preference.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { measuredRounding } from '../../exact-clocks.ts';
import { num } from '../../format.ts';
import { draft, workspace } from '../../session.ts';
import { NAME_HINT } from '../../wizard/wizard.ts';
import { estimate } from '../../wizard/estimate.ts';
import { power } from '../../wizard/fields.ts';
import { legacy } from '../bridge.ts';
import InputField from '../form/InputField.vue';
import SelectField from '../form/SelectField.vue';
import StepHeading from '../form/StepHeading.vue';

const PHASE_TIME = [
  ['every', 'Every phase'],
  ['final', 'The final phase; earlier phases run as fast as their kept buildings allow'],
];

const view = computed(() =>
  legacy(() => {
    const wizardDraft = draft(),
      settings = wizardDraft.settings;
    const goals = workspace.catalog.goals;
    return {
      timed: settings.multiplier > 5,
      goals: goals.map(g => ({ ...g, on: settings.goal === g.id })),
      recommended: settings.multiplier > 5 ? 'timed' : 'balanced',
      // The goal is always one of the catalog's.
      name: wizardDraft.name,
      hours: settings.hours,
      phaseTime: settings.phaseTime || 'every',
      roundRates: !!settings.roundRates,
      wholeMachines: settings.wholeMachines !== false,
      // What whole machines cost on these settings, once the live estimate has measured it: the
      // whole-machine pass of a plan with them on (not the quick exact one, nor a stale result).
      cost: (() => {
        const measured =
          settings.wholeMachines !== false &&
          estimate.status === 'done' &&
          estimate.plan &&
          measuredRounding(estimate.plan);
        if (!measured) return '';
        const { phase, cost } = measured;
        return `Measured on these settings: Phase ${phase} takes ${num(cost.buildings[0])} buildings and ${power(cost.needMW[0])} of power with whole machines, against ${num(cost.buildings[1])} buildings and ${power(cost.needMW[1])} with exact clocks.`;
      })(),
    };
  }),
);
</script>

<template>
  <StepHeading :step="3" :total="5">Choose your production goal</StepHeading>
  <p>
    {{
      view.timed
        ? 'Your elevator multiplier makes completion time a useful starting point.'
        : 'Balanced progression is a practical starting point for these settings.'
    }}
    Storage and your selected preferences apply to every option.
  </p>
  <div class="goal-grid">
    <label v-for="goal in view.goals" :key="goal.id" class="goal-card"
      ><input type="radio" name="goal" :value="goal.id" :checked="goal.on" /><strong>{{
        goal.name
      }}</strong
      ><span v-if="view.recommended === goal.id" class="badge orange">Suggested</span>
      <p>{{ goal.description }}</p></label
    >
  </div>
  <div class="form-grid">
    <InputField
      label="Profile name"
      name="profileName"
      :value="view.name"
      type="text"
      maxlength="80"
      :placeholder="NAME_HINT"
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
    ><input
      type="checkbox"
      name="wholeMachines"
      :checked="view.wholeMachines"
      aria-describedby="whole-machines-cost"
    />Whole machines: run solid-part machines at 100% and send the overflow to storage, then the
    sink</label
  >
  <p id="whole-machines-cost" class="small muted">
    Whole machines have a cost: every machine runs at 100%, so the lines that feed it run at full
    speed too, which takes more buildings, power and raw resources than exact clocks (the last
    machine of each line underclocked to the exact remainder). Fluid, generator and nuclear lines
    always run at exact clocks, and single production lines can be set to exact clocks later, in
    their dialog. Recipe choices are selected first, then whole-machine counts are fitted within
    your budgets.<template v-if="view.cost"
      >{{ ' ' }}<span data-whole-machines-cost>{{ view.cost }}</span></template
    >
  </p>
  <p class="small muted">
    Maximum output means fastest simultaneous elevator completion, within your resource budgets. It
    does not maximize sink points. Rounding is ignored for maximum output.
  </p>
</template>
