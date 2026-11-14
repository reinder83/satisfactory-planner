// Beginner, the detail level that was "New to Satisfactory" (#1076; one level of three since
// #1337, detail-level.ts). It is shown, never recalculated: at Beginner
//   - the advanced details of a plan are hidden: the hard-drive payoff (ui/plan/PayoffPanel.vue)
//     and what whole machines cost against exact clocks (ui/plan/RoundingCost.vue);
//   - the guided start leaves out the recipes and exactness questions while their answers are the
//     simple ones, standard recipes and whole machines (guidedFlow in wizard/guided.ts); All
//     settings still has them;
//   - a new plan's stock question starts at "Nothing — just the elevator" (beginnerStock), which
//     with the standard recipes and whole machines keeps Phase 1 to a few biomass burners.
import { GUIDED_TOPUP_RATE } from '../preferences.ts';
import { detailLevel } from './detail-level.ts';
import type { WizardSettings } from './wizard/wizard.ts';

export const beginnerMode = (): boolean => detailLevel() === 'beginner';

// The stock a new plan starts with: the guided start's "My building materials" with Concrete
// topped up, or "Nothing — just the elevator" for a beginner.
const STOCK_DEFAULT = { storage: 'construction', collectables: false } as const;
const STOCK_BEGINNER = { storage: 'none', collectables: false } as const;

const isStock = (settings: WizardSettings, beginnerStock: boolean): boolean => {
  const overrides = Object.entries(settings.storageOverrides || {});
  return beginnerStock
    ? settings.storage === 'none' && !overrides.length
    : settings.storage === 'construction' &&
        overrides.length === 1 &&
        overrides[0]![0] === 'Concrete' &&
        overrides[0]![1] === GUIDED_TOPUP_RATE;
};

// A new plan's stock for `beginner` (true: nothing stocked), written over `settings` only while
// it still holds the other mode's default, so a stock the user picked is never changed.
// Returns whether it changed anything.
export function beginnerStock(settings: WizardSettings, value: boolean): boolean {
  if (!isStock(settings, !value)) return false;
  Object.assign(settings, value ? STOCK_BEGINNER : STOCK_DEFAULT);
  settings.storageOverrides = value ? {} : { Concrete: GUIDED_TOPUP_RATE };
  return true;
}
