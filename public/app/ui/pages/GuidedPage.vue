<!--
  #wizard during the guided start (wizard.mode 'guided', until its questions are answered): a
  short illustrated sequence that writes the same settings object the five steps write. For a
  save that already has profiles it first asks what is different (ui/guided/GuidedTopics.vue);
  otherwise the question at guidedStep, as picture cards (GuidedCards.vue), the rate rows of
  the "already producing" question (ui/wizard/SupplyRows.vue), the hours for a timed goal and
  the top-up chips on the stock question. "All settings →" lands on the step that owns the
  question, keeping every answer. The flow, readers and moves are in wizard/guided.ts: every
  answer is read back from the form (readGuidedForm) and redraws, since it decides what
  follows, and past the last question the plan is calculated and the five steps' Review
  (WizardPage.vue) takes over. The form is keyed by screen, so each starts from the draft. A
  missing Save name stops Continue and All settings with a message beside the box
  (form/NameField.vue, #622).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { browserMode } from '../../../browser-api.ts';
import { draft, wizard } from '../../session.ts';
import { render } from '../../shell.ts';
import { guidedFlow, moveGuided, readGuidedForm, toAdvanced } from '../../wizard/guided.ts';
import { cancelWizard } from '../../wizard/wizard.ts';
import { legacy } from '../bridge.ts';
import BrowserNotice from '../BrowserNotice.vue';
import InputField from '../form/InputField.vue';
import NameField from '../form/NameField.vue';
import GuidedCards from '../guided/GuidedCards.vue';
import GuidedTopics from '../guided/GuidedTopics.vue';
import GuidedTopup from '../guided/GuidedTopup.vue';
import PageHeader from '../PageHeader.vue';
import SupplyRows from '../wizard/SupplyRows.vue';

// null once the draft has left the guided questions: until render() swaps this page out, it
// draws nothing.
const page = computed(() =>
  legacy(() => {
    const wizardDraft = wizard;
    if (wizardDraft?.mode !== 'guided') return null;
    const flow = guidedFlow();
    const topics = !!wizardDraft.saveId && wizardDraft.guidedAsk === null;
    const index = topics ? -1 : Math.min(wizardDraft.guidedStep - 1, flow.length - 1);
    const question = topics ? null : flow[index];
    return {
      key: topics ? 'topics' : String(wizardDraft.guidedStep),
      title: wizardDraft.saveId
        ? 'Add a profile to ' + wizardDraft.saveName
        : 'Create your factory plan',
      topics,
      index,
      progress: flow.map((step, i) => ({
        id: step.id,
        label: step.short || step.title.replace(/\?$/, ''),
        state: i === index ? 'current' : i < index ? 'done' : '',
      })),
      question,
      timed: question?.id === 'goal' && wizardDraft.settings.goal === 'timed',
      hours: wizardDraft.settings.hours ?? 8,
      adding: !!wizardDraft.saveId,
      name: wizardDraft.saveId ? wizardDraft.name : wizardDraft.saveName,
      last: topics ? false : index >= flow.length - 1,
      first: topics || wizardDraft.guidedStep <= 1,
      advancedStep: question?.step || 1,
    };
  }),
);

// A question's answer, a top-up chip or a topic decides what follows: read and redraw. A topic
// is only recorded (wizard.guidedTopics): Continue applies them, so the topics screen stays.
function changed(event: Event) {
  const name = String((event.target as HTMLInputElement).name);
  if (name.startsWith('guided:') || name === 'topup' || name === 'topic') {
    readGuidedForm(event.currentTarget as HTMLFormElement);
    render();
  }
}

// Enter or the primary button: the next question, or past the last one calculate the plan.
// The submit stops here, since nothing else handles the wizard form.
function submit() {
  moveGuided(draft().guidedStep + 1);
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
      class="panel wizard-panel guided-panel"
      @change="changed"
      @submit.prevent.stop="submit"
    >
      <div v-if="!page.topics" class="guided-name">
        <NameField
          :label="page.adding ? 'Profile name' : 'Save name'"
          :name="page.adding ? 'profileName' : 'saveName'"
          :value="page.name"
          error-id="guided-name-error"
          :check="!page.adding"
          maxlength="80"
          :placeholder="
            page.adding ? 'Named after your goal if left blank' : 'e.g. My Satisfactory save'
          "
        />
      </div>
      <GuidedTopics v-if="page.topics" />
      <h2 v-else-if="!page.question">Ready to calculate</h2>
      <template v-else>
        <h2>{{ page.question.title }}</h2>
        <p>{{ page.question.lead }}</p>
        <SupplyRows v-if="page.question.kind === 'supply'" />
        <GuidedCards v-else :question="page.question" />
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
            @click="toAdvanced(page.advancedStep)"
          >
            All settings →
          </button>
          <button class="btn primary" type="submit">
            {{ page.last ? 'Calculate plan' : 'Continue →' }}
          </button></span
        >
      </div>
    </form>
  </template>
</template>
