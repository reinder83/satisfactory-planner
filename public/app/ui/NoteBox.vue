<!--
  A notes box that saves itself (ui/note-draft.ts): the plan pages' phase notes, the Backup
  page's save-wide notes and, through detail/DetailNote.vue, the notes in factory and
  container dialogs. `noteKey` is the saved notes key and goes on the textarea as
  data-save-note, which the tests and browser-check.ts look for. Under it: an optional hint
  and the status line ("Saving…", "Saved · 12:04", "Not saved — Retry"), announced politely.
-->
<script setup lang="ts">
import { useTemplateRef } from 'vue';
import { useNoteAutosave } from './note-draft.ts';

const props = withDefaults(
  defineProps<{ id: string; noteKey: string; label?: string; ariaLabel?: string }>(),
  { label: '', ariaLabel: undefined },
);
const { text, status, message, typed, flush, retry } = useNoteAutosave(
  () => props.noteKey,
  useTemplateRef<HTMLTextAreaElement>('box'),
);
</script>

<template>
  <textarea
    :id="id"
    ref="box"
    v-model="text"
    class="notes"
    maxlength="6000"
    :aria-label="ariaLabel"
    :aria-describedby="id + '-status'"
    :data-save-note="noteKey"
    @input="typed"
    @blur="flush"
  ></textarea>
  <div class="note-save">
    <span v-if="label" class="small muted">{{ label }}</span
    ><span class="small muted"
      ><span :id="id + '-status'" aria-live="polite" :data-note-status="status">{{ message }}</span
      >&nbsp;<button
        v-if="status === 'failed'"
        type="button"
        class="btn quiet"
        data-note-retry
        @click="retry"
      >
        Retry
      </button></span
    >
  </div>
</template>
