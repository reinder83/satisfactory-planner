<!--
  A note you can leave on one thing (BAK-3, #1355): a step of the build plan (key `step-<step id>`),
  a factory (`group-<factory id>`, on its build order page) or the phase on screen (the build plan
  shows the phase's note, the same `phase-<phase>` the Notes page has). It is one disclosure
  button: "Add a note" while there is none, "Note" with its first line while there is one, which
  opens by itself so the note is in sight. (A button, not a <details>: a step is itself a
  <details> with its own <summary>, which the page's tests and styles address.) The box (NoteBox.vue,
  saved as you type like every note) is made the first time the note opens and stays, so a note
  typed in it is never dropped by folding it. The keys are ordinary notes records (`state.notes`,
  up to 6,000 characters, deleted when blank), so they are saved, exported, backed up, carried and
  shared with the other notes and need no state version; the Notes page lists them
  (ui/notes/ItemNotes.vue) so none is out of sight.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { state } from '../../session.ts';
import { legacy } from '../bridge.ts';
import NoteBox from '../NoteBox.vue';

const props = defineProps<{
  noteKey: string;
  // What the button says with no note ("Add a note") and with one ("Note").
  emptyLabel: string;
  filledLabel: string;
  // The note box's accessible name.
  label: string;
}>();

const text = computed(() => legacy(() => state.notes?.[props.noteKey] ?? '').trim());
const has = computed(() => !!text.value);
// The first line, cut, beside "Note" while it is shut.
const preview = computed(() => {
  const line = text.value.split('\n')[0]!;
  return line.length > 60 ? line.slice(0, 59) + '…' : line;
});
const opened = ref(has.value);
const made = ref(has.value);
const bodyId = computed(() => 'item-note-' + props.noteKey);
function toggle() {
  opened.value = !opened.value;
  if (opened.value) made.value = true;
}
</script>

<template>
  <div class="item-note" data-item-note :data-note-for="noteKey">
    <button
      type="button"
      class="item-note-toggle"
      :aria-expanded="opened ? 'true' : 'false'"
      :aria-controls="bodyId"
      data-item-note-toggle
      @click="toggle"
    >
      {{ has ? filledLabel : emptyLabel
      }}<span v-if="has && !opened" class="muted" data-item-note-preview> · {{ preview }}</span>
    </button>
    <div v-show="opened" :id="bodyId" class="item-note-body">
      <NoteBox v-if="made" :id="'note-box-' + noteKey" :note-key="noteKey" :aria-label="label" />
    </div>
  </div>
</template>
