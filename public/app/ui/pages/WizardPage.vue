<!--
  #wizard for the five steps ("All settings"), and for the guided start's Review once its
  questions are answered: step tabs, the current step in #wizard-form (ui/wizard/), and Back /
  Cancel, "← Guided start" and the primary button. Without a draft it offers to create a save.
  The steps keep the legacy readers: their inputs are named as before and not bound to the
  draft, so readWizard (wizard/wizard.ts) reads the form exactly as it did, and moving between
  steps reads the one being left. The form is keyed by step, so every step starts from the
  draft and a new step clears the error line. Enter or the primary button moves on until
  Review, which calculates, and on Review creates the profile. The submit stops here, since
  nothing else handles the wizard form.
-->
<script setup>
import { computed } from 'vue';
import { browserMode } from '../../../browser-api.ts';
import { navigate } from '../../api.ts';
import { setWizard, wizard } from '../../session.ts';
import { render } from '../../shell.ts';
import { toGuided } from '../../wizard/guided.ts';
import {
  createProfile,
  moveWizard,
  readWizard,
  submitLabel,
  wizardError,
} from '../../wizard/wizard.ts';
import { legacy } from '../bridge.ts';
import BrowserNotice from '../BrowserNotice.vue';
import PageHeader from '../PageHeader.vue';
import GoalStep from '../wizard/GoalStep.vue';
import PreferencesStep from '../wizard/PreferencesStep.vue';
import ResourcesStep from '../wizard/ResourcesStep.vue';
import ReviewStep from '../wizard/ReviewStep.vue';
import SettingsStep from '../wizard/SettingsStep.vue';
import { newSave } from '../actions.ts';

const STEPS = ['Game settings', 'Preferences', 'Goals', 'Resources', 'Review'];

const page = computed(() =>
  legacy(() => {
    const w = wizard;
    if (!w) return { draft: false };
    return {
      draft: true,
      step: w.step,
      title: w.saveId ? 'Add a profile to ' + w.saveName : 'Create your factory plan',
      submit: submitLabel(w),
    };
  }),
);

// Settings whose answer changes what the step shows: read the step and redraw.
function changed(e) {
  if (['recipes', 'mainPower', 'pureIngots'].includes(e.target.name)) {
    readWizard(e.currentTarget);
    render();
  }
}

// "Cancel" on step 1: drop the draft without a confirmation and show the profiles page.
// Nothing has been saved yet; the profile is only created on Review.
function cancel() {
  setWizard(null);
  navigate('profiles');
}

async function submit(e) {
  const form = e.currentTarget,
    b = form.querySelector('button[type="submit"]');
  if (wizard.step < 5) {
    await moveWizard(wizard.step + 1);
    return;
  }
  b.disabled = true;
  try {
    await createProfile(form, b);
  } catch (err) {
    wizardError(form, err);
    b.disabled = false;
    // calcProgress rewrote the button's label, so give it the right one back.
    b.textContent = submitLabel(wizard);
  }
}
</script>

<template>
  <template v-if="!page.draft">
    <PageHeader eyebrow="NEW PROFILE" title="Choose a save first" />
    <button class="btn primary" data-new-save @click="newSave">Create a save</button
    ><a class="btn" href="#profiles">Existing saves</a>
  </template>
  <template v-else>
    <BrowserNotice v-if="browserMode" />
    <PageHeader eyebrow="SAVE → SETTINGS → GOALS → PLAN" :title="page.title" />
    <div class="wizard-progress">
      <button
        v-for="(n, i) in STEPS"
        :key="n"
        type="button"
        :class="page.step === i + 1 ? 'current' : ''"
        :data-wizard-step="i + 1"
        :aria-current="page.step === i + 1 ? 'step' : null"
        @click="moveWizard(i + 1)"
      >
        {{ i + 1 }}. {{ n }}
      </button>
    </div>
    <form
      id="wizard-form"
      :key="page.step"
      class="panel wizard-panel"
      @change="changed"
      @submit.prevent.stop="submit"
    >
      <SettingsStep v-if="page.step === 1" />
      <PreferencesStep v-else-if="page.step === 2" />
      <GoalStep v-else-if="page.step === 3" />
      <ResourcesStep v-else-if="page.step === 4" />
      <ReviewStep v-else-if="page.step === 5" />
      <div class="wizard-actions">
        <button v-if="page.step === 1" type="button" class="btn" data-cancel-wizard @click="cancel">
          Cancel</button
        ><button
          v-else
          type="button"
          class="btn"
          data-wizard-back
          @click="moveWizard(page.step - 1)"
        >
          Back</button
        ><span class="guided-escape"
          ><button
            v-if="page.step < 5"
            type="button"
            class="btn quiet"
            data-guided-start
            @click="toGuided()"
          >
            ← Guided start</button
          ><button class="btn primary" type="submit">{{ page.submit }}</button></span
        >
      </div>
      <p id="wizard-error" class="form-error" role="alert"></p>
    </form>
  </template>
</template>
