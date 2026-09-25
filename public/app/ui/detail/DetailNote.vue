<!--
  The notes box at the end of a factory dialog, saved under `noteKey` by saveNote in
  ui/actions.ts (which also closes the dialog after a successful save). The text is the
  component's own, so it survives the dialog redrawing when a box in it is ticked; each
  opened dialog starts from the saved note.
-->
<script setup lang="ts">
import { ref } from 'vue';
import { state } from '../../session.ts';
import { saveNote } from '../actions.ts';

const props = withDefaults(defineProps<{ noteKey: string; label?: string; ariaLabel?: string }>(), {
  label: '',
  ariaLabel: 'Factory notes',
});
const text = ref(state.notes[props.noteKey] || '');
</script>

<template>
  <textarea
    id="detail-note"
    v-model="text"
    class="notes"
    maxlength="6000"
    :aria-label="ariaLabel"
  ></textarea>
  <div v-if="label" class="note-save">
    <span class="small muted">{{ label }}</span
    ><button class="btn" :data-save-note="noteKey" @click="saveNote" data-input="detail-note">
      Save notes
    </button>
  </div>
  <button v-else class="btn" :data-save-note="noteKey" @click="saveNote" data-input="detail-note">
    Save notes
  </button>
</template>
