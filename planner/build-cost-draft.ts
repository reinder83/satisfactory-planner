// The check of a plan that counts what its buildings cost to build (#1229, settings.buildCost), and
// the draft of a phase that fails it.
//
// The check, not a demand of the plan: a phase is planned exactly as without the setting, and then
// its exact LP is solved once more with the build-cost rows (addBuildCosts in build-cost.ts): its
// deliveries, the parts its production lines, generators, miners and extractors cost to build, and
// the lines that make those parts, within the phase's time on its budgets. When that fits, the
// phase keeps its plan, byte for byte. When it does not, the phase is a draft whose reason names
// the build cost. Adding the parts to the plan's own demand would put lines for them into the plan
// and send what they make nowhere the pages know of (the books, the flow, the sink), so the plan is
// left as it is and only its feasibility counts them.
//
// Measured as every draft is (draft.ts): the exact LP at precise clocks without production
// amplification, so whole machines may need a little more and amplified machines a little less.
// Only from the start phase on: the phases before it are milestone-only and show no production.
import { BUILD_COSTS } from '../public/preferences.ts';
import { buildingName, listNames } from '../public/wording.ts';
import { amplifiesIn } from '../public/somersloops.ts';
import type {
  CurrentSettings,
  CurrentStage,
  PhaseCaps,
  StageBuildCost,
} from '../public/types/index.ts';
import type { Solved } from './types.ts';
import { DATA } from './data.ts';
import { goalHours } from './model.ts';
import {
  buildCostCapWords,
  exactRun,
  fitsInHours,
  leastHours,
  phaseBudgets,
  shortfallReason,
  type DraftContext,
} from './draft.ts';
import { warningDuration } from './warnings.ts';

// A number in the stored reason, the same in both editions and whatever locale the server or the
// browser runs in: en-US, with at most two decimals ("7,700", "1.5").
const EN_US = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const enUs = (value: number): string => EN_US.format(value);

// Each build-cost draft's own plan: the phase as planned without its buildings' parts (`own`),
// which the caps per phase read (capBuildCostDraft). In memory only, never stored.
const ownPlans = new WeakMap<CurrentStage, Solved>();

