<!-- A labelled <select> from [value, label] pairs (selectField() in wizard/fields.js for the
     legacy screens), showing `value`. `name` is the form field the screen reads it back
     from, and its help text key. -->
<script setup>
import HelpTip from './HelpTip.vue';

defineProps({
  label: { type: String, required: true },
  name: { type: String, required: true },
  options: { type: Array, required: true },
  value: { type: [String, Number], default: '' },
});
</script>

<template>
  <label class="field"
    >{{ label }} <HelpTip :name="name" /><select :name="name">
      <option v-for="[v, l] in options" :key="v" :value="v" :selected="v === String(value)">
        {{ l }}
      </option>
    </select></label
  >
</template>
