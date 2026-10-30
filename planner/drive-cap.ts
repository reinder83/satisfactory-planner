// The cap on hard drives (#1233, slice of #1079, settings.driveCap): the plan counts on at most N
// hard-drive alternates over all its phases, beyond the ones the player owns (ownedAlternates) and
// the ones a MAM node or a milestone unlocks (STANDARD_ALTERNATES, which recipePool relabels as
// standard recipes). Hard drives are collected once and the unlock steps are counted once per plan
// (hardDriveTasks in public/progression.ts), so the cap is on the whole plan, not per phase.
//
// The plan is made without the cap first, and kept byte for byte when it already counts on N or
// fewer. Otherwise one integer search on the last planned phase that fits (the largest) picks the
// set (pickDriveSet: a 0/1 choice per alternate, the lines of an unpicked one held at 0), and every
// phase is planned again from that set (`driveSet`, read by recipePool, never stored). A phase that
// does not fit its budgets with the set is the usual draft, with a sentence naming the cap and
// `driveCap` on the stage (the draft advice's lever).
import { listNames } from '../public/wording.ts';
import { driveCapWords } from '../public/preferences.ts';
import { setSearchDeadline, solve } from '../optimizer.ts';
import type { CalcRow, CurrentSettings, CurrentStage } from '../public/types/index.ts';
import type { PoolRecipe } from './types.ts';
import { DATA } from './data.ts';
import {
  buildModel,
  phaseContext,
  phaseDemands,
  phasePool,
  reachableItems,
  stockedFromSurplus,
  withoutCaps,
} from './model.ts';
import { BUILT } from './stage.ts';

type Stages = Record<number, CurrentStage>;
// The stages of a plan and the warnings of their adjustments (planStages in calculate.ts).
export interface PlannedStages {
  stages: Stages;
  warnings: string[];
}
// How the set was picked: the search found the best set (`found`), stopped at its limit
// (`stopped`), or proved that no set of at most N fits the phase (`none`); `set` is the recipe ids.
export interface DrivePick {
  status: 'found' | 'stopped' | 'none';
  set: string[];
}

// The recipe a row runs, as recipeIdOf in public/progression.ts reads it (which the planner does
// not import): a group's own line its copied recipe, a storage-only line its recipe, an amplified
// twin the recipe it doubles.
const rowRecipe = (row: Pick<CalcRow, 'id' | 'onSite' | 'stock'>): string =>
  row.onSite?.recipe ?? row.stock?.recipe ?? (row.id.startsWith('amp:') ? row.id.slice(4) : row.id);

// The hard-drive alternates the plan counts on, as its hard-drive steps list them (rows marked
// `alternate`, from the start phase on, drafts' rows too), without the ones the player owns: each
// recipe id with its machine-equivalents over those phases, the most used first.
function driveAlternates(config: CurrentSettings, stages: Stages): Map<string, number> {
  const owned = new Set(config.ownedAlternates || []),
    used = new Map<string, number>();
  for (let phase = Number(config.phase || 1); phase <= 5; phase++)
    for (const row of stages[phase]?.rows || []) {
      const id = rowRecipe(row);
      if (row.alternate && !owned.has(id)) used.set(id, (used.get(id) ?? 0) + row.equivalent);
    }
  return new Map([...used].sort((a, b) => b[1] - a[1]));
}

