<!--
  The heading of a wizard or guided-start screen. It takes focus when Continue or Back brings
  the screen in (focusNewStep in ui/refocus.ts, #608): tabindex="-1" makes it focusable by script
  but not by Tab, and the ring shows after a key press only, like a page's h1. With `step` its
  accessible name starts with where the screen is ("Step 2 of 5: How do you want to build?"),
  which a screen reader reads out on arrival; the visible text stays the screen's own heading.
  An All settings step passes `allSettings`, its step number, instead: the place is then its
  screen's (stepPlace in wizard/screens.ts), "Step 1 of 3" in expert mode's denser screens (#1197),
  said only by the first heading of a screen that holds two steps.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { stepPlace } from '../../wizard/screens.ts';
import { legacy } from '../bridge.ts';

const props = defineProps<{ step?: number; total?: number; allSettings?: number }>();
const place = computed(() =>
  props.allSettings
    ? legacy(() => stepPlace(props.allSettings!))
    : { step: props.step, total: props.total },
);
</script>

<template>
  <h2 tabindex="-1" data-step-heading>
    <span v-if="place.step && place.total" class="visually-hidden"
      >Step {{ place.step }} of {{ place.total }}: </span
    ><slot />
  </h2>
</template>