// The draft of `phase` when its budgets cannot also make what its buildings cost to build in its
// time, else null (the phase keeps its plan): see the header. Called for a phase whose plan fits,
// `own`, which the draft keeps for the caps per phase (capBuildCostDraft).
export function buildCostDraft(
  config: CurrentSettings,
  phase: number,
  own?: Solved,
): CurrentStage | null {
  if (!config.buildCost || phase < Number(config.phase)) return null;
  const conversion = phase === 5 && config.sam !== 'avoid';
  const plain: CurrentSettings = { ...config, amplifySloops: 0 };
  const draft: DraftContext = {
    config,
    phase,
    plain,
    conversion,
    budgets: phaseBudgets(config, phase),
    buildCost: true,
  };
  const hours = goalHours(config);
  if (fitsInHours(draft, hours)) return null;
  // What the goal needs with the budgets lifted, the parts included; when no budget makes them in
  // time, the plan without them, whose buildings the reason names as counted over a long time.
  const needed = exactRun(plain, phase, { conversion, ignoreLimits: true, buildCost: true });
  const plan = needed.feasible
    ? needed
    : exactRun(plain, phase, { conversion, ignoreLimits: true });
  if (!plan.feasible) return null;
  const counted = needed.feasible ? needed.buildCost : longCount(plain, phase, conversion);
  const buildCost: StageBuildCost = { ...(counted ?? { buildings: {}, parts: {} }), hours };
  const stage: CurrentStage = { ...plan, feasible: false, buildCost };
  const lead = buildCostWords(buildCost, needed.feasible);
  if (needed.feasible) {
    stage.reason = lead + ' ' + shortfallReason(stage, draft, needed, hours);
    if (amplifiesIn(config, phase) && stage.shortfalls?.length)
      stage.reason +=
        ' These amounts are before production amplification; amplified machines may need somewhat less.';
  } else stage.reason = lead + ' ' + noBudgetWords(stage, draft, hours);
  if (own) ownPlans.set(stage, own);
  return stage;
}
// A build-cost draft whose own plan is over a cap per phase (#1221) as well: its reason also names
// the cap (buildCostCapWords, #1020). The caps come after the build cost (holdToCaps in
// calculate.ts), which plans no draft again, so this is where such a draft hears of them. Any other
// stage, and a draft that already names a cap, is left as it is.
export function capBuildCostDraft(stage: CurrentStage, caps: PhaseCaps): void {
  const own = ownPlans.get(stage);
  if (!own || stage.capShortfalls) return;
  const words = buildCostCapWords(stage, caps, own);
  if (words) stage.reason += ' ' + words;
}
// What the buildings of the plan without the parts cost: counted over the longest time a phase may
// take, where the lines for the parts add next to nothing.
function longCount(plain: CurrentSettings, phase: number, conversion: boolean) {
  const long = exactRun({ ...plain, goal: 'timed', hours: 2000 }, phase, {
    conversion,
    ignoreLimits: true,
    buildCost: true,
  });
  return long.feasible ? long.buildCost : undefined;
}
// The reason's first sentence: the building that costs the most to build (by the AWESOME Sink's
// points of its parts, a measure of what they take to make) with its parts, and how many other
// buildings need parts too. The counts are those of the plan that would also make the parts in the
// phase's time (more buildings than the player's plan, #1020), so it says so: "Counting what its
// buildings cost to build, this phase does not fit in its 8 h: to also make its buildings' parts
// within its 8 h, this phase would need 40 Fuel Generators (600 × Motor, … and 2,000 × Quickwire
// to build them) and 85 other buildings, and its budgets can't make all their parts in time along
// with its deliveries." `within` false (no budget makes the parts in time, so the counts are of
// the plan over a long time, close to the player's own) keeps the plain "its 40 Fuel Generators
// need …" wording.
export function buildCostWords(
  { hours, buildings, parts: counted }: StageBuildCost,
  within = true,
): string {
  const opening = `Counting what its buildings cost to build, this phase does not fit in its ${enUs(hours)} h`;
  const ranked = Object.entries(buildings)
    .map(([building, count]) => ({
      building,
      count,
      weight: buildingWeight(building, counted) * count,
    }))
    .sort((first, second) => second.weight - first.weight);
  const top = ranked[0];
  if (!top) return opening + '.';
  const others = ranked.slice(1).reduce((total, entry) => total + entry.count, 0);
  const parts = Object.entries(countedParts(top.building, counted))
    .sort(([a, first], [b, second]) => second - first || a.localeCompare(b))
    .map(([item, amount]) => `${enUs(amount * top.count)} × ${item}`);
  const named = `${enUs(top.count)} ${buildingName(top.building, top.count)}`;
  const otherCount = `${enUs(others)} other building${others === 1 ? '' : 's'}`;
  if (within)
    return `${opening}: to also make its buildings' parts within its ${enUs(hours)} h, this phase would need ${named} (${listNames(parts)} to build ${top.count === 1 ? 'it' : 'them'})${others ? ` and ${otherCount}` : ''}, and its budgets can't make all their parts in time along with its deliveries.`;
  const rest = others ? `, and its ${otherCount} need parts too, which it can't` : `, which it can't`;
  return `${opening}: its ${named} need${top.count === 1 ? 's' : ''} ${listNames(parts)} to build${rest} make in time along with its deliveries.`;
}
// The time sentence when no budget makes the parts in time: the hours the phase would fit its
// budgets in, by bisection as the budget reason finds them, or that more time alone does not fit.
function noBudgetWords(stage: CurrentStage, draft: DraftContext, hours: number): string {
  if (!fitsInHours(draft, 2000))
    return 'More time alone will not fit: no budget lets this phase make its buildings and its deliveries.';
  stage.minHours = leastHours(draft, hours);
  return `No budget makes them in that time, but it fits the current budgets at ${warningDuration(stage.minHours)} for this phase.`;
}
// One building's parts that the phase counted (the items of `counted`, the parts of all of them).
const countedParts = (building: string, counted: StageBuildCost['parts']) =>
  Object.fromEntries(
    Object.entries(BUILD_COSTS[building]?.cost ?? {}).filter(
      ([item]) => counted[item] !== undefined,
    ),
  );
// What one building's counted parts take to make, in AWESOME Sink points (each part's sink value).
const buildingWeight = (building: string, counted: StageBuildCost['parts']): number =>
  Object.entries(countedParts(building, counted)).reduce(
    (total, [item, amount]) => total + amount * (DATA.items[item]?.sink ?? 1),
    0,
  );
