// "New to Satisfactory" (#1076): a view preference remembered in this browser, like "Hide
// completed" (session.ts), never in a saved profile, so nothing stored changes and no plan is
// recalculated. Switched on, it
//   - hides the advanced details of a plan: the hard-drive payoff (the MAM's alternates, hidden by
//     style.css through the root element's data-beginner) and what whole machines cost against
//     exact clocks (ui/plan/RoundingCost.vue);
//   - leaves the recipes and exactness questions out of the guided start while their answers are
//     the simple ones, standard recipes and whole machines (guidedFlow in wizard/guided.ts); All
//     settings still has them;
//   - starts a new plan's stock question at "Nothing — just the elevator" (beginnerStock), which
//     with the standard recipes and whole machines keeps Phase 1 to a few biomass burners.
// Nothing stored, or anything unreadable, means off.
import { GUIDED_TOPUP_RATE } from '../preferences.ts';
import type { WizardSettings } from './wizard/wizard.ts';

export const BEGINNER_KEY = 'planner-beginner';

let beginner = stored();
markPage();
function stored(): boolean {
  try {
    return localStorage.getItem(BEGINNER_KEY) === 'on';
  } catch {
    return false;
  }
}

export const beginnerMode = (): boolean => beginner;

// Remembers the choice and marks the page (the root element's data-beginner) for style.css.
export function setBeginnerMode(value: boolean) {
  beginner = value;
  try {
    localStorage.setItem(BEGINNER_KEY, value ? 'on' : 'off');
  } catch {}
  markPage();
}

// Called once at startup and on every change. A page without a root element (the tests' bare
// documents) is left alone.
function markPage() {
  if (typeof document !== 'undefined')
    document.documentElement?.toggleAttribute?.('data-beginner', beginner);
}

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
