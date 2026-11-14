<!--
  "Next up: Iron & Steel Works · 0/11 lines [Build order]" above the toolbar of the factories page
  (FAC-4, #1342): the first factory, in the order the factories are listed, that does not run
  completely yet (nextUp in views/factories.ts), with its running lines. Factories with no line
  running are folded below it, so the page opens on what is started and what to build next.
  [Build order] is the factory's build-order page (a link: it goes to another page); a factory
  with a single line has none, so [Show] brings its section instead. Not shown while editing.
-->
<script setup lang="ts">
import { flowRoute } from '../../session.ts';
import type { FactoryProgress } from '../../views/factories.ts';
import { showSection } from './reveal.ts';

defineProps<{ next: FactoryProgress }>();
</script>

<template>
  <p class="notice info next-up" data-next-up>
    <span
      >Next up: <b data-next-up-name>{{ next.name }}</b> ·
      <span data-next-up-count>{{ next.running }}/{{ next.total }} lines</span></span
    ><a
      v-if="next.total > 1"
      class="btn"
      :href="'#' + flowRoute(next.id)"
      data-next-up-order
      :aria-label="'Build order of ' + next.name"
      >Build order</a
    ><button
      v-else
      type="button"
      class="btn"
      data-next-up-show
      :aria-label="'Show ' + next.name"
      @click="showSection(next.id)"
    >
      Show
    </button>
  </p>
</template>
