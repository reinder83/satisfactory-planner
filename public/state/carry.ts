// Carrying progress into a new profile (newProfileState, the carry options, carryGuide), the
// profiles /api/profiles and /api/round-up add in both editions (calculatedProfile,
// roundUpState, wholeMachineProfile), their refusals (checkNewProfileKind, checkRoundUp) and
// sharing a profile without its progress (shareState).
// Re-exported by ../state.ts.
import type {
  BuiltLines,
  CalcRow,
  FactoryGroup,
  FactoryGroups,
  GroupAssignment,
  Phase,
  Progression,
  StoredProfileKind,
  ProgressState,
  SavedState,
  SloopPins,
  StageKey,
  StoredCalculatedPlan,
  StoredProfile,
} from '../types/index.ts';
import { phaseSteps, recipeIdOf, type StepsMemo } from '../progression.ts';
import {
  calcKeyParts,
  lineFacts,
  type RecipeBook,
  sameProduct,
  stageRowsOf,
  successorOf,
} from './built-match.ts';
import { defaultFactoryGroups } from './factory-groups.ts';
import { renameOfferFields, withoutRenameOffer } from './rename-offer.ts';
import {
  knownPins,
  knownPlanSettings,
  stalePinWarnings,
  staleWarning,
  withWarnings,
} from './stale-pins.ts';
import {
  type RowsPlan,
  fail,
  initialState,
  isPhase,
  plain,
  safeKey,
  validateEdits,
  validateGroups,
  validateOnSiteReview,
  validateOrigin,
  validateState,
  validateTaskEdits,
  validateTickedBy,
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
    'Progress on production lines',
    'The new plan counts the lines you built as standing, so it keeps and extends them rather than replacing them. Production lines stay ticked where the new plan needs no more machines and no more input. A line that needs more machines keeps the ones you built, and its step says how many to add; one with fewer machines or another recipe says what is spare or what to switch, and one the new plan no longer has is listed as no longer needed.',
  ],
  [
    'picked',
    'Treat this plan’s alternate recipes as unlocked',
    'Ticks the unlock step for every alternate recipe you ticked yourself, including the ones your ingot and power preferences require. Planner’s choice picks stay on the hard-drive hunt.',
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
// an amplified twin or a group's own line ticks its recipe's step (#901). The picks Planner's
// choice made (settings.plannerPicks, #1058) are recipes to hunt, not owned: they are left out,
// so their hard-drive steps stay open. A plan made before it has none, and all its picks count.
export function pickedRecipeUnlocks(plan: RowsPlan | null | undefined): string[] {
  if (plan?.settings?.recipes !== 'custom') return [];
  const hunting = new Set(plan.settings.plannerPicks || []);
  const ids = new Set(plan.settings.alternateRecipes || []);
  for (const row of planRows(plan).values()) if (row.alternate) ids.add(recipeIdOf(row));
  return [...ids].filter(id => !hunting.has(id) && safeKey('recipe-unlock-' + id));
}
// What a new profile may be told is already standing in the world. The guided
// start asks this for a save you are not beginning from scratch: a production
// line you already built, the HUB tutorial you already finished. These are the
// checklist keys those records already use, so nothing new is stored and the
// answer is as reversible as any other tick.
//
// Only these families are accepted, all of them facts about the world rather
// than about this plan: a production row this very plan builds, an early-base
// step, and an unlock: a milestone or MAM node (`unlock-`), an alternate recipe the
// player owns (`recipe-unlock-`, #1068) and a phase's hard-drive hunt once every
// recipe it asks for is owned (`hard-drives-<phase>`), the same unlock records a
// carried profile copies (carryPrefixes.unlocks). Anything else is dropped rather
// than rejected, so an older or newer client cannot fail a profile it is
// otherwise allowed to make.
const builtKeys = (raw: unknown, plan: RowsPlan | null): string[] => {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 2000) fail('Invalid list of finished work.');
  const rows = planRows(plan);
  return [...new Set<unknown>(raw)].filter(
    (key): key is string =>
      safeKey(key) &&
      (rows.has(key) ||
        key.startsWith('early-base-') ||
        key.startsWith('unlock-') ||
        key.startsWith('recipe-unlock-') ||
        /^hard-drives-[1-5]$/.test(key)),
  );
};
// Build the starting progress for a newly created profile. Without a source
// profile and without a list of finished work this is the blank state every
// earlier release produced.
//
// plan is the new profile's calculation (null for an original-handbook profile), source and
// sourcePlan the sibling profile's state and plan to carry from, raw the carry choices and
// built the guided start's finished-work keys; book the catalog's recipes (built-match.ts), which
// name the built lines no plan at hand has (both editions pass it; without it such a line keeps
// its count as one no longer needed). Returns { state, reviewCount, grownCount, changedCount,
// carried }: the validated state, how many carried 'calc-' ticks were unticked for review, how
// many grown lines keep their built machines (carryLines, #1174), how many built lines changed
// otherwise (shrunk, switched to another recipe or no longer needed, #1175), and how many checks
// start ticked. The source is only read. Called by calculatedProfile below, which
// /api/profiles uses in save-routes.ts and in browser-api.ts.
export function newProfileState(
  plan: RowsPlan | null,
  source: SavedState | null | undefined,
  sourcePlan: RowsPlan | null | undefined,
  raw: unknown,
  built: unknown,
  book?: RecipeBook,
): {
  state: ProgressState;
  reviewCount: number;
  grownCount: number;
  changedCount: number;
  carried: number;
} {
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
      grownCount: 0,
      changedCount: 0,
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
  // Production lines (carryLines): ticks that stay, grown and shrunk lines that keep their built
  // machines, and the rest unticked for review; then the built lines the new plan no longer has
  // (carryFormerLines).
  let reviewCount = 0,
    grownCount = 0,
    changedCount = 0;
  if (picks.factories && plan) {
    const machines = standingLines(source, sourcePlan, book);
    ({ reviewCount, grownCount, changedCount } = carryLines(
      state,
      plan,
      source,
      sourcePlan,
      machines,
    ));
    reviewCount += keepSiteTicks(state, plan, source, sourcePlan);
    changedCount += carryFormerLines(state, plan, source, sourcePlan, machines, book);
  }
  // What a handbook migration could not place is kept for review and never deleted (#485), so a
  // profile carried from a migrated one takes it along unchanged, whatever the picks (#489).
  const origin = validateOrigin(source.handbookOrigin);
  if (origin) state.handbookOrigin = origin;
  // So are the ticks an earlier recalculation kept for review because of lines made on site.
  const review = validateOnSiteReview(source.onSiteReview);
  if (review) state.onSiteReview = { checks: { ...review.checks, ...state.onSiteReview?.checks } };
  carryTickers(state, source);
  const clean = validateState(state);
  return {
    state: clean,
    reviewCount,
    grownCount,
    changedCount,
    carried: Object.values(clean.checks).filter(Boolean).length,
  };
}
// Who ticked a step and when (#1206) goes with each tick carried: a step the source ticked that is
// ticked here too keeps the source's record. A tick unticked for review has none, and neither has
// a step only ticked here (finished work, picked unlocks), which validateState then drops.
function carryTickers(state: ProgressState, source: Pick<SavedState, 'checks' | 'tickedBy'>) {
  const records = validateTickedBy(source.tickedBy, source.checks || {});
  for (const [key, record] of Object.entries(records || {}))
    if (state.checks[key] === true) (state.tickedBy ??= {})[key] = record;
}
// The machines that stand on the source's production lines, by check key (#1175): a ticked line
// of the source plan has its machines, or more where a carry kept spare ones (a shrunk line); a
// line not ticked has its own `builtMachines` (a grown line partly built). A line the source plan
// no longer has keeps its count (built-match.ts): ticked, no longer needed; not ticked, to be
// switched, until every line of its phase making its product is ticked, when the switch is done
// and its machines stand on those lines.
export function standingLines(
  source: Pick<SavedState, 'checks' | 'builtMachines'>,
  sourcePlan: RowsPlan | null | undefined,
  book: RecipeBook | undefined,
): Map<string, number> {
  const rows = planRows(sourcePlan),
    counts = source.builtMachines || {},
    checks = source.checks || {},
    standing = new Map<string, number>();
  for (const [key, row] of rows) {
    const count = checks[key] ? Math.max(row.machines, counts[key] ?? 0) : (counts[key] ?? 0);
    if (count >= 1) standing.set(key, count);
  }
  for (const [key, count] of Object.entries(counts)) {
    const parts = calcKeyParts(key);
    if (rows.has(key) || !parts || !(count >= 1)) continue;
    if (!checks[key]) {
      const [stageKey, rowId] = parts,
        stageRows = stageRowsOf(sourcePlan, stageKey),
        facts = lineFacts(rowId, [sourcePlan], book);
      const switched =
        sameProduct(stageRows, facts.product, rowId).length > 0 &&
        !successorOf(facts, rowId, stageRows, checks, stageKey);
      if (switched) continue;
    }
    standing.set(key, count);
  }
  return standing;
}
// The production lines that stand in `source` (standingLines) as the planner's
// `settings.builtLines` (#1176): { phase: { rowId: machines } }, row ids and phases sorted;
// undefined when none stand. A recalculation that carries production lines sends it, so the solve
// keeps and extends them (addBuiltLines in planner/model.ts); the carry then matches the new
// plan's lines to the same counts.
export function builtLinesOf(
  source: Pick<SavedState, 'checks' | 'builtMachines'>,
  sourcePlan: RowsPlan | null | undefined,
  book: RecipeBook | undefined,
): BuiltLines | undefined {
  const lines: BuiltLines = {};
  const standing = [...standingLines(source, sourcePlan, book)].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  for (const [key, count] of standing) {
    const parts = calcKeyParts(key);
    if (!parts || !safeKey(key) || !Number.isInteger(count) || count > 100000) continue;
    // The row ids the planner accepts (ROW_ID in planner/settings.ts).
    if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(parts[1])) continue;
    const [stageKey, rowId] = parts;
    (lines[stageKey as StageKey] ??= {})[rowId] = count;
  }
  return Object.keys(lines).length ? lines : undefined;
}
// The source's production line ticks on the new plan's lines. A line ticked in the source stays
// ticked only if the old plan had the same row with at least as many machines and inputs; a
// shrunk one (#1175), which needs fewer machines than stand, keeps them in `builtMachines`
// (version 19), so its step says how many are spare. A grown line (#1174), the same row with more
// machines, is unticked but keeps the machines that stand on it as built: its step says how many
// stand and how many to add. Any other change unticks it for review, stored as false, the rule
// /api/round-up applies. Rows the source never ticked are left alone, except that a line with
// machines standing on it (standingLines: a grown line partly built, or a line an earlier plan
// had left and this one has again) is ticked when they are enough, else keeps that count unticked
// (keepStanding). A central line that lines made on
// site split (siteTicksForReview) is not grown: which machines stand is not known, so
// keepSiteTicks keeps its tick for review. Returns how many lines were unticked for review, how
// many grew and how many otherwise changed (shrunk, or back in the plan).
function carryLines(
  state: ProgressState,
  plan: RowsPlan,
  source: Pick<SavedState, 'checks' | 'builtMachines'>,
  sourcePlan: RowsPlan | null | undefined,
  standing: ReadonlyMap<string, number>,
): { reviewCount: number; grownCount: number; changedCount: number } {
  const previous = planRows(sourcePlan),
    split = new Set(siteTicksForReview(plan, source, sourcePlan)),
    built: Record<string, number> = {};
  let reviewCount = 0,
    grownCount = 0,
    changedCount = 0;
  for (const [key, row] of planRows(plan)) {
    const old = previous.get(key);
    if (!safeKey(key)) continue;
    const stands = split.has(key) ? 0 : (standing.get(key) ?? 0);
    if (!source.checks?.[key] || (!old && stands >= 1)) {
      if (stands >= 1) changedCount += keepStanding(state, built, key, row, stands, !old);
      continue;
    }
    const grown =
      !old ||
      row.machines > old.machines ||
      Object.entries(row.inputs || {}).some(
        ([item, rate]) => rate > (old.inputs?.[item] || 0) + 0.001,
      );
    state.checks[key] = !grown;
    if (!grown) {
      if (stands > row.machines) {
        built[key] = stands;
        changedCount++;
      }
      continue;
    }
    if (old && !split.has(key) && old.machines >= 1 && row.machines > old.machines) {
      // More machines than the old plan's, but as many stand (a shrunk line's spares): all of
      // them stand, so it stays ticked.
      if (stands >= row.machines)
        changedCount += keepStanding(state, built, key, row, stands, false);
      else {
        built[key] = stands;
        grownCount++;
      }
    } else reviewCount++;
  }
  if (Object.keys(built).length) state.builtMachines = built;
  return { reviewCount, grownCount, changedCount };
}
// A line of the new plan with `stands` machines standing on it that its source did not tick as
// it is now (a grown line partly built, a shrunk line's spares, a line an earlier plan had left):
// with at least as many as the plan needs, all of them stand, so it is ticked (#1181), keeping
// any beyond the plan's as spare (#1175); with fewer it keeps its count, unticked, and its step
// says how many to add. Never dropped. Returns 1 when it counts as a changed built line (spare
// machines, or `back` in the plan after an earlier plan had left it), else 0.
function keepStanding(
  state: ProgressState,
  built: Record<string, number>,
  key: string,
  row: CalcRow,
  stands: number,
  back: boolean,
): number {
  const enough = stands >= row.machines;
  if (enough) state.checks[key] = true;
  if (!enough || stands > row.machines) built[key] = stands;
  return back || stands > row.machines ? 1 : 0;
}
// The source's built lines the new plan no longer has (#1175), in a phase it plans: each keeps
// its machines in `builtMachines` under its own check key. With a successor (built-match.ts: a
// line of the phase making the same product, not ticked), its step says what to switch, and the
// key stays unticked; without one it is no longer needed, kept ticked, and the build plan lists it
// as one that can be dismantled or kept. Never a silent drop. Lines made on site that lost their
// line (siteTicksForReview) stay with keepSiteTicks. Runs after the other ticks are carried, so
// the successors are the lines left unticked. Returns how many it kept.
function carryFormerLines(
  state: ProgressState,
  plan: RowsPlan,
  source: Pick<SavedState, 'checks'>,
  sourcePlan: RowsPlan | null | undefined,
  standing: ReadonlyMap<string, number>,
  book: RecipeBook | undefined,
): number {
  const next = planRows(plan),
    split = new Set(siteTicksForReview(plan, source, sourcePlan)),
    built: Record<string, number> = { ...state.builtMachines };
  let kept = 0;
  for (const [key, count] of standing) {
    const parts = calcKeyParts(key);
    if (next.has(key) || split.has(key) || !safeKey(key) || !parts) continue;
    const [stageKey, rowId] = parts,
      rows = stageRowsOf(plan, stageKey);
    // A phase the new plan does not build has nothing to change.
    if (!rows.length) continue;
    built[key] = count;
    kept++;
    const facts = lineFacts(rowId, [sourcePlan, plan], book);
    if (successorOf(facts, rowId, rows, state.checks, stageKey)) delete state.checks[key];
    else state.checks[key] = true;
  }
  if (kept) state.builtMachines = built;
  return kept;
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
// `group` with only the moved lines of its flow graph layout that are rows in `rows`; without a
// layout left, without the field.
function carriedLayout(group: FactoryGroup, rows: ReadonlySet<string>): FactoryGroup {
  if (!group.layout?.nodes) return group;
  const { nodes, ...view } = group.layout;
  const kept = Object.fromEntries(Object.entries(nodes).filter(([row]) => rows.has(row)));
  const layout = { ...view, ...(Object.keys(kept).length ? { nodes: kept } : {}) };
  const { layout: _old, ...rest } = group;
  return Object.keys(layout).length ? { ...rest, layout } : rest;
}
// Keep the previous profile's group names and its assignments for rows the new
// plan still builds, then place the plan's remaining rows with the defaults.
function mergeGroups(defaults: FactoryGroups, raw: unknown, plan: RowsPlan | null): FactoryGroups {
  const carried = validateGroups(raw);
  if (!carried.groups.length) return defaults;
  const rows = new Set([...planRows(plan).values()].map(row => row.id));
  // A group's flow graph layout (#1224) comes along, its zoom and scroll offsets, its tags switch
  // and its moved inputs and outputs (#1240) as they were, and the spots of the lines the new plan
  // still has.
  const groups = carried.groups.map(group => carriedLayout(group, rows));
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
  book?: RecipeBook,
) {
  const started = newProfileState(
    plan,
    source?.state || null,
    source?.plan || null,
    raw,
    built,
    book,
  );
  return {
    profile: {
      id,
      name,
      kind: 'calculated' as const,
      plan: carryGuide(plan, source?.plan),
      state: started.state,
    },
    reviewCount: started.reviewCount,
    grownCount: started.grownCount,
    changedCount: started.changedCount,
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
// The settings /api/round-up calculates its whole-machine copy with, in both editions: the plan's
// own with whole machines, and protected storage fed from surplus first (#1061), so the copy gets
// no whole line that only exists to be sunk.
export const roundUpSettings = <T extends object>(settings: T) => ({
  ...settings,
  wholeMachines: true,
  storageFromSurplus: true as const,
});
// What /api/round-up calculates in both editions (#1273): roundUpSettings of the plan's own
// settings less the pins the planner no longer takes (knownPlanSettings, #1271), and the plan
// warnings that name them, for wholeMachineProfile. A plan without such pins rounds up exactly
// as before.
export function roundUpInput<T extends object>(
  plan: Pick<StoredCalculatedPlan, 'stages'> & { settings: T },
  book: RecipeBook,
) {
  const known = knownPlanSettings(plan, book, staleWarning);
  return { settings: roundUpSettings(known.settings), stale: known.stale };
}
// The whole-machine copy /api/round-up adds in both editions: `<name> · whole machines` (at
// most 80 characters), the rounded plan with the previous plan's guide, and roundUpState's
// progress. Returns the profile to push and reviewCount; limits, ids and selection stay with
// the callers. `stale` are roundUpInput's warnings, added to the rounded plan's own, so a pin
// round-up left out is never dropped silently.
export function wholeMachineProfile<P extends RowsPlan, S extends SavedState>(
  id: string,
  previous: Pick<StoredProfile, 'name' | 'plan'> & { state: S },
  roundedPlan: P,
  stale: string[] = [],
) {
  const { state, reviewCount } = roundUpState(previous.state, previous.plan, roundedPlan);
  return {
    profile: {
      id,
      name: (previous.name + ' · whole machines').slice(0, 80),
      kind: 'calculated' as const,
      plan: withWarnings(carryGuide(roundedPlan, previous.plan), stale),
      state,
    },
    reviewCount,
  };
}
// Edit settings, "Recalculate in place" (/api/recalculate, #1071): the refusals both editions
// give (profile-routes.ts recalculate and browser-api.ts recalculate). Only a calculated profile
// has settings to edit. `planCreatedAt` is the plan the user edited the settings of: a profile
// recalculated since (in another tab or on another device) is refused (409), never replaced
// with settings made from the plan before it. The previous version is kept as a profile of its
// own, so the save needs room for one more.
export const recalculateNeedsCalculated =
  'Only a calculated profile can be recalculated. Create a calculated profile instead.';
export const recalculatedElsewhere =
  'This profile was recalculated in another tab or on another device. Open it again to edit ' +
  'the settings it has now.';
export const noRoomForBackup =
  'This save already has 30 profiles, so there is no room to keep the current version as a ' +
  'backup. Remove a profile first.';
export function checkRecalculate(
  profile: { kind: StoredProfileKind; plan?: { createdAt: string } | null },
  planCreatedAt: unknown,
  profileCount: number,
) {
  if (profile.kind !== 'calculated' || !profile.plan) fail(recalculateNeedsCalculated);
  if (planCreatedAt !== profile.plan.createdAt) fail(recalculatedElsewhere, 409);
  if (profileCount >= 30) fail(noRoomForBackup);
}
// A tab names the plan it shows (the X-Planner-Plan header: the plan's createdAt) when it asks
// for the profile's state (/api/state) and with each progress write (/api/update), in both
// editions (#1071). Once the profile has been recalculated in place elsewhere, the state belongs
// to another plan: the request is refused (409), so the tab opens the new plan instead of
// adopting its state, and no value worked out from the old plan's steps, slots or clocks (a
// step order, an exact clock, a tick on a line the user saw) lands on the new one. A note
// written with its own `base` text is compared by that text alone (checkBase): a note is not
// part of the plan. Without the header (an older page, a script) nothing is compared.
export const planReplaced =
  'This profile was recalculated in another tab or on another device, so this change was not ' +
  'saved. The new plan is shown now.';
export function checkPlan(
  profile: { plan?: { createdAt: string } | null },
  shown: string | null | undefined,
  update?: unknown,
) {
  if (shown === null || shown === undefined) return;
  const note = update as { type?: unknown; base?: unknown } | null | undefined;
  if (note?.type === 'note' && typeof note.base === 'string') return;
  if (shown !== (profile.plan?.createdAt ?? '')) fail(planReplaced, 409);
}
// The in-place recalculation both editions write (#1071): the profile keeps its id and gets the
// new plan, `name` and the progress calculatedProfile carries from its own previous version
// (the same carry rules and picks as a new profile carried from it, so ticks whose rows still
// need no more machines and no more input stay ticked, grown lines keep their built machines,
// shrunk, switched and removed lines keep theirs with a change task, and the rest are kept for
// review). Its
// revision moves past the previous one, so a whole-value write from a tab that still shows the
// previous version is refused (checkBase). The previous version is kept whole as `backup`: a
// copy of the stored profile (plan, progress, payoff ranking) under `backupId` and `backupName`,
// which the callers add right after it, linked to the profile (`backupOf`, so "Restore this
// version" can swap it back, restore.ts). Nothing is deleted. Limits and selection stay with the
// callers.
//
// Unlike a new profile, the user goes on in this very profile (#1112), so it also keeps the phase
// worked on (inPlacePhase) and, with `data` (progression.json), the record of every other step the
// new plan still lists under the same id (keepListedSteps): the Space Elevator, the mining,
// retirement and delivery steps, the augmenters, the hand-fed somersloops. Both editions pass
// `data`; without it (tests of other behaviour) only the carry rules above apply. `book` names
// the built lines no plan has any more (newProfileState).
export function recalculatedProfile<P extends RowsPlan, T extends StoredProfile>(
  previous: T,
  plan: P,
  name: string,
  raw: unknown,
  built: unknown,
  backupId: string,
  backupName: string,
  data?: Progression,
  book?: RecipeBook,
) {
  const started = calculatedProfile(previous.id, name, plan, previous, raw, built, book);
  const state = started.profile.state;
  state.settings.phase = inPlacePhase(
    previous.state.settings?.phase,
    previous.plan,
    started.profile.plan,
  );
  if (data) keepListedSteps(state, previous.state, started.profile.plan, data);
  keepAsked(state, previous.state, started.profile.plan, book);
  // The steps kept above keep who ticked them too (#1206), and the version follows.
  carryTickers(state, previous.state);
  state.revision = (previous.state.revision ?? 0) + 1;
  // The pins the recalculation left out because the game data no longer takes them (#1271) are
  // never dropped silently: the new plan says so until a recalculation replaces it. A copy, so a
  // plan Review showed (reviewedReplacement) is not changed.
  const warned = withWarnings(started.profile.plan, stalePinWarnings(previous, book));
  return {
    // A profile that is itself a kept version keeps its link (restore.ts): it stays the version
    // kept for that profile, now recalculated. A dismissed "Rename to …" offer stays dismissed
    // (rename-offer.ts); the backup, which gets a name of its own, leaves it behind.
    profile: {
      ...started.profile,
      plan: warned,
      state: validateState(state),
      ...(previous.backupOf === undefined ? {} : { backupOf: previous.backupOf }),
      ...renameOfferFields(previous),
    },
    backup: {
      ...withoutRenameOffer(structuredClone(previous)),
      id: backupId,
      name: backupName,
      backupOf: previous.id,
    },
    reviewCount: started.reviewCount,
    grownCount: started.grownCount,
    changedCount: started.changedCount,
    carried: Object.values(state.checks).filter(Boolean).length,
  };
}
// The choices the progress state asks for beyond the plan (the lines asked to run at exact clocks,
// `exactClocks`, #1066, the somersloops pinned on lines, `sloopPins`, #1235, and the lines pinned
// to a clock with Power Shards, `lineClocks`, #1239) after a
// recalculation in place (#1237, #1258): every recalculation the user starts plans the choice,
// freezing it in the new plan's settings, so the state needs none and follows the plan. A choice
// the new plan was not calculated with (saved after Edit settings started its draft, or a request
// from an older page) stays asked for, so the plan offers "Recalculate in place with exact clocks"
// or "... with somersloop pins" or "... with Power Shard pins" again rather than dropping it. An empty choice stays too: it asks
// for none, which differs from a plan calculated with some. Compared as the planner stores them:
// each phase's ids (exact clocks) or ids and values (pins, line clocks) sorted, no empty phase.
// With `book` (both editions pass the catalog's), a pin on a recipe the game data no longer takes
// is left out first (knownPins, #1271): every recalculation leaves it out of the plan's settings,
// so it is not asked for any more, and a state left asking for just the plan's pins needs none.
const ASKED_PHASES = ['1', '2', '3', '4', '5'] as StageKey[];
const askedKey = (
  asked: Partial<Record<StageKey, string[] | Record<string, number>>> | undefined,
) =>
  ASKED_PHASES.map(phase => {
    const lines = asked?.[phase] ?? [];
    return (Array.isArray(lines) ? lines : Object.entries(lines).map(entry => entry.join('=')))
      .sort()
      .join('\n');
  }).join('|');
function keepAsked(
  state: ProgressState,
  source: Pick<SavedState, 'exactClocks' | 'sloopPins' | 'lineClocks'>,
  plan: Pick<StoredCalculatedPlan, 'settings'>,
  book: RecipeBook | undefined,
): void {
  for (const field of ['exactClocks', 'sloopPins', 'lineClocks'] as const) {
    const raw = source[field];
    const asked =
      book && raw && field !== 'exactClocks' ? knownPins(raw as SloopPins, book, field).kept : raw;
    if (asked && askedKey(asked) !== askedKey(plan.settings?.[field]))
      (state as Pick<SavedState, typeof field>)[field] = structuredClone(asked) as never;
  }
}
// The phase worked on after a recalculation in place (#1112): the one the user had, unless the
// edit moved the plan's start phase past it, which raises it to the new start phase. A phase the
// user was on before the old start phase (a milestone-only phase, #759) stays, since the new plan
// offers it too; a plan with a guide offers nothing before its start phase (firstPlanPhase).
export function inPlacePhase(
  saved: unknown,
  previousPlan: Pick<StoredCalculatedPlan, 'settings'> | null | undefined,
  plan: Pick<StoredCalculatedPlan, 'settings' | 'guide'>,
): Phase {
  const start = (plan.settings?.phase || '3') as Phase;
  if (!isPhase(saved)) return start;
  if (saved === 'post' || Number(saved) >= Number(start)) return saved;
  const before = Number(previousPlan?.settings?.phase || 1);
  return !plan.guide && Number(saved) < before ? saved : start;
}
// The build plan's step ids of every phase of `plan`, as phaseSteps lists them for `state`.
const PLAN_PHASES = ['1', '2', '3', '4', '5', 'post'] as const;
function listedStepIds(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages' | 'guide'>,
  state: ProgressState,
  data: Progression,
): Set<string> {
  const memo: StepsMemo = {};
  return new Set(
    PLAN_PHASES.flatMap(phase => phaseSteps(plan, state, data, phase, memo).map(step => step.id)),
  );
}
// Copies the source's record of each step the new plan still lists (listedStepIds, worked out
// with the carried progress and phase) that the carry options do not decide: not a production
// line of the new plan (kept only where it needs no more work, the review rule above, and the
// lines made on site), and not a key the options copy by prefix (carryPrefixes), so a record the
// user chose not to carry stays behind. What is left are steps of the world the user goes on in
// (`space-elevator`, `mining-<phase>`, `retire-<phase>`, `deliver-<phase>`, `alien-power-augmenter`,
// `sloop-hand-fed`, the storage step `calc-<phase>-storage`, a guide's own steps). A step the new
// plan no longer lists is not copied; the backup keeps it.
function keepListedSteps(
  state: ProgressState,
  source: Pick<SavedState, 'checks'>,
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages' | 'guide'>,
  data: Progression,
): void {
  const rows = planRows(plan),
    decided = Object.values(carryPrefixes).flat(),
    listed = listedStepIds(plan, state, data);
  for (const [key, value] of Object.entries(source.checks || {}))
    if (
      listed.has(key) &&
      typeof value === 'boolean' &&
      safeKey(key) &&
      !rows.has(key) &&
      !decided.some(prefix => key.startsWith(prefix))
    )
      state.checks[key] = value;
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
  // And so are the machines that stand on a grown line (#1174), and who ticked what (#1206).
  delete clean.builtMachines;
  delete clean.tickedBy;
  return validateState(clean);
}
