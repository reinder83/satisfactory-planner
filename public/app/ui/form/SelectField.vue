<!-- A labelled <select> from [value, label] pairs, showing `value` (the first option when no
     option has it, as a select does by itself). `name` is the form field the screen reads it
     back from, and its help text key. The value is set on the select, after its options. -->
<script setup>
import { computed } from 'vue';
import HelpTip from './HelpTip.vue';

const props = defineProps({
  label: { type: String, required: true },
  name: { type: String, required: true },
  options: { type: Array, required: true },
  value: { type: [String, Number], default: '' },
});
const shown = computed(() =>
  props.options.some(([v]) => v === String(props.value))
    ? String(props.value)
    : props.options[0]?.[0],
);
</script>

<template>
  <label class="field"
    >{{ label }} <HelpTip :name="name" /><select :name="name" :value="shown">
      <option v-for="[v, l] in options" :key="v" :value="v">{{ l }}</option>
    </select></label
  >
</template>
