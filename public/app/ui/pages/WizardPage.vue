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
  At the Expert detail level (#1197, app/expert.ts) the steps take three denser screens instead of
  five (wizard/screens.ts): Game settings with Preferences, Goals with Resources, and Review, a tab
  each, without the explanatory paragraphs (`data-explain`, hidden by style.css under .compact;
  the ⓘ help tips stay). The detail level (ONB-2, #1337, ui/DetailLevel.vue) is offered above the
  steps before Review, as on the guided start: picking one reads the screen first, so nothing typed
  is lost.
-->
<script setup lang="ts">
import { computed, watch } from 'vue';
import { browserMode } from '../../../browser-api.ts';
import { DETAIL_NOTES, detailLevel } from '../../detail-level.ts';
import { expertMode } from '../../expert.ts';
import { draft, wizard } from '../../session.ts';
import { render } from '../../shell.ts';
import { pickDetail, toGuided } from '../../wizard/guided.ts';
import {
  nextScreenStep,
  previousScreenStep,
  screenSteps,
  wizardScreens,
} from '../../wizard/screens.ts';
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
import DetailLevel from '../DetailLevel.vue';
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

const page = computed(() =>
  legacy(() => {
    const wizardDraft = wizard;
    if (!wizardDraft) return { draft: false as const };
    const shown = screenSteps(wizardDraft.step);
    return {
      draft: true as const,
      step: wizardDraft.step,
      // The steps drawn on this screen, and the tabs: one per screen, named by its first step.
      shown,
      first: shown[0]!,
      tabs: wizardScreens().map((screen, i) => ({
        step: screen.steps[0]!,
        label: `${i + 1}. ${screen.title}`,
        current: screen.steps.includes(wizardDraft.step),
      })),
      expert: expertMode(),
      detail: detailLevel(),
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
  const name = (event.target as HTMLInputElement).name;
  // The detail level's own handler (DetailLevel.vue's pick) has it.
  if (name === 'wizardDetail') return;
  if (['recipes', 'mainPower', 'pureIngots', 'droneFuel', 'nuclear'].includes(name)) {
    readWizard(event.currentTarget as HTMLFormElement);
    render();
  }
  edited(event);
}

// Goals and Resources estimate as they are edited (SP-33, wizard/estimate.ts).
const estimating = computed(
  () => page.value.draft && page.value.shown.some(step => step === 3 || step === 4),
);
function edited(event: Event) {
  if ((event.target as HTMLInputElement).name === 'wizardDetail') return;
  if (estimating.value) scheduleEstimate(event.currentTarget as HTMLFormElement);
}

async function submit(event: Event) {
  const wizardDraft = draft(),
    form = event.currentTarget as HTMLFormElement,
    // Every step's form has its submit button.
    button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  if (wizardDraft.step < 5) {
    await moveWizard(nextScreenStep(wizardDraft.step));
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
        v-for="tab in page.tabs"
        :key="tab.label"
        type="button"
        :class="tab.current ? 'current' : ''"
        :data-wizard-step="tab.step"
        :aria-current="tab.current ? 'step' : undefined"
        @click="moveWizard(tab.step)"
      >
        {{ tab.label }}
      </button>
    </div>
    <div :class="['wizard-body', estimating ? 'with-estimate' : '']">
      <form
        id="wizard-form"
        :key="page.step"
        :class="['panel', 'wizard-panel', page.expert ? 'compact' : '']"
        :data-wizard-screen="page.shown.join('-')"
        @change="changed"
        @input="edited"
        @submit.prevent.stop="submit"
      >
        <div v-if="page.step < 5" class="wizard-detail" data-wizard-detail>
          <DetailLevel
            :level="page.detail"
            name="wizardDetail"
            describedby="wizard-detail-note"
            @pick="(level, form) => pickDetail(form, level)"
          />
          <p id="wizard-detail-note" class="small muted" data-explain data-detail-note>
            {{ DETAIL_NOTES[page.detail] }}
          </p>
        </div>
        <SettingsStep v-if="page.shown.includes(1)" />
        <PreferencesStep v-if="page.shown.includes(2)" />
        <GoalStep v-if="page.shown.includes(3)" />
        <ResourcesStep v-if="page.shown.includes(4)" />
        <ReviewStep v-if="page.shown.includes(5)" />
        <p
          id="wizard-error"
          class="form-error notice error"
          role="alert"
          tabindex="-1"
          data-wizard-error
        ></p>
        <div class="wizard-actions">
          <button
            v-if="page.first === 1"
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
            @click="moveWizard(previousScreenStep(page.step))"
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
