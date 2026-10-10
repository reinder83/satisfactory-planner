<!--
  The limitsConfirmed box, which maximum output needs (calculate() refuses it unconfirmed), under
  the budgets on All settings step 4 (ResourcesStep.vue) and on the guided start's budget screen
  (ui/guided/GuidedBudgets.vue, #1072). Step 4 reads it in readStepChecks, the guided screen in
  readBudgets (wizard/wizard.ts). `required` (the guided screen, which is only asked for maximum
  output) makes ticking it a condition of Continue; Back and All settings still leave the screen.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { draft } from '../../session.ts';
import { legacy } from '../bridge.ts';

defineProps<{ required?: boolean }>();

const confirmed = computed(() => legacy(() => !!draft().settings.limitsConfirmed));
</script>

<template>
  <label class="check-row"
    ><input
      name="limitsConfirmed"
      type="checkbox"
      :checked="confirmed"
      :required="required || undefined"
    />I have checked these budgets for my save (required for maximum output)</label
  >
</template>
