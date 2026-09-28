<!--
  The pages that need an open save (the build plan, factories, logistics, storage, power &
  resources and notes) while none exists (#281, #360): an empty workspace opens on the guided
  start, but the navigation still leads to these, which drew a dashboard of zeros or nothing at
  all. This says why and offers one primary action, "Create a save" (newSave in ui/actions.ts,
  which opens the guided start), with importing on the Backup page as the quiet alternative.
  pages.ts picks it in their place; Saves & profiles and Backup work without a save.
-->
<script setup lang="ts">
import { computed, nextTick, watch } from 'vue';
import { view } from '../../session.ts';
import { legacy } from '../bridge.ts';
import { newSave } from '../actions.ts';
import PageHeader from '../PageHeader.vue';

const TITLES: Record<string, string> = {
  plan: 'Build plan',
  factories: 'Factories',
  logistics: 'Logistics',
  storage: 'Storage room',
  resources: 'Power & resources',
  notes: 'Notes',
};
const title = computed(() => legacy(() => TITLES[view] || 'No save yet'));

// One component serves all six pages, so moving between them (Back, Forward, a typed address)
// keeps it mounted and focusOpenedPage() in ui/refocus.ts, which runs when a page replaces
// another, does not. This does the same: the heading takes focus when focus was on the page
// being left (its Create a save) or nowhere. A followed sidebar link keeps focus, as it does
// between any two pages.
watch(title, async () => {
  await nextTick();
  const main = document.querySelector<HTMLElement>('#main');
  const current = document.activeElement;
  if (current && current !== document.body && !main?.contains(current)) return;
  document.querySelector<HTMLElement>('#main h1')?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
});
</script>

<template>
  <PageHeader
    eyebrow="NO SAVE YET"
    :title="title"
    subtitle="This page shows your plan once a save exists. Answer a few questions and the planner works the plan out."
  />
  <section class="panel no-save" data-no-save>
    <h2>Start with a save</h2>
    <p>
      A save holds your factory plan and your progress: checkmarks, deliveries and notes. Nothing
      has been saved yet.
    </p>
    <button type="button" class="btn primary" data-new-save @click="newSave">Create a save</button>
    <p class="small muted">
      Moving from another browser or the Docker edition?
      <a href="#backup">Import saves on the Backup page</a>.
    </p>
  </section>
</template>
