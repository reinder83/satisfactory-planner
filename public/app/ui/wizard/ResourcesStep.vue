<!--
  All settings step 4, resource budgets: one "limit:<resource>" box per raw resource, the
  button that opens the node survey (ui/pages/SurveyPage.vue) to work them out, and the
  limitsConfirmed box, which maximum output needs.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { resourceDefaults } from '../../../preferences.ts';
import { draft, wizard, workspace } from '../../session.ts';
import { openExtraction } from '../../wizard/extraction.ts';
import { legacy } from '../bridge.ts';
import InputField from '../form/InputField.vue';

const view = computed(() =>
  legacy(() => {
    const s = draft().settings;
    return {
      description: resourceDefaults(s.purity, s.distribution).description,
      seed: s.worldSeed ? 'Recorded seed: ' + s.worldSeed + '. ' : '',
      limits: workspace.catalog.raw.map(n => ({ name: n, value: s.limits[n] })),
      confirmed: !!s.limitsConfirmed,
    };
  }),
);
</script>

<template>
  <h2>Available resource budgets</h2>
  <p>
    <button type="button" class="btn primary" data-open-extraction @click="openExtraction()">
      Work these out from my nodes →
    </button>
    <span class="small muted"
      >Count what your world holds and the planner turns it into these rates.</span
    >
  </p>
  <p>
    Enter the extraction you can allocate to this new plan, per minute, after existing factories and
    power fuel. Starter values are full-map estimates at endgame extraction, not resources already
    connected.
  </p>
  <div class="notice blue">
    {{ view.description }}
    {{ view.seed
    }}<a href="https://satisfactoryworldseed.com/" target="_blank" rel="noreferrer"
      >Look up your seed totals</a
    >
    ·
    <a href="https://satisfactory.wiki.gg/wiki/Resource_Node" target="_blank" rel="noreferrer"
      >Node reference</a
    >. Resource-rich counts cannot be filled accurately without your seed: enter the lookup totals
    below. Oil-well extraction may be added after its unlock.
  </div>
  <div class="resource-inputs">
    <InputField
      v-for="l in view.limits"
      :key="l.name"
      :label="l.name"
      :name="'limit:' + l.name"
      :value="l.value"
      min="0"
      max="10000000"
      step="any"
      required
    />
  </div>
  <label class="check-row"
    ><input name="limitsConfirmed" type="checkbox" :checked="view.confirmed" />I have checked these
    budgets for my save (required for maximum output)</label
  >
</template>
