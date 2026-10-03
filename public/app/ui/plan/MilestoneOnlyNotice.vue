<!--
  On a calculated profile's build plan, factories and resources pages while a milestone-only phase
  is shown (#759, milestoneOnly() in session.ts): a phase before the profile's start phase, which
  lists only the milestones that belong there. Says so, and where production starts, so an empty
  factories or resources page is not taken for a missing plan, and offers "Go to Phase N" as the
  one next step (#786). Draws nothing in any other phase.

  When the profile opened here although its saved working phase is a later one (#570,
  openedFrom()), it also says what ui/plan/OpenedEarlierNotice.vue would (the working phase and the
  open steps), so the build plan shows one notice rather than two; OpenedEarlierNotice draws
  nothing in a milestone-only phase. The button then goes to the saved phase, as that notice's
  does, writing nothing. Otherwise the saved phase is this earlier one (picked on the phase track),
  and the button picks the start phase the way the phase track does: saved, the search cleared and
  the page redrawn.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { allowSwitch, save } from '../../api.ts';
import {
  checked,
  milestoneOnly,
  openedFrom,
  phase,
  phaseLabel,
  setOpenedPhase,
  setQuery,
  startPhase,
} from '../../session.ts';
import { render } from '../../shell.ts';
import { planTasks } from '../../tasks.ts';
import { legacy } from '../bridge.ts';
import { refocusOnOpenedPage } from '../refocus.ts';

const notice = computed(() =>
  legacy(() => {
    if (!milestoneOnly()) return null;
    const saved = openedFrom(),
      shown = phaseLabel(phase()),
      start = phaseLabel(startPhase()),
      open = saved ? planTasks().filter(task => !checked(task.id)).length : 0;
    // The working phase and why the plan starts here, when it opened on this phase.
    const working = !saved
      ? ''
      : `You are working on ${phaseLabel(saved)}. ` +
        (open
          ? `${shown} still has ${open} open ${open === 1 ? 'step' : 'steps'}, so the plan starts here. `
          : `All ${shown} steps are done now. `);
    return {
      text:
        working +
        `This profile plans production from ${start} on. ${shown} lists only the HUB milestones ` +
        'and MAM research that belong to it: no production lines, storage or power to build here.',
      target: phaseLabel(saved || startPhase()),
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
    // The saved phase already is the one to show: only stop showing the earlier one.
    if (!openedFrom()) await save({ type: 'phase', value: startPhase() });
    setOpenedPhase(null);
    setQuery('');
    render();
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
      Go to {{ notice.target }}
    </button>
  </div>
</template>
