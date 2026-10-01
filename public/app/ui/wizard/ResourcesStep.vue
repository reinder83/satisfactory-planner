<!--
  All settings step 4, resource budgets: one "limit:<resource>" box per raw resource, the
  button that opens the node survey (ui/pages/SurveyPage.vue) to work them out, and the
  limitsConfirmed box, which maximum output needs.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { resourceDefaults } from '../../../preferences.ts';
import { draft, workspace } from '../../session.ts';
import { openExtraction } from '../../wizard/extraction.ts';
import { legacy } from '../bridge.ts';
import InputField from '../form/InputField.vue';
import StepHeading from '../form/StepHeading.vue';

const view = computed(() =>
  legacy(() => {
    const settings = draft().settings;
    return {
      description: resourceDefaults(settings.purity, settings.distribution).description,
      seed: settings.worldSeed ? 'Recorded seed: ' + settings.worldSeed + '. ' : '',
      limits: workspace.catalog.raw.map(name => ({ name, value: settings.limits[name] })),
      confirmed: !!settings.limitsConfirmed,
    };
  }),
);
</script>

<template>
  <StepHeading :step="4" :total="5">Available resource budgets</StepHeading>
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
  <div class="notice info">
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
      v-for="limit in view.limits"
      :key="limit.name"
      :label="limit.name"
      :name="'limit:' + limit.name"
      :value="limit.value"
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
