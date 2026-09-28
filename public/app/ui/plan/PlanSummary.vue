<!--
  The build plan's summary line (SP-43, #278), in place of the four tiles: what else this phase
  holds, each part a link to its page (factories, storage, power). `items` are the page's own
  figures; an item without `href` is plain text (the calculated plan's delivery time).
-->
<script setup lang="ts">
defineProps<{ items: { text: string; href?: string; key: string }[] }>();
</script>

<template>
  <ul class="plan-summary" data-plan-summary aria-label="This phase">
    <li v-for="item in items" :key="item.key" :data-summary="item.key">
      <a v-if="item.href" :href="item.href">{{ item.text }}</a
      ><template v-else>{{ item.text }}</template>
    </li>
  </ul>
</template>
