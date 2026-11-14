// Expert, the detail level that was "Expert mode" (#1197; one level of three since #1337,
// detail-level.ts), for players who know the game. It is shown, never recalculated: at Expert
//   - a new plan opens on All settings instead of the guided start (openWizard in
//     wizard/wizard.ts), which "← Guided start" still reaches;
//   - All settings is drawn on three denser screens instead of five, without the explanatory
//     paragraphs (wizardScreens in wizard/wizard.ts, WizardPage.vue): the same fields, read the
//     same way, so the same answers give the same settings and the same plan;
//   - the build plan's HUB milestones and MAM research are grouped by tier, with a tick per group
//     as well as per item (unlock-groups.ts, ui/plan/UnlockGroups.vue), which writes the same
//     checks ticking each item writes.
import { detailLevel } from './detail-level.ts';

export const expertMode = (): boolean => detailLevel() === 'expert';
