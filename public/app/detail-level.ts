// Detail level (ONB-2, #1337): one Beginner / Standard / Expert setting in place of the two
// switches "New to Satisfactory" (#1076) and "Expert mode" (#1197), which could both be on.
//   - Beginner is what "New to Satisfactory" did (beginner.ts): fewer guided questions, a new save
//     stocked with nothing, no hard-drive payoff or whole-machine costs on the build plan.
//   - Expert is what "Expert mode" did (expert.ts): All settings first, on three denser screens,
//     and the build plan's unlocks grouped by tier.
//   - Standard is neither.
// Each profile keeps its own level (`detailLevel` in its progress state, state version 31): the
// build plan's control saves it, and a new profile or a recalculation in place takes the level
// the wizard showed. A profile without one (every profile before #1337) follows this browser's
// level, as the two switches did, so nothing looks different after the update.
//
// This browser's level is `planner-detail` in localStorage. A browser without it is migrated
// once from the two switches' keys, which stay as they were (an older release still reads them):
//   both on → Expert, New to Satisfactory only → Beginner, Expert mode only → Expert,
//   neither → Standard.
// Picking a level in the wizard sets it too, so the next new plan starts there. Unreadable
// storage means Standard.
import { state, stateLoaded, view, wizard } from './session.ts';
import type { DetailLevel } from '../types/index.ts';

export const DETAIL_KEY = 'planner-detail';
// The two switches' keys before #1337: 'on' or 'off'.
export const LEGACY_BEGINNER_KEY = 'planner-beginner';
export const LEGACY_EXPERT_KEY = 'planner-expert';

// The words each level is shown with, in order.
export const DETAIL_LABELS: readonly [DetailLevel, string][] = [
  ['beginner', 'Beginner'],
  ['standard', 'Standard'],
  ['expert', 'Expert'],
];

// What each level does, under the wizard's control.
export const DETAIL_NOTES: Record<DetailLevel, string> = {
  beginner:
    'Keeps it simple: skips the questions on alternate recipes and clock speeds, hides the ' +
    'hard-drive and clock details on the build plan, and starts a new save with nothing stocked ' +
    'beyond the Space Elevator. All settings still has everything.',
  standard:
    'Every question, and every detail on the build plan. Beginner keeps it simple; Expert skips ' +
    'to All settings.',
  expert:
    'For players who know the game: skips these questions for All settings on three denser ' +
    "screens, and groups the build plan's unlocks by tier with a tick per tier.",
};

const isDetailLevel = (value: unknown): value is DetailLevel =>
  DETAIL_LABELS.some(([level]) => level === value);

// The level the two switches of an older release stand for.
export const legacyDetail = (beginner: boolean, expert: boolean): DetailLevel =>
  expert ? 'expert' : beginner ? 'beginner' : 'standard';

let browserLevel = storedDetail();
function storedDetail(): DetailLevel {
  let level: DetailLevel;
  try {
    const kept = localStorage.getItem(DETAIL_KEY);
    if (isDetailLevel(kept)) return kept;
    level = legacyDetail(
      localStorage.getItem(LEGACY_BEGINNER_KEY) === 'on',
      localStorage.getItem(LEGACY_EXPERT_KEY) === 'on',
    );
  } catch {
    return 'standard';
  }
  try {
    localStorage.setItem(DETAIL_KEY, level);
  } catch {}
  return level;
}

// This browser's level: for a profile without its own and for the wizard's next new plan.
export const browserDetail = (): DetailLevel => browserLevel;
export function setBrowserDetail(level: DetailLevel) {
  browserLevel = level;
  try {
    localStorage.setItem(DETAIL_KEY, level);
  } catch {}
}

// The level of a profile's progress state: its own, else this browser's.
export const profileDetail = (progress: { detailLevel?: DetailLevel } | null | undefined) =>
  progress?.detailLevel ?? browserLevel;

// The level shown now: the wizard's while it is on screen (its draft's, started from the profile it
// edits or the level shown before it opened), else the open profile's.
export function detailLevel(): DetailLevel {
  if (view === 'wizard' && wizard) {
    return (
      wizard.detail ?? (wizard.edit ? profileDetail(stateLoaded ? state : null) : browserLevel)
    );
  }
  return profileDetail(stateLoaded ? state : null);
}
