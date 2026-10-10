<!--
  #wizard for the five steps ("All settings"; the guided start draws its own Review, GuidedPage.vue,
  #1072): step tabs, the current step in #wizard-form (ui/wizard/), and Back /
  Cancel, "← Guided start" and the primary button. Without a draft it offers to create a save.
  The steps keep the legacy readers: their inputs are named as before and not bound to the
  draft, so readWizard (wizard/wizard.ts) reads the form exactly as it did, and moving between
  steps reads the one being left. The form is keyed by step, so every step starts from the
  draft and a new step clears the error line. Enter or the primary button moves on until
  Review, which calculates, and on Review creates the profile, or for Edit settings (#1071)
  recalculates the edited profile in place ("Recalculate in place"), its owned fields started
  from the ticks where they show more (ui/wizard/TicksPrefill.vue says which, #1068). The submit
  stops here, since nothing else handles the wizard form. Beside Goals and Resources is the live estimate
  (ui/wizard/EstimatePanel.vue, SP-33), which every edit there restarts; at 720px and below it
  sits under the form, with a one-line summary at the foot of the screen (#412).
-->
<script setup lang="ts">
import { computed, watch } from 'vue';
import { browserMode } from '../../../browser-api.ts';
import { draft, wizard } from '../../session.ts';
import { render } from '../../shell.ts';
import { toGuided } from '../../wizard/guided.ts';
import {
  cancelWizard,
  createProfile,
  moveWizard,
  readWizard,
  recalculateProfile,
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
import TicksPrefill from '../wizard/TicksPrefill.vue';
import { newSave } from '../actions.ts';
import { focusNewStep } from '../refocus.ts';

const STEPS = ['Game settings', 'Preferences', 'Goals', 'Resources', 'Review'];

const page = computed(() =>
  legacy(() => {
    const wizardDraft = wizard;
    if (!wizardDraft) return { draft: false as const };
    return {
      draft: true as const,
      step: wizardDraft.step,
      eyebrow: wizardDraft.edit ? 'EDIT SETTINGS' : 'NEW PROFILE',
      title: wizardDraft.edit
        ? 'Edit the settings of ' + wizardDraft.edit.name
        : wizardDraft.saveId
          ? 'Add a profile to ' + wizardDraft.saveName
          : 'Create your factory plan',
      submit: submitLabel(wizardDraft),
    };
  }),
);

// Continue and Back replace the form, and focus with it: it goes to the new step's heading
// (#608). A step tab stays where it is, and keeps focus. Not on the first step drawn.
watch(() => page.value.draft && page.value.step, focusNewStep, { flush: 'post' });

// Settings whose answer changes what the step shows: read the step and redraw.
function changed(event: Event) {
  if (
    ['recipes', 'mainPower', 'pureIngots', 'droneFuel', 'nuclear'].includes(
      (event.target as HTMLInputElement).name,
    )
  ) {
    readWizard(event.currentTarget as HTMLFormElement);
    render();
  }
  edited(event);
}

// Goals and Resources estimate as they are edited (SP-33, wizard/estimate.ts).
const estimating = computed(() => page.value.draft && [3, 4].includes(page.value.step));
function edited(event: Event) {
  if (estimating.value) scheduleEstimate(event.currentTarget as HTMLFormElement);
}

async function submit(event: Event) {
  const wizardDraft = draft(),
    form = event.currentTarget as HTMLFormElement,
    // Every step's form has its submit button.
    button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  if (wizardDraft.step < 5) {
    await moveWizard(wizardDraft.step + 1);
    return;
  }
  // Busy while it calculates (app/busy.ts): it keeps focus (#299), and Enter in a field submits
  // nothing more meanwhile, since the browser presses the busy button for it.
  if (isBusy(button)) return;
  await whileBusy(button, async () => {
    try {
      if (wizardDraft.edit) await recalculateProfile(form, button);
      else await createProfile(form, button);
    } catch (error) {
      wizardError(form, error as Error);
      // calcProgress rewrote the button's label, so give it the right one back.
      button.textContent = submitLabel(wizardDraft);
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
    <PageHeader :eyebrow="page.eyebrow" :title="page.title" />
    <TicksPrefill />
    <div class="wizard-progress">
      <button
        v-for="(title, i) in STEPS"
        :key="title"
        type="button"
        :class="page.step === i + 1 ? 'current' : ''"
        :data-wizard-step="i + 1"
        :aria-current="page.step === i + 1 ? 'step' : undefined"
        @click="moveWizard(i + 1)"
      >
        {{ i + 1 }}. {{ title }}
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
        <p
          id="wizard-error"
          class="form-error notice error"
          role="alert"
          tabindex="-1"
          data-wizard-error
        ></p>
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
      </form>
      <EstimatePanel v-if="estimating" />
    </div>
  </template>
</template>
