<!--
  On a calculated profile's build plan, factories, logistics, storage, resources and factory flow
  pages while a milestone-only phase is shown (#759, milestoneOnly() in session.ts): a phase
  before the profile's start phase, which lists only the milestones that belong there. Says so,
  and where production starts, so an empty factories, logistics or resources page is not taken
  for a missing plan, and offers "Go to Phase N" as the one next step (#786). The storage room
  (`place="storage"`, #1053) covers every phase, so there it says the room is the plan's from the
  start phase on. Draws nothing in any other phase.

  While the saved working phase is another one (workingPhaseNotShown() in session.ts: the tab
  shows this phase because it was picked in the phase picker, #1053, or the profile opened here,
  #570), it also says what ui/plan/OpenedEarlierNotice.vue would (the working phase, and the open
  steps when the profile opened here, openedFrom()), so the build plan shows one notice rather
  than two; OpenedEarlierNotice draws nothing in a milestone-only phase. The button then shows the
  working phase, as that notice's does, writing nothing. Otherwise the saved phase is this
  milestone-only one, and the button saves the start phase as the working phase, as "Work on
  Phase N" does: saved, the search cleared and the page redrawn.

  While any step of the milestone-only phases is open, "Mark everything before Phase N done"
  (#1068, data-earlier-done) ticks those open steps after a confirmation, in one `checks` update
  that only ticks (stepsBeforeStart in progression.ts: all unlock-<id> steps), then goes on as
  "Go to Phase N" does. It is the later way to say what the wizard's "Everything before Phase N is
  done" says when a profile is created (ui/wizard/AlreadyHave.vue).
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { allowSwitch, save } from '../../api.ts';
import {
  calculated,
  checked,
  milestoneOnly,
  openedFrom,
  phase,
  phaseLabel,
  progressionData,
  setOpenedPhase,
  setQuery,
  startPhase,
  state,
  workingPhaseNotShown,
} from '../../session.ts';
import { render } from '../../shell.ts';
import { planTasks } from '../../tasks.ts';
import { legacy } from '../bridge.ts';
import { confirmAction } from '../confirm.ts';
import { refocusOnOpenedPage } from '../refocus.ts';
import { earlierPhasesWords, milestoneOnlyPhases, stepsBeforeStart } from '../../../progression.ts';

// `place` is the page that shows it, where that changes the wording.
const props = defineProps<{ place?: 'storage' }>();

const notice = computed(() =>
  legacy(() => {
    if (!milestoneOnly() || !calculated) return null;
    const saved = workingPhaseNotShown(),
      opened = !!openedFrom(),
      shown = phaseLabel(phase()),
      start = phaseLabel(startPhase()),
      open = opened ? planTasks().filter(task => !checked(task.id)).length : 0;
    // The working phase, and why the plan starts here when the profile opened on this phase.
    const working = !saved
      ? ''
      : `You are working on ${phaseLabel(saved)}. ` +
        (!opened
          ? ''
          : open
            ? `${shown} still has ${open} open ${open === 1 ? 'step' : 'steps'}, so the plan starts here. `
            : `All ${shown} steps are done now. `);
    const earlierOpen = stepsBeforeStart(calculated, state, progressionData).filter(
      key => !checked(key),
    );
    return {
      text:
        working +
        `This profile plans production from ${start} on. ${shown} lists only the HUB milestones ` +
        (props.place === 'storage'
          ? `and MAM research that belong to it; the storage room below is the plan's from ${start} on.`
          : 'and MAM research that belong to it: no production lines, storage or power to build here.'),
      target: phaseLabel(saved || startPhase()),
      start,
      earlier: earlierPhasesWords(milestoneOnlyPhases(calculated)),
      earlierOpen,
    };
  }),
);

// While the start phase is being saved the button is busy (#299), so a second press sends nothing.
const busy = ref(false);
async function goOn(event: Event) {
  if (busy.value || !milestoneOnly()) return;
  const refocus = refocusOnOpenedPage(event.currentTarget);
  busy.value = true;
  try {
    if (!(await allowSwitch())) return;
    await showTarget();
    await refocus();
  } catch {
    // A failed write reports through the error toast; the page stays on this phase.
  } finally {
    busy.value = false;
  }
}

// Leave the milestone-only phase for the saved working phase, or the start phase (saved).
async function showTarget() {
  // The saved phase already is the one to show: only stop showing this one.
  if (!workingPhaseNotShown()) await save({ type: 'phase', value: startPhase() });
  setOpenedPhase(null);
  setQuery('');
  render();
}

// "Mark everything before Phase N done" (#1068): tick every open step of the milestone-only
// phases, after a confirmation, then go on as goOn does. Only ticks: a step already ticked is
// not sent, and nothing is unticked.
async function markEarlierDone(event: Event) {
  const view = notice.value;
  if (busy.value || !view?.earlierOpen.length) return;
  const trigger = event.currentTarget,
    keys = view.earlierOpen,
    count = keys.length === 1 ? '1 open step' : `${keys.length} open steps`;
  const ok = await confirmAction({
    title: `Mark everything before ${view.start} done?`,
    body:
      `This ticks the ${count} of ${view.earlier}: HUB milestones and MAM research. ` +
      'Steps you already ticked stay as they are, and you can untick any step later.',
    confirmLabel: `Tick ${count}`,
  });
  if (!ok || !milestoneOnly()) return;
  const refocus = refocusOnOpenedPage(trigger);
  busy.value = true;
  try {
    if (!(await allowSwitch())) return;
    await save({ type: 'checks', keys, value: true });
    await showTarget();
    await refocus();
  } catch {
    // A failed write reports through the error toast; the page stays on this phase.
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="notice" class="notice info" data-milestone-only>
    {{ notice.text }}<br /><button
      type="button"
      class="btn"
      data-go-to-start-phase
      :aria-disabled="busy || undefined"
      @click="goOn"
    >
      Go to {{ notice.target }}</button
    ><template v-if="notice.earlierOpen.length">
      <button
        type="button"
        class="btn"
        data-earlier-done
        :aria-disabled="busy || undefined"
        @click="markEarlierDone"
      >
        Mark everything before {{ notice.start }} done
      </button></template
    >
  </div>
</template>
