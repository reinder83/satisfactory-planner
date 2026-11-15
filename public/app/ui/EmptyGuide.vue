<!--
  What a page that has nothing to list yet will show, and the way forward (X-7, #1355): a short
  heading, a sentence or two in the default slot and the link or button to the step that fills it
  (a real <a> or <button>, in the `links` slot). It draws no state of its own and is only put on a
  page while that page is empty: Factories and Logistics in a phase that builds no production
  lines, the Trains tab with no stations or lines, the Storage room with no container planned.
  ADA says a short line of her own on the same pages (ada.ts: empty-factories, empty-logistics,
  empty-storage; none for the Trains tab, which many players never use, so she would only nag).
  `page` is the hook the tests and browser-check.ts look for.
-->
<script setup lang="ts">
defineProps<{ page: string; title: string }>();
</script>

<template>
  <section class="empty-guide" :data-empty-guide="page" :aria-label="title">
    <h2>{{ title }}</h2>
    <slot />
    <p v-if="$slots.links" class="small empty-guide-links"><slot name="links" /></p>
  </section>
</template>
