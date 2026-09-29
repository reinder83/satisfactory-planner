<!-- The header and body of the shared #detail dialog. `icon` is an item name for the header
     icon. The × closes it (closeDetail in ui/actions.ts). The `actions` slot puts controls in
     the sticky header, between the title and the × (a factory's Running box, #239), so they stay
     in view while the body scrolls and come between them in the tab order. The h2 names the
     dialog: #detail in index.html has aria-labelledby="detail-title" (#321), and every #detail
     dialog renders this frame, so the name follows whichever dialog is shown. `summary` is a
     line under the title, as PageHeader has under a page's: a factory's output and storage rate
     (SP-21, #256), in the units' own case, which the uppercase eyebrow would not keep.
     `wrapTitle` lets the title wrap on a phone rather than end in an ellipsis (#435), for a
     name the user typed that the body does not repeat. -->
<script setup lang="ts">
import ItemIcon from '../ItemIcon.vue';
import { closeDetail } from '../actions.ts';

withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    summary?: string;
    icon?: string;
    wrapTitle?: boolean;
  }>(),
  { subtitle: '', summary: '', icon: '', wrapTitle: false },
);
</script>

<template>
  <header :class="['dialog-head', wrapTitle ? 'wrap-title' : '']">
    <div class="dialog-title">
      <span v-if="icon" class="dialog-icon"><ItemIcon :name="icon" /></span>
      <div>
        <div class="eyebrow">{{ subtitle }}</div>
        <h2 id="detail-title">{{ title }}</h2>
        <div v-if="summary" class="subtitle" data-dialog-summary>{{ summary }}</div>
      </div>
    </div>
    <div class="dialog-head-actions">
      <slot name="actions" />
      <button class="close" aria-label="Close details" data-close @click="closeDetail">×</button>
    </div>
  </header>
  <div class="dialog-body"><slot /></div>
</template>
