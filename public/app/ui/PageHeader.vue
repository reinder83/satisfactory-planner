<!--
  The heading row at the top of every page. Its h1 takes focus (tabindex="-1": reachable by
  script, not by Tab) when an action opens another page or profile and its control goes with the
  old one (#304, focusOpenedPage in ui/refocus.ts). Its title also names the browser tab, with the
  page it is on (pageTitle in app/page-title.ts, #1254).
-->
<script setup lang="ts">
import { watchEffect } from 'vue';
import { pageTitle } from '../page-title.ts';
import { view } from '../session.ts';
import { legacy } from './bridge.ts';

const props = withDefaults(
  defineProps<{ eyebrow: string; title: string; subtitle?: string; badge?: string }>(),
  { subtitle: '', badge: '' },
);

watchEffect(() => {
  document.title = pageTitle(
    props.title,
    legacy(() => view),
  );
});
</script>

<template>
  <div class="heading-row">
    <div>
      <div class="eyebrow">{{ eyebrow }}</div>
      <h1 tabindex="-1">{{ title }}</h1>
      <div v-if="subtitle" class="subtitle">{{ subtitle }}</div>
    </div>
    <span v-if="badge" class="badge orange">{{ badge }}</span>
  </div>
</template>
