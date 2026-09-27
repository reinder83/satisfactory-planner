<!--
  The heading row at the top of every page. Its h1 takes focus (tabindex="-1": reachable by
  script, not by Tab) when an action opens another page or profile and its control goes with the
  old one (#304, focusOpenedPage in ui/refocus.ts).
-->
<script setup lang="ts">
withDefaults(defineProps<{ eyebrow: string; title: string; subtitle?: string; badge?: string }>(), {
  subtitle: '',
  badge: '',
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
