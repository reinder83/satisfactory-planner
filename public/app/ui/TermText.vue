<!--
  A text with its glossary terms marked (#1076): the first occurrence of each term in `terms`
  (every glossary term when absent) is a Term.vue, the rest stays plain. The words are exactly
  `text`, so search and copying see what they saw before.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { termParts } from '../../preferences.ts';
import Term from './Term.vue';

const props = defineProps<{ text: string; terms?: readonly string[] }>();
const parts = computed(() => termParts(props.text, props.terms));
</script>

<template>
  <template v-for="(part, i) in parts" :key="i"
    ><Term v-if="part.term" :term="part.term" :text="part.text" /><template v-else>{{
      part.text
    }}</template></template
  >
</template>
