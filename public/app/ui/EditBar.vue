<!--
  The bar an edit mode shows while it is on (SP-13, #248): "Editing steps · Done editing" (or
  groups, or the storage layout), sticky at the top of the page as it scrolls, so Done never
  needs a scroll back to the page's own toggle, which stays the way in. A page draws it right
  after its header, as a child of <main>, which is what it sticks within. Done and Esc leave the
  mode through `done`, then focus goes to the page's toggle (`toggle`, a selector). A `done` that
  returns false kept the mode on and put focus where the user must act first (an unsaved "Made on
  site" choice, #930, or a step's edit form with unsaved text, #969), so focus stays there. Esc is left alone while typing in a field (a checkbox
  or radio takes no typing, so Esc on one still leaves, #981), while a dialog is open, or when
  something already handled it (a menu, a step's own edit form).
-->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted } from 'vue';

const props = defineProps<{ label: string; toggle: string; done: () => boolean | void }>();

async function leave() {
  if (props.done() === false) return;
  await nextTick();
  document.querySelector<HTMLElement>(props.toggle)?.focus();
}
function key(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const target = event.target as HTMLElement | null;
  // A checkbox or radio takes no typing, so Esc on one still leaves the mode (#981).
  if (
    target?.closest(
      'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable], dialog, [role="menu"]',
    )
  )
    return;
  if (document.querySelector('dialog[open]')) return;
  event.preventDefault();
  void leave();
}
onMounted(() => document.addEventListener('keydown', key));
onBeforeUnmount(() => document.removeEventListener('keydown', key));
</script>

<template>
  <div class="edit-bar" role="region" :aria-label="label" data-edit-bar>
    <span class="edit-bar-label">{{ label }}</span>
    <button type="button" class="btn primary" data-edit-bar-done @click="leave">
      Done editing
    </button>
  </div>
</template>
