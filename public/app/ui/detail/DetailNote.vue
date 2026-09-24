<!--
  The notes box at the end of a factory dialog, saved under `noteKey` by the shared
  data-save-note handler in events/views.js (which also closes the dialog after a successful
  save). The text is the component's own, so it survives the dialog redrawing when a box in it
  is ticked; each opened dialog starts from the saved note.
-->
<script setup>
import { ref } from 'vue';
import { state } from '../../session.js';

const props = defineProps({
  noteKey: { type: String, required: true },
  label: { type: String, default: '' },
});
const text = ref(state.notes[props.noteKey] || '');
</script>

<template>
  <textarea
    id="detail-note"
    v-model="text"
    class="notes"
    maxlength="6000"
    aria-label="Factory notes"
  ></textarea>
  <div v-if="label" class="note-save">
    <span class="small muted">{{ label }}</span
    ><button class="btn" :data-save-note="noteKey" data-input="detail-note">Save notes</button>
  </div>
  <button v-else class="btn" :data-save-note="noteKey" data-input="detail-note">Save notes</button>
</template>
