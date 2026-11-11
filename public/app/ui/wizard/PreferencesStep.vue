<!--
  All settings step 2, preferences: recipes, ingots, SAM, power and drone fuel, nuclear,
  storage and refill rates, somersloops and augmenters, then the somersloop ledger, the
  per-item storage rates, the MAM recipes box (MamRecipes, #1058, under every recipe access),
  for custom recipe access the alternate recipe picker with its owned, hunting and not allowed
  states (AltPicker, #1075), and for Standard and All the alternates you already own
  (OwnedAlternates, #1068; the picker holds them under custom access). Recipe
  access, preferred power, the ingot choice, drone fuel and nuclear change what the step shows,
  so WizardPage reads the step and redraws when they change. A rate that only means something
  with a choice made (the drone fuel supply and the battery bridge, the minimum of uranium
  reactors) shows only then, so no screen says "no drone fuel" beside a supply of 10 (#1072);
  its stored value is kept, as the planner ignores it without the choice.
  The fields above the picker (those, the somersloop ledger and the storage rates) are one
  disclosure, folded by default with a one-line summary (ONB-1, #1328), so the picker starts near
  the top; the viewer's choice is kept in this browser (wizard/settings-fold.ts), and an invalid
  field opens it.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { droneFuels, powerOptions, storageOptions } from '../../../preferences.ts';
import { draft } from '../../session.ts';
import { legacy } from '../bridge.ts';
import { setSettingsOpen, settingsOpen, settingsSummary } from '../../wizard/settings-fold.ts';
import InputField from '../form/InputField.vue';
import SelectField from '../form/SelectField.vue';
import AltPicker from './AltPicker.vue';
import MamRecipes from './MamRecipes.vue';
import OwnedAlternates from './OwnedAlternates.vue';
import SloopLedger from './SloopLedger.vue';
import StorageRates from './StorageRates.vue';
import StepHeading from '../form/StepHeading.vue';

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
const FUELS = droneFuels.map(fuel => [fuel, fuel === 'none' ? 'No dedicated drone fuel' : fuel]);

const settings = computed(() => legacy(() => ({ ...draft().settings })));

// The settings form is a disclosure (ONB-1, #1328), folded unless this viewer opened it (the
// choice is remembered in this browser, wizard/settings-fold.ts). Its fields stay in the form
// while folded, so the step is read and validated as before. A field the browser finds invalid
// opens it for as long as the step is on screen without changing the remembered choice, so an
// error is never hidden: the invalid event fires before the browser tries to focus the field,
// and the region is shown at once for that.
const region = ref<HTMLElement>();
const forced = ref(false);
const shown = computed(() => settingsOpen.value || forced.value);
// The summary reads the form's values from when it was last folded, or the draft's.
const live = ref<Record<string, string> | null>(null);
const summary = computed(() =>
  settingsSummary(name =>
    live.value
      ? live.value[name]
      : String(settings.value[name as keyof typeof settings.value] ?? ''),
  ),
);
function toggle() {
  if (shown.value) {
    const form = region.value?.closest('form');
    if (form) {
      const data = new FormData(form);
      live.value = Object.fromEntries([...data].map(([key, value]) => [key, String(value)]));
    }
    forced.value = false;
    setSettingsOpen(false);
  } else setSettingsOpen(true);
}
function reveal() {
  if (shown.value) return;
  forced.value = true;
  if (region.value) region.value.hidden = false;
}
</script>

<template>
  <StepHeading :all-settings="2">How do you want to build?</StepHeading>
  <section class="settings-fold" data-settings-fold>
    <h3 class="settings-fold-head">
      <button
        type="button"
        class="settings-fold-toggle"
        data-settings-toggle
        :aria-expanded="shown"
        aria-controls="prefs-settings"
        @click="toggle"
      >
        <span class="alt-caret" aria-hidden="true">{{ shown ? '▾' : '▸' }}</span
        ><span class="settings-fold-title">Build settings</span
        ><span v-if="!shown" class="settings-fold-summary" data-settings-summary>{{
          summary
        }}</span>
      </button>
    </h3>
    <div
      id="prefs-settings"
      ref="region"
      class="settings-fold-body"
      :hidden="!shown"
      @invalid.capture="reveal"
    >
      <div class="form-grid">
        <SelectField
          label="Recipe access"
          name="recipes"
          :options="RECIPES"
          :value="settings.recipes"
        />
        <SelectField
          label="Ingot lines"
          name="pureIngots"
          :options="INGOTS"
          :value="String(settings.pureIngots)"
        />
        <SelectField
          label="SAM resource conversion"
          name="sam"
          :options="SAM"
          :value="settings.sam"
        />
        <InputField
          label="Extra utilities power (%)"
          name="utilityPercent"
          :value="settings.utilityPercent ?? 20"
          min="0"
          max="200"
          step="1"
          required
        />
        <SelectField
          label="Drone fuel"
          name="droneFuel"
          :options="FUELS"
          :value="settings.droneFuel || 'none'"
        />
        <InputField
          v-if="settings.droneFuel && settings.droneFuel !== 'none'"
          label="Drone fuel supply (items/min, entire fleet)"
          name="droneFuelRate"
          :value="settings.droneFuelRate ?? 10"
          min="0.01"
          max="10000"
          step="any"
          required
        />
        <InputField
          v-if="settings.droneFuel === 'Packaged Ionized Fuel'"
          label="Phase 4 battery bridge /min (ionized fuel only)"
          name="droneBridgeRate"
          :value="settings.droneBridgeRate ?? 10"
          min="0.01"
          max="10000"
          step="any"
          required
        />
        <SelectField
          label="Preferred main power"
          name="mainPower"
          :options="powerOptions"
          :value="settings.mainPower || 'auto'"
        />
        <SelectField
          label="Nuclear goal"
          name="nuclear"
          :options="NUCLEAR"
          :value="settings.nuclear"
        />
        <InputField
          v-if="settings.nuclear !== 'none'"
          label="Minimum uranium reactors from Phase 4"
          name="uraniumReactors"
          :value="settings.uraniumReactors"
          min="1"
          max="1000"
          step="1"
          required
        />
        <SelectField
          label="Storage supply"
          name="storage"
          :options="storageOptions"
          :value="settings.storage"
        />
        <SelectField
          label="Collectables storage"
          name="collectables"
          :options="COLLECTABLES"
          :value="String(settings.collectables ?? settings.storage === 'all')"
        />
        <InputField
          label="Construction materials refill /min"
          name="buildRate"
          :value="settings.buildRate ?? settings.storageRate"
          min="0"
          max="300"
          step="0.1"
          required
        />
        <InputField
          label="Other items refill /min"
          name="storageRate"
          :value="settings.storageRate"
          min="0.1"
          max="300"
          step="0.1"
          required
        />
        <InputField
          label="Extra Singularity Cells /min in Phase 5"
          name="cellsPerMinute"
          :value="settings.cellsPerMinute"
          min="0"
          max="1000"
          step="0.1"
          required
        />
        <InputField
          label="Somersloops available to spend"
          name="somersloops"
          :value="settings.somersloops ?? 0"
          min="0"
          max="106"
          step="1"
          required
        />
        <InputField
          label="Alien Power Augmenters in Phase 5"
          name="augmenters"
          :value="settings.augmenters ?? 0"
          min="0"
          max="10"
          step="1"
          required
        />
        <InputField
          label="Of those, fueled with Alien Power Matrix"
          name="fueledAugmenters"
          :value="settings.fueledAugmenters ?? 0"
          min="0"
          max="10"
          step="1"
          required
        />
        <InputField
          label="Somersloops for production amplification"
          name="amplifySloops"
          :value="settings.amplifySloops ?? 0"
          min="0"
          max="106"
          step="1"
          required
        />
      </div>
      <SloopLedger /><StorageRates />
    </div>
  </section>
  <MamRecipes /><AltPicker v-if="settings.recipes === 'custom'" /><OwnedAlternates v-else />
  <div class="notice info" data-explain>
    SAM conversion controls raw resource conversion, not SAM ingredients required by late-game
    parts. Pure recipes still need unlocking. Gathered items get storage positions but cannot have
    an unlimited automatic source.
  </div>
  <p class="small muted" data-explain>
    Each Main Portal consumes <b>2 Singularity Cells/min</b> to maintain its connection; the
    Satellite Portal does not consume cells. <b>10/min supplies five connections</b> (the standard
    recipe produces 10/min). Reserve portal operating power separately.
    <a href="https://satisfactory.wiki.gg/wiki/Portal" target="_blank" rel="noreferrer"
      >Portal reference</a
    >. Nuclear waste and unpackaged fluids stay outside the storage room.
  </p>
</template>
