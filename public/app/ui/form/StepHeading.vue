<!--
  The heading of a wizard or guided-start screen. It takes focus when Continue or Back brings
  the screen in (focusNewStep in ui/refocus.ts, #608): tabindex="-1" makes it focusable by script
  but not by Tab, and the ring shows after a key press only, like a page's h1. With `step` its
  accessible name starts with where the screen is ("Step 2 of 5: How do you want to build?"),
  which a screen reader reads out on arrival; the visible text stays the screen's own heading.
-->
<script setup lang="ts">
defineProps<{ step?: number; total?: number }>();
</script>

<template>
  <h2 tabindex="-1" data-step-heading>
    <span v-if="step && total" class="visually-hidden">Step {{ step }} of {{ total }}: </span
    ><slot />
  </h2>
</template>
