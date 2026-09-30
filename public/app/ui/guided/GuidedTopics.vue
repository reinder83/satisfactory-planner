<!--
  "What is different this time?": a second profile for a save you already play starts from
  the settings of the profile you are on, so it is asked what changed rather than every
  question again. Shows those settings, and one "topic" box per question (the phase ticked
  until a change records the ticks in wizard.guidedTopics, so a redraw keeps them); Continue
  (moveGuided) turns the ticked ones into wizard.guidedAsk, which narrows guidedFlow().
-->
<script setup lang="ts">
import { computed } from 'vue';
import { guidedQuestions, storageOptions } from '../../../preferences.ts';
import { num } from '../../format.ts';
import { draft, workspace } from '../../session.ts';
import { legacy } from '../bridge.ts';

const view = computed(() =>
  legacy(() => {
    const wizardDraft = draft(),
      settings = wizardDraft.settings,
      save = workspace.saves.find(entry => entry.id === wizardDraft.saveId);
    const from =
      save?.profiles.find(
        profile => profile.id === (wizardDraft.carryFrom || save.activeProfile),
      ) || save?.profiles[0];
    return {
      from: from?.name,
      ticked: wizardDraft.guidedTopics || ['phase'],
      known: [
        ['Phase', 'Phase ' + (settings.phase || '3')],
        [
          'Goal',
          workspace.catalog.goals.find(goal => goal.id === settings.goal)?.name || settings.goal,
        ],
        [
          'Recipes',
          settings.recipes === 'all'
            ? 'All alternates'
            : settings.recipes === 'custom'
              ? num((settings.alternateRecipes || []).length) + ' picked'
              : 'Standard only',
        ],
        [
          'Stocked',
          (storageOptions.find(([value]) => value === settings.storage) || [, settings.storage])[1],
        ],
        ['Machines', settings.wholeMachines === false ? 'Exact ratios' : 'Whole machines'],
      ],
    };
  }),
);
</script>

<template>
  <h2>What is different this time?</h2>
  <p>
    Starting from the settings of <b>{{ view.from || 'this save' }}</b
    >. Tick only what changes; the rest is kept as it is.
  </p>
  <div class="guided-known">
    <span v-for="[label, value] in view.known" :key="label"
      ><b>{{ label }}</b
      >{{ value }}</span
    >
  </div>
  <div class="guided-topics">
    <label v-for="question in guidedQuestions" :key="question.id" class="check-row"
      ><input
        type="checkbox"
        name="topic"
        :value="question.id"
        :checked="view.ticked.includes(question.id)"
      />{{ question.title }}</label
    >
  </div>
  <p class="small muted">
    Progress from {{ view.from || 'the other profile' }} can be carried over on the Review step,
    including the production lines this plan does not expand.
  </p>
</template>
