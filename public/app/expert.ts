// "Expert mode" (#1197): the counterpart of "New to Satisfactory" (beginner.ts) for players who know
// the game, and a view preference like it: remembered in this browser, never in a saved profile, so
// nothing stored changes and no plan is recalculated. Switched on, it
//   - opens a new plan on All settings instead of the guided start (openWizard in
//     wizard/wizard.ts), which "← Guided start" still reaches;
//   - draws All settings on three denser screens instead of five, without the explanatory
//     paragraphs (wizardScreens in wizard/wizard.ts, WizardPage.vue): the same fields, read the
//     same way, so the same answers give the same settings and the same plan;
//   - groups the build plan's HUB milestones and MAM research by tier, with a tick per group as
//     well as per item (unlock-groups.ts, ui/plan/UnlockGroups.vue), which writes the same checks
//     ticking each item writes.
// It is never on together with New to Satisfactory: switching one on switches the other off, and a
// browser that somehow has both stored reads as a beginner. Nothing stored, or anything
// unreadable, means off.
import { beginnerMode, setBeginnerMode } from './beginner.ts';

export const EXPERT_KEY = 'planner-expert';

let expert = storedExpert();
function storedExpert(): boolean {
  try {
    return localStorage.getItem(EXPERT_KEY) === 'on';
  } catch {
    return false;
  }
}

export const expertMode = (): boolean => expert && !beginnerMode();

// Remembers the choice; switching it on switches New to Satisfactory off.
export function setExpertMode(value: boolean) {
  if (value && beginnerMode()) setBeginnerMode(false);
  expert = value;
  try {
    localStorage.setItem(EXPERT_KEY, value ? 'on' : 'off');
  } catch {}
}

// "New to Satisfactory" switched from a page that offers both: on switches expert mode off.
export function switchBeginnerMode(value: boolean) {
  setBeginnerMode(value);
  if (value && expert) setExpertMode(false);
}
