<!-- A labelled <input>, showing `value`.
     `name` is the form field the screen reads it back from, and its help text key. Any other
     attribute (min, max, step, required, readonly, maxlength) goes on the input. -->
<script setup lang="ts">
import HelpTip from './HelpTip.vue';

defineOptions({ inheritAttrs: false });
withDefaults(
  defineProps<{ label: string; name: string; value?: string | number; type?: string }>(),
  { value: '', type: 'number' },
);
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
