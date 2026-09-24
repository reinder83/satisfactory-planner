<!-- The heading row at the top of every page. -->
<script setup>
defineProps({
  eyebrow: { type: String, required: true },
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  badge: { type: String, default: '' },
});
</script>

<template>
  <div class="heading-row">
    <div>
      <div class="eyebrow">{{ eyebrow }}</div>
      <h1>{{ title }}</h1>
      <div v-if="subtitle" class="subtitle">{{ subtitle }}</div>
    </div>
    <span v-if="badge" class="badge orange">{{ badge }}</span>
  </div>
</template>
