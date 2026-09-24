<!-- The header and body of the shared #detail dialog. `icon` is an item name for the header
     icon. The × is handled by the shared data-close handler in events/views.js. -->
<script setup>
import ItemIcon from '../ItemIcon.vue';

defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  icon: { type: String, default: '' },
});
</script>

<template>
  <header class="dialog-head">
    <div class="dialog-title">
      <span v-if="icon" class="dialog-icon"><ItemIcon :name="icon" /></span>
      <div>
        <div class="eyebrow">{{ subtitle }}</div>
        <h2>{{ title }}</h2>
      </div>
    </div>
    <button class="close" aria-label="Close details" data-close>×</button>
  </header>
  <div class="dialog-body"><slot /></div>
</template>
