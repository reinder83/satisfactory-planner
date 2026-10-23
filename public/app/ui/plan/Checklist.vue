<!--
  The build plan's checklist for the current phase of a calculated profile: the step search
  and "Hide completed" (view state only), the steps that pass them or a message saying why
  none do, and while editing the steps removed from this phase. The steps are planTasks():
  the generated ones with this profile's edits, plus its personal tasks. The step being
  edited shows its edit form instead.

  Outside edit mode (SP-42, #277) the first unfinished step leads the list, unfolded, with
  Mark done and its Open factory. The other unfinished steps follow in order, and completed
  ones fold into "Done (n)" under the list, so ticking the lead step promotes the next one. A
  step just ticked stays in its place among the unfinished ones for a few seconds first, drawn
  ticked (tick-hold.ts, #1054), so the next step never slides under the pointer at once.
  A line that only made a Space Elevator part already delivered in full (#1062) is dimmed with
  a note under its title, and its unfinished step comes after the other unfinished ones. A line
  at exact clocks, or one whose clocks a recalculation would change (#1066), says so there too.
  A line that only makes a Space Elevator part is a batch task (#1211, batchStepNote in tasks.ts):
  its step says how many to make, how long that takes and the power switching it off then frees.
  With every step done, a line says the phase checklist is complete. While editing, the list
  stays flat in the plan's order, since ↑ / ↓ move a step past its neighbour on screen.
  A step's text marks the glossary terms (#1076, ui/TermText.vue) the steps above it on screen have
  not marked yet, so each term is explained once. "New to Satisfactory" (app/beginner.ts) is a
  view preference beside "Hide completed": it hides the plan's hard-drive and clock details.
  "Mine only" (#1199, ui/factories/MineOnly.vue) sits under them while a factory has an owner: it
  keeps only the steps linked to production lines in factories owned by the name this device goes
  by, and when that leaves no open step the list says so.
  "Expert mode" (app/expert.ts, #1197) is the other view preference there, never on with it: outside
  edit mode it takes the HUB milestones and MAM research out of the list and draws them grouped by
  tier above it (ui/plan/UnlockGroups.vue), each group with its own tick.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue';
import { firstTerms } from '../../../preferences.ts';
import { beginnerMode } from '../../beginner.ts';
import { expertMode, setExpertMode, switchBeginnerMode } from '../../expert.ts';
import { lineClockNote } from '../../exact-clocks.ts';
import {
  calculated,
  checked as ticked,
  progressionData,
  editingTask,
  hideDone,
  phase,
  planEditing,
  query,
  requiredOnly,
  setHideDone,
  setQuery,
  setRequiredOnly,
  stage,
  state,
} from '../../session.ts';
import { render } from '../../shell.ts';
import {
  batchStepNote,
  filteredPlanTasks,
  idleStepNotes,
  planTasks,
  removedPlanTasks,
  taskIcon,
  taskLink,
  taskLinkChoices,
} from '../../tasks.ts';
import { sharedRemovedNote, sharedStepPhases } from '../../shared-steps.ts';
import { stepMaterialWords } from '../../views/step-materials.ts';
import { unlockGroups, type UnlockGroupView } from '../../unlock-groups.ts';
import { legacy } from '../bridge.ts';
import { searchField } from '../search-field.ts';
import { activeMine } from '../../views/factories.ts';
import MineOnly from '../factories/MineOnly.vue';
import PlanStep from './PlanStep.vue';
import RemovedSteps from './RemovedSteps.vue';
import StepEditForm from './StepEditForm.vue';
import UnlockGroups from './UnlockGroups.vue';
import { dropHold, isHeld, isLeaving } from './tick-hold.ts';
import type { PlanStepView, RemovedStepView, Step } from '../../tasks.ts';

// A production line's own step at exact clocks, or one whose clocks a recalculation would change
// (lineClockNote, #1066); '' for any other step, a personal task linked to the line included.
const clockNote = (stepId: string, rowId: string | undefined): string =>
  calculated && rowId && stepId === 'calc-' + stage() + '-' + rowId
    ? lineClockNote(calculated, state, stage(), rowId)
    : '';

const list = computed(() =>
  legacy(() => {
    const tasks = planTasks(),
      shown = filteredPlanTasks(tasks),
      removed = removedPlanTasks(),
      idle = idleStepNotes(shown);
    // Done: ticked, or done by the step's own condition (`satisfied`, stepDone in tasks.ts, #1070).
    const satisfied = new Map(
      tasks.flatMap(task => (task.satisfied ? [[task.id, task.satisfied]] : [])),
    );
    const checked = (id: string) => ticked(id) || satisfied.has(id);
    const steps = shown.map((task): PlanStepView => {
      const link = taskLink(task);
      return {
        id: task.id,
        title: task.title,
        body: task.body,
        table: task.table,
        list: task.list,
        built: task.built,
        spare: task.spare,
        done: checked(task.id),
        idle: idle.get(task.id),
        satisfied: satisfied.get(task.id),
        clocks: clockNote(task.id, link?.id),
        batch: batchStepNote(task.id),
        materials: stepMaterialWords(task.id),
        icon: taskIcon(task),
        link,
        custom: task.id.startsWith('custom-'),
        form: planEditing && editingTask === task.id ? taskLinkChoices(task) : null,
      };
    });
    // Expert mode, outside edit mode (#1197): the unlocks go into their groups above the list.
    const groups = !planEditing && expertMode() ? groupViews(tasks, steps, checked) : [];
    const grouped = new Set(groups.flatMap(group => group.items.map(item => item.id)));
    const listed = steps.filter(s => !grouped.has(s.id));
    // Outside edit mode: the unfinished steps (the first leads) and the completed ones. The
    // steps of lines a delivered part leaves without work (#1062) come last among the
    // unfinished ones, dimmed, and never lead. A step just ticked is held in its place among
    // them for a few seconds (tick-hold.ts, #1054).
    const unfinished = [
        ...listed.filter(s => open(s) && !s.idle),
        ...listed.filter(s => open(s) && s.idle),
      ],
      finished = listed.filter(s => !open(s));
    // Each glossary term is marked in the first step text on screen that has it (#1076).
    const order = planEditing
        ? steps
        : [...groups.flatMap(group => group.items), ...unfinished, ...finished],
      marks = firstTerms(
        order.map(s =>
          s.table ? `${s.table.intro} ${s.table.after ?? ''}` : s.list ? '' : s.body || '',
        ),
      );
    order.forEach((s, i) => (s.terms = marks[i]));
    return {
      total: tasks.length,
      beginner: beginnerMode(),
      expert: expertMode(),
      query,
      hideDone,
      requiredOnly,
      optional: tasks.filter(task => task.optional).length,
      editing: planEditing,
      count: shown.length !== tasks.length ? shown.length + ' of ' + tasks.length + ' steps' : '',
      empty: !tasks.length
        ? emptyPhase(removed.length > 0)
        : query.trim()
          ? 'No steps match this search.'
          : 'Every step of this phase is completed. Untick “Hide completed” to review them.',
      steps,
      groups,
      open: unfinished,
      done: finished,
      // Every step of the phase is ticked (not only the ones the search shows).
      complete: tasks.length > 0 && tasks.every(t => checked(t.id)),
      // "Required steps only" hides every step still open: only optional ones are left (#1070).
      optionalLeft: requiredOnly && tasks.some(t => t.optional && !checked(t.id)),
      // "Mine only" (#1199) applies, so the open steps it hides are other people's or nobody's.
      mine: !!activeMine(),
      // Post Phase 5 has no next phase to get ready for (#1069).
      post: phase() === 'post',
      removed: planEditing ? removedViews(removed) : [],
    };
  }),
);

// Unfinished, or ticked a moment ago and still held in place.
const open = (step: PlanStepView) => !step.done || isHeld(step.id);

// The phase's unlocks in their groups (#1197): each group's keys are all its steps in the phase,
// its items the ones the search and filters show; a group none of whose steps is shown is left
// out.
function groupViews(
  tasks: Step[],
  shown: PlanStepView[],
  checked: (id: string) => boolean,
): UnlockGroupView[] {
  const views = new Map(shown.map(step => [step.id, step]));
  return unlockGroups(tasks, progressionData).flatMap(group => {
    const items = group.items.flatMap(task => views.get(task.id) ?? []);
    if (!items.length) return [];
    const keys = group.items.map(task => task.id);
    return [{ key: group.key, label: group.label, keys, done: keys.filter(checked).length, items }];
  });
}

// A page change drops the hold: the steps are drawn where their ticks put them when it comes back.
onBeforeUnmount(dropHold);

// "Removed steps in this phase", each step noting the other phases that list it too (#744).
function removedViews(removed: Step[]): RemovedStepView[] {
  const shared = sharedStepPhases(removed.map(task => task.id));
  return removed.map(task => {
    const phases = shared.get(task.id);
    return {
      id: task.id,
      title: task.title,
      icon: taskIcon(task),
      shared: phases ? sharedRemovedNote(phases) : undefined,
    };
  });
}

// Why the phase shows no steps at all: the user removed every one, or it never had any (a plan
// guide without steps for this phase, #646). Only the first points to Removed steps,
// which the checklist lists while editing.
function emptyPhase(anyRemoved: boolean) {
  if (!anyRemoved) return 'This phase has no steps yet. Add a task below to start its checklist.';
  return planEditing
    ? 'Every step of this phase is removed. Use Removed steps below to restore them.'
    : 'Every step of this phase is removed. Choose Edit steps to restore them.';
}

// The step search: the box keeps what is typed, and the list filters once typing pauses
// (searchField, #1060).
const { typed: typedQuery, input: search } = searchField(
  () => legacy(() => query),
  value => {
    setQuery(value);
    render();
  },
);

function toggleHideDone(event: Event) {
  setHideDone((event.target as HTMLInputElement).checked);
  render();
}

// "New to Satisfactory" (#1076): a view preference like Hide completed, remembered in this browser.
// On, it switches expert mode off (#1197).
function toggleBeginner(event: Event) {
  switchBeginnerMode((event.target as HTMLInputElement).checked);
  render();
}

// "Expert mode" (#1197): the same kind of preference; on, it switches New to Satisfactory off.
function toggleExpert(event: Event) {
  setExpertMode((event.target as HTMLInputElement).checked);
  render();
}

// "Required steps only" (#1070): hides the optional steps, a view preference like Hide completed.
function toggleRequiredOnly(event: Event) {
  setRequiredOnly((event.target as HTMLInputElement).checked);
  render();
}
</script>

<template>
  <div v-if="list.total > 0" class="checklist-tools">
    <input
      id="plan-search"
      class="search"
      placeholder="Find a step…"
      aria-label="Find a step"
      :value="typedQuery"
      @input="search"
    /><label class="check-row small"
      ><input
        type="checkbox"
        id="hide-done"
        :checked="list.hideDone"
        @change="toggleHideDone"
      />Hide completed</label
    ><label v-if="list.optional || list.requiredOnly" class="check-row small"
      ><input
        type="checkbox"
        id="required-only"
        data-required-only
        :checked="list.requiredOnly"
        @change="toggleRequiredOnly"
      />Required steps only</label
    ><label class="check-row small"
      ><input
        type="checkbox"
        data-beginner-switch
        :checked="list.beginner"
        :aria-describedby="list.beginner ? 'beginner-note' : undefined"
        @change="toggleBeginner"
      />New to Satisfactory</label
    ><label class="check-row small"
      ><input
        type="checkbox"
        data-expert-switch
        :checked="list.expert"
        :aria-describedby="list.expert ? 'expert-note' : undefined"
        @change="toggleExpert"
      />Expert mode</label
    ><span class="small muted">{{ list.count }}</span>
  </div>
  <MineOnly v-if="list.total > 0" where="plan" />
  <p
    v-if="list.total > 0 && list.beginner"
    id="beginner-note"
    class="small muted"
    data-beginner-note
  >
    New to Satisfactory: the hard-drive payoff and what whole machines cost are hidden. Untick it to
    see them.
  </p>
  <p v-if="list.total > 0 && list.expert" id="expert-note" class="small muted" data-expert-note>
    Expert mode: HUB milestones and MAM research are grouped by tier. Tick a group to tick each of
    its unlocks.
  </p>
  <div v-if="list.editing" class="checklist">
    <template v-if="list.steps.length">
      <template v-for="step in list.steps" :key="step.id">
        <StepEditForm
          v-if="step.form"
          :step="step"
          :options="step.form.options"
          :current="step.form.current"
        />
        <PlanStep v-else :step="step" :editing="list.editing" />
      </template>
    </template>
    <div v-else class="empty-state">{{ list.empty }}</div>
  </div>
  <template v-else>
    <UnlockGroups v-if="list.groups.length" :groups="list.groups" />
    <div v-if="list.open.length" class="checklist" data-open-steps>
      <PlanStep
        v-for="(step, i) in list.open"
        :key="step.id"
        :step="step"
        :lead="i === 0 && !step.idle"
        :held="step.done && isHeld(step.id)"
        :leaving="step.done && isLeaving(step.id)"
      />
    </div>
    <div v-else-if="list.complete && !list.query.trim()" class="checklist">
      <div class="task lead is-complete" data-phase-complete>
        <div class="step-no">Phase checklist complete</div>
        <div class="lead-done">
          <template v-if="list.post"
            ><b>Nothing left to build</b>
            <p>Post Phase 5 has no next phase: keep these lines running.</p></template
          >
          <template v-else
            ><b>Ready for the next phase</b>
            <p>
              Verify the delivery, then choose your next phase using the selector above.
            </p></template
          >
          <p v-if="list.hideDone">Untick “Hide completed” to review the steps.</p>
        </div>
      </div>
    </div>
    <div v-else-if="list.optionalLeft && !list.query.trim()" class="checklist">
      <div class="empty-state" data-optional-left>
        Only optional steps are left. Untick “Required steps only” to see them.
      </div>
    </div>
    <div v-else-if="list.mine && !list.query.trim()" class="checklist">
      <div class="empty-state" data-mine-left>
        None of the open steps of this phase is in a factory you own. Untick “Mine only” to see
        them.
      </div>
    </div>
    <div v-else-if="!list.done.length && !list.groups.length" class="checklist">
      <div class="empty-state">{{ list.empty }}</div>
    </div>
    <details v-if="list.done.length" class="done-group">
      <summary>Done ({{ list.done.length }})</summary>
      <div class="checklist">
        <PlanStep v-for="step in list.done" :key="step.id" :step="step" />
      </div>
    </details>
  </template>
  <RemovedSteps v-if="list.removed.length" :steps="list.removed" />
</template>
