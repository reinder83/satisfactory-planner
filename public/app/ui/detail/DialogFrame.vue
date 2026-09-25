<!-- The header and body of the shared #detail dialog. `icon` is an item name for the header
     icon. The × closes it (closeDetail in ui/actions.ts). -->
<script setup>
import ItemIcon from '../ItemIcon.vue';
import { closeDetail } from '../actions.ts';

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
    <button class="close" aria-label="Close details" data-close @click="closeDetail">×</button>
  </header>
  <div class="dialog-body"><slot /></div>
</template>
