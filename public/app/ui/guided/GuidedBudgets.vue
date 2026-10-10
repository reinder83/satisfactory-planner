<!--
  The guided start's budget screen (#1072), right after the goal question while the goal is
  "As fast as the map allows" (guidedBudgetsQuestion, guidedFlow in wizard/guided.ts). Maximum
  output uses as much of each budget as it can, and calculate() refuses it until the budgets are
  confirmed, so this asks what All settings step 4 asks for it, with step 4's own parts:

  - "Work these out from my nodes →" opens the node survey (openExtraction), which comes back here
    with the budgets set and confirmed;
  - the budget boxes (BudgetInputs.vue, name="limit:<resource>");
  - "I have checked these budgets for my save" (BudgetConfirm.vue, name="limitsConfirmed"),
    required here, so Continue waits for it while Back and All settings do not.

  readBudgets in wizard/wizard.ts reads it with the rest of the form, as step 4 reads the same
  fields, so the settings are the ones All settings makes. Step 4's mining per phase, owned
  miners, belts and generators stay there (the latter three on "What you already have").
-->
<script setup lang="ts">
import { computed } from 'vue';
import { resourceDefaults } from '../../../preferences.ts';
import { draft } from '../../session.ts';
import { openExtraction } from '../../wizard/extraction.ts';
import { legacy } from '../bridge.ts';
import BudgetConfirm from '../wizard/BudgetConfirm.vue';
import BudgetInputs from '../wizard/BudgetInputs.vue';

const view = computed(() =>
  legacy(() => {
    const settings = draft().settings;
    return {
      description: resourceDefaults(settings.purity, settings.distribution).description,
      mining: !!settings.phaseMining,
    };
  }),
);
</script>

<template>
  <div class="guided-budgets" data-guided-budgets>
    <p class="guided-budgets-survey">
      <button type="button" class="btn" data-open-extraction @click="openExtraction()">
        Work these out from my nodes →
      </button>
      <span class="small muted"
        >Count what your world holds and the planner turns it into these rates.</span
      >
    </p>
    <p class="small muted">
      Starting values: {{ view.description }}
      <template v-if="view.mining">
        Each phase draws only its share of them, through the miners and belts it can build; All
        settings, step 4, shows each phase's.</template
      >
    </p>
    <BudgetInputs />
    <BudgetConfirm required />
  </div>
</template>
