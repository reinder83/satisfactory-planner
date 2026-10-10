<!--
  The resource budgets: one "limit:<resource>" box per raw resource, in the draft's
  settings.limits. All settings step 4 (ResourcesStep.vue) draws them, and so does the guided
  start's budget screen for maximum output (ui/guided/GuidedBudgets.vue, #1072); both read them
  the same way (readLimit in wizard/wizard.ts). The confirmation under them is BudgetConfirm.vue.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { draft, workspace } from '../../session.ts';
import { legacy } from '../bridge.ts';
import InputField from '../form/InputField.vue';

const limits = computed(() =>
  legacy(() => {
    const settings = draft().settings;
    return workspace.catalog.raw.map(name => ({ name, value: settings.limits[name] }));
  }),
);
</script>

<template>
  <div class="resource-inputs">
    <InputField
      v-for="limit in limits"
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
</template>
