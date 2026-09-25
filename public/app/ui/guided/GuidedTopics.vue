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
    const w = draft(),
      s = w.settings,
      save = workspace.saves.find(x => x.id === w.saveId);
    const from =
      save?.profiles.find(p => p.id === (w.carryFrom || save.activeProfile)) || save?.profiles[0];
    return {
      from: from?.name,
      ticked: w.guidedTopics || ['phase'],
      known: [
        ['Phase', 'Phase ' + (s.phase || '3')],
        ['Goal', workspace.catalog.goals.find(g => g.id === s.goal)?.name || s.goal],
        [
          'Recipes',
          s.recipes === 'all'
            ? 'All alternates'
            : s.recipes === 'custom'
              ? num((s.alternateRecipes || []).length) + ' picked'
              : 'Standard only',
        ],
        ['Stocked', (storageOptions.find(([v]) => v === s.storage) || [, s.storage])[1]],
        ['Machines', s.wholeMachines === false ? 'Exact ratios' : 'Whole machines'],
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
    <span v-for="[k, v] in view.known" :key="k"
      ><b>{{ k }}</b
      >{{ v }}</span
    >
  </div>
  <div class="guided-topics">
    <label v-for="q in guidedQuestions" :key="q.id" class="check-row"
      ><input type="checkbox" name="topic" :value="q.id" :checked="view.ticked.includes(q.id)" />{{
        q.title
      }}</label
    >
  </div>
  <p class="small muted">
    Progress from {{ view.from || 'the other profile' }} can be carried over on the Review step,
    including the production lines this plan does not expand.
  </p>
</template>
