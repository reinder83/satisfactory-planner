<!-- A labelled <select> from [value, label] pairs, showing `value` (the first option when no
     option has it, as a select does by itself). `name` is the form field the screen reads it
     back from, and its help text key. The value is set on the select, after its options. -->
<script setup lang="ts">
import { computed } from 'vue';
import HelpTip from './HelpTip.vue';

const props = withDefaults(
  // options are [value, label] pairs.
  defineProps<{
    label: string;
    name: string;
    options: readonly (readonly string[])[];
    value?: string | number;
  }>(),
  { value: '' },
);
const shown = computed(() =>
  props.options.some(([value]) => value === String(props.value))
    ? String(props.value)
    : props.options[0]?.[0],
);
</script>

<template>
  <label class="field"
    >{{ label }} <HelpTip :name="name" /><select :name="name" :value="shown">
      <option v-for="[optionValue, optionLabel] in options" :key="optionValue" :value="optionValue">
        {{ optionLabel }}
      </option>
    </select></label
  >
</template>
