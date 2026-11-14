// "Work on Phase N instead" (#1053, BP-10): saves the phase shown as the profile's working phase,
// the one other tabs, devices and a reload open. Shared by the build plan's one phase banner
// (plan/OpenedEarlierNotice.vue) and the top bar's button on the pages that have no banner
// (Shell.vue). Busy while it saves (#299). Once the phase shown is the working phase focus moves
// to the phase picker that now says "Working on": the track's segment, or the select at phone
// widths. A failed write reports through the error toast and leaves everything as it was.
import { nextTick, ref } from 'vue';
import { save, toast } from '../api.ts';
import { phase, phaseLabel, setOpenedPhase, workingPhaseNotShown } from '../session.ts';
import { render } from '../shell.ts';

export const committing = ref(false);

export async function workOnShown() {
  const target = phase();
  if (committing.value || !workingPhaseNotShown()) return;
  committing.value = true;
  try {
    await save({ type: 'phase', value: target });
    setOpenedPhase(null);
    render();
    toast(`You are now working on ${phaseLabel(target)}.`);
    await nextTick();
    const wide = globalThis.matchMedia?.('(min-width: 721px)')?.matches;
    const picker = wide
      ? document.querySelector<HTMLElement>('[data-phase-track] [aria-selected="true"]')
      : document.querySelector<HTMLElement>('#phase-picker');
    picker?.focus();
  } catch {
    // Reported by the error toast; the phase shown stays and so does the button.
  } finally {
    committing.value = false;
  }
}
