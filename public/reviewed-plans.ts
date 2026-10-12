// The plans the wizard's Review showed (POST /api/preview), kept so "Create profile"
// (POST /api/profiles, #1060) and Edit settings' "Recalculate in place" (POST /api/recalculate,
// #1138, reviewedReplacement below) store the plan the user reviewed instead of calculating it
// again: a second calculation took as long again (20 s and more for maximum output on a phone),
// and a search that stopped at its time limit could give a plan other than the one reviewed. Both
// editions keep them in memory only (the Docker server per user, the browser edition for its tab),
// so nothing is stored and a restart or reload only means one more calculation.
//
// A plan is kept for the exact settings it was calculated from, as the request sent them, so a
// create or recalculation with any other settings (changed after Review was drawn, or from
// another tab) is calculated afresh. calculate() is a function of its settings, so the kept plan
// is what a fresh calculation for them gives, created when Review calculated it. The plan is
// copied when it is kept and again for each use, so neither the page showing it nor a stored
// profile changes it.
// Live estimates (`?estimate=1`) are not kept: Review always calculates its own preview.

// How many plans are kept at once (the oldest goes first), and for how long.
export const REVIEWED_PLANS = 8;
export const REVIEWED_PLAN_MS = 60 * 60 * 1000;

export interface ReviewedPlans<P> {
  // Keeps the plan Review showed for `settings`, for `owner` (a user id; '' in the browser).
  keep(owner: string, settings: unknown, plan: P): void;
  // A copy of the plan kept for exactly these settings, or null: calculate it then.
  take(owner: string, settings: unknown): P | null;
}

export function reviewedPlans<P>(now: () => number = Date.now): ReviewedPlans<P> {
  const kept = new Map<string, { plan: P; at: number }>();
  const keyOf = (owner: string, settings: unknown) => owner + '\n' + JSON.stringify(settings);
  return {
    keep(owner, settings, plan) {
      const key = keyOf(owner, settings);
      kept.delete(key);
      kept.set(key, { plan: structuredClone(plan), at: now() });
      // A Map keeps insertion order, so the first key is the oldest; the loop runs only while
      // the map holds more than REVIEWED_PLANS keys, so there is one.
      while (kept.size > REVIEWED_PLANS) kept.delete(kept.keys().next().value!);
    },
    take(owner, settings) {
      const key = keyOf(owner, settings),
        entry = kept.get(key);
      if (!entry) return null;
      if (now() - entry.at > REVIEWED_PLAN_MS) {
        kept.delete(key);
        return null;
      }
      return structuredClone(entry.plan);
    },
  };
}

// Edit settings' "Recalculate in place" (#1138, POST /api/recalculate in both editions) stores
// the plan its Review showed the same way: the plan kept for exactly these settings, or null
// (calculate it then). Only a plan Review calculated after the profile's plan was made
// (`replacing`, the request's planCreatedAt, which checkRecalculate has matched with the
// profile) is used: Review always comes after the plan it edits, and an older one would bring
// back a creation time the profile had before (the plan it has, or one it left behind), which
// the stale-tab checks (409) tell plans apart by. Each recalculation in place therefore gives the
// profile a plan of its own creation time, as calculating did. The plan's recalculation offers
// have no Review: their settings were not reviewed, so they are calculated.
export function reviewedReplacement<P extends { createdAt: string }>(
  plans: ReviewedPlans<P>,
  owner: string,
  settings: unknown,
  replacing: unknown,
): P | null {
  const plan = plans.take(owner, settings);
  return plan && typeof replacing === 'string' && Date.parse(plan.createdAt) > Date.parse(replacing)
    ? plan
    : null;
}
