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

  Typed text is never dropped without a word, and never saved by anything but Save step (#969, as
  for the "Made on site" picker, #930). The form registers with api.ts (choiceDrafts), and counts
  while its fields differ from the saved step: Done editing then keeps it open, and it says so in
  a live region and focuses Save step, with Cancel beside it (holdUnsavedChoices); leaving the
  page, the profile or the phase asks first (allowSwitch), and closing the tab warns
  (listeners.ts). A form that shows the saved step holds nothing back.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { choiceDrafts, save, type ChoiceDraft } from '../../api.ts';
import { setEditingTask } from '../../session.ts';
import { render } from '../../shell.ts';
import { autoTaskLink, basePlanTasks } from '../../tasks.ts';
import { refocusOn } from '../refocus.ts';
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

// Whether the fields differ from the saved step as Save step would store them: trimmed, and a
// cleared title or details standing for the plan's own text.
const planText = (field: 'title' | 'body') =>
  String(basePlanTasks().find(t => t.id === props.step.id)?.[field] || '').trim();
const asSaved = (typed: string, field: 'title' | 'body') => typed.trim() || planText(field);
const changed = computed(
  () =>
    asSaved(title.value, 'title') !== props.step.title.trim() ||
    asSaved(body.value, 'body') !== String(props.step.body || '').trim() ||
    link.value !== props.current,
);
// Set when Done editing was held back by this unsaved text (#969), until it is saved or
// cancelled, or the fields show the saved step again: the form says why, above Save step.
const held = ref(false);
const holding = computed(() => held.value && changed.value);
const heldId = computed(() => 'task-edit-held-' + props.step.id);

// The form and its Save step, for the registration below.
const formEl = ref<HTMLFormElement | null>(null);
const saveButton = ref<HTMLButtonElement | null>(null);

// Done editing while the text is unsaved (holdUnsavedChoices in api.ts): the form says so, and
// comes into view with focus on Save step.
async function hold(focus: boolean) {
  held.value = true;
  if (!focus) return;
  await nextTick();
  formEl.value
    ?.querySelector('[data-task-edit-held]')
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  saveButton.value?.focus({ preventScroll: true });
}

const registration: ChoiceDraft = {
  el: () => formEl.value,
  label: () => props.step.title,
  edits: true,
  unsaved: () => changed.value,
  hold: focus => void hold(focus),
  // Leaving anyway (allowSwitch): the saved step's text again, should the form still be shown.
  discard: () => {
    title.value = props.step.title;
    body.value = props.step.body || '';
    link.value = props.current;
    held.value = false;
  },
};
onMounted(() => choiceDrafts.add(registration));
onBeforeUnmount(() => choiceDrafts.delete(registration));

// Cancel and Save step put the step back in the form's place, so focus goes back to that
// step's Edit button (ui/refocus.ts, #562). A refused save keeps the form open, and focus in it.
const backToEdit = (trigger: EventTarget | null) =>
  refocusOn(trigger, `#main [data-edit-task="${CSS.escape(props.step.id)}"]`);

async function submit(event: Event) {
  const id = props.step.id,
    formData = new FormData(event.target as HTMLFormElement);
  const refocus = backToEdit(document.activeElement);
  const base = basePlanTasks().find(t => t.id === id);
  const title = String(formData.get('title') || '').trim(),
    body = String(formData.get('body') || '').trim(),
    link = String(formData.get('link') || '');
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
    await refocus();
  } catch {}
}

// "Cancel", or Escape in the form (#601): close the form without saving. `trigger` is
// the control that had focus: Cancel, or the field Escape was pressed in.
async function cancel(trigger: EventTarget | null) {
  const refocus = backToEdit(trigger);
  setEditingTask(null);
  render();
  await refocus();
}

// Escape in the form acts as Cancel (#601). An Escape something already handled (an open
// native list, an input method composing text) is left alone, and preventDefault tells the
// edit bar's Escape (ui/EditBar.vue) that this one is taken, so edit mode stays on. Focus goes
// back to the Edit button as for Cancel, whichever field had it.
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
  event.preventDefault();
  void cancel(document.activeElement);
}
</script>

<template>
  <form
    ref="formEl"
    class="task task-edit"
    :data-task-edit="step.id"
    @submit.prevent="submit"
    @keydown="escape"
  >
    <label class="field">Step title<input v-model="title" name="title" maxlength="240" /></label>
    <label class="field"
      >Details<textarea name="body" class="notes" maxlength="6000" v-model="body"></textarea>
    </label>
    <label class="field"
      >Linked factory<select v-model="link" name="link">
        <option value="">No linked factory</option>
        <option v-for="[factoryId, name] in options" :key="factoryId" :value="factoryId">
          {{ name }}
        </option>
      </select></label
    >
    <div :id="heldId" class="task-edit-held" role="status" data-task-edit-held>
      <p v-if="holding" class="notice warn">
        These edits are not saved yet. Save the step or cancel first.
      </p>
    </div>
    <div class="task-edit-actions">
      <button
        ref="saveButton"
        class="btn primary"
        type="submit"
        :aria-describedby="holding ? heldId : undefined"
      >
        Save step
      </button>
      <button class="btn" type="button" data-cancel-task-edit @click="cancel($event.currentTarget)">
        Cancel
      </button>
    </div>
    <p class="small muted">
      Restore the original text by clearing a field. The step keeps its checkmark either way.
    </p>
  </form>
</template>
