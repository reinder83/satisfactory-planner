<!-- "Add task" under the build plan's checklist: a personal task for the current phase with
     a random custom-… id. The button is busy while saving (bound aria-disabled, app/busy.ts: it
     keeps focus, #299), and the form sends nothing more meanwhile; a success empties the form. -->
<script setup lang="ts">
import { ref } from 'vue';
import { save } from '../../api.ts';
import { phase } from '../../session.ts';
import { render } from '../../shell.ts';

defineProps<{ placeholder: string }>();

const saving = ref(false);

async function submit(e: Event) {
  const form = e.target as HTMLFormElement;
  const title = String(new FormData(form).get('title') || '').trim();
  if (!title || saving.value) return;
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
    /><button class="btn" type="submit" :aria-disabled="saving || undefined">Add task</button>
  </form>
</template>
