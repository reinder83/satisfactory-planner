<!-- An item's bundled icon from icons/. A trailing "(...)" qualifier is dropped first. Missing icons are hidden by the error
     listener in listeners.js. -->
<script setup lang="ts">
import { computed } from 'vue';
import { slug } from '../format.ts';

const props = defineProps<{ name: string }>();
const src = computed(
  () => `./icons/${slug(String(props.name).replace(/\s*\([^)]*\)\s*$/, ''))}.png`,
);
</script>

<template>
  <img class="item-icon" :src="src" width="42" height="42" loading="lazy" alt="" />
</template>
