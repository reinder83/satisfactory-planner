// All settings' screens (#1197). The draft's `step` (1-5) is always one of the five steps: Game
// settings, Preferences, Goals, Resources and Review. Normally each is a screen of its own; in
// expert mode (expert.ts) the first two share a screen and so do the next two, so All settings
// takes three denser screens. A screen draws the same step components with the same named fields,
// read by the same readers (readWizard in wizard.ts), so the same answers give the same settings
// and the same plan whichever way they were entered. WizardPage.vue draws the screen holding the
// draft's step; moving within a screen is no move.
import { expertMode } from '../expert.ts';

export interface WizardScreen {
  // The steps drawn together, in order; the first is the screen's own step for the tabs.
  steps: number[];
  title: string;
}

const FIVE_SCREENS: WizardScreen[] = [
  { steps: [1], title: 'Game settings' },
  { steps: [2], title: 'Preferences' },
  { steps: [3], title: 'Goals' },
  { steps: [4], title: 'Resources' },
  { steps: [5], title: 'Review' },
];
const COMPACT_SCREENS: WizardScreen[] = [
  { steps: [1, 2], title: 'Settings & preferences' },
  { steps: [3, 4], title: 'Goals & resources' },
  { steps: [5], title: 'Review' },
];

export const wizardScreens = (): WizardScreen[] => (expertMode() ? COMPACT_SCREENS : FIVE_SCREENS);

// The steps drawn with `step`, itself included.
export const screenSteps = (step: number): number[] =>
  wizardScreens().find(screen => screen.steps.includes(step))?.steps ?? [step];

// The first step of the screen after, and of the screen before, the one holding `step`.
export const nextScreenStep = (step: number): number => Math.max(...screenSteps(step)) + 1;
export const previousScreenStep = (step: number): number => Math.min(...screenSteps(step)) - 1;

// Where a step's heading says it is ("Step 2 of 3", ui/form/StepHeading.vue): the number of its
// screen, on the screen's first step only, so a shared screen announces itself once.
export function stepPlace(step: number): { step?: number; total?: number } {
  const screens = wizardScreens(),
    at = screens.findIndex(screen => screen.steps[0] === step);
  return at < 0 ? {} : { step: at + 1, total: screens.length };
}
