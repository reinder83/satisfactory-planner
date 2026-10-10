// The plan's own recalculation offers (#1071): "Recalculate in place with exact clocks"
// (plan/ExactClocksRecalc.vue), "… with items made on site" (factories/OnSiteRecalc.vue),
// "… with transport fuel" (factories/GroupLinks.vue) and "… with what you have"
// (plan/OwnedTicksNotice.vue, #1068). Each recalculates the open profile in place
// through the request Edit settings' "Recalculate in place" sends (POST /api/recalculate,
// recalculate.ts): same id and name, the new plan, the progress carried from itself with every
// carry pick (as the new profile these offers used to create was carried), so a line marked
// running that now needs more machines or more input is left unticked for review and ticks with
// no single line to land on are kept for review (onSiteReview). The previous version is kept whole
// as "<name> (before edit, <date>)". Nothing happens until the user presses the button and
// confirms; the confirmation names that backup. Then the unsaved-notes check (allowSwitch), the
// queued writes, and the calculation with its progress on the button, busy (app/busy.ts) so it
// keeps focus (#299). The page is redrawn with the new plan, whose notice is gone, so focus goes
// to the page's heading (refocusOnOpenedPage, #300, #304). A profile recalculated meanwhile in
// another tab or on another device is refused (409, the plan the offer was made on is named):
// nothing changes, and the tab opens the plan the profile has now.
import { allowSwitch, toast, writeQueue } from '../api.ts';
import { isBusy, whileBusy } from '../busy.ts';
import { keptName, postRecalculation, recalculatedText } from '../recalculate.ts';
import { calculated, currentProfile, currentSave, loadContext, setWorkspace } from '../session.ts';
import { render } from '../shell.ts';
import { calcProgress } from '../wizard/wizard.ts';
import { isTranscribed, RESOLVE_WARNING } from '../../handbook-migration.ts';
import { confirmAction } from './confirm.ts';
import { refocusOnOpenedPage } from './refocus.ts';

// The sentence after each offer's button.
export const IN_PLACE_NOTE =
  'recalculates this profile in place and carries your progress; the current version is kept as a backup under Profiles.';

// The refusal when the profile was recalculated elsewhere since the page showed the offer.
export const offerStale =
  'This profile was recalculated in another tab or on another device, so it was not recalculated again. Its new plan is shown now.';

export interface RecalcOffer {
  // The settings to calculate: the plan's own with the offer's change.
  settings: object;
  // What the recalculation plans, after "Recalculates “<name>” ": "with the vehicle fuel".
  change: string;
  // The button's label, put back after a failure.
  label: string;
}

// The confirmation's text: what is recalculated, how the progress is carried and where the
// current version is kept.
export function offerQuestion(name: string, change: string, kept: string, transcribed: boolean) {
  return (
    `Recalculates “${name}” ${change}. Its progress is carried: a production line marked ` +
    'running that now needs more machines or more input is left unticked for review. The ' +
    `current version is kept as “${kept}” under Profiles, with all of its progress.` +
    (transcribed ? ' ' + RESOLVE_WARNING : '')
  );
}

export async function recalculateOffer(button: HTMLButtonElement, offer: RecalcOffer) {
  if (isBusy(button) || !calculated) return;
  const saveId = currentSave.id,
    profileId = currentProfile.id,
    name = currentProfile.name,
    planCreatedAt = calculated.createdAt,
    kept = keptName(saveId, name);
  const confirmed = await confirmAction({
    title: 'Recalculate this profile in place?',
    body: offerQuestion(name, offer.change, kept, isTranscribed(calculated)),
    confirmLabel: 'Recalculate in place',
  });
  if (!confirmed || !(await allowSwitch())) return;
  const refocus = refocusOnOpenedPage(button);
  await whileBusy(button, async () => {
    try {
      await writeQueue;
      const done = await postRecalculation(
        { saveId, profileId, name, backupName: kept, settings: offer.settings, planCreatedAt },
        calcProgress(button, 'Recalculating…'),
      );
      setWorkspace(done.workspace);
      await loadContext(done.saveId, done.profileId);
      render();
      toast(recalculatedText(done.reviewCount, kept));
      void refocus();
    } catch (error) {
      button.textContent = offer.label;
      if ((error as { status?: number }).status !== 409) {
        toast((error as Error).message, true);
        return;
      }
      // Only while the tab still shows that profile: one opened meanwhile stays open.
      if (currentSave.id === saveId && currentProfile.id === profileId)
        await loadContext(saveId, profileId).catch(() => {});
      render();
      toast(offerStale, true);
      void refocus();
    }
  });
}
