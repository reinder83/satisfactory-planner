<!--
  The notes box at the end of a factory or container dialog, saved under `noteKey` as you type
  (NoteBox.vue). The text is the box's own, so it survives the dialog redrawing when a box in
  it is ticked; each opened dialog starts from the saved note.
-->
<script setup lang="ts">
import NoteBox from '../NoteBox.vue';

withDefaults(defineProps<{ noteKey: string; label?: string; ariaLabel?: string }>(), {
  label: '',
  ariaLabel: 'Production line notes',
});
</script>

<template>
  <NoteBox id="detail-note" :note-key="noteKey" :label="label" :aria-label="ariaLabel" />
</template>
