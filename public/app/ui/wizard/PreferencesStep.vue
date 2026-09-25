<!--
  All settings step 2, preferences: recipes, ingots, SAM, power and drone fuel, nuclear,
  storage and refill rates, somersloops and augmenters, then the somersloop ledger, the
  per-item storage rates and, for custom recipe access, the alternate recipe picker. Recipe
  access, preferred power and the ingot choice change what the step shows, so WizardPage reads
  the step and redraws when they change.
-->
<script setup>
import { computed } from 'vue';
import { droneFuels, powerOptions, storageOptions } from '../../../preferences.js';
import { wizard } from '../../session.ts';
import { legacy } from '../bridge.ts';
import InputField from '../form/InputField.vue';
import SelectField from '../form/SelectField.vue';
import AltPicker from './AltPicker.vue';
import SloopLedger from './SloopLedger.vue';
import StorageRates from './StorageRates.vue';

const RECIPES = [
  ['standard', 'Standard recipes'],
  ['all', 'Allow all alternate recipes as they become available'],
  ['custom', 'Pick specific alternate recipes'],
];
const INGOTS = [
  ['false', 'Let the planner choose'],
  ['true', 'Require pure ingot recipes when unlocked'],
];
const SAM = [
  ['avoid', 'Avoid ore / gas conversion'],
  ['needed', 'Only to meet resource limits or improve maximum output'],
  ['allow', 'Allow whenever useful'],
];
const NUCLEAR = [
  ['none', 'No nuclear power'],
  ['sink', 'Uranium power; sink plutonium fuel rods'],
  ['recycle', 'Full waste recycling in Phase 5'],
];
const COLLECTABLES = [
  ['false', 'No collectables bays'],
  ['true', 'Include leaves, wood, slugs, food, protein and DNA'],
];
const FUELS = droneFuels.map(n => [n, n === 'none' ? 'No dedicated drone fuel' : n]);

const s = computed(() => legacy(() => ({ ...wizard.settings })));
</script>

<template>
  <h2>How do you want to build?</h2>
  <div class="form-grid">
    <SelectField label="Recipe access" name="recipes" :options="RECIPES" :value="s.recipes" />
    <SelectField
      label="Ingot factories"
      name="pureIngots"
      :options="INGOTS"
      :value="String(s.pureIngots)"
    />
    <SelectField label="SAM resource conversion" name="sam" :options="SAM" :value="s.sam" />
    <InputField
      label="Extra utilities power (%)"
      name="utilityPercent"
      :value="s.utilityPercent ?? 20"
      min="0"
      max="200"
      step="1"
      required
    />
    <SelectField
      label="Drone fuel"
      name="droneFuel"
      :options="FUELS"
      :value="s.droneFuel || 'none'"
    />
    <InputField
      label="Drone fuel supply (items/min, entire fleet)"
      name="droneFuelRate"
      :value="s.droneFuelRate ?? 10"
      min="0.01"
      max="10000"
      step="any"
      required
    />
    <InputField
      label="Phase 4 battery bridge /min (ionized fuel only)"
      name="droneBridgeRate"
      :value="s.droneBridgeRate ?? 10"
      min="0.01"
      max="10000"
      step="any"
      required
    />
    <SelectField
      label="Preferred main power"
      name="mainPower"
      :options="powerOptions"
      :value="s.mainPower || 'auto'"
    />
    <SelectField label="Nuclear goal" name="nuclear" :options="NUCLEAR" :value="s.nuclear" />
    <InputField
      label="Minimum uranium reactors from Phase 4"
      name="uraniumReactors"
      :value="s.uraniumReactors"
      min="1"
      max="1000"
      step="1"
      required
    />
    <SelectField
      label="Storage supply"
      name="storage"
      :options="storageOptions"
      :value="s.storage"
    />
    <SelectField
      label="Collectables storage"
      name="collectables"
      :options="COLLECTABLES"
      :value="String(s.collectables ?? s.storage === 'all')"
    />
    <InputField
      label="Construction materials refill /min"
      name="buildRate"
      :value="s.buildRate ?? s.storageRate"
      min="0"
      max="300"
      step="0.1"
      required
    />
    <InputField
      label="Other items refill /min"
      name="storageRate"
      :value="s.storageRate"
      min="0.1"
      max="300"
      step="0.1"
      required
    />
    <InputField
      label="Extra Singularity Cells /min in Phase 5"
      name="cellsPerMinute"
      :value="s.cellsPerMinute"
      min="0"
      max="1000"
      step="0.1"
      required
    />
    <InputField
      label="Somersloops available to spend"
      name="somersloops"
      :value="s.somersloops ?? 0"
      min="0"
      max="106"
      step="1"
      required
    />
    <InputField
      label="Alien Power Augmenters in Phase 5"
      name="augmenters"
      :value="s.augmenters ?? 0"
      min="0"
      max="10"
      step="1"
      required
    />
    <InputField
      label="Of those, fueled with Alien Power Matrix"
      name="fueledAugmenters"
      :value="s.fueledAugmenters ?? 0"
      min="0"
      max="10"
      step="1"
      required
    />
    <InputField
      label="Somersloops for production amplification"
      name="amplifySloops"
      :value="s.amplifySloops ?? 0"
      min="0"
      max="106"
      step="1"
      required
    />
  </div>
  <SloopLedger /><StorageRates /><AltPicker v-if="s.recipes === 'custom'" />
  <div class="notice blue">
    SAM conversion controls raw resource conversion, not SAM ingredients required by late-game
    parts. Pure recipes still need unlocking. Gathered items get storage positions but cannot have
    an unlimited automatic source.
  </div>
  <p class="small muted">
    Each Main Portal consumes <b>2 Singularity Cells/min</b> to maintain its connection; the
    Satellite Portal does not consume cells. <b>10/min supplies five connections</b> (the standard
    recipe produces 10/min). Reserve portal operating power separately.
    <a href="https://satisfactory.wiki.gg/wiki/Portal" target="_blank" rel="noreferrer"
      >Portal reference</a
    >. Nuclear waste and unpackaged fluids stay outside the storage room.
  </p>
</template>
