// Carrying progress into a new profile (newProfileState, the carry options, carryGuide), the
// profiles /api/profiles and /api/round-up add in both editions (calculatedProfile,
// roundUpState, wholeMachineProfile), their refusals (checkNewProfileKind, checkRoundUp) and
// sharing a profile without its progress (shareState).
// Re-exported by ../state.ts.
import type {
  CalcRow,
  FactoryGroups,
  GroupAssignment,
  StoredProfileKind,
  ProgressState,
  SavedState,
  StageKey,
  StoredCalculatedPlan,
  StoredProfile,
} from '../types/index.ts';
import { recipeIdOf } from '../progression.ts';
import { defaultFactoryGroups } from './factory-groups.ts';
import {
  type RowsPlan,
  fail,
  initialState,
  plain,
  safeKey,
  validateEdits,
  validateGroups,
  validateOnSiteReview,
  validateOrigin,
  validateState,
  validateTaskEdits,
} from './validate.ts';

// A new profile for a save you are already playing describes the same world.
// These groups say which of the previous profile's records are facts about that
// world (unlocks, the built storage room, deliveries handed in) rather than
// facts about its plan, so a new profile can start from them instead of an
// empty checklist. Plan-shaped records are carried only where the new plan
// still asks for the same or less work.
export const carryOptions: [key: string, label: string, description: string][] = [
  [
    'unlocks',
    'Milestone, MAM and hard-drive unlocks',
    'Tier milestones, MAM research and the alternate recipes you confirmed in game.',
  ],
  [
    'storage',
    'Storage room layout and containers',
    'Floors, bays, container names and every built, labelled, connected and verified position.',
  ],
  [
    'commissioning',
    'Power and start-up steps',
    'Biomass, coal, fuel, nuclear, drone-fuel and portal commissioning you already finished.',
  ],
  [
    'deliveries',
    'Elevator deliveries handed in',
    'The part counts you already delivered to the Space Elevator.',
  ],
  [
    'notes',
    'Notes and personal tasks',
    'Save-wide notes, step notes and the tasks you added yourself.',
  ],
  [
    'planEdits',
    'Build-plan edits and factories',
    'Renamed, reordered and removed steps, plus your factories and their names.',
  ],
  [
    'factories',
    'Progress on unchanged production lines',
    'Production lines stay ticked where the new plan needs no more machines and no more input.',
  ],
  [
    'picked',
    'Treat this plan’s alternate recipes as unlocked',
    'Ticks the unlock step for every alternate recipe you picked, including the ones your ingot and power preferences require.',
  ],
];
// The checklist key prefixes each world-shaped carry option copies as they are. The other
// options (deliveries, notes, planEdits, factories, picked) are handled in newProfileState.
const carryPrefixes: Record<string, string[]> = {
  unlocks: ['unlock-', 'recipe-unlock-', 'hard-drives-'],
  storage: ['slot-', 'storage-'],
  commissioning: [
    'startup-',
    'preferred-power-',
    'drone-fuel-',
    'early-base-',
    'portal-supply',
    'power-retained',
  ],
};
// Alternates releases before #1044 planned as hard-drive alternates, each with its own unlock step
// 'recipe-unlock-<recipe>', which the game unlocks with a MAM node or a HUB milestone instead: by
// the id of that unlock, whose step ('unlock-<id>') a recalculated plan lists for the recipe now.
// The recipe comes with that unlock and no other way, so a tick on the recipe's old step means
// the unlock is done in game. tests/recipe-unlocks.test.ts checks the ids against
// progression.json and MAM_RECIPES and MILESTONE_RECIPES in planner/data.ts.
export const UNLOCKED_WITH: Record<string, string> = {
  Recipe_Alternate_PolyesterFabric_C: 'Research_Mycelia_2_1_C',
  Recipe_Alternate_Silica_Distilled_C: 'Schematic_7-5_C',
};
// Turns the client's carry choices into { option: boolean }. An absent choice carries
// everything; anything else that is not an object carries nothing.
export const carryPicks = (raw: unknown): Record<string, boolean> =>
  Object.fromEntries(
    carryOptions.map(([key]) => [key, raw === undefined ? true : !!(plain(raw) && raw[key])]),
  );