// How long the search for the set may take, in milliseconds: the caps' search budget
// (CAP_SEARCH_MS in calculate.ts, #1221), so a binding cap holds the Docker server for seconds.
const DRIVE_SEARCH_MS = 15000;
// The cap on hard drives over the plan made without it (`planned`): that plan when it counts on
// at most the cap, else the plan again from the set pickDriveSet picks (`replan`, planStages in
// calculate.ts, with the settings it plans from). Returns the stages, their warnings and the
// settings the later steps plan with (the caps per phase, holdToCaps), which carry the set.
export function holdToDriveCap(
  config: CurrentSettings,
  planned: PlannedStages,
  replan: (settings: CurrentSettings) => PlannedStages,
): PlannedStages & { config: CurrentSettings } {
  const cap = config.driveCap,
    used = driveAlternates(config, planned.stages);
  if (cap === undefined || used.size <= cap) return { ...planned, config };
  const phase = searchPhase(config, planned.stages);
  setSearchDeadline(Date.now() + DRIVE_SEARCH_MS);
  // A cap of 0 leaves nothing to pick.
  const pick: DrivePick =
    phase && cap > 0
      ? pickDriveSet(config, phase, cap)
      : { status: cap > 0 ? 'none' : 'found', set: [] };
  // Without a proven best set, the cap still holds: the plan keeps the alternates the plan without
  // the cap uses most.
  const set = pick.status === 'found' ? pick.set : [...used.keys()].slice(0, cap);
  const capped: CurrentSettings = { ...config, driveSet: [...set].sort() };
  const result = replan(withoutCaps(capped));
  for (let stage = 1; stage <= 5; stage++) {
    const draft = result.stages[stage];
    if (draft && !draft.feasible && planned.stages[stage]?.feasible)
      result.stages[stage] = withDriveReason(draft, cap, set, pick.status === 'stopped');
  }
  result.warnings.push(driveCapWarning(config, cap, used.size, set, pick, phase));
  return { ...result, config: capped };
}
// The phase the set is picked on: the last planned phase (from the start phase on) whose plan
// without the cap fits, or none.
function searchPhase(config: CurrentSettings, stages: Stages): number | null {
  for (let phase = 5; phase >= Number(config.phase || 1); phase--)
    if (stages[phase]?.feasible) return phase;
  return null;
}

// The search for the set on one phase. The phase's exact LP (precise clocks, no amplification and
// no caps per phase, as the two-step fit's first step picks its network) is solved without the cap
// first: the hard-drive alternates it runs (not owned) are the candidates, and the others stay out,
// as an alternate that plan does not run is not worth a drive to it. When the candidates are within
// the cap they are the set. Otherwise one integer search: a 0/1 variable per candidate
// ('drive:<recipe>'), at most `cap` of them ('driveCap'), and every line of a candidate (a group's
// own copy and the machines that stand, #1176, too) held to 0 unless it is picked
// ('driveUse:<recipe>': at most DRIVE_ROOM times every line of the LP without the cap together,
// room no line of a plan of the phase needs). A picked recipe costs a little (DRIVE_TIE), so of two
// equal sets the smaller wins, and the set is the picked recipes the solution runs. The search is
// limited as every integer search (5,000 nodes, and the deadline holdToDriveCap set). The phase's
// SAM conversion as solveGoal plans it: 'needed' tries without it first.
function pickDriveSet(config: CurrentSettings, phase: number, cap: number): DrivePick {
  const conversions =
    phase === 5 && config.sam === 'needed'
      ? [false, true]
      : [phase === 5 && config.sam === 'allow'];
  let pick: DrivePick = { status: 'none', set: [] };
  for (const conversion of conversions) {
    pick = searchSet(config, phase, cap, conversion);
    if (pick.status !== 'none') return pick;
  }
  return pick;
}
// How far a picked recipe's lines may run, in multiples of every line of the LP without the cap
// together (pickDriveSet), and the least room, in machine-equivalents.
const DRIVE_ROOM = 4,
  DRIVE_ROOM_MIN = 200;
