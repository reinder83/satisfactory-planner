<!--
  One step of the build-plan checklist. Its checkbox writes the step's saved checklist key
  (toggleCheck in ui/actions.ts, which the storage page's checklists use too). A step linked to a
  production line has "Production line ↗", a factoryLink() to the line's dialog, and, when the
  line is in a factory, "Open factory: <name> →" before it, a link to that factory's flow page
  (#1047): the factory the build plan builds the line with (StepFactory in tasks.ts), aimed at
  the line's card there; a line split over several places says so under the links. In edit
  mode it adds move, edit and remove tools. `step` is a row from
  Checklist.vue: the step as the user sees it, with its icon, link and checkmark. The lead step
  (`lead`, SP-42) is the first unfinished one: unfolded, marked "Next step", with Mark done. A
  line that only made a Space Elevator part already delivered in full (`step.idle`, #1062) is
  dimmed, with its note under the title; a line at exact clocks, or one whose clocks a
  recalculation would change (`step.clocks`, #1066), says so there too. A step just ticked is
  `held` in place for a few seconds (tick-hold.ts, #1054), and `leaving` as it fades out of it.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { holdUnsavedChoices, save, toast } from '../../api.ts';
import { checked, flowRoute, phase, setEditingTask } from '../../session.ts';
import { render } from '../../shell.ts';
import { removeStepBody } from '../../shared-steps.ts';
import { filteredPlanTasks, planTasks, taskOrderSlots } from '../../tasks.ts';
import { listNames } from '../../../wording.ts';
import StepIcon from './StepIcon.vue';
import StepTable from './StepTable.vue';
import { factoryLink, toggleCheck } from '../actions.ts';
import { confirmAction } from '../confirm.ts';
import { aimFlowLine, refocusAfterRemoval, refocusOn } from '../refocus.ts';
import { announceTick, focusStep, holdStep, letGo, settled, tickNews } from './tick-hold.ts';
import type { PlanStepView } from '../../tasks.ts';

const props = withDefaults(
  defineProps<{
    step: PlanStepView;
    editing?: boolean;
    lead?: boolean;
    held?: boolean;
    leaving?: boolean;
  }>(),
  { editing: false, lead: false, held: false, leaving: false },
);

// "Open factory: <name> →" is a real link, so it opens in a new tab too; followed here, the flow
// page it opens focuses this step's line, and Back from it focuses this link again (aimFlowLine
// in ui/refocus.ts).
const splitId = computed(() => 'step-split-' + props.step.id);
// The note of a line a delivered part leaves without work (#1062), which also describes the
// step's checkbox.
const idleId = computed(() => 'step-idle-' + props.step.id);
// The note of a step done by its own condition (#1070), which also describes the checkbox: with no
// tick to clear, the checkbox is disabled while the condition holds.
const satisfiedId = computed(() => 'step-satisfied-' + props.step.id);
const describedBy = computed(
  () =>
    [props.step.idle ? idleId.value : '', props.step.satisfied ? satisfiedId.value : '']
      .filter(Boolean)
      .join(' ') || undefined,
);
const lockedDone = computed(() => !!props.step.satisfied && !checked(props.step.id));
function aimLine(event: MouseEvent) {
  const link = props.step.link;
  if (!link?.factory || event.button !== 0) return;
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  aimFlowLine(link.factory.id, link.id, props.step.id);
}

// Ticking a step moves it between the unfinished steps and "Done (n)" (Checklist.vue, SP-42).
// Ticked, it stays where it is for a few seconds first (tick-hold.ts, #1054): focus stays on its
// checkbox, the toast says what changed and offers Undo, and a second click lands on the step
// the user sees there. When it leaves, focus goes to the same control in the step that took its
// place. Unticked, it goes back among the unfinished ones at once, and focus goes with it.
async function check(event: Event) {
  const checkbox = event.target as HTMLInputElement;
  const { id, title } = props.step;
  if (!checkbox.checked) {
    letGo(id);
    if (!(await toggleCheck(event))) return;
    toast(tickNews(id, title, false));
    await focusStep(id, 'input[data-check]');
    return;
  }
  holdStep(id, checkbox, 'input[data-check]');
  const saved = await toggleCheck(event);
  if (saved) announceTick(id, title);
  await settled(id, saved);
}

// "Mark done" on the lead step: the same saved checklist key as its checkbox, held in place the
// same way. Meanwhile it says "Marked done" and does nothing more, keeping focus; when the step
// leaves, focus goes on to the next lead step's Mark done.
const marking = ref(false);
async function markDone(event: Event) {
  if (marking.value || props.step.done) return;
  const { id, title } = props.step;
  marking.value = true;
  holdStep(id, event.currentTarget, '[data-mark-done]');
  let saved = false;
  try {
    await save({ type: 'check', key: id, value: true });
    saved = true;
    render();
  } catch {
  } finally {
    marking.value = false;
  }
  if (saved) announceTick(id, title);
  await settled(id, saved);
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
// focus goes to the form's Step title field (ui/refocus.ts, #562). Another step's open form with
// typed text not saved yet stays open instead and says so, as Done editing does (#969, #1029).
async function edit(event: Event) {
  if (holdUnsavedChoices()) return;
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
  <article
    :class="[
      'task',
      editing ? 'is-editing' : '',
      lead ? 'lead' : '',
      step.idle ? 'is-idle' : '',
      held ? 'is-held' : '',
      leaving ? 'is-leaving' : '',
    ]"
  >
    <div v-if="lead" class="step-no">Next step</div>
    <input
      type="checkbox"
      :data-check="step.id"
      @change="check"
      :aria-label="'Complete: ' + step.title"
      :aria-describedby="describedBy"
      :checked="step.done"
      :disabled="lockedDone || undefined"
    /><StepIcon :icon="step.icon" />
    <details :data-task="step.id" :open="lead">
      <summary>
        {{ step.title
        }}<span v-if="step.idle" :id="idleId" class="task-idle" data-idle-note>{{ step.idle }}</span
        ><span v-if="step.satisfied" :id="satisfiedId" class="task-idle" data-satisfied-note>{{
          step.satisfied
        }}</span
        ><span v-if="step.clocks" class="task-idle" data-step-clocks>{{ step.clocks }}</span>
      </summary>
      <StepTable v-if="step.table" :table="step.table" />
      <p v-else>{{ step.body || 'Your own task for this phase.' }}</p>
      <button
        v-if="lead"
        type="button"
        class="btn primary lead-done-btn"
        data-mark-done
        :aria-disabled="marking || step.done || undefined"
        @click="markDone"
      >
        {{ step.done ? 'Marked done' : 'Mark done' }}</button
      ><a
        v-if="step.link?.factory"
        :class="['btn', lead ? '' : 'quiet', 'task-link']"
        :href="'#' + flowRoute(step.link.factory.id)"
        :data-step-factory="step.link.factory.id"
        :aria-describedby="step.link.factory.others.length ? splitId : undefined"
        @click="aimLine"
      >
        Open factory: {{ step.link.factory.name }} →</a
      ><button
        v-if="step.link"
        :class="['btn', lead ? '' : 'quiet', 'task-link']"
        v-bind="factoryLink({ calcFactory: step.link.id })"
        :aria-label="'Production line: ' + step.link.name"
      >
        Production line ↗</button
      ><span
        v-if="step.link?.factory?.others.length"
        :id="splitId"
        class="small muted task-split"
        data-step-split
        >Split over {{ listNames([step.link.factory.name, ...step.link.factory.others]) }}; this
        step builds it with {{ step.link.factory.name }}.</span
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
