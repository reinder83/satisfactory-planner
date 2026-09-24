<!-- The ⓘ tooltip for a setting (help() in wizard/fields.js for the legacy screens), or
     nothing when preferences.js has no help text for `name`. It opens on hover and on
     keyboard focus, and the tooltip text doubles as its accessible name. -->
<script setup>
import { computed } from 'vue';
import { helpText } from '../../../preferences.js';

const props = defineProps({ name: { type: String, required: true } });
const text = computed(() => helpText[props.name] || '');
</script>

<template>
  <span v-if="text" class="setting-help" tabindex="0" :aria-label="text"
    >ⓘ<span role="tooltip">{{ text }}</span></span
  >
</template>
