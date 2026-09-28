<!--
  #wizard for the five steps ("All settings"), and for the guided start's Review once its
  questions are answered: step tabs, the current step in #wizard-form (ui/wizard/), and Back /
  Cancel, "← Guided start" and the primary button. Without a draft it offers to create a save.
  The steps keep the legacy readers: their inputs are named as before and not bound to the
  draft, so readWizard (wizard/wizard.ts) reads the form exactly as it did, and moving between
  steps reads the one being left. The form is keyed by step, so every step starts from the
  draft and a new step clears the error line. Enter or the primary button moves on until
  Review, which calculates, and on Review creates the profile. The submit stops here, since
  nothing else handles the wizard form. Beside Goals and Resources is the live estimate
  (ui/wizard/EstimatePanel.vue, SP-33), which every edit there restarts; at 720px and below it
  sits under the form.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { browserMode } from '../../../browser-api.ts';
import { draft, wizard } from '../../session.ts';
import { render } from '../../shell.ts';
import { toGuided } from '../../wizard/guided.ts';
import {
  cancelWizard,
  createProfile,
  moveWizard,
  readWizard,
  submitLabel,
  wizardError,
} from '../../wizard/wizard.ts';
import { scheduleEstimate } from '../../wizard/estimate.ts';
import { legacy } from '../bridge.ts';
import { isBusy, whileBusy } from '../../busy.ts';
import BrowserNotice from '../BrowserNotice.vue';
import EstimatePanel from '../wizard/EstimatePanel.vue';
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
    if (!w) return { draft: false as const };
    return {
      draft: true as const,
      step: w.step,
      title: w.saveId ? 'Add a profile to ' + w.saveName : 'Create your factory plan',
      submit: submitLabel(w),
    };
  }),
);

// Settings whose answer changes what the step shows: read the step and redraw.
function changed(e: Event) {
  if (['recipes', 'mainPower', 'pureIngots'].includes((e.target as HTMLInputElement).name)) {
    readWizard(e.currentTarget as HTMLFormElement);
    render();
  }
  edited(e);
}

// Goals and Resources estimate as they are edited (SP-33, wizard/estimate.ts).
const estimating = computed(() => page.value.draft && [3, 4].includes(page.value.step));
function edited(e: Event) {
  if (estimating.value) scheduleEstimate(e.currentTarget as HTMLFormElement);
}

async function submit(e: Event) {
  const w = draft(),
    form = e.currentTarget as HTMLFormElement,
    // Every step's form has its submit button.
    b = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  if (w.step < 5) {
    await moveWizard(w.step + 1);
    return;
  }
  // Busy while it calculates (app/busy.ts): it keeps focus (#299), and Enter in a field submits
  // nothing more meanwhile, since the browser presses the busy button for it.
  if (isBusy(b)) return;
  await whileBusy(b, async () => {
    try {
      await createProfile(form, b);
    } catch (err) {
      wizardError(form, err as Error);
      // calcProgress rewrote the button's label, so give it the right one back.
      b.textContent = submitLabel(w);
    }
  });
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
        :aria-current="page.step === i + 1 ? 'step' : undefined"
        @click="moveWizard(i + 1)"
      >
        {{ i + 1 }}. {{ n }}
      </button>
    </div>
    <div :class="['wizard-body', estimating ? 'with-estimate' : '']">
      <form
        id="wizard-form"
        :key="page.step"
        class="panel wizard-panel"
        @change="changed"
        @input="edited"
        @submit.prevent.stop="submit"
      >
        <SettingsStep v-if="page.step === 1" />
        <PreferencesStep v-else-if="page.step === 2" />
        <GoalStep v-else-if="page.step === 3" />
        <ResourcesStep v-else-if="page.step === 4" />
        <ReviewStep v-else-if="page.step === 5" />
        <div class="wizard-actions">
          <button
            v-if="page.step === 1"
            type="button"
            class="btn"
            data-cancel-wizard
            @click="cancelWizard"
          >
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
      <EstimatePanel v-if="estimating" />
    </div>
  </template>
</template>