// What a picked recipe costs in the search's objective, a hundredth of a machine-equivalent.
const DRIVE_TIE = 0.01;
// Lines below this level do not run.
const RUNS = 1e-6;
function searchSet(
  config: CurrentSettings,
  phase: number,
  cap: number,
  conversion: boolean,
): DrivePick {
  const maximum = config.goal === 'maximum' && phase >= 2;
  const goal = config.goal === 'maximum' && !maximum ? 'balanced' : config.goal;
  const context = phaseContext(
    { ...withoutCaps(config), goal, wholeMachines: false, amplifySloops: 0 },
    phase,
    { maximum, conversion, storageLeftOut: stockedFromSurplus(config) },
  );
  const pool = phasePool(context);
  const demands = phaseDemands(context, reachableItems(context, pool));
  const { model } = buildModel(context, pool, demands);
  const free = solve(model);
  if (!free.feasible) return { status: 'none', set: [] };
  const level = (names: readonly string[]) =>
    names.reduce((total, name) => total + (free.values[name] || 0), 0);
  const lines = candidateLines(config, pool, model.variables);
  const unused = Object.keys(lines).filter(recipe => level(lines[recipe]!) <= RUNS);
  if (Object.keys(lines).length - unused.length <= cap)
    return { status: 'found', set: Object.keys(lines).filter(recipe => !unused.includes(recipe)) };
  const room = Math.max(
    DRIVE_ROOM_MIN,
    DRIVE_ROOM * level(pool.flatMap(recipe => [recipe.id, BUILT + recipe.id])),
  );
  model.constraints.driveCap = { max: cap };
  for (const [recipe, names] of Object.entries(lines)) {
    const use = 'driveUse:' + recipe;
    model.constraints[use] = { max: 0 };
    for (const name of names) model.variables[name]![use] = 1;
    if (unused.includes(recipe)) continue;
    const pick = 'drive:' + recipe;
    model.variables[pick] = { cost: DRIVE_TIE, driveCap: 1, [use]: -room };
    (model.ints ??= {})[pick] = 1;
    (model.bounds ??= {})[pick] = 1;
  }
  const solved = solve(model);
  if (!solved.feasible)
    return { status: /infeasible/i.test(solved.solverStatus) ? 'none' : 'stopped', set: [] };
  const set = Object.entries(lines)
    .filter(
      ([recipe, names]) =>
        (solved.values['drive:' + recipe] || 0) > 0.5 &&
        names.some(name => (solved.values[name] || 0) > RUNS),
    )
    .map(([recipe]) => recipe);
  return { status: 'found', set };
}
// The model's variables of each hard-drive alternate the pool offers and the player does not own:
// the recipe's own, its groups' copies (#875) and its built lines' (#1176).
function candidateLines(
  config: CurrentSettings,
  pool: PoolRecipe[],
  variables: Record<string, Record<string, number>>,
): Record<string, string[]> {
  const owned = new Set(config.ownedAlternates || []),
    lines: Record<string, string[]> = {};
  for (const recipe of pool) {
    const id = recipe.onSite?.recipe ?? recipe.id;
    if (!recipe.alternate || owned.has(id)) continue;
    for (const name of [recipe.id, BUILT + recipe.id])
      if (variables[name]) (lines[id] ??= []).push(name);
  }
  return lines;
}

// A recipe's name without "Alternate: ".
const recipeName = (id: string): string =>
  (DATA.recipes.find(recipe => recipe.id === id)?.name ?? id).replace(/^Alternate: /, '');
// The set in words: "Pure Iron Ingot and Steel Rod".
const setWords = (set: readonly string[]): string => listNames(set.map(recipeName).sort());

// A phase that fits without the cap but not from the set: its draft (draftStage) with a sentence
// naming the cap, and `driveCap` for the draft advice's lever.
function withDriveReason(
  draft: CurrentStage,
  cap: number,
  set: readonly string[],
  stopped: boolean,
): CurrentStage {
  const words =
    ` With your cap on hard drives (${driveCapWords(cap)} over the whole plan), this phase may use` +
    (set.length
      ? ` only these hard-drive alternates: ${setWords(set)}`
      : ' no hard-drive alternate you do not own') +
    '; without the cap it fits.' +
    (stopped
      ? ' The search for the best set stopped at its limit before it found one, so whether a set within the cap fits has not been checked.'
      : '');
  return {
    ...draft,
    reason: (draft.reason ?? '') + words,
    driveCap: { cap, ...(stopped ? { stopped: true as const } : {}) },
  };
}
// The plan's warning when the cap binds: how many alternates the plan without it uses, and the set.
function driveCapWarning(
  config: CurrentSettings,
  cap: number,
  free: number,
  set: readonly string[],
  pick: DrivePick,
  phase: number | null,
): string {
  const owned = config.ownedAlternates?.length ? ' beyond the ones you own' : '';
  const head = `Cap on hard drives: the plan counts on ${driveCapWords(cap)}${owned}, where it would use ${free} without the cap.`;
  const on = `Phase ${phase}`;
  if (!set.length) return `${head} Every phase plans without them.`;
  if (pick.status === 'found')
    return `${head} The search on ${on} picked ${setWords(set)}, and every phase plans from ${set.length === 1 ? 'it' : 'these'}.`;
  const kept = `so the plan keeps the ${set.length === 1 ? 'one' : set.length} the plan without the cap uses most: ${setWords(set)}`;
  if (!phase) return `${head} No phase fits even without the cap, ${kept}.`;
  return pick.status === 'stopped'
    ? `${head} The search for the best set on ${on} stopped at its limit before it found one, ${kept}. A better set may exist.`
    : `${head} No set within the cap fits ${on}, ${kept}.`;
}
