<!-- An item's bundled icon from icons/. A trailing "(...)" qualifier is dropped first. Missing icons are hidden by the error
     listener in listeners.js. -->
<script setup>
import { computed } from 'vue';
import { slug } from '../format.js';

const props = defineProps({ name: { type: String, required: true } });
const src = computed(
  () => `./icons/${slug(String(props.name).replace(/\s*\([^)]*\)\s*$/, ''))}.png`,
);
</script>

<template>
  <img class="item-icon" :src="src" width="42" height="42" loading="lazy" alt="" />
</template>
