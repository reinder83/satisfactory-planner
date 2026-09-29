<!-- An item's bundled icon from icons/. A trailing "(...)" qualifier is dropped first. A name with
     no bundled icon (icons.ts), such as a container named after no item, gets an empty dashed
     square of the same size instead (#448, #463), so a row of items keeps its icons in line.
     Every item a container can hold has its icon (#455). An icon that is listed but fails to load
     is hidden by the error listener in listeners.ts. -->
<script setup lang="ts">
import { computed } from 'vue';
import { slug } from '../format.ts';
import { BUNDLED_ICONS } from '../icons.ts';

const props = defineProps<{ name: string }>();
const file = computed(() => slug(String(props.name).replace(/\s*\([^)]*\)\s*$/, '')));
</script>

<template>
  <img
    v-if="BUNDLED_ICONS.has(file)"
    class="item-icon"
    :src="`./icons/${file}.png`"
    width="42"
    height="42"
    loading="lazy"
    alt=""
  />
  <svg
    v-else
    class="item-icon item-icon-missing"
    viewBox="0 0 24 24"
    width="42"
    height="42"
    aria-hidden="true"
    focusable="false"
    data-icon-missing
  >
    <rect x="1" y="1" width="22" height="22" rx="2" />
  </svg>
</template>
