<!--
  A notes box that saves itself (ui/note-draft.ts): the Notes page's save-wide and phase
  notes and, through detail/DetailNote.vue, the notes in factory and
  container dialogs. `noteKey` is the saved notes key and goes on the textarea as
  data-save-note, which the tests and browser-check.ts look for. Under it: an optional hint
  and the status line ("Saving…", "Saved · 12:04", "Not saved — Retry"), announced politely.
  When the note was changed elsewhere while this box held other text (#1052), a notice under
  it shows the other version, read-only, and asks which to keep: "Keep mine", "Keep theirs"
  or "Keep both". Nothing is saved until one is chosen.
-->
<script setup lang="ts">
import { useTemplateRef } from 'vue';
import { NOTE_MAX, useNoteAutosave } from './note-draft.ts';

const props = withDefaults(
  defineProps<{ id: string; noteKey: string; label?: string; ariaLabel?: string }>(),
  { label: '', ariaLabel: undefined },
);
const {
  text,
  status,
  message,
  conflict,
  bothTooLong,
  typed,
  flush,
  retry,
  keepMine,
  keepTheirs,
  keepBoth,
} = useNoteAutosave(() => props.noteKey, useTemplateRef<HTMLTextAreaElement>('box'));
</script>

<template>
  <textarea
    :id="id"
    ref="box"
    v-model="text"
    class="notes"
    :maxlength="NOTE_MAX"
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
  <div
    v-if="conflict !== null"
    class="notice warn note-conflict"
    role="group"
    :aria-labelledby="id + '-conflict-title'"
    :data-note-conflict="noteKey"
  >
    <p :id="id + '-conflict-title'">
      <strong>This note was changed in another tab or on another device.</strong> Your text is in
      the box above and is not saved yet. Choose which version to keep.
    </p>
    <label class="small" :for="id + '-theirs'">The other version</label>
    <textarea
      :id="id + '-theirs'"
      class="notes note-theirs"
      readonly
      :value="conflict"
      data-note-theirs
    ></textarea>
    <div class="note-conflict-actions">
      <button type="button" class="btn primary" data-note-keep="mine" @click="keepMine">
        Keep mine
      </button>
      <button type="button" class="btn" data-note-keep="theirs" @click="keepTheirs">
        Keep theirs
      </button>
      <button
        type="button"
        :class="['btn', bothTooLong ? 'unavailable' : '']"
        data-note-keep="both"
        :disabled="bothTooLong"
        :aria-describedby="bothTooLong ? id + '-both-long' : undefined"
        @click="keepBoth"
      >
        Keep both
      </button>
    </div>
    <p v-if="bothTooLong" :id="id + '-both-long'" class="small">
      Both versions together are longer than a note can hold (6,000 characters). Shorten your text,
      or keep one version.
    </p>
    <p v-else class="small">
      Keep both puts the other version first and your text under it, in one note.
    </p>
  </div>
</template>
