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
  (WizardPage.vue) takes over. The form is keyed by screen, so each starts from the draft.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { browserMode } from '../../../browser-api.ts';
import { navigate } from '../../api.ts';
import { draft, setWizard, wizard } from '../../session.ts';
import { render } from '../../shell.ts';
import { guidedFlow, moveGuided, readGuidedForm, toAdvanced } from '../../wizard/guided.ts';
import { legacy } from '../bridge.ts';
import BrowserNotice from '../BrowserNotice.vue';
import InputField from '../form/InputField.vue';
import GuidedCards from '../guided/GuidedCards.vue';
import GuidedTopics from '../guided/GuidedTopics.vue';
import GuidedTopup from '../guided/GuidedTopup.vue';
import PageHeader from '../PageHeader.vue';
import SupplyRows from '../wizard/SupplyRows.vue';

// null once the draft has left the guided questions: until render() swaps this page out, it
// draws nothing.
const page = computed(() =>
  legacy(() => {
    const w = wizard;
    if (w?.mode !== 'guided') return null;
    const flow = guidedFlow();
    const topics = !!w.saveId && w.guidedAsk === null;
    const index = topics ? -1 : Math.min(w.guidedStep - 1, flow.length - 1);
    const q = topics ? null : flow[index];
    return {
      key: topics ? 'topics' : String(w.guidedStep),
      title: w.saveId ? 'Add a profile to ' + w.saveName : 'Create your factory plan',
      topics,
      progress: flow.map((x, i) => ({
        id: x.id,
        label: x.short || x.title.replace(/\?$/, ''),
        state: i === index ? 'current' : i < index ? 'done' : '',
      })),
      question: q,
      timed: q?.id === 'goal' && w.settings.goal === 'timed',
      hours: w.settings.hours ?? 8,
      adding: !!w.saveId,
      name: w.saveId ? w.name : w.saveName,
      last: topics ? false : index >= flow.length - 1,
      first: topics || w.guidedStep <= 1,
      advancedStep: q?.step || 1,
    };
  }),
);

// A question's answer, a top-up chip or a topic decides what follows: read and redraw. A topic
// is only recorded (wizard.guidedTopics): Continue applies them, so the topics screen stays.
function changed(e: Event) {
  const name = String((e.target as HTMLInputElement).name);
  if (name.startsWith('guided:') || name === 'topup' || name === 'topic') {
    readGuidedForm(e.currentTarget as HTMLFormElement);
    render();
  }
}

// "Cancel" on the first screen: drop the draft without a confirmation and show the profiles
// page. Nothing has been saved yet.
function cancel() {
  setWizard(null);
  navigate('profiles');
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
    <div v-if="!page.topics" class="guided-progress" role="list">
      <span
        v-for="p in page.progress"
        :key="p.id"
        role="listitem"
        :class="p.state"
        :aria-current="p.state === 'current' ? 'step' : undefined"
        ><i></i>{{ p.label }}</span
      >
    </div>
    <form
      id="wizard-form"
      :key="page.key"
      class="panel wizard-panel guided-panel"
      @change="changed"
      @submit.prevent.stop="submit"
    >
      <label v-if="!page.topics" class="field guided-name"
        >{{ page.adding ? 'Profile name' : 'Save name'
        }}<input
          :name="page.adding ? 'profileName' : 'saveName'"
          type="text"
          :value="page.name"
          :required="!page.adding"
          maxlength="80"
          :placeholder="
            page.adding ? 'Named after your goal if left blank' : 'My Satisfactory save'
          "
      /></label>
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
      <div class="wizard-actions">
        <button v-if="page.first" type="button" class="btn" data-cancel-wizard @click="cancel">
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
      <p id="wizard-error" class="form-error" role="alert"></p>
    </form>
  </template>
</template>
