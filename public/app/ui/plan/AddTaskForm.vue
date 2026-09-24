<!-- "Add task" under the build plan's checklist: a personal task for the current phase with
     a random custom-… id. The button is disabled while saving; a success empties the form. -->
<script setup>
import { ref } from 'vue';
import { save } from '../../api.js';
import { phase } from '../../session.js';
import { render } from '../../shell.js';

defineProps({ placeholder: { type: String, required: true } });

const saving = ref(false);

async function submit(e) {
  const form = e.target;
  const title = String(new FormData(form).get('title') || '').trim();
  if (!title) return;
  saving.value = true;
  try {
    await save({
      type: 'addTask',
      id:
        'custom-' +
        Array.from(crypto.getRandomValues(new Uint8Array(16)), b =>
          b.toString(16).padStart(2, '0'),
        ).join(''),
      phase: phase(),
      title,
    });
    form.reset();
    render();
  } catch {
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form id="add-task" class="inline-form" @submit.prevent="submit">
    <input
      name="title"
      maxlength="240"
      required
      :placeholder="placeholder"
      aria-label="Personal task"
    /><button class="btn" type="submit" :disabled="saving">Add task</button>
  </form>
</template>
