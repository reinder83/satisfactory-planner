<!--
  One step of the build-plan checklist. Its checkbox writes the step's saved checklist key
  (toggleCheck in ui/actions.ts, which the storage page's checklists use too); its
  "Open factory" link is a factoryLink(). In edit mode it adds move, edit and remove tools. `step` is a row from
  Checklist.vue: the step as the user sees it, with its icon, link and checkmark. The lead step
  (`lead`, SP-42) is the first unfinished one: unfolded, marked "Next step", with Mark done.
-->
<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { save } from '../../api.ts';
import { phase, setEditingTask } from '../../session.ts';
import { render } from '../../shell.ts';
import { removeStepBody } from '../../shared-steps.ts';
import { filteredPlanTasks, planTasks, taskOrderSlots } from '../../tasks.ts';
import StepIcon from './StepIcon.vue';
import { factoryLink, toggleCheck } from '../actions.ts';
import { confirmAction } from '../confirm.ts';
import { refocusAfterRemoval, refocusOn } from '../refocus.ts';
import type { PlanStepView } from '../../tasks.ts';

const props = withDefaults(
  defineProps<{ step: PlanStepView; editing?: boolean; lead?: boolean }>(),
  { editing: false, lead: false },
);

// Ticking a step moves it between the unfinished steps and "Done (n)" (Checklist.vue, SP-42),
// so its row is drawn anew and focus would fall to <body>. Ticked, focus goes to the same
// control in the step that took its place, the next lead's when it led; unticked, to the step
// itself where it now stands among the unfinished ones. Each step is known by its checklist key,
// so a step ticked while an earlier tick is still saving finds its place again by its neighbours
// once its own save lands, when the earlier step has already gone to Done (#822).
const openRows = {
  row: '#main [data-open-steps] > .task',
  fallback: ['#main .done-group > summary', '#plan-search'],
  key: (row: Element) => row.querySelector<HTMLElement>('[data-check]')?.dataset.check,
};
function focusStep(id: string, control: string) {
  return async () => {
    await nextTick();
    const current = document.activeElement;
    if (current && current !== document.body && current.isConnected) return;
    [...document.querySelectorAll<HTMLElement>('#main .task')]
      .find(row => row.querySelector<HTMLElement>(`[data-check]`)?.dataset.check === id)
      ?.querySelector<HTMLElement>(control)
      ?.focus();
  };
}
async function check(event: Event) {
  const checkbox = event.target as HTMLInputElement;
  const refocus = checkbox.checked
    ? refocusAfterRemoval(checkbox, { ...openRows, control: 'input[data-check]' })
    : focusStep(props.step.id, 'input[data-check]');
  await toggleCheck(event);
  await refocus();
}

// "Mark done" on the lead step: the same saved checklist key as its checkbox. Focus goes on to
// the next lead step's Mark done.
const marking = ref(false);
async function markDone(event: Event) {
  if (marking.value) return;
  const refocus = refocusAfterRemoval(event.currentTarget, {
    ...openRows,
    control: '[data-mark-done]',
  });
  marking.value = true;
  try {
    await save({ type: 'check', key: props.step.id, value: true });
    render();
    await refocus();
  } catch {
  } finally {
    marking.value = false;
  }
}

// ↑ / ↓: move the step past its neighbour on screen and save this phase's whole order
// (taskOrder). Steps hidden by "Hide completed" or the search keep their places, so a step
// never trades places with one the user cannot see. Nothing happens at either end of the
// visible list. Removed steps and saved places of steps not in the plan now keep their slots
// (taskOrderSlots), so restoring a step puts it back where it was. The moved step's row is
// re-inserted in its new place, which takes focus from the pressed arrow, so focus goes back to
// the same arrow on the moved step (ui/refocus.ts, #656), and a second press moves it again.
async function move(event: Event, direction: number) {
  const tasks = planTasks(),
    ids = tasks.map(t => t.id),
    shown = filteredPlanTasks(tasks).map(t => t.id),
    past = shown[shown.indexOf(props.step.id) + direction];
  if (!shown.includes(props.step.id) || !past) return;
  const refocus = refocusOn(
    event.currentTarget,
    `#main [data-move-task="${CSS.escape(props.step.id)}"][data-dir="${direction}"]`,
  );
  ids.splice(ids.indexOf(props.step.id), 1);
  ids.splice(ids.indexOf(past) + (direction > 0 ? 1 : 0), 0, props.step.id);
  const listed = new Set(ids);
  let next = 0;
  const order = taskOrderSlots().map(id => (listed.has(id) ? ids[next++]! : id));
  try {
    await save({ type: 'taskOrder', phase: phase(), ids: order });
    render();
    await refocus();
  } catch {}
}

// "Edit": swap the step for its edit form (StepEditForm.vue). The button goes with the step, so
// focus goes to the form's Step title field (ui/refocus.ts, #562).
async function edit(event: Event) {
  const refocus = refocusOn(
    event.currentTarget,
    `#main [data-task-edit="${CSS.escape(props.step.id)}"] [name=title]`,
  );
  setEditingTask(props.step.id);
  render();
  await refocus();
}

// Where focus goes once a step is removed (ui/refocus.ts, #286): `control` on the next step,
// else the previous one, else the personal task field under the list.
const stepList = (control: string) => ({
  row: '#main .checklist .task',
  control,
  fallback: ['#add-task [name=title]'],
});

// "Remove", after a confirmation. A personal task (id custom-…) is deleted; a plan step is
// only hidden (taskRemove) and keeps its checkmark, so it can be put back from "Removed
// steps in this phase". A step other phases list too goes from them too, and the
// confirmation names them (shared-steps.ts, #744).
async function remove(event: Event) {
  const id = props.step.id;
  if (id.startsWith('custom-')) return deletePersonal(event);
  const refocus = refocusAfterRemoval(event.currentTarget, stepList('[data-remove-step]'));
  if (
    !(await confirmAction({
      title: 'Remove this step?',
      body: removeStepBody(id),
      confirmLabel: 'Remove step',
      danger: true,
    }))
  )
    return;
  try {
    await save({ type: 'taskRemove', id });
    render();
    await refocus();
  } catch {}
}

// "Delete personal task" (inside a personal task's details outside edit mode, or Remove on
// one while editing), after a confirmation. Outside edit mode the next step's Delete is inside
// its closed details, so focus goes to that step's summary instead.
async function deletePersonal(event: Event) {
  const refocus = refocusAfterRemoval(
    event.currentTarget,
    stepList(props.editing ? '[data-remove-step]' : 'summary'),
  );
  if (
    !(await confirmAction({
      title: 'Delete this personal task?',
      body: 'Delete this personal task?',
      confirmLabel: 'Delete task',
      danger: true,
    }))
  )
    return;
  try {
    await save({ type: 'removeTask', id: props.step.id });
    render();
    await refocus();
  } catch {}
}
</script>

<template>
  <article :class="['task', editing ? 'is-editing' : '', lead ? 'lead' : '']">
    <div v-if="lead" class="step-no">Next step</div>
    <input
      type="checkbox"
      :data-check="step.id"
      @change="check"
      :aria-label="'Complete: ' + step.title"
      :checked="step.done"
    /><StepIcon :icon="step.icon" />
    <details :data-task="step.id" :open="lead">
      <summary>{{ step.title }}</summary>
      <p>{{ step.body || 'Your own task for this phase.' }}</p>
      <button
        v-if="lead"
        type="button"
        class="btn primary lead-done-btn"
        data-mark-done
        :aria-disabled="marking || undefined"
        @click="markDone"
      >
        Mark done</button
      ><button
        v-if="step.link"
        :class="['btn', lead ? '' : 'quiet', 'task-link']"
        v-bind="factoryLink({ calcFactory: step.link.id })"
      >
        Open factory: {{ step.link.name }} ↗</button
      ><button
        v-if="step.custom && !editing"
        class="delete-task"
        :data-remove="step.id"
        @click="deletePersonal"
      >
        Delete personal task
      </button>
    </details>
    <span v-if="editing" class="task-tools"
      ><button
        class="btn quiet"
        :data-move-task="step.id"
        data-dir="-1"
        :aria-label="'Move up: ' + step.title"
        @click="move($event, -1)"
      >
        ↑</button
      ><button
        class="btn quiet"
        :data-move-task="step.id"
        data-dir="1"
        :aria-label="'Move down: ' + step.title"
        @click="move($event, 1)"
      >
        ↓</button
      ><button
        class="btn quiet"
        :data-edit-task="step.id"
        :aria-label="'Edit: ' + step.title"
        @click="edit"
      >
        Edit</button
      ><button
        class="btn quiet danger"
        :data-remove-step="step.id"
        :aria-label="'Remove: ' + step.title"
        @click="remove"
      >
        Remove
      </button></span
    >
  </article>
</template>
