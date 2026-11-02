<!-- A labelled <input>, showing `value`.
     `name` is the form field the screen reads it back from, and its help text key unless `help`
     names another (a field called `hours` has the help text `guidedHours`, #1021). Any other
     attribute (min, max, step, required, readonly, maxlength) goes on the input. -->
<script setup lang="ts">
import HelpTip from './HelpTip.vue';

defineOptions({ inheritAttrs: false });
withDefaults(
  defineProps<{
    label: string;
    name: string;
    help?: string;
    value?: string | number;
    type?: string;
  }>(),
  { value: '', type: 'number' },
);
</script>

<template>
  <label class="field"
    >{{ label }} <HelpTip :name="help ?? name" /><input
      :name="name"
      :type="type"
      :value="value"
      v-bind="$attrs"
  /></label>
</template>