// Rows of a plan keyed by the checklist address their step uses.
const planRows = (plan: RowsPlan | null | undefined): Map<string, CalcRow> => {
  const rows = new Map<string, CalcRow>();
  for (const [phase, stage] of Object.entries(plan?.stages || {}))
    for (const row of stage.rows || []) rows.set('calc-' + phase + '-' + row.id, row);
  return rows;
};
// Hand-picking alternates states which recipes you own: the recipes ticked in
// the picker plus the ones a pure-ingot or power preference locks in for you,
// which reach the plan as alternate rows rather than as picks. A row's recipe is recipeIdOf's, so
// an amplified twin or a group's own line ticks its recipe's step (#901).
export function pickedRecipeUnlocks(plan: RowsPlan | null | undefined): string[] {
  if (plan?.settings?.recipes !== 'custom') return [];
  const ids = new Set(plan.settings.alternateRecipes || []);
  for (const row of planRows(plan).values()) if (row.alternate) ids.add(recipeIdOf(row));
  return [...ids].filter(id => safeKey('recipe-unlock-' + id));
}
// What a new profile may be told is already standing in the world. The guided
// start asks this for a save you are not beginning from scratch: a production
// line you already built, the HUB tutorial you already finished. These are the
// checklist keys those records already use, so nothing new is stored and the
// answer is as reversible as any other tick.
//
// Only three families are accepted, all of them facts about the world rather
// than about this plan: a production row this very plan builds, an early-base
// step, and an unlock. Anything else is dropped rather than rejected, so an
// older or newer client cannot fail a profile it is otherwise allowed to make.
const builtKeys = (raw: unknown, plan: RowsPlan | null): string[] => {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 2000) fail('Invalid list of finished work.');
  const rows = planRows(plan);
  return [...new Set<unknown>(raw)].filter(
    (key): key is string =>
      safeKey(key) && (rows.has(key) || key.startsWith('early-base-') || key.startsWith('unlock-')),
  );
};
// Build the starting progress for a newly created profile. Without a source
// profile and without a list of finished work this is the blank state every
// earlier release produced.
//
// plan is the new profile's calculation (null for an original-handbook profile), source and
// sourcePlan the sibling profile's state and plan to carry from, raw the carry choices and
// built the guided start's finished-work keys. Returns { state, reviewCount, carried }: the
// validated state, how many carried 'calc-' ticks were unticked for review, and how many
// checks start ticked. The source is only read. Called by calculatedProfile below, which
// /api/profiles uses in save-routes.ts and in browser-api.ts.
export function newProfileState(
  plan: RowsPlan | null,
  source: SavedState | null | undefined,
  sourcePlan: RowsPlan | null | undefined,
  raw: unknown,
  built: unknown,
): { state: ProgressState; reviewCount: number; carried: number } {
  const state = initialState();
  state.settings.phase = plan?.settings?.phase || '3';
  if (plan) state.factoryGroups = defaultFactoryGroups(plan);
  // Recorded before any carried records, so a source profile that deliberately
  // left one of these unticked still wins below.
  const standing = builtKeys(built, plan);
  for (const key of standing) state.checks[key] = true;
  if (!source) {
    const clean = validateState(state);
    return {
      state: clean,
      reviewCount: 0,
      carried: Object.values(clean.checks).filter(Boolean).length,
    };
  }
  const picks = carryPicks(raw);
  if (picks.factories)
    for (const key of standing) if (source.checks?.[key] === false) delete state.checks[key];
  // For a save you already play those picks are in-game unlocks, so their
  // confirmation steps start ticked. Records copied below still win, including a
  // step the previous profile left deliberately unticked.
  if (picks.picked)
    for (const id of pickedRecipeUnlocks(plan)) state.checks['recipe-unlock-' + id] = true;
  const prefixes = Object.entries(carryPrefixes)
    .filter(([key]) => picks[key])
    .flatMap(([, list]) => list);
  for (const [key, value] of Object.entries(source.checks || {}))
    if (prefixes.some(prefix => key.startsWith(prefix))) state.checks[key] = value;
  if (picks.unlocks) carryRecipeUnlocks(state, source);
  if (picks.deliveries) state.deliveries = { ...source.deliveries };
  if (picks.storage)
    for (const [key, value] of Object.entries(source.notes || {}))
      if (key.startsWith('slot-')) state.notes[key] = value;
  if (picks.storage) state.storageEdits = validateEdits(source.storageEdits);
  if (picks.notes) {
    state.notes = { ...state.notes, ...source.notes };
    state.customTasks = structuredClone(source.customTasks || []);
    for (const task of state.customTasks) {
      const done = source.checks?.[task.id];
      if (done !== undefined) state.checks[task.id] = done;
    }
  }
  if (picks.planEdits) {
    state.taskEdits = validateTaskEdits(source.taskEdits);
    state.factoryGroups = mergeGroups(state.factoryGroups, source.factoryGroups, plan);
  }
  // A row ticked in the source stays ticked only if the old plan had the same row with at
  // least as many machines and inputs. Otherwise it is stored as false, the same review
  // rule /api/round-up applies. Rows the source never ticked are left alone.
  let reviewCount = 0;
  if (picks.factories && plan) {
    const previous = planRows(sourcePlan);
    for (const [key, row] of planRows(plan)) {
      if (!source.checks?.[key] || !safeKey(key)) continue;
      const old = previous.get(key);
      const grown =
        !old ||
        row.machines > old.machines ||
        Object.entries(row.inputs || {}).some(
          ([item, rate]) => rate > (old.inputs?.[item] || 0) + 0.001,
        );
      state.checks[key] = !grown;
      if (grown) reviewCount++;
    }
    reviewCount += keepSiteTicks(state, plan, source, sourcePlan);
  }
  // What a handbook migration could not place is kept for review and never deleted (#485), so a
  // profile carried from a migrated one takes it along unchanged, whatever the picks (#489).
  const origin = validateOrigin(source.handbookOrigin);
  if (origin) state.handbookOrigin = origin;
  // So are the ticks an earlier recalculation kept for review because of lines made on site.
  const review = validateOnSiteReview(source.onSiteReview);
  if (review) state.onSiteReview = { checks: { ...review.checks, ...state.onSiteReview?.checks } };
  const clean = validateState(state);
  return { state: clean, reviewCount, carried: Object.values(clean.checks).filter(Boolean).length };
}
// The unlocks behind the source's ticked old recipe steps (UNLOCKED_WITH, #1044): a new profile
// that carries the unlocks starts with each such unlock's step ticked, since its plan lists that
// step for the recipe and no longer the recipe's own. The recipe's own record is copied as it is
// (the unlocks option above), and a record the source holds for the unlock's step wins, ticked or
// not, as every copied record does. Only a new profile gets this, once, so the source's own steps
// and anything the user changes later stay as they are.
function carryRecipeUnlocks(state: ProgressState, source: Pick<SavedState, 'checks'>): void {
  for (const [recipe, unlock] of Object.entries(UNLOCKED_WITH)) {
    const key = 'unlock-' + unlock;
    if (source.checks?.['recipe-unlock-' + recipe] === true && source.checks[key] === undefined)
      state.checks[key] = true;
  }
}
// The source's ticks that factory groups' own lines made on site (#875, row id
// '<recipe>:<group>' with `onSite`) leave without a single line to land on in the new plan
// (#876), by check key:
// - a ticked central line (`calc-<phase>-<recipe>`) whose phase gains a group line of that recipe
//   the source plan lacks: its machines are now split between the central line and the groups'
//   lines, and which of them stand is not known;
// - a ticked group line the new plan no longer has (its group stopped making the item on site,
//   or the group is gone): its machines now belong to the central line.
export function siteTicksForReview(
  plan: RowsPlan,
  source: Pick<SavedState, 'checks'>,
  sourcePlan: RowsPlan | null | undefined,
): string[] {
  const previous = planRows(sourcePlan),
    next = planRows(plan);
  const keys = new Set<string>();
  for (const [key, row] of next)
    if (row.onSite && !previous.has(key)) {
      const central = key.slice(0, key.length - row.id.length) + row.onSite.recipe;
      if (source.checks?.[central]) keys.add(central);
    }
  for (const [key, row] of previous)
    if (row.onSite && !next.has(key) && source.checks?.[key]) keys.add(key);
  return [...keys].filter(key => safeKey(key));
}
// Keeps siteTicksForReview's ticks in `state.onSiteReview`, exactly as the source has them, and
// unticks a central line among them that the new plan still has, so it is reviewed rather than
// guessed (a group's own line starts unticked, as any new line does). Returns how many lines it
// unticked, for reviewCount.
function keepSiteTicks(
  state: ProgressState,
  plan: RowsPlan,
  source: Pick<SavedState, 'checks'>,
  sourcePlan: RowsPlan | null | undefined,
): number {
  const keys = siteTicksForReview(plan, source, sourcePlan);
  if (!keys.length) return 0;
  const checks: Record<string, boolean> = {};
  let unticked = 0;
  for (const key of keys) {
    checks[key] = true;
    if (state.checks[key]) {
      state.checks[key] = false;
      unticked++;
    }
  }
  state.onSiteReview = { checks };
  return unticked;
}
// Keep the previous profile's group names and its assignments for rows the new
// plan still builds, then place the plan's remaining rows with the defaults.
function mergeGroups(defaults: FactoryGroups, raw: unknown, plan: RowsPlan | null): FactoryGroups {
  const carried = validateGroups(raw);
  if (!carried.groups.length) return defaults;
  const rows = new Set([...planRows(plan).values()].map(row => row.id));
  const groups = [...carried.groups];
  const known = new Set(groups.map(group => group.id));
  const assignments: Record<string, GroupAssignment[]> = {};
  for (const [key, list] of Object.entries(carried.assignments))
    if (rows.has(key)) assignments[key] = list;
  for (const [key, list] of Object.entries(defaults.assignments)) {
    if (assignments[key]) continue;
    for (const member of list)
      if (!known.has(member.group)) {
        const defaultGroup = defaults.groups.find(group => group.id === member.group);
        if (defaultGroup && groups.length < 60) {
          groups.push(defaultGroup);
          known.add(defaultGroup.id);
        }
      }
    if (list.every(member => known.has(member.group))) assignments[key] = list;
  }
  // Vehicle links (#205) join carried groups or fixed places, all still known here.
  return validateGroups({
    groups,
    assignments,
    ...(carried.links ? { links: carried.links } : {}),
    // The items a carried group makes on site (#874) belong to the group, not a row.
    ...(carried.local ? { local: carried.local } : {}),
  });
}
// A plan made from another by a fresh solve (Recalculate as a new profile, round-up) keeps the
// source plan's guide (#472): its phase steps, storage tasks, completion modules and power
// content are the narrative the user ticks, and the carried state still holds those ticks.
// Factory notes stay only for rows the new plan still has. Returns `plan` with the guide set,
// unchanged when the source has none.
export function carryGuide<T extends { stages: StoredCalculatedPlan['stages'] }>(
  plan: T,
  source: StoredCalculatedPlan | null | undefined,
): T & { guide?: StoredCalculatedPlan['guide'] } {
  const guide = source?.guide;
  if (!guide) return plan;
  const copy = structuredClone(guide);
  if (copy.factories) {
    const rows = new Set(
      Object.values(plan.stages).flatMap(stage => (stage?.rows || []).map(row => row.id)),
    );
    copy.factories = Object.fromEntries(
      Object.entries(copy.factories).filter(([id]) => rows.has(id)),
    );
  }
  return { ...plan, guide: copy };
}
// The refusals of /api/profiles and /api/round-up, shared by both editions (save-routes.ts,
// profile-routes.ts and browser-api.ts) so they say the same thing for the same request. They
// describe the profile, not the retired handbook (owner decision 8 on #387, #705), and say what
// to do instead. The original profile type cannot be created any more (#496).
export const retiredProfileType =
  'This profile type can no longer be created. Create a calculated profile instead.';
