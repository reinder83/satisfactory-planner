<!--
  The inline form that replaces a step while it is being edited (data-task-edit). It saves
  only what differs from the generated step: a title or details equal to the plan's own
  text are saved as empty, meaning "no override", and so is a cleared field and the link
  when it is the automatic one. "No linked factory" on an automatically linked step is
  saved as '-' (stepLink in tasks.ts). The checkmark is untouched.
-->
<script setup lang="ts">
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
    <label class="field"
      >Step title<input name="title" maxlength="240" :value="step.title"
    /></label>
    <label class="field"
      >Details<textarea
        name="body"
        class="notes"
        maxlength="6000"
        :value="step.body || ''"
      ></textarea>
    </label>
    <label class="field"
      >Linked factory<select name="link">
        <option value="">No linked factory</option>
        <option v-for="[v, l] in options" :key="v" :value="v" :selected="v === current">
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
