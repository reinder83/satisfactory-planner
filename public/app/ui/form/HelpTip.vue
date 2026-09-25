<!-- The ⓘ tooltip for a setting, or nothing when preferences.ts has no help text for `name`. It opens on hover and on
     keyboard focus, and the tooltip text doubles as its accessible name. -->
<script setup lang="ts">
import { computed } from 'vue';
import { helpText } from '../../../preferences.ts';

const props = defineProps<{ name: string }>();
const text = computed(() => helpText[props.name] || '');
</script>

<template>
  <span v-if="text" class="setting-help" tabindex="0" :aria-label="text"
    >ⓘ<span role="tooltip">{{ text }}</span></span
  >
</template>
