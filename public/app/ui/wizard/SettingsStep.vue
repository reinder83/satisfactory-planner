<!--
  All settings step 1, game settings: the save name (read-only when adding to a save), phase,
  world settings, multipliers, power in MW (stored as GW by readWizard) and the production you
  already run. Changing purity or distribution replaces the budgets on step 4 with that
  world's starting estimates when the step is read.
-->
<script setup>
import { computed } from 'vue';
import { distributions, purities } from '../../../preferences.js';
import { wizard } from '../../session.ts';
import { legacy } from '../bridge.ts';
import HelpTip from '../form/HelpTip.vue';
import InputField from '../form/InputField.vue';
import SelectField from '../form/SelectField.vue';
import SupplyRows from './SupplyRows.vue';

const PHASES = ['1', '2', '3', '4', '5'].map(x => [x, 'Phase ' + x]);

const view = computed(() =>
  legacy(() => {
    const w = wizard,
      s = w.settings;
    return {
      saveName: w.saveName,
      adding: !!w.saveId,
      phase: s.phase,
      purity: s.purity,
      distribution: s.distribution,
      worldSeed: s.worldSeed || '',
      multiplier: s.multiplier,
      powerFactor: s.powerFactor,
      availablePowerMW: s.availablePowerGW * 1000,
      installedPowerMW: (s.installedPowerGW ?? s.availablePowerGW) * 1000,
      modNotes: s.modNotes || '',
    };
  }),
);
</script>

<template>
  <h2>Your save and game settings</h2>
  <p>Use the settings shown in your game. Values are multipliers: half consumption is 0.5.</p>
  <div class="form-grid">
    <InputField
      label="Save name"
      name="saveName"
      :value="view.saveName"
      type="text"
      required
      maxlength="80"
      :readonly="view.adding"
    />
    <SelectField label="Currently working on" name="phase" :options="PHASES" :value="view.phase" />
    <SelectField label="Resource purity" name="purity" :options="purities" :value="view.purity" />
    <SelectField
      label="Node distribution"
      name="distribution"
      :options="distributions"
      :value="view.distribution"
    />
    <InputField
      label="World seed (optional)"
      name="worldSeed"
      :value="view.worldSeed"
      min="-2147483648"
      max="2147483647"
      step="1"
    />
    <InputField
      label="Elevator requirement multiplier"
      name="multiplier"
      :value="view.multiplier"
      min="0.1"
      max="1000"
      step="0.1"
      required
    />
    <InputField
      label="Power consumption multiplier"
      name="powerFactor"
      :value="view.powerFactor"
      min="0"
      max="10"
      step="0.1"
      required
    />
    <InputField
      label="Spare existing power (MW)"
      name="availablePowerMW"
      :value="view.availablePowerMW"
      min="0"
      max="10000000"
      step="1"
      required
    />
    <InputField
      label="Total installed power (MW)"
      name="installedPowerMW"
      :value="view.installedPowerMW"
      min="0"
      max="10000000"
      step="1"
      required
    />
    <InputField
      label="Other settings / mod notes"
      name="modNotes"
      :value="view.modNotes"
      type="text"
      maxlength="500"
    />
  </div>
  <h3>Production you already run <HelpTip name="existingSupply" /></h3>
  <SupplyRows />
  <p class="small muted">
    Other settings are notes only. Modified recipes, production boosts and modded items are not
    simulated. Phase plans assume the necessary milestones and MAM research are unlocked by
    commissioning.
  </p>
</template>