export function checkNewProfileKind(kind: unknown) {
  if (kind === 'original') fail(retiredProfileType);
}
// Only a calculated profile with exact ratios has production to round up to whole machines.
export const roundUpNeedsCalculated =
  "Only a calculated profile's production can be rounded up. Create a calculated profile to " +
  'plan with whole machines.';
export const alreadyWholeMachines =
  'This profile already uses whole machines, so there is nothing to round up. Round up a ' +
  'profile that uses exact ratios instead.';
export function checkRoundUp(profile: {
  kind: StoredProfileKind;
  plan?: { settings: { wholeMachines?: boolean } } | null;
}) {
  if (profile.kind !== 'calculated') fail(roundUpNeedsCalculated);
  // A calculated profile always carries its plan.
  if (profile.plan!.settings.wholeMachines) fail(alreadyWholeMachines);
}
// The calculated profile /api/profiles adds in both editions (save-routes.ts createProfile and
// browser-api.ts createProfile): its progress starts from newProfileState, carried from
// `source` (a sibling profile, or null) with the carry choices `raw` and the guided start's
// `built` keys, and its plan keeps the source plan's guide (#472). Returns the profile to push,
// with newProfileState's reviewCount and carried count. Limits, ids and selection stay with
// the callers.
export function calculatedProfile<P extends RowsPlan>(
  id: string,
  name: string,
  plan: P,
  source: Pick<StoredProfile, 'state' | 'plan'> | null | undefined,
  raw: unknown,
  built: unknown,
) {
  const started = newProfileState(plan, source?.state || null, source?.plan || null, raw, built);
  return {
    profile: {
      id,
      name,
      kind: 'calculated' as const,
      plan: carryGuide(plan, source?.plan),
      state: started.state,
    },
    reviewCount: started.reviewCount,
    carried: started.carried,
  };
}
// Round-up (/api/round-up, profile-routes.ts roundUp and browser-api.ts roundUp): the progress
// of the whole-machine copy. The previous state is cloned, never changed, and a ticked
// 'calc-<phase>-<row>' check is unticked for review where the rounded plan has a row the
// previous plan lacks, or needs more machines or more of any input (tolerance 0.001) than it;
// reviewCount counts those. The same rule newProfileState applies when carrying factory
// progress. Rows the previous state never ticked are left alone.
export function roundUpState<S extends SavedState>(
  previousState: S,
  previousPlan: RowsPlan | null | undefined,
  roundedPlan: RowsPlan,
): { state: S; reviewCount: number } {
  const state = structuredClone(previousState);
  let reviewCount = 0;
  for (const [phase, stage] of Object.entries(roundedPlan.stages))
    for (const row of stage.rows || []) {
      const old = previousPlan?.stages[phase as StageKey]?.rows?.find(r => r.id === row.id);
      if (
        !old ||
        row.machines > old.machines ||
        Object.entries(row.inputs).some(([item, rate]) => rate > (old.inputs[item] || 0) + 0.001)
      ) {
        const checkKey = 'calc-' + phase + '-' + row.id;
        if (state.checks[checkKey]) {
          state.checks[checkKey] = false;
          reviewCount++;
        }
      }
    }
  return { state, reviewCount };
}
// The whole-machine copy /api/round-up adds in both editions: `<name> · whole machines` (at
// most 80 characters), the rounded plan with the previous plan's guide, and roundUpState's
// progress. Returns the profile to push and reviewCount; limits, ids and selection stay with
// the callers.
export function wholeMachineProfile<P extends RowsPlan, S extends SavedState>(
  id: string,
  previous: Pick<StoredProfile, 'name' | 'plan'> & { state: S },
  roundedPlan: P,
) {
  const { state, reviewCount } = roundUpState(previous.state, previous.plan, roundedPlan);
  return {
    profile: {
      id,
      name: (previous.name + ' · whole machines').slice(0, 80),
      kind: 'calculated' as const,
      plan: carryGuide(roundedPlan, previous.plan),
      state,
    },
    reviewCount,
  };
}
// Sharing a profile hands over the plan-shaped content (layout, groups, step
// edits, personal tasks) while the recipient starts with fresh progress.
// Used by /api/export-saves?share=1 in server/save-routes.ts and browser-api.ts; the input is
// cloned.
export function shareState(state: SavedState): ProgressState {
  const clean = validateState(structuredClone(state));
  clean.checks = {};
  clean.notes = {};
  clean.deliveries = {};
  clean.revision = 0;
  // Its unmapped ticks and notes are progress too (#485), and so are ticks kept for review (#876).
  delete clean.handbookOrigin;
  delete clean.onSiteReview;
  return validateState(clean);
}
