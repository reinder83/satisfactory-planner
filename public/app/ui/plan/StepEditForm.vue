<!--
  The inline form that replaces a step while it is being edited (data-task-edit). It saves
  only what differs from the generated step: a title or details equal to the plan's own
  text are saved as empty, meaning "no override", and so is a cleared field and the link
  when it is the automatic one. "No linked factory" on an automatically linked step is
  saved as '-' (stepLink in tasks.ts). The checkmark is untouched.
  The fields hold their own values, set once when the form opens, so a redraw while it is open
  does not put the saved text back over what was typed: after a save refused because another
  tab changed the profile (#165), the page shows the latest state and the form keeps the
  typed title, details and link for the user to save again or cancel.
-->
<script setup lang="ts">
import { ref } from 'vue';
import { save } from '../../api.ts';
import { setEditingTask } from '../../session.ts';
import { render } from '../../shell.ts';
import { autoTaskLink, basePlanTasks } from '../../tasks.ts';
import type { PlanStepView } from '../../tasks.ts';

const props = withDefaults(
  defineProps<{
    step: PlanStepView;
    // [factory or row id, name] for every factory of this phase.
    options: [id: string, name: string][];
    current?: string;
  }>(),
  { current: '' },
);
const title = ref(props.step.title);
const body = ref(props.step.body || '');
const link = ref(props.current);

async function submit(e: Event) {
  const id = props.step.id,
    fd = new FormData(e.target as HTMLFormElement);
  const base = basePlanTasks().find(t => t.id === id);
  const title = String(fd.get('title') || '').trim(),
    body = String(fd.get('body') || '').trim(),
    link = String(fd.get('link') || '');
  try {
    await save({
      type: 'taskEdit',
      id,
      title: base && title === base.title ? '' : title,
      body: base && body === String(base.body || '').trim() ? '' : body,
      link: link === autoTaskLink(id) ? '' : link || (autoTaskLink(id) ? '-' : ''),
    });
    setEditingTask(null);
    render();
  } catch {}
}

// "Cancel": close the form without saving.
function cancel() {
  setEditingTask(null);
  render();
}
</script>

<template>
  <form class="task task-edit" :data-task-edit="step.id" @submit.prevent="submit">
    <label class="field">Step title<input v-model="title" name="title" maxlength="240" /></label>
    <label class="field"
      >Details<textarea name="body" class="notes" maxlength="6000" v-model="body"></textarea>
    </label>
    <label class="field"
      >Linked factory<select v-model="link" name="link">
        <option value="">No linked factory</option>
        <option v-for="[v, l] in options" :key="v" :value="v">
          {{ l }}
        </option>
      </select></label
    >
    <div class="task-edit-actions">
      <button class="btn primary" type="submit">Save step</button>
      <button class="btn" type="button" data-cancel-task-edit @click="cancel">Cancel</button>
    </div>
    <p class="small muted">
      Restore the original text by clearing a field. The step keeps its checkmark either way.
    </p>
  </form>
</template>
