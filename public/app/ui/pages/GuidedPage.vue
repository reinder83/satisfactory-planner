<!--
  #wizard during the guided start (wizard.mode 'guided', until its questions are answered): a
  short illustrated sequence that writes the same settings object the five steps write. For a
  save that already has profiles it first asks what is different (ui/guided/GuidedTopics.vue);
  otherwise the question at guidedStep, as picture cards (GuidedCards.vue), the rate rows of
  the "already producing" question (ui/wizard/SupplyRows.vue), "What you already have"
  (ui/guided/GuidedHave.vue, #1068), the hours for a timed goal, the budgets maximum output needs
  confirmed (ui/guided/GuidedBudgets.vue, #1072) and
  the top-up chips on the stock question, the recipe picker for "I will choose them myself" and
  the spare power box on the power question. "All settings →" lands on the step that owns the
  question, keeping every answer. The flow, readers and moves are in wizard/guided.ts: every
  answer is read back from the form (readGuidedForm) and redraws, since it decides what
  follows, and past the last question the plan is calculated and shown here as the flow's last
  step, Review (ReviewStep.vue, as All settings shows it), whose Create profile ends the flow:
  one flow, with no second set of steps (#1072). The form is keyed by screen, so each starts from the draft. A
  missing Save name stops Continue and All settings with a message beside the box
  (form/NameField.vue, #622).
-->
<script setup lang="ts">
import { computed, watch } from 'vue';
import { browserMode } from '../../../browser-api.ts';
import { draft, wizard } from '../../session.ts';
import { render } from '../../shell.ts';
import { guidedFlow, moveGuided, readGuidedForm, toAdvanced } from '../../wizard/guided.ts';
import { NAME_HINT, cancelWizard } from '../../wizard/wizard.ts';
import { legacy } from '../bridge.ts';
import BrowserNotice from '../BrowserNotice.vue';
import InputField from '../form/InputField.vue';
import NameField from '../form/NameField.vue';
import GuidedBudgets from '../guided/GuidedBudgets.vue';
import GuidedCards from '../guided/GuidedCards.vue';
import GuidedHave from '../guided/GuidedHave.vue';
import GuidedTopics from '../guided/GuidedTopics.vue';
import GuidedTopup from '../guided/GuidedTopup.vue';
import PageHeader from '../PageHeader.vue';
import SupplyRows from '../wizard/SupplyRows.vue';
import StepHeading from '../form/StepHeading.vue';
import { focusNewStep } from '../refocus.ts';
import AltPicker from '../wizard/AltPicker.vue';
import ReviewStep from '../wizard/ReviewStep.vue';
import { isBusy, whileBusy } from '../../busy.ts';
import { createProfile, submitLabel, wizardError } from '../../wizard/wizard.ts';
import { guidedReview, reviewInAllSettings } from '../../wizard/guided.ts';

// The stepper's last step, after every flow's questions (#1072).
const REVIEW = { id: 'review', label: 'Review' };

// null once the draft has left the guided start: until render() swaps this page out, it draws
// nothing.
const page = computed(() =>
  legacy(() => {
    const wizardDraft = wizard;
    if (wizardDraft?.mode !== 'guided') return null;
    const flow = guidedFlow();
    // The calculated plan, once the questions are answered: the flow's last step (#1072).
    const review = guidedReview(wizardDraft);
    const topics = !review && !!wizardDraft.saveId && wizardDraft.guidedAsk === null;
    const index = review
      ? flow.length
      : topics
        ? -1
        : Math.min(wizardDraft.guidedStep - 1, flow.length - 1);
    const question = topics || review ? null : flow[index];
    // Review is the last step of every flow, so the stepper shows where the questions lead.
    const steps = [...flow.map(step => ({ id: step.id, label: step.short })), REVIEW];
    return {
      key: review ? 'review' : topics ? 'topics' : String(wizardDraft.guidedStep),
      review,
      title: wizardDraft.saveId
        ? 'Add a profile to ' + wizardDraft.saveName
        : 'Create your factory plan',
      topics,
      index,
      progress: steps.map((step, i) => ({
        ...step,
        state: i === index ? 'current' : i < index ? 'done' : '',
      })),
      question,
      timed: question?.id === 'goal' && wizardDraft.settings.goal === 'timed',
      hours: wizardDraft.settings.hours ?? 8,
      // "I will choose them myself": the picker under the cards, so the questions go on (#1072).
      picking: question?.id === 'recipes' && wizardDraft.settings.recipes === 'custom',
      spareMW: (wizardDraft.settings.availablePowerGW || 0) * 1000,
      adding: !!wizardDraft.saveId,
      name: wizardDraft.saveId ? wizardDraft.name : wizardDraft.saveName,
      submit: topics ? 'Continue →' : submitLabel(wizardDraft),
      first: topics || wizardDraft.guidedStep <= 1,
      // Review's All settings is the five steps' Review, with this plan (#1072).
      advancedStep: review ? 5 : question?.step || 1,
    };
  }),
);

// Continue and Back replace the form, and focus with it: it goes to the new screen's heading
// (#608). Not on the first screen drawn, which has no change to follow.
watch(() => page.value?.key, focusNewStep, { flush: 'post' });

// A question's answer, a top-up chip or a topic decides what follows: read and redraw. A topic
// is only recorded (wizard.guidedTopics): Continue applies them, so the topics screen stays.
function changed(event: Event) {
  const name = String((event.target as HTMLInputElement).name);
  if (name.startsWith('guided:') || name === 'topup' || name === 'topic') {
    readGuidedForm(event.currentTarget as HTMLFormElement);
    render();
  }
}

// Enter or the primary button: the next question, past the last one calculate the plan, and on
// Review create the profile, busy meanwhile as on All settings' Review (WizardPage.vue). The
// submit stops here, since nothing else handles the wizard form.
async function submit(event: Event) {
  if (!page.value?.review) {
    void moveGuided(draft().guidedStep + 1);
    return;
  }
  const wizardDraft = draft(),
    form = event.currentTarget as HTMLFormElement,
    button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  if (isBusy(button)) return;
  await whileBusy(button, async () => {
    try {
      await createProfile(form, button);
    } catch (error) {
      wizardError(form, error as Error);
      button.textContent = submitLabel(wizardDraft);
    }
  });
}
</script>

<template>
  <template v-if="page">
    <BrowserNotice v-if="browserMode" />
    <PageHeader
      eyebrow="A FEW QUESTIONS"
      :title="page.title"
      subtitle="Answer what matters and the planner fills in the rest. Every setting is still there under All settings."
    />
    <div v-if="!page.topics" class="guided-stepper">
      <div class="guided-progress" role="list">
        <span
          v-for="(step, i) in page.progress"
          :key="step.id"
          role="listitem"
          :class="step.state"
          :aria-current="step.state === 'current' ? 'step' : undefined"
          ><i aria-hidden="true">{{ i + 1 }}</i
          ><b class="guided-step-label">{{ step.label }}</b></span
        >
      </div>
      <span class="guided-count" data-guided-count
        >{{ page.index + 1 }} of {{ page.progress.length }}</span
      >
    </div>
    <form
      id="wizard-form"
      :key="page.key"
      :class="['panel', 'wizard-panel', page.review ? '' : 'guided-panel']"
      @change="changed"
      @submit.prevent.stop="submit"
    >
      <div v-if="!page.topics && !page.review" class="guided-name">
        <NameField
          :label="page.adding ? 'Profile name' : 'Save name'"
          :name="page.adding ? 'profileName' : 'saveName'"
          :value="page.name"
          error-id="guided-name-error"
          :check="!page.adding"
          maxlength="80"
          :placeholder="page.adding ? NAME_HINT : 'e.g. My Satisfactory save'"
        />
      </div>
      <ReviewStep v-if="page.review" />
      <GuidedTopics v-else-if="page.topics" />
      <StepHeading v-else-if="!page.question">Ready to calculate</StepHeading>
      <template v-else>
        <StepHeading :step="page.index + 1" :total="page.progress.length">{{
          page.question.title
        }}</StepHeading>
        <p>{{ page.question.lead }}</p>
        <SupplyRows v-if="page.question.kind === 'supply'" />
        <GuidedHave v-else-if="page.question.kind === 'have'" />
        <GuidedBudgets v-else-if="page.question.kind === 'budgets'" />
        <GuidedCards v-else :question="page.question" />
        <AltPicker v-if="page.picking" />
        <div v-if="page.timed" class="form-grid guided-follow">
          <InputField
            label="Hours per phase"
            name="hours"
            :value="page.hours"
            min="0.25"
            max="2000"
            step="0.25"
            required
          />
        </div>
        <div v-if="page.question.id === 'power'" class="form-grid guided-follow">
          <InputField
            label="Spare power you already have (MW)"
            name="availablePowerMW"
            :value="page.spareMW"
            min="0"
            max="10000000"
            step="1"
            required
          />
        </div>
        <GuidedTopup v-if="page.question.id === 'stock'" />
      </template>
      <p
        id="wizard-error"
        class="form-error notice error"
        role="alert"
        tabindex="-1"
        data-wizard-error
      ></p>
      <div class="wizard-actions">
        <button
          v-if="page.first"
          type="button"
          class="btn"
          data-cancel-wizard
          @click="cancelWizard"
        >
          Cancel
        </button>
        <button
          v-else
          type="button"
          class="btn"
          data-guided-back
          @click="moveGuided(draft().guidedStep - 1)"
        >
          Back
        </button>
        <span class="guided-escape"
          ><button
            type="button"
            class="btn quiet"
            :data-guided-advanced="page.advancedStep"
            @click="page.review ? reviewInAllSettings() : toAdvanced(page.advancedStep)"
          >
            All settings →
          </button>
          <button class="btn primary" type="submit">
            {{ page.submit }}
          </button></span
        >
      </div>
    </form>
  </template>
</template>
