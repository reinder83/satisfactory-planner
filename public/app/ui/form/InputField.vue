<!-- A labelled <input>, showing `value`.
     `name` is the form field the screen reads it back from, and its help text key. Any other
     attribute (min, max, step, required, readonly, maxlength) goes on the input. -->
<script setup>
import HelpTip from './HelpTip.vue';

defineOptions({ inheritAttrs: false });
defineProps({
  label: { type: String, required: true },
  name: { type: String, required: true },
  value: { type: [String, Number], default: '' },
  type: { type: String, default: 'number' },
});
</script>

<template>
  <label class="field"
    >{{ label }} <HelpTip :name="name" /><input
      :name="name"
      :type="type"
      :value="value"
      v-bind="$attrs"
  /></label>
</template>
