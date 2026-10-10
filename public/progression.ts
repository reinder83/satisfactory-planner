import type {
  CalcRow,
  GridGenerator,
  Progression,
  ProgressionEntry,
  StageKey,
  StoredCalculatedPlan,
  StoredStage,
} from './types/index.ts';
import { listNames, powerAmount, slug } from './wording.ts';
import { ownedBeyondKept, powerView } from './power.ts';
import { miningLinearMW, OWNED_GENERATORS, phaseForTier } from './preferences.ts';
import { miningBuildings, miningStepBody } from './mining.ts';

// A generated guidance step: its checklist key, title and text. `optional` marks a step the phase
// can do without (#1070: research only a later phase needs, a storage-only line), which "Required
// steps only" hides. `satisfied` is set while the step's own condition holds (the hard-drive step
// with no recipe left to unlock, the delivery with every counter at its target): the build plan
// then shows it done, says why, and writes no tick.
export interface GuideTask {
  id: string;
  title: string;
  body: string;
  optional?: boolean;
  satisfied?: string;
}

// The id prefix and name suffix of an amplified twin (amplified() in planner/recipes.ts, which a
// test keeps in step): a row of its own, 'amp:<recipe>', with its own progress key.
export const AMPLIFIED_ID = 'amp:';
const AMPLIFIED_NAME = ' (somersloop amplified)';
// The recipe a row runs: its own id; for a factory group's own line made on site (#875,
// '<recipe>:<group>') the recipe it copies; for an amplified twin (#901, 'amp:<recipe>') the
// recipe it doubles. So a line's unlock and milestone are always its recipe's. Every place that
// needs a recipe from a row goes through this (the unlock steps and milestones here, the picked
// unlocks a new profile carries, the wizard's "Planner's choice").
export const recipeIdOf = (row: Pick<CalcRow, 'id' | 'onSite' | 'stock'>): string =>
  row.onSite?.recipe ??
  row.stock?.recipe ??
  (row.id.startsWith(AMPLIFIED_ID) ? row.id.slice(AMPLIFIED_ID.length) : row.id);
// The recipe's own name for a row: an amplified twin's without " (somersloop amplified)".
const recipeNameOf = (row: Pick<CalcRow, 'id' | 'name'>): string =>
  row.id.startsWith(AMPLIFIED_ID) && row.name.endsWith(AMPLIFIED_NAME)
    ? row.name.slice(0, -AMPLIFIED_NAME.length)
    : row.name;

// What every task list of one phase's guide reads, built once by guideContext. `plan` is the
// profile's calculation snapshot, `checks` its ticked checklist keys, `data` progression.json,
// `stage` the phase planned (1-5) and `rows` that stage's production rows.
export interface GuideContext {
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages'>;
  checks: Record<string, boolean>;
  data: Progression;
  stage: number;
  rows: CalcRow[];
  // The plan's stage for a phase number (stage keys are its digits).
  stageOf: (phase: number) => StoredStage | undefined;
  byName: (name: string) => ProgressionEntry | undefined;
  // An unlock counts as done only when the user ticked its step, never by guessing from phase.
  unlocked: (entry: ProgressionEntry) => boolean;
  // Rows up to this phase that make an item, and whether their factory is ticked as running;
  // used to say where a milestone's cost can come from.
  sources: (item: string) => { row: CalcRow; running: boolean }[];
  // A milestone's cost, each item with where it can come from.
  funding: (entry: ProgressionEntry) => string;
}

// The power unlocks the user has ticked. Without spare existing power in the settings the power
// advice follows these, never advising a source below the one the phase plans (#1048).
interface UnlockedPower {
  coal: boolean;
  petroleum: boolean;
  nuclear: boolean;
  solid: boolean;
}

// Collectibles (hard drives, slugs, somersloops...) are gathered, not produced, so they never
// hold back when a MAM node can be researched.
const COLLECTIBLES = [
  'Hard Drive',
  'Power Shard',
  'Blue Power Slug',
  'Yellow Power Slug',
  'Purple Power Slug',
  'Mercer Sphere',
  'Somersloop',
];

// Locale-formatted with at most 2 decimals, exactly as Number(value).toLocaleString(undefined,
// { maximumFractionDigits: 2 }) would, but with one shared formatter: toLocaleString with options
// builds a new Intl.NumberFormat on every call, which was most of phaseSteps' time (#772).
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
export const formatNumber = (value: unknown): string => numberFormat.format(Number(value));

// What phaseSteps may keep between its calls for several phases of one plan and progress, when
// neither changes in between (profilePhases in state/summary.ts, #804): the milestones every
// planned phase needs, which each phase's milestone list starts from (milestonesListedIn). Pass a
// new empty object per plan and progress; without one, nothing is kept.
export interface StepsMemo {
  planned?: ProgressionEntry[];
  // Per milestone id, the planned phases whose own lines need it (requiredMilestones), in order.
  neededIn?: Map<string, number[]>;
}

// The generated guidance steps of a calculated profile for one phase, called by phaseSteps below
// (calcTasks in app/views/calculated.ts). `plan` is the profile's calculation snapshot, `state` its
// progress (only `checks` is read), `data` is progression.json and `phase` '1'-'5' or
// 'post' (planned as Phase 5). Returns task lists of { id, title, body }; ids are checklist
// keys, so they must stay stable. Nothing here changes the plan or the progress.
// progression.json: `entries` are HUB milestones and MAM nodes ({ id, name, tier, mam,
// alternate, cost, recipes, requires }), `buildings` maps a machine name to the recipe that
// builds it and `availability` gives the first phase in which an item can be made.
export function progression(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages'>,
  state: { checks: Record<string, boolean> },
  data: Progression,
  phase: string,
  memo: StepsMemo = {},
): {
  baseTasks: GuideTask[];
  powerTasks: GuideTask[];
  milestoneTasks: GuideTask[];
  hardDrives: GuideTask[];
  retire: GuideTask[];
  powerStartup: number;
} {
  const context = guideContext(plan, state, data, phase);
  const milestones =
    phase === 'post' ? [] : milestonesListedIn(plan, state, data, context.stage, memo);
  return {
    baseTasks: baseTasks(context),
    powerTasks: powerTasks(context),
    milestoneTasks: optionalResearch(
      milestoneTasks(context, milestones),
      context.stage,
      data,
      memo.neededIn ?? new Map(),
    ),
    hardDrives: hardDriveTasks(context),
    retire: retireTasks(context),
    // How many of powerTasks start up power before any unlock (powerStartupCount).
    powerStartup: powerStartupCount(context),
  };
}

// A generated build-plan step of a calculated profile. A production step carries the row it
// builds, with an empty body: the build plan describes it (calcTasks in app/views/calculated.ts).
export interface PhaseStep extends GuideTask {
  row?: CalcRow;
}

// A calculated profile's generated build-plan steps for `phase` ('1'-'5', or 'post', which plans
// Phase 5's stage), in the order the build plan shows them, before the user's step edits and
// personal tasks. A plan with a guide (#393, a migrated handbook profile) has the guide's steps
// for the phase instead, with their own check ids; a phase the guide leaves out has none (#466).
// A phase before the profile's start phase is milestone-only (#759, milestoneOnlyPhase): its
// milestone steps and nothing else, since production is planned from the start phase on.
// Otherwise (#1070): startup, power and the required milestone steps, each power step after the
// unlock it asks for, mining, hard drives, one step per production row (generators first,
// powerFirst), storage, the delivery, the storage-only lines, the lines this phase retires, and
// last the research only a later phase needs (optional). Row steps use the saved key
// `calc-<stage>-<row id>`, the same key as that factory card's Running box, and must stay stable.
// It reads only its arguments, so it works out any phase of a stored plan, not just the open one.
// `memo` (StepsMemo) lets calls for several phases of the same plan and progress share work.
export function phaseSteps(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages' | 'guide'>,
  state: GuideState,
  data: Progression,
  phase: string,
  memo: StepsMemo = {},
): PhaseStep[] {
  if (plan.guide) return (plan.guide.phases[phase] ?? []).map(step => ({ ...step }));
  if (milestoneOnlyPhase(plan, phase))
    return milestoneTasks(
      guideContext(plan, state, data, phase),
      milestonesListedIn(plan, state, data, Number(phase), memo),
    );
  const stage = (phase === 'post' ? '5' : phase) as StageKey,
    steps = progression(plan, state, data, phase, memo);
  // Research only a later phase needs is optional here and comes last (#1070, optionalResearch).
  const required = steps.milestoneTasks.filter(task => !task.optional),
    optional = steps.milestoneTasks.filter(task => task.optional);
  // Later phases keep the power they run going first, then take the phase's milestones, then the
  // power steps that ask for those unlocks (#1070).
  const startup =
    stage === '1'
      ? phaseOneStartup(steps, required, plan, state, data)
      : [
          ...steps.powerTasks.slice(0, steps.powerStartup),
          ...required,
          ...steps.powerTasks.slice(steps.powerStartup),
        ];
  const rows = plan.stages[stage]?.rows || [];
  const rowStep = (row: CalcRow): PhaseStep => ({
    id: 'calc-' + stage + '-' + row.id,
    title: rowStepTitle(plan, state, row),
    body: '',
    row,
    ...(row.stock ? { optional: true } : {}),
  });
  return [
    ...startup,
    ...miningTask(plan, stage),
    ...steps.hardDrives,
    // The power plant before the machines it powers (powerFirst).
    ...powerFirst(rows.filter(row => !row.stock)).map(rowStep),
    storageStep(plan.stages[stage], stage),
    ...deliveryTask(plan, state, phase),
    // Storage-only lines (#1061) are optional, so they come after everything the plan needs.
    ...rows.filter(row => row.stock).map(rowStep),
    ...steps.retire,
    ...optional,
  ];
}

// Phase 1's start (#1070): the HUB tutorial and its last upgrade (Tier 0, HUB Upgrade 6, which
// the biomass steps ask for), the power start-up, the starter base, the other milestones, the
// power steps after their unlocks, the base's last steps and building the Space Elevator. Phase 1
// always has its seven base steps (baseTasks), and its first two power steps are "Power available
// now" and Biomass.
function phaseOneStartup(
  steps: ReturnType<typeof progression>,
  required: GuideTask[],
  plan: Pick<StoredCalculatedPlan, 'settings'>,
  state: GuideState,
  data: Progression,
): GuideTask[] {
  const tierZero = new Set(
    data.entries.filter(entry => !entry.mam && entry.tier === 0).map(entry => 'unlock-' + entry.id),
  );
  return [
    steps.baseTasks[0]!,
    ...required.filter(task => tierZero.has(task.id)),
    ...steps.powerTasks.slice(0, 2),
    ...steps.baseTasks.slice(1, 5),
    ...required.filter(task => !tierZero.has(task.id)),
    ...steps.powerTasks.slice(2),
    ...steps.baseTasks.slice(5),
    ...elevatorTask(plan, state),
  ];
}

// The production lines in build order with each generator line moved up (#1070): straight after
// the last line that makes one of its inputs (the Fuel lines for a Fuel Generator), or first when
// it burns only what is mined, so the power plant is built before the machines it powers. Several
// generators keep their order, and so do the other lines. phaseSteps applies it to the planner's
// order and groupedSteps (app/group-order.ts) to the factories' order; applied twice it changes
// nothing more.
export function powerFirst<T extends Pick<CalcRow, 'inputs' | 'outputs' | 'generationMW'>>(
  rows: readonly T[],
): T[] {
  const generates = (row: T) => row.generationMW > 0;
  const ordered = rows.filter(row => !generates(row));
  let next = 0;
  for (const generator of rows.filter(generates)) {
    const inputs = Object.keys(generator.inputs || {});
    let at = next;
    ordered.forEach((row, i) => {
      if (inputs.some(item => (row.outputs || {})[item])) at = Math.max(at, i + 1);
    });
    ordered.splice(at, 0, generator);
    next = at + 1;
  }
  return ordered;
}

// A Space Elevator delivery's saved key (#1062): `<stage>-<item slug>`, as the build plan's
// counters save it (app/delivered.ts reads it from here).
export const deliveryKey = (stageKey: StageKey, item: string): string =>
  stageKey + '-' + slug(item);

// The parts a stage hands in at the Space Elevator, each with its target count.
const deliveryParts = (stagePlan: StoredStage | undefined): [string, number][] =>
  Object.entries(stagePlan?.delivery || {})
    .filter(([, part]) => part.target > 0)
    .map(([item, part]) => [item, part.target]);

// The phase worked on (`state.settings.phase`) as a number, Post Phase 5 as 6 (after Phase 5);
// NaN without one.
const workingPhase = (state: GuideState): number =>
  state.settings?.phase === 'post' ? 6 : Number(state.settings?.phase);

// The reason the elevator and delivery steps of a phase before the one worked on show as done
// (#1070): moving on to a later phase proves that phase's delivery was sent and the elevator
// stands, the rule elevatorTask applies to a profile made for a later phase. So a profile saved
// before these steps existed keeps its finished phases finished and opens where it did.
const LATER_PHASE = 'Done: you are working in a later phase.';

// "Build the Space Elevator" (#1070), once, in Phase 1 of a profile made for Phase 1: a profile
// made for a later phase has delivered Phase 1, so its elevator stands. Its key is
// `space-elevator`; it shows as done while the phase worked on is after Phase 1.
function elevatorTask(
  plan: Pick<StoredCalculatedPlan, 'settings'>,
  state: GuideState,
): GuideTask[] {
  if (Number(plan.settings.phase || 1) !== 1) return [];
  return [
    {
      id: 'space-elevator',
      title: 'Build the Space Elevator',
      body: 'HUB Upgrade 6 unlocks it. Build it where the elevator lines can belt their parts into it, with room around its inputs. It takes this phase’s delivery; count each part sent with the delivery counters on this page.',
      ...(workingPhase(state) > 1 ? { satisfied: LATER_PHASE } : {}),
    },
  ];
}

// "Send the Phase N delivery" (#1070), in each planned phase whose stage hands parts in (not Post
// Phase 5): its key is `deliver-<stage>`. It shows as done while every part's delivery counter
// (state.deliveries, deliveryKey) is at its target, or while the phase worked on is later than
// this one, without writing a tick; ticking it by hand also works for a player who does not count.
function deliveryTask(
  plan: Pick<StoredCalculatedPlan, 'stages'>,
  state: GuideState,
  phase: string,
): GuideTask[] {
  if (phase === 'post') return [];
  const stage = phase as StageKey,
    parts = deliveryParts(plan.stages[stage]);
  if (!parts.length) return [];
  const counted = (item: string) => state.deliveries?.[deliveryKey(stage, item)] ?? 0;
  const sent = parts.every(([item, target]) => counted(item) >= target);
  return [
    {
      id: 'deliver-' + stage,
      title: `Send the Phase ${stage} delivery`,
      body: `Load the Space Elevator with ${listNames(parts.map(([item, target]) => formatNumber(target) + ' ' + item))} and send it. Count the parts with the delivery counters on this page: this step shows as done once every counter reaches its target.`,
      ...(sent
        ? { satisfied: 'Done: every delivery counter is at its target.' }
        : workingPhase(state) > Number(stage)
          ? { satisfied: LATER_PHASE }
          : {}),
    },
  ];
}

// The phase's mining step (#1065), on a plan with mining per phase: the miners and extractors
// its draw needs, best nodes first (miningStepBody in mining.ts). Its key is `mining-<stage>`;
// a plan without mining per phase has no such step, so its build plan is as it was.
function miningTask(plan: Pick<StoredCalculatedPlan, 'stages'>, stage: StageKey): GuideTask[] {
  const body = miningStepBody(plan.stages[stage], stage);
  return body ? [{ id: 'mining-' + stage, title: 'Tap the resource nodes', body }] : [];
}

// What phaseSteps reads of a profile's progress: its ticks, its factory groups' names, which
// name a group's own line made on site, its delivery counts and the phase worked on.
export interface GuideState {
  checks: Record<string, boolean>;
  // The Space Elevator delivery counts (deliveryKey), which the delivery step reads.
  deliveries?: Record<string, number>;
  // The phase worked on ('1'-'5' or 'post'): a later one marks the elevator and delivery steps
  // of the phases before it done (#1070).
  settings?: { phase?: string };
  factoryGroups?: { groups?: { id: string; name: string }[] };
}

// A production row's step title: the row's name, and for a factory group's own line made on site
// (#876) the group it is for, "Wire for Motor works": the group's name now, else the name the
// plan was calculated with, else its id. Every place that names a line of the plan goes through
// it: the build plan, the factory dialog's heading, deliveries and lane advice (flow.ts) and a
// step's linked production line (#954, #964). `plan.settings` may be absent where a flow is drawn
// without the plan's settings; the groups then name the line alone.
export function rowStepTitle(
  plan: { settings?: Pick<StoredCalculatedPlan['settings'], 'onSite'> | undefined },
  state: GuideState,
  row: Pick<CalcRow, 'name' | 'onSite' | 'stock'>,
): string {
  if (row.stock) return row.name + ' for storage (optional)';
  const group = row.onSite?.group;
  if (!group) return row.name;
  const name =
    state.factoryGroups?.groups?.find(known => known.id === group)?.name ??
    plan.settings?.onSite?.[group]?.name ??
    group;
  return row.name + ' for ' + name;
}

// The storage step of a phase. A whole-machine plan since #1061 (`storageAsked`) fills storage
// from surplus first and lists its storage-only lines after this step; an older plan reserved
// the storage rates in its lines, as the old text says. The id is the same either way.
function storageStep(stagePlan: StoredStage | undefined, stage: StageKey): PhaseStep {
  const id = 'calc-' + stage + '-storage';
  if (!stagePlan?.storageAsked)
    return {
      id,
      title: 'Connect protected storage and overflow',
      body: 'Reserve the listed storage refill rates before elevator exports. Handle every liquid byproduct; send surplus sinkable solids to the AWESOME Sink after unlocking it.',
    };
  const lines = (stagePlan.rows || []).filter(row => row.stock).length;
  return {
    id,
    title: 'Fill protected storage from surplus, overflow to the sink',
    body:
      'Send each stored item’s surplus into its container first, through a Priority Merger or an overflow splitter, and let a full container overflow to the AWESOME Sink after unlocking it. Handle every liquid byproduct.' +
      (lines
        ? ` The ${lines === 1 ? 'storage-only line after this step is' : `${lines} storage-only lines after this step are`} optional: ${lines === 1 ? 'it fills' : 'they fill'} only the containers no surplus covers, so build ${lines === 1 ? 'it' : 'them'} last.`
        : ''),
  };
}

// Whether `phase` of a calculated plan is milestone-only (#759): a phase before the plan's start
// phase (its settings' phase), which the build plan offers for the milestones listed there and
// nothing else. The planner solves every phase from 1 (calculate() in planner.ts), but a stage
// before the start phase is not this profile's to build: no production lines, storage, power,
// hard drives or retirements. A plan with a guide has its own steps and no such phase.
export function milestoneOnlyPhase(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'guide'>,
  phase: string,
): boolean {
  return !plan.guide && phase !== 'post' && Number(phase) < Number(plan.settings.phase || 1);
}

// The first phase a calculated plan offers (#759): Phase 1, the phases before its start phase
// milestone-only (milestoneOnlyPhase), or the start phase itself for a plan with a guide, which
// has no such phases. firstPhase() in app/session.ts asks this for the open profile, and the
// save list's per-phase counts (profilePhases in state/summary.ts) for every profile, so the
// profile card, the top bar's phase track and the phase a profile opens on cover the same phases.
export const firstPlanPhase = (plan: Pick<StoredCalculatedPlan, 'settings' | 'guide'>): StageKey =>
  plan.guide ? (String(plan.settings?.phase || '1') as StageKey) : '1';

// The milestone-only phases of a calculated plan, in order: from its first phase (firstPlanPhase)
// up to, not including, its start phase. None for a plan with a guide or one made for Phase 1.
export const milestoneOnlyPhases = (
  plan: Pick<StoredCalculatedPlan, 'settings' | 'guide'>,
): StageKey[] =>
  (['1', '2', '3', '4'] as const).filter(
    phase => Number(phase) >= Number(firstPlanPhase(plan)) && milestoneOnlyPhase(plan, phase),
  );

// The check keys of every step the milestone-only phases before a calculated plan's start phase
// list (#1068): what "Everything before Phase N is done" ticks, in the wizard's Review
// (ui/wizard/AlreadyHave.vue, sent as the new profile's `built` keys) and later on the build plan
// (ui/plan/MilestoneOnlyNotice.vue, a `checks` update). They are all `unlock-<id>` milestone and
// MAM research steps, facts about the world, and ticking them only adds ticks. None for a plan
// made for Phase 1 or one with a guide.
export function stepsBeforeStart(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages' | 'guide'>,
  state: GuideState,
  data: Progression,
): string[] {
  const memo: StepsMemo = {};
  const ids = milestoneOnlyPhases(plan).flatMap(phase =>
    phaseSteps(plan, state, data, phase, memo).map(step => step.id),
  );
  return [...new Set(ids)];
}

// The alternate recipes a calculated plan's hard-drive steps ask for (#1068), per planned phase
// (its start phase on, post-game left out: it repeats Phase 5): that phase's hunt step
// (`hard-drives-<stage>`) and one entry per recipe it lists first (`recipe-unlock-<recipe>`, with
// the recipe's name), as hardDriveTasks lists them. Read by the wizard's "What you already have"
// (ui/wizard/AlreadyHave.vue), which offers each recipe as owned or still to hunt.
export interface AlternateHunt {
  phase: StageKey;
  hunt: string;
  recipes: { key: string; name: string }[];
}
export function alternateHunts(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages' | 'guide'>,
  data: Progression,
): AlternateHunt[] {
  if (plan.guide) return [];
  const memo: StepsMemo = {},
    hunts: AlternateHunt[] = [];
  for (const phase of ['1', '2', '3', '4', '5'] as const) {
    if (!plan.stages[phase] || milestoneOnlyPhase(plan, phase)) continue;
    const steps = phaseSteps(plan, { checks: {} }, data, phase, memo);
    const recipes = steps
      .filter(step => step.id.startsWith('recipe-unlock-'))
      .map(step => ({ key: step.id, name: step.title.replace(/^Unlock /, '') }));
    if (recipes.length) hunts.push({ phase, hunt: 'hard-drives-' + phase, recipes });
  }
  return hunts;
}

// The steps a new profile starts with ticked for the alternates it owns (#1068): each owned
// recipe's unlock step (`owned` holds `recipe-unlock-<recipe>` keys), and a phase's hunt step when
// every recipe that phase lists is owned, since nothing is left to hunt there. Only ticks.
export function ownedAlternateKeys(hunts: AlternateHunt[], owned: ReadonlySet<string>): string[] {
  return hunts.flatMap(({ hunt, recipes }) => {
    const mine = recipes.filter(recipe => owned.has(recipe.key)).map(recipe => recipe.key);
    return mine.length === recipes.length ? [...mine, hunt] : mine;
  });
}

// "Phase 1", "Phases 1 and 2", "Phases 1, 2 and 3": the milestone-only phases in words (#1068).
export function earlierPhasesWords(phases: readonly string[]): string {
  if (phases.length === 1) return 'Phase ' + phases[0];
  return 'Phases ' + phases.slice(0, -1).join(', ') + ' and ' + phases[phases.length - 1];
}

// The context the task lists share, for `phase` '1'-'5' or 'post' (planned as Phase 5).
export function guideContext(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages'>,
  state: { checks: Record<string, boolean> },
  data: Progression,
  phase: string,
): GuideContext {
  const stageOf = (phaseNumber: number): StoredStage | undefined =>
    plan.stages[String(phaseNumber) as StageKey];
  const stage = Number(phase === 'post' ? 5 : phase),
    checks = state.checks,
    start = Number(plan.settings.phase || 1);
  // Only stages the profile builds (its start phase on): one before it is never built, so a
  // milestone-only phase (#759) has no planned source of its own. Worked out once per item and
  // kept for this context, which reads one fixed state: the milestone order and funding text ask
  // for the same items again and again, which was most of phaseSteps' time (#804).
  const built = (Object.entries(plan.stages) as [string, StoredStage][]).filter(
    ([key]) => Number(key) >= start && Number(key) <= stage,
  );
  const sourcesOf = new Map<string, { row: CalcRow; running: boolean }[]>();
  const sources = (item: string) => {
    let found = sourcesOf.get(item);
    if (!found) {
      found = built.flatMap(([key, planned]) =>
        (planned.rows || [])
          .filter(row => row.outputs[item])
          .map(row => ({ row, running: !!checks['calc-' + key + '-' + row.id] })),
      );
      sourcesOf.set(item, found);
    }
    return found;
  };
  const status = (item: string) =>
    sources(item).some(source => source.running)
      ? 'already producing (marked running; reserve a batch)'
      : sources(item).length
        ? 'production planned, not yet marked running'
        : 'gather, handcraft, or build a starter supply';
  return {
    plan,
    checks,
    data,
    stage,
    rows: stageOf(stage)?.rows || [],
    stageOf,
    byName: name => data.entries.find(entry => entry.name === name),
    unlocked: entry => !!checks['unlock-' + entry.id],
    sources,
    funding: entry =>
      Object.entries(entry.cost)
        .map(([item, quantity]) => `${formatNumber(quantity)} ${item}: ${status(item)}`)
        .join('; '),
  };
}

// Milestones this phase needs: those unlocking a recipe or machine its rows use, a fixed set
// of basics, and phase-specific power and logistics unlocks, each with its prerequisites.
// In the order they were first added; milestoneTasks decides the order shown.
export function requiredMilestones(context: GuideContext): ProgressionEntry[] {
  const { plan, data, stage, rows, byName } = context;
  const required = new Map<string, ProgressionEntry>();
  function add(entry: ProgressionEntry | undefined) {
    if (!entry || required.has(entry.id)) return;
    required.set(entry.id, entry);
    for (const id of entry.requires) add(data.entries.find(prerequisite => prerequisite.id === id));
  }
  const wanted = new Set(rows.map(recipeIdOf));
  for (const row of rows) {
    const building = data.buildings[row.machine];
    if (building) wanted.add(building);
  }
  // With mining per phase (#1065), the belts, pipes, miners and extractors the phase's mining
  // uses, so the milestone of each (Tier 7 Logistics Mk.5 in Phase 4) is a step of the phase.
  for (const name of miningBuildings(context.stageOf(stage))) {
    const building = data.buildings[name];
    if (building) wanted.add(building);
  }
  for (const entry of data.entries) if (entry.recipes.some(r => wanted.has(r))) add(entry);
  for (const name of [
    'Logistics',
    'Base Building',
    'Field Research',
    'Resource Sink Bonus Program',
  ])
    add(byName(name));
  // The biomass start-up steps and "Power available now" ask for these in any phase until a
  // power unlock is ticked (biomassStartupTasks, powerReviewTask), so every phase needs them; a
  // profile made for a later phase lists them in Phase 1, their own phase (#781). Added in every
  // phase rather than only while those steps show, so ticking another unlock never takes a
  // milestone step away.
  add(byName('HUB Upgrade 6'));
  add(byName('Obstacle Clearing'));
  add(byName('Logistics Mk.2'));
  if (stage >= 2) add(byName('Coal Power'));
  if (stage >= 4 && plan.settings.droneFuel && plan.settings.droneFuel !== 'none')
    add(byName('Aeronautical Engineering'));
  // The augmenters are buildings, not rows, so their MAM node comes from the settings: Phase 5's
  // "Build N Alien Power Augmenters" step (endgameTasks) asks for it (#810). Fueled augmenters'
  // Alien Power Matrix node comes in through the fuel row's recipe above.
  if (stage === 5 && (plan.settings.augmenters ?? 0) > 0) add(byName(AUGMENTER_RESEARCH));
  // Petroleum Power from its own phase on, as Coal Power from Phase 2, whether or not this plan
  // builds Fuel Generators (#1048): a player who already runs fuel power ticks it, and "Power
  // available now" then stops advising coal.
  if (stage >= 3) add(byName('Petroleum Power'));
  if (rows.some(r => r.machine === 'Nuclear Power Plant')) add(byName('Nuclear Power'));
  // Useful early research is reachable through Field Research; its dataset tier is not a HUB gate.
  for (const name of ['Blue Power Slugs', 'Overclock Production']) add(byName(name));
  if (rows.some(r => Object.keys(r.inputs).some(item => /Caterium|Quickwire/.test(item))))
    for (const name of ['Caterium', 'Caterium Ingots', 'Caterium Electronics']) add(byName(name));
  if (
    rows.some(row =>
      Object.keys(row.inputs).some(item => /Quartz|Silica|Crystal Oscillator/.test(item)),
    )
  )
    for (const name of ['Quartz', 'Quartz Crystals', 'Silica']) add(byName(name));
  return [...required.values()];
}

// A step's "Prerequisites: …" or "First unlock: …" sentence, naming only the unlocks
// progression.json lists. One it does not list (the HUB tutorial upgrades before HUB Upgrade 6)
// is left out, as requiredMilestones leaves it out, rather than shown as its raw class id (#812);
// with none listed there is no sentence.
function listedNames(ids: string[], data: Progression, label: string): string {
  const names = ids.flatMap(id => data.entries.find(entry => entry.id === id)?.name ?? []);
  return names.length ? `${label}: ${names.join(', ')}. ` : '';
}

// The phase an unlock belongs to, the first in which it can be researched: a HUB milestone its
// tier's phase, a MAM node the latest first-available phase of its cost items, collectibles aside.
export function milestonePhase(entry: ProgressionEntry, data: Progression): number {
  if (!entry.mam) return phaseForTier(entry.tier);
  const phases = Object.keys(entry.cost)
    .filter(item => !COLLECTIBLES.includes(item))
    .map(item => data.availability[item] || 1);
  return Math.max(1, ...phases);
}

// Whether an unlock can be researched by `stage`.
const researchable = (entry: ProgressionEntry, data: Progression, stage: number): boolean =>
  milestonePhase(entry, data) <= stage;

// The milestones whose unlock step phase `stage` (1-5) of the profile lists (#758). The profile
// lists every milestone one of its planned phases (its start phase on) needs and can research by
// then (requiredMilestones), each once, under its own phase (milestonePhase), so a Tier 2 unlock
// only Phase 3's rows need is a Phase 1 step. A milestone of a phase before the start phase is
// listed in that phase, which the build plan offers as a milestone-only phase (#759). Post-game,
// planned as Phase 5, lists none (progression() above): they are all in Phase 5. The check key
// stays `unlock-<id>` whichever phase lists the step. milestoneTasks orders the list.
// `memo` keeps the planned phases' milestones (plannedMilestones) for later calls with it.
export function milestonesListedIn(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages'>,
  state: { checks: Record<string, boolean> },
  data: Progression,
  stage: number,
  memo: StepsMemo = {},
): ProgressionEntry[] {
  if (!memo.planned) plannedMilestones(plan, state, data, memo);
  return memo.planned!.filter(entry => milestonePhase(entry, data) === stage);
}

// Every milestone one of the profile's planned phases (its start phase on) needs and can
// research by then, each once, in the order they were first needed: what milestonesListedIn
// shares out over the phases. Kept in `memo.planned`, with the phases needing each one in
// `memo.neededIn` (optionalResearch below reads those).
function plannedMilestones(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages'>,
  state: { checks: Record<string, boolean> },
  data: Progression,
  memo: StepsMemo,
): void {
  const start = Number(plan.settings.phase || 1),
    listed = new Map<string, ProgressionEntry>(),
    neededIn = new Map<string, number[]>();
  const planned = (['1', '2', '3', '4', '5'] as const).filter(
    key => Number(key) >= start && plan.stages[key],
  );
  for (const key of planned)
    for (const entry of requiredMilestones(guideContext(plan, state, data, key))) {
      neededIn.set(entry.id, [...(neededIn.get(entry.id) ?? []), Number(key)]);
      if (!entry.alternate && researchable(entry, data, Number(key))) listed.set(entry.id, entry);
    }
  memo.planned = [...listed.values()];
  memo.neededIn = neededIn;
}

// The MAM research steps of a planned phase that none of its own lines needs (#1070): listed
// here because their costs first become available in this phase (milestonesListedIn), but only
// a later phase's lines use them. They are marked optional, say which phase needs them, and go
// after the phase's production lines; their check keys stay `unlock-<id>`. HUB milestones and the
// research every phase asks for (requiredMilestones) stay required.
function optionalResearch(
  tasks: GuideTask[],
  stage: number,
  data: Progression,
  neededIn: Map<string, number[]>,
): GuideTask[] {
  return tasks.map(task => {
    const id = task.id.slice('unlock-'.length),
      entry = data.entries.find(known => known.id === id),
      phases = neededIn.get(id) ?? [];
    if (!entry?.mam || phases.includes(stage)) return task;
    const later = phases.find(phase => phase > stage);
    return {
      ...task,
      title: task.title + ' (optional)',
      body:
        `Optional in this phase: none of its lines needs it${later ? `; Phase ${later}’s lines do` : ''}. Research it now if the materials are at hand, or later. ` +
        task.body,
      optional: true,
    };
  });
}

// Depth-first, so every prerequisite in the list comes before what needs it; otherwise keeps
// the order of `milestones`.
function prerequisitesFirst(milestones: ProgressionEntry[]): ProgressionEntry[] {
  const ordered: ProgressionEntry[] = [],
    seen = new Set<string>();
  function visit(entry: ProgressionEntry) {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    for (const id of entry.requires) {
      const prerequisite = milestones.find(m => m.id === id);
      if (prerequisite) visit(prerequisite);
    }
    ordered.push(entry);
  }
  milestones.forEach(visit);
  return ordered;
}

// One unlock step per milestone of `required` this phase can research (progression() passes the
// phase's milestonesListedIn). Alternate recipes are left
// out: they come from hard drives (hardDriveTasks). Prerequisites come before dependents;
// among otherwise independent unlocks, costs with running supply come first.
export function milestoneTasks(context: GuideContext, required: ProgressionEntry[]): GuideTask[] {
  const { data, stage, sources, funding } = context;
  const milestones = required.filter(entry => !entry.alternate && researchable(entry, data, stage));
  const readiness = (entry: ProgressionEntry) =>
    Object.keys(entry.cost).filter(item => sources(item).some(source => source.running)).length /
    Math.max(1, Object.keys(entry.cost).length);
  milestones.sort(
    (first, second) =>
      Number(first.mam) - Number(second.mam) ||
      first.tier - second.tier ||
      readiness(second) - readiness(first) ||
      first.name.localeCompare(second.name),
  );
  return prerequisitesFirst(milestones).map(
    (entry): GuideTask => ({
      id: 'unlock-' + entry.id,
      title: `${entry.mam ? 'MAM' : 'Tier ' + entry.tier}: ${entry.name}`,
      body: `${entry.mam ? 'Follow this MAM branch and complete its parent research nodes first.' : 'Unlock at the HUB before using its machines or recipes.'} ${listedNames(entry.requires, data, 'Prerequisites')}Cost (base game; adjust if your milestone-cost settings differ): ${funding(entry) || 'No item cost listed'}. Production checkmarks do not confirm inventory or spare capacity.`,
    }),
  );
}

// One hard-drive step plus one unlock step per alternate recipe this phase's rows use first: an
// alternate an earlier planned phase (the start phase on) already uses is listed there and not
// again (#870), as each milestone is listed once (#758). An unlock is a fact about the world, so a
// step repeated in every phase that uses the recipe made a later phase look started while the
// profile was still on the first. The check key stays `recipe-unlock-<recipe>` whichever phase
// lists it, so a tick made in a later phase's list counts in the phase that lists it now. The
// recipe is recipeIdOf's, so an amplified twin or a group's own line shares its recipe's one step
// (#875, #901); keys an earlier release gave an amplified twin, 'recipe-unlock-amp:<recipe>', or
// a new profile carried for a group's own line, 'recipe-unlock-<recipe>:<group>' (#1041), are
// merged into it by validateState (mergeOldUnlockKeys in state/validate.ts).
export function hardDriveTasks(context: GuideContext): GuideTask[] {
  const { checks, data, stage, rows } = context;
  const earlier = earlierAlternates(context);
  const alternates = [
    ...new Map(
      rows
        .filter(r => r.alternate && !earlier.has(recipeIdOf(r)))
        .map(row => [recipeIdOf(row), row]),
    ).values(),
  ];
  if (!alternates.length) return [];
  const missing = alternates.filter(r => !checks['recipe-unlock-' + recipeIdOf(r)]);
  return [
    {
      id: 'hard-drives-' + stage,
      title: 'Collect and scan hard drives for the selected alternates',
      body: `${missing.length} selected recipe unlocks remain unconfirmed. Complete Field Research and build the MAM. Take materials and portable power for crash sites, collect hard drives, and run 10-minute scans while building. Choices are random: this is not a guaranteed drive count. Finish each recipe’s prerequisite milestones/research first.`,
      // With every recipe it lists unlocked, the hunt is over: shown done without a tick (#1070).
      ...(missing.length ? {} : { satisfied: 'Done: every recipe it lists is unlocked.' }),
    },
    ...alternates.map(row => {
      const alternate = data.entries.find(
        entry => entry.alternate && entry.recipes.includes(recipeIdOf(row)),
      );
      return {
        id: 'recipe-unlock-' + recipeIdOf(row),
        title: 'Unlock ' + recipeNameOf(row),
        body: `Required by this profile’s ${row.machine} line. ${listedNames(alternate?.requires ?? [], data, 'First unlock')}Choose it when offered by hard-drive research. Confirm here only after unlocking it in game; selecting “all alternates” in the profile is a planning allowance, not an in-game unlock.`,
      };
    }),
  ];
}

// The alternate recipes the planned phases before `stage` use (from the plan's start phase on;
// a stage before it is never built), whose unlock steps those phases list (hardDriveTasks).
function earlierAlternates({ plan, stage, stageOf }: GuideContext): Set<string> {
  const ids = new Set<string>();
  for (let phase = Number(plan.settings.phase || 1); phase < stage; phase++)
    for (const row of stageOf(phase)?.rows || []) if (row.alternate) ids.add(recipeIdOf(row));
  return ids;
}

// The power, fuel and endgame steps of the phase. phaseSteps interleaves Phase 1's lists by
// position, so the order of the first steps (power review, biomass, Solid Biofuel, burner bank)
// matters.
export function powerTasks(context: GuideContext): GuideTask[] {
  const power = unlockedPower(context);
  return [
    powerReviewTask(context, power),
    ...biomassStartupTasks(context, power),
    ...generationTasks(context, power),
    ...endgameTasks(context),
    ...sloopTasks(context),
    ...droneFuelTasks(context),
  ];
}

// How many of powerTasks' first steps keep the power the player already has going, "Power
// available now" and the biomass start-up: they ask for no unlock of this phase, so phaseSteps
// lists them before the phase's milestones and the rest after them (#1070), each power step after
// the unlock it asks for.
const powerStartupCount = (context: GuideContext): number =>
  1 + biomassStartupTasks(context, unlockedPower(context)).length;

function unlockedPower({ byName, unlocked }: GuideContext): UnlockedPower {
  const known = (name: string) => {
    const entry = byName(name);
    return !!entry && unlocked(entry);
  };
  return {
    coal: known('Coal Power'),
    petroleum: known('Petroleum Power'),
    nuclear: known('Nuclear Power'),
    solid: known('Obstacle Clearing'),
  };
}

// "Power available now", the first step of every phase from 2 on (phaseSteps puts the power steps
// first; its place and key stay). With spare existing power in the settings it builds on that
// figure from Phase 2 on, where the plan's power is balanced against it: what the phase needs
// beyond it and the generation the plan builds for it, or that it covers the phase (#1048).
// Without, and in Phase 1's biomass start, it follows the ticked power unlocks, as it always has.
// The generators the player already has (settings.ownedGenerators, #1068) are named in both: how
// many of the phase's generators they are and how many are left to build, and those of a building
// the phase does not fuel, which it does not count (ownedPowerText).
function powerReviewTask(context: GuideContext, unlocked: UnlockedPower): GuideTask {
  const figures = phasePower(context);
  return {
    id: 'startup-' + context.stage + '-power-review',
    title: 'Power available now',
    body:
      (figures.existingMW + figures.augmenterMW > 0 && context.stage >= 2
        ? existingPowerText(context, figures, unlocked)
        : unlockText(context, figures, unlocked) + ownedCountText(figures)) +
      unfueledOwnedText(context, figures),
  };
}

// The generators the player already has that this phase counts (#1068), where "Power available
// now" gives no generator counts of its own (without spare power): " You already have 4 of the 6
// Coal Generators this phase's lines need, so build 2 more." or "… 8 Coal Generators, enough for
// the 6 this phase's lines need, so build none." Empty without any.
function ownedCountText({ owned }: PhasePowerFigures): string {
  if (!owned.length) return '';
  const parts = owned.map(entry => {
    const have = entry.owned ?? 0,
      plural = (count: number) => entry.machine + (count === 1 ? '' : 's');
    return have < entry.own
      ? `${formatNumber(have)} of the ${formatNumber(entry.own)} ${plural(entry.own)} this phase's lines need, so build ${formatNumber(entry.machines - Math.max(have, entry.kept))} more`
      : `${formatNumber(have)} ${plural(have)}, enough for the ${formatNumber(entry.own)} this phase's lines need, so build none`;
  });
  return ` You already have ${listNames(parts)}.`;
}

// The generators the player already has in a building this phase plans no generator line in
// (#1068), which it therefore does not count: their fuel is not in its budgets. Biomass Burners
// are left out (they are hand-fed, outside the plan; the burner bank counts them), and so is a
// building the phase cannot have unlocked yet. " This phase builds no Coal Generators, so the 8
// you already have are not counted: to keep them running, leave their fuel out of the budgets and
// enter their 600 MW as Spare existing power in Edit settings." Empty otherwise.
function unfueledOwnedText(
  { plan, stage }: GuideContext,
  { modelled, running }: PhasePowerFigures,
) {
  const owned = plan.settings.ownedGenerators;
  if (!owned || !modelled) return '';
  const idle = OWNED_GENERATORS.filter(
    kind =>
      kind.machine !== 'Biomass Burner' &&
      kind.phase <= stage &&
      (owned[kind.machine] ?? 0) > 0 &&
      !running.includes(kind.machine),
  );
  if (!idle.length) return '';
  const count = (kind: (typeof idle)[number]) => owned[kind.machine] ?? 0;
  const mw = idle.reduce((sum, kind) => sum + count(kind) * kind.mw, 0);
  // One building names only its count ("the 8"), several name each ("the 8 Coal Generators and
  // 1 Nuclear Power Plant"); a single generator is "it".
  const named = (kind: (typeof idle)[number]) =>
    idle.length === 1
      ? count(kind) === 1
        ? 'one'
        : formatNumber(count(kind))
      : `${formatNumber(count(kind))} ${kind.machine}${count(kind) === 1 ? '' : 's'}`;
  const one = idle.length === 1 && count(idle[0]!) === 1;
  const [are, them, their] = one ? ['is', 'it', 'its'] : ['are', 'them', 'their'];
  return ` This phase builds no ${listNames(idle.map(kind => kind.machine + 's'))}, so the ${listNames(idle.map(named))} you already have ${are} not counted: to keep ${them} running, leave ${their} fuel out of the budgets and enter ${their} ${powerAmount(mw)} as Spare existing power in Edit settings.`;
}

// A phase's power as every page gives it (powerView in public/power.ts, #1064), in MW: what it
// needs (its lines at their clocked power with the utility allowance and the miners and
// extractors; for a plan made before #1064 its whole-machine peak with the allowance), the spare
// existing power the settings enter (availablePowerGW, as the Resources page's bar shows it),
// what Phase 5's Alien Power Augmenters add to it (their 500 MW each and their boost on installed
// generation), the new generation its whole generators give with the augmenters' boost, and what
// is left once the need is met (negative when short). The generator lines come highest source
// first (SOURCE_ORDER). `modelled` is true for a plan with a grid, whose `kept` lists the
// generators the phase before built and this phase keeps, per building.
interface PhasePowerFigures {
  modelled: boolean;
  // What the need holds (#1090): the production lines, the miners and extractors and the utility
  // allowance for trains, drones and pumps, with their words (powerView's need, power.ts).
  need: ReturnType<typeof powerView>['need'];
  kept: GridGenerator[];
  // The generators the player already has (#1068) beyond the kept ones, per building
  // (ownedBeyondKept in power.ts), and every building the phase runs generators in.
  owned: GridGenerator[];
  running: string[];
  // The phase before this one, which built the kept generators, and Phase 5's augmenter boost.
  previous: number;
  boost: number;
  // What the planner's power constraint charges (a plan with a grid): every line at its full
  // linear power with the allowance, and the extraction; 0 otherwise. A plan before #1086 has
  // its fuel for this; a later one for the clocked need, within a generator (planner/load.ts).
  plannedMW: number;
  requiredMW: number;
  existingMW: number;
  augmenters: number;
  augmenterMW: number;
  newMW: number;
  leftMW: number;
  generators: CalcRow[];
  // Phase 5 under 'recycle': the uranium plants come in multiples of the waste chain's period
  // (nuclearPeriod, #370), so every waste line runs whole; 0 otherwise.
  period: number;
}

function phasePower({ plan, stage, stageOf, rows }: GuideContext): PhasePowerFigures {
  const planned = stageOf(stage) ?? { feasible: false },
    view = powerView(planned, plan.settings);
  const rank = (row: CalcRow) => SOURCE_ORDER.indexOf(generatorSource(row));
  return {
    modelled: view.modelled,
    need: view.need,
    kept: view.generators.filter(entry => entry.kept > 0),
    owned: ownedBeyondKept(view),
    running: view.generators.map(entry => entry.machine),
    previous: stage - 1,
    boost: planned.boost || 0,
    plannedMW: plannedFor(planned, plan.settings),
    requiredMW: view.needMW,
    existingMW: view.spareMW,
    augmenters: planned.augmenters || 0,
    augmenterMW: view.augmenterMW,
    newMW: view.generationMW,
    leftMW: view.leftMW,
    period: planned?.nuclearPeriod ?? 0,
    generators: rows.filter(isGenerator).sort((first, second) => rank(first) - rank(second)),
  };
}

// What the planner's power constraint charges a stage (#1064): every line at its full linear power
// with the allowance, and the extraction. 0 without a grid.
function plannedFor(planned: StoredStage, settings: GuideContext['plan']['settings']): number {
  if (!planned.grid) return 0;
  const linear = (planned.rows || [])
    .filter(row => row.power > 0)
    .reduce((sum, row) => sum + row.power * (row.equivalent || 0), 0);
  // With mining per phase (#1065) the grid counts the nodes' clocked power, and the planner charged
  // each node kind's linear power.
  const extraction = planned.mining
    ? miningLinearMW(planned.raw || {}, planned.mining) * (settings.powerFactor ?? 1)
    : planned.grid.extractionMW;
  return (
    linear * (settings.powerFactor ?? 1) * (1 + (settings.utilityPercent ?? 20) / 100) + extraction
  );
}

// Power sources from the highest tier down, as generatorSource names them, and the HUB unlock
// each needs. The unlocks are in tier order too (POWER_UNLOCKS), so a source ranks by its unlock.
const SOURCE_ORDER = ['nuclear', 'rocket fuel', 'turbofuel', 'fuel', 'coal'];
const POWER_UNLOCKS = ['Coal Power', 'Petroleum Power', 'Nuclear Power'] as const;
const SOURCE_UNLOCK: Record<string, (typeof POWER_UNLOCKS)[number]> = {
  coal: 'Coal Power',
  fuel: 'Petroleum Power',
  turbofuel: 'Petroleum Power',
  'rocket fuel': 'Petroleum Power',
  nuclear: 'Nuclear Power',
};
// A power unlock's tier: 1 for Coal Power up to 3 for Nuclear Power, 0 for none.
const unlockTier = (name: string | undefined): number =>
  POWER_UNLOCKS.indexOf(name as (typeof POWER_UNLOCKS)[number]) + 1;

// The highest power unlock ticked that this phase can use (Coal Power from Phase 2, Petroleum
// Power from 3, Nuclear Power from 4), as a tier; 0 for biomass only.
const tickedTier = (stage: number, { coal, petroleum, nuclear }: UnlockedPower): number =>
  nuclear && stage >= 4 ? 3 : petroleum && stage >= 3 ? 2 : coal && stage >= 2 ? 1 : 0;

// The power sources of the phase's generator lines, highest first ("nuclear", "turbofuel").
const plannedSources = (generators: CalcRow[]): string[] => [
  ...new Set(generators.map(generatorSource)),
];

// The unlocks the planned sources need that are not ticked yet, in tier order.
const missingUnlocks = (generators: CalcRow[], { coal, petroleum, nuclear }: UnlockedPower) => {
  const ticked: Record<string, boolean> = {
    'Coal Power': coal,
    'Petroleum Power': petroleum,
    'Nuclear Power': nuclear,
  };
  return POWER_UNLOCKS.filter(
    name =>
      !ticked[name] && plannedSources(generators).some(source => SOURCE_UNLOCK[source] === name),
  );
};

// The text with spare existing power (#1048). It never names a source below the plan's. The need
// is given with what it holds (#1090): the production lines, the miners and extractors and the
// utility allowance for trains, drones and pumps, which Extra utilities power in Preferences
// sets, and where the variable-power machines count at their peak.
function existingPowerText(
  { plan }: GuideContext,
  figures: PhasePowerFigures,
  unlocked: UnlockedPower,
): string {
  const { requiredMW, existingMW, augmenters, augmenterMW, generators } = figures;
  // What the phase has before any new generation: the spare power, and what the augmenters add.
  const haveMW = existingMW + augmenterMW;
  const yours = `your ${augmenters === 1 ? 'augmenter adds' : formatNumber(augmenters) + ' augmenters add'} ${powerAmount(augmenterMW)}`;
  const have =
    augmenterMW <= 0.01
      ? `You have ${powerAmount(existingMW)} of spare power available`
      : existingMW <= 0.01
        ? `Your Alien Power ${augmenters === 1 ? 'Augmenter adds' : 'Augmenters add'} ${powerAmount(augmenterMW)}`
        : `You have ${powerAmount(existingMW)} of spare power available, and ${yours}`;
  const allowance = figures.need.words;
  const unlock = missingUnlocks(generators, unlocked);
  const unlockFirst = unlock.length ? ` Unlock ${listNames(unlock)} first.` : '';
  const check =
    (figures.need.peak ? ' ' + figures.need.peak : '') +
    ` The ${figures.need.percent}% for trains, drones and pumps is ${figures.need.setting} in Preferences: raise it with Edit settings for more margin.` +
    ' Before connecting the next factory, check the actual load against what your grid supplies.';
  if (requiredMW - haveMW <= 0.01)
    return (
      `${have}, which ${augmenterMW > 0.01 ? 'cover' : 'covers'} this phase's ${powerAmount(requiredMW)} (${allowance}): ` +
      (generators.length
        ? `nothing needs building for that. The plan still builds ${newGeneration(plan, figures, true)}.${unlockFirst}`
        : 'nothing needs building for power in this phase.') +
      check
    );
  const more = `${have}. This phase needs ${powerAmount(requiredMW - haveMW)} more (${powerAmount(requiredMW)} in all: ${allowance})`;
  if (!generators.length)
    return `${more}, and its plan builds no generators for it: see the power headroom on the Resources page.${check}`;
  return `${more}: build ${newGeneration(plan, figures, false)}.${unlockFirst}${check}`;
}

// The generation the phase's lines add, highest source first, with what is left over once the
// phase's need is met and why: "its nuclear power, 13 × Uranium power (Nuclear Power Plant), which
// provides 32.5 GW, 643.9 MW spare from building whole plants". Where the spare power already
// covers the phase (`covered`), all of it is left over: "which adds 2.5 GW because …".
function newGeneration(
  plan: GuideContext['plan'],
  figures: PhasePowerFigures,
  covered: boolean,
): string {
  const { newMW, leftMW, generators } = figures;
  const lines = generators.map(
    row => `${formatNumber(row.machines)} × ${row.name} (${row.machine})`,
  );
  const named = `its ${listNames(plannedSources(generators))} power, ${listNames(lines)}${keptText(figures)}`;
  if (covered)
    return `${named}, which adds ${powerAmount(newMW)}${spareCause(plan, figures, newMW)}`;
  const left =
    leftMW > 0.01
      ? `, ${powerAmount(leftMW)} spare${spareCause(plan, figures, leftMW)}`
      : leftMW < -0.01
        ? `, ${powerAmount(-leftMW)} short of the need: see the power headroom on the Resources page`
        : '';
  return `${named}, which provides ${powerAmount(newMW)}${left}`;
}

// The generators the phase before built that this phase keeps (#1064), after its generator lines:
// " (7 of these Fuel Generators were built in Phase 3)", or where it keeps more than its lines
// need, " (keep all 8 Fuel Generators built in Phase 3)". Then those the player already has
// (#1068): " (you already have 4 of these Coal Generators)", or where they are more than the lines
// need, " (keep all 8 Coal Generators you already have)". Empty without any.
function keptText({ kept, owned, previous }: PhasePowerFigures): string {
  const parts = kept.map(entry => {
    const plural = entry.machine + (entry.kept === 1 ? '' : 's');
    return entry.machines > entry.own && entry.kept >= (entry.owned ?? 0)
      ? `keep all ${formatNumber(entry.kept)} ${plural} built in Phase ${previous}`
      : `${formatNumber(entry.kept)} of these ${entry.machine}s ${entry.kept === 1 ? 'was' : 'were'} built in Phase ${previous}`;
  });
  for (const entry of owned) {
    const have = entry.owned ?? 0,
      plural = entry.machine + (have === 1 ? '' : 's');
    parts.push(
      entry.machines > entry.own
        ? `keep all ${formatNumber(have)} ${plural} you already have`
        : `you already have ${formatNumber(have)} of these ${entry.machine}s`,
    );
  }
  return parts.length ? ` (${listNames(parts)})` : '';
}

// Why the generator lines give more than the phase needs, where the plan shows it: the profile's
// minimum of uranium reactors (settings.uraniumReactors, which the planner builds whatever the
// need), else the waste chain's period in Phase 5 (the spare less than one block of plants), else
// whole machines rounded up (every generator line whole, and the spare less than one machine of
// the largest). Otherwise no reason is given.
function spareCause(
  plan: GuideContext['plan'],
  figures: PhasePowerFigures,
  leftMW: number,
): string {
  const { generators, period } = figures;
  const minimum = plan.settings.uraniumReactors ?? 1;
  const uranium = generators.find(row => row.id === 'power-uranium');
  // One generator's output: a whole one at 100% in a plan with a grid (#1064), else the line's
  // output over its machines.
  const perMachine = (row: CalcRow) =>
    figures.modelled ? -row.power : row.generationMW / Math.max(1, row.machines);
  if (uranium && uranium.machines <= minimum && leftMW >= perMachine(uranium) - 0.01)
    return ` because this profile's minimum is ${formatNumber(minimum)} uranium reactor${minimum === 1 ? '' : 's'}`;
  // One block: the period's uranium plants with the plutonium and ficsonium plants they feed.
  const nuclearMW = generators
    .filter(row => row.machine === 'Nuclear Power Plant')
    .reduce((total, row) => total + row.generationMW, 0);
  if (uranium && period > 1 && leftMW < (nuclearMW * period) / Math.max(1, uranium.machines))
    return ` from building the uranium plants in multiples of ${formatNumber(period)}, so every line of the waste chain runs whole`;
  if (figures.modelled) return gridCause(figures, leftMW);
  const whole = generators.every(row => Math.abs(row.machines - (row.equivalent ?? 0)) < 1e-6);
  if (whole && leftMW < Math.max(...generators.map(perMachine)))
    return generators.every(row => row.machine === 'Nuclear Power Plant')
      ? ' from building whole plants'
      : ' from building whole generators';
  return '';
}

// Why a plan with a grid (#1064) has power left over, after the nuclear causes above: generators
// the phase before built that it keeps beyond what its own lines need; fuel the lines make beyond
// what the plan's power balance asks for by more than one generator burns (whole production lines
// and their byproducts set how much); else the larger of the generators rounded up to whole ones
// (with fuel for less than one generator over the balance, which whole plants in the planner
// leave) and the fuel planned beyond the phase's need within that balance: for every line at its
// full linear power while its underclocked machines draw less. A plan since #1086 plans its fuel
// for the clocked need (planner/load.ts), so that part is at most a generator's worth there; a
// plan before it, whose fuel follows the linear balance, keeps the reason it was given. Otherwise
// no reason is given.
function gridCause(figures: PhasePowerFigures, leftMW: number): string {
  const { generators, kept, owned, previous } = figures;
  const extra = kept.filter(
    entry => entry.machines > entry.own && entry.kept >= (entry.owned ?? 0),
  );
  if (extra.length)
    return ` from keeping the ${listNames(extra.map(entry => `${formatNumber(entry.kept)} ${entry.machine}${entry.kept === 1 ? '' : 's'}`))} built in Phase ${previous}`;
  // The generators the player already has, where they are more than the lines need (#1068).
  const extraOwned = owned.filter(entry => entry.machines > entry.own);
  if (extraOwned.length)
    return ` from keeping the ${listNames(extraOwned.map(entry => `${formatNumber(entry.owned)} ${entry.machine}${entry.owned === 1 ? '' : 's'}`))} you already have`;
  if (!(leftMW > 0.01)) return '';
  const fuelMW = generators.reduce((sum, row) => sum + row.generationMW * (1 + figures.boost), 0);
  const unitMW = Math.max(0, ...generators.map(row => -row.power * (1 + figures.boost)));
  const fuelOver = fuelMW - (figures.plannedMW - figures.existingMW - figures.augmenterMW);
  if (fuelOver > unitMW + 0.01)
    return ' because its lines make more fuel than the phase needs: whole production lines and their byproducts set how much';
  const have = figures.existingMW + figures.augmenterMW;
  const whole = figures.newMW - fuelMW + Math.max(0, fuelOver),
    clock = Math.min(fuelMW, figures.plannedMW - have) - (figures.requiredMW - have);
  if (clock > whole)
    return ' because the fuel is planned for every machine at full power, and the underclocked machines draw less';
  return generators.every(row => row.machine === 'Nuclear Power Plant')
    ? ' from building whole plants'
    : ' from building whole generators';
}

// The text without spare existing power: by the power unlocks ticked, as before #1048, except that
// a phase planning a higher source than the one ticked says so instead of advising the lower one.
function unlockText(
  { stage }: GuideContext,
  { generators }: PhasePowerFigures,
  unlocked: UnlockedPower,
): string {
  const ticked = tickedTier(stage, unlocked);
  const higher = generators.filter(row => unlockTier(SOURCE_UNLOCK[generatorSource(row)]) > ticked);
  const missing = missingUnlocks(higher, unlocked);
  // The higher source the plan builds, and the unlocks it still needs.
  const plans = missing.length
    ? `this phase's plan generates with ${listNames(plannedSources(higher))} power: unlock ${listNames(missing)} before building it`
    : '';
  const powerNow =
    ticked === 3
      ? 'Nuclear power is marked unlocked. Commission all waste processing before loading fuel rods.'
      : ticked === 2
        ? plans
          ? `Fuel generators are marked unlocked, but ${plans}, and keep your fuel generators running until then.`
          : 'Fuel generators are marked unlocked. Use only the fuel recipes you have researched and connect their byproduct handling.'
        : ticked === 1
          ? plans
            ? `Coal Power is marked unlocked, but ${plans}, and keep your coal generators running until then.`
            : 'Coal Power is marked unlocked. Build coal extraction, water and generators, then verify sustained output.'
          : // Biomass bridges to the first unlock, which "Unlock Coal Power" and the fuel and
            // nuclear steps ask for (generationTasks).
            unlocked.solid
            ? 'Use belt-fed Biomass Burners with Solid Biofuel; keep gathering leaves and wood.'
            : 'Use HUB/built Biomass Burners with gathered fuel or Biomass. Unlock Obstacle Clearing for Solid Biofuel.';
  return (
    powerNow +
    ' Full-phase generation shown in the calculator is a future target, not power already unlocked. Tick the relevant HUB/MAM unlocks to update this advice.'
  );
}

// The phase a calculated plan starts building in: its settings' phase. The phases before it are
// milestone-only (#759) and list no power steps.
const startPhase = ({ plan }: GuideContext): number => Number(plan.settings.phase || 1);

// Whether the settings enter spare existing power (availablePowerGW above 0).
const hasSparePower = ({ plan }: GuideContext): boolean =>
  (plan.settings.availablePowerGW || 0) > 0;

// Whether the "Unlock Coal Power" step applies (#1048): Coal Power is not ticked, and either this
// phase builds coal generators or coal is the next step up for the player, who has ticked no
// higher power unlock and entered no spare existing power. Otherwise it would advise a source
// below the one the player runs or the phase plans.
function coalUnlockNeeded(context: GuideContext, { coal, petroleum, nuclear }: UnlockedPower) {
  if (coal) return false;
  if (context.rows.some(row => isGenerator(row) && generatorSource(row) === 'coal')) return true;
  return !petroleum && !nuclear && !hasSparePower(context);
}

// Biomass start-up guidance: Phase 1, or any phase with no power unlock ticked yet and no spare
// existing power in the settings (#1048: a player with spare power already runs more than biomass,
// and "Power available now" builds on that figure instead). Gathering
// Biomass and automating Solid Biofuel are done once in the game, so those two steps are listed
// once, in the first planned phase that lists the start-up, which is always the start phase
// (#872), as each milestone (#758) and alternate unlock (#870) is listed once: repeated in every
// later phase with the same check keys, a tick made while working on Phase 3 made Phases 4 and 5
// look started. Post-game plans Phase 5's stage, so it lists them too for a profile made for
// Phase 5. The burner bank is sized for this phase's load and keyed per phase, so every phase
// with the start-up keeps its own.
function biomassStartupTasks(
  context: GuideContext,
  { coal, petroleum, nuclear }: UnlockedPower,
): GuideTask[] {
  const { plan, stage, stageOf } = context;
  if (!(stage === 1 || (!coal && !petroleum && !nuclear && !hasSparePower(context)))) return [];
  const first = stage === startPhase(context);
  // What the phase needs beyond the spare power, as every page gives it (#1064).
  const view = powerView(stageOf(stage) ?? { feasible: false }, plan.settings),
    need = Math.max(0, view.needMW - view.spareMW),
    factor = plan.settings.powerFactor ?? 1;
  // Three starter constructors have their own draw; this is a manually supplied startup estimate.
  const burners = Math.ceil((need + 12 * factor) / 30);
  const once: GuideTask[] = [
    {
      id: 'startup-biomass',
      title: 'Turn leaves and wood into Biomass',
      body: 'After HUB Upgrade 6, feed two separate containers into two Constructors: Leaves uses 120 Leaves/min → 60 Biomass/min; Wood uses 60 Wood/min → 300 Biomass/min at 100%. Merge outputs into a buffer. Gathering remains manual; start smaller or underclock until fuel and power are stable.',
    },
    {
      id: 'startup-solid-biofuel',
      title: 'Unlock Obstacle Clearing, then automate Solid Biofuel',
      body: 'Tier 2 Obstacle Clearing unlocks the Chainsaw and Solid Biofuel. One Constructor consumes 120 Biomass/min → 60 Solid Biofuel/min at 100%. Start with one, fed by the Biomass buffer; retain fuel for the chainsaw. With a Mk.1 input belt, limit it to 60 Biomass/min → 30 Solid Biofuel/min; unlock Logistics Mk.2 for a 120/min input and the full 60/min output. A full 360 Biomass/min from both source Constructors can supply three Solid Biofuel Constructors, making 180/min. Split the merge across belts as needed: Mk.1 carries 60/min and Mk.2 120/min, so do not try to put 360/min on one early belt.',
    },
  ];
  return [
    ...(first ? once : []),
    {
      id: 'startup-burner-bank-' + stage,
      title: 'Size and feed the biomass burner bank',
      body: `Standalone Biomass Burners provide 30 MW each; HUB burners provide 20 MW each. Ignoring any HUB capacity not entered as spare power, allow about ${formatNumber(burners)} standalone burners for ${formatNumber(need)} MW of planned additional load plus three fuel-processing Constructors.${ownedBurnersText(plan.settings.ownedGenerators?.['Biomass Burner'] ?? 0, burners)} At full load each standalone burner consumes 4 Solid Biofuel/min; this bank needs up to ${formatNumber(burners * 4)}/min. One 60/min Solid Biofuel Constructor can fuel 15 such burners; a Mk.1-fed 30/min line supports 7.5 burners at full load. This is a startup estimate, not part of the continuous resource model: add processing capacity/power if needed, keep a reserve, and build gradually until coal is unlocked.`,
    },
  ];
}

// The Biomass Burners the player already has (settings.ownedGenerators, #1068) against the bank's
// `burners`: " You already have 4 of them: build 6 more." or " The 12 you already have cover
// it." Empty without any.
function ownedBurnersText(owned: number, burners: number): string {
  if (!(owned > 0)) return '';
  return owned < burners
    ? ` You already have ${formatNumber(owned)} of them: build ${formatNumber(burners - owned)} more.`
    : ` The ${formatNumber(owned)} you already have cover it.`;
}

// Moving to the generators the plan builds: coal, fuel, the preferred main power, aluminum
// water recycling and nuclear. "Unlock Coal Power" is one unlock, so it is listed once, in the
// first planned phase from Phase 2 on (#872, as the biomass start-up above), and post-game with it
// for a profile made for Phase 5.
function generationTasks(context: GuideContext, unlocked: UnlockedPower): GuideTask[] {
  const { stage, rows } = context;
  const tasks: GuideTask[] = [];
  if (stage === Math.max(2, startPhase(context)) && coalUnlockNeeded(context, unlocked))
    tasks.push({
      id: 'startup-coal-unlock',
      title: 'Unlock Coal Power before switching to coal',
      body: 'After Phase 1, prioritize Tier 3 Coal Power. Use existing reinforced-plate, rotor and cable production to fund it; see the HUB cost checklist. Keep biomass online while priming water and starting the coal supply. Only retire burners after stable generation is proven.',
    });
  const fuels = [
    ...new Set(rows.filter(r => r.machine === 'Fuel Generator').map(generatorFuel)),
  ].filter(Boolean);
  if (stage >= 3 && fuels.length)
    tasks.push({
      id: 'startup-fuel-' + stage,
      title: 'Unlock and commission the planned fuel power',
      body: fuelPowerBody(fuels),
    });
  tasks.push(...preferredPowerTasks(context));
  if (stage >= 4 && rows.some(r => r.inputs['Alumina Solution'] || r.outputs['Alumina Solution']))
    tasks.push({
      id: 'startup-aluminum-' + stage,
      title: 'Commission aluminum water recycling',
      body: 'Unlock Bauxite Refinement before commissioning the aluminum chain. Seed the system, prioritize returned water and handle silica/byproducts so the line cannot block.',
    });
  if (stage >= 4 && rows.some(r => r.machine === 'Nuclear Power Plant'))
    tasks.push({
      id: 'startup-nuclear-' + stage,
      title: 'Unlock nuclear and finish downstream waste processing first',
      body:
        stage === 4
          ? 'Complete Nuclear Power and the needed enrichment unlocks. Build uranium-waste processing and sink the resulting plutonium rods before starting reactors. Ficsonium recycling is a Phase 5 upgrade.'
          : 'Complete the required Tier 9 conversion/quantum unlocks. Commission the full uranium → plutonium → Ficsonium waste chain before burning plutonium. Match underclocks and verify power for recycling during startup.',
    });
  return tasks;
}

// The fuel power step's text: the fuels this phase's Fuel Generator lines burn (Fuel, Turbofuel,
// Rocket Fuel, as generators() in planner/recipes.ts names them), with only their unlocks (#880).
function fuelPowerBody(fuels: string[]): string {
  const research = [
    fuels.includes('Turbofuel') ? ' For turbofuel, complete its Sulfur MAM research.' : '',
    fuels.includes('Rocket Fuel')
      ? ' Rocket fuel also needs its own MAM node, nitrogen supply and Blender access.'
      : '',
  ].join('');
  return `This phase's Fuel Generators burn ${listNames(fuels)}. Complete Oil Processing and Petroleum Power first.${research} Confirm any fuel alternates in the hard-drive checklist. Start with an unlocked fuel recipe and upgrade only after the full new chain is ready.`;
}

// From Phase 3, when the profile chose a main power source: the generator lines this phase's
// plan builds, named as their own build steps are, with what each adds (#871). The setting only
// narrows the generators the planner may choose (generators() in planner/recipes.ts): under
// "Rocket fuel + nuclear" a phase may burn no rocket fuel at all, and a phase whose spare power
// covers its load builds none. So the step reads the phase's rows, never the setting alone. Its
// check key stays `preferred-power-<phase>`.
function preferredPowerTasks(context: GuideContext): GuideTask[] {
  const { plan, stage, rows } = context;
  const preferred = plan.settings.mainPower;
  if (!(stage >= 3 && preferred && preferred !== 'auto')) return [];
  const generators = rows.filter(isGenerator);
  const unburned = unburnedPreference(preferred, stage, rows);
  return [
    {
      id: 'preferred-power-' + stage,
      ...(generators.length
        ? generatorStep(context, generators, unburned)
        : sparePowerStep(stage, unburned)),
    },
  ];
}

// A preferred fuel this phase makes but burns in no generator, and the lines that make it.
interface UnburnedFuel {
  fuel: string;
  makers: string[];
}

// A generator line: a power-<fuel> row (generators() in planner/recipes.ts).
const isGenerator = (row: CalcRow): boolean => row.generationMW > 0;

// What a generator line burns: its input other than water.
const generatorFuel = (row: CalcRow): string =>
  Object.keys(row.inputs).find(item => item !== 'Water') || '';

// A generator line's power source in words, as the settings name it: coal, fuel, turbofuel,
// rocket fuel or nuclear (any Nuclear Power Plant).
const generatorSource = (row: CalcRow): string =>
  row.machine === 'Nuclear Power Plant'
    ? 'nuclear'
    : row.machine === 'Coal Generator'
      ? 'coal'
      : generatorFuel(row).toLowerCase();

// The fuel the preferred main power burns in this phase (as generators() narrows it), when this
// phase makes that fuel but no generator burns it, because the planner chose another generator
// the setting also allows. Null otherwise.
function unburnedPreference(
  preferred: string,
  stage: number,
  rows: CalcRow[],
): UnburnedFuel | null {
  if (preferred === 'coal' || (preferred === 'nuclear' && stage >= 4)) return null;
  const fuel =
    preferred === 'fuel'
      ? 'Fuel'
      : preferred.startsWith('rocket') && stage >= 4
        ? 'Rocket Fuel'
        : 'Turbofuel';
  if (rows.some(row => isGenerator(row) && row.inputs[fuel])) return null;
  const makers = rows.filter(row => row.outputs[fuel]).map(row => row.name);
  return makers.length ? { fuel, makers } : null;
}

// The sentence for a preferred fuel this phase makes but does not burn.
const unburnedText = (unburned: UnburnedFuel | null): string =>
  unburned
    ? ` Your preferred main power would burn ${unburned.fuel} in this phase, but the planner chose no generator that does: the ${unburned.fuel} from this phase's ${listNames(unburned.makers)} step${unburned.makers.length > 1 ? 's' : ''} is for other uses.`
    : '';

// What a phase without generator lines says: it runs on the spare power in the settings.
function sparePowerStep(
  stage: number,
  unburned: UnburnedFuel | null,
): Pick<GuideTask, 'title' | 'body'> {
  return {
    title: 'Keep spare power ahead of the next production block',
    body: `Phase ${stage} builds no generators: its plan runs on the spare existing power in this profile's settings.${unburnedText(unburned)} Before connecting the next factory, check the actual maximum consumption, with the utility allowance, against that spare power.`,
  };
}

// The unlocks and commissioning each power source needs before its generators run.
const SOURCE_PREREQUISITES: Record<string, string> = {
  coal: 'Coal power needs Coal Power unlocked, coal extraction and water.',
  fuel: 'Fuel power needs Oil Processing and Petroleum Power.',
  turbofuel:
    'Turbofuel power needs Oil Processing, Petroleum Power and the Sulfur MAM Turbofuel research; use coal until they are complete, and commission all byproduct handling.',
  'rocket fuel':
    'Rocket fuel power needs Blender access, nitrogen and Rocket Fuel in the Sulfur MAM tree; build and prime its chain before switching generators over.',
  nuclear:
    'Complete Nuclear Power and commission the fuel supply plus all waste processing before starting reactors.',
};

// The step for a phase with generator lines: Build when every line that grows is new to this
// phase, Expand when one adds to a line the previous phase built, Keep when none needs more
// machines. The previous phase counts only from the profile's start phase on.
function generatorStep(
  { plan, stage, rows, stageOf }: GuideContext,
  generators: CalcRow[],
  unburned: UnburnedFuel | null,
): Pick<GuideTask, 'title' | 'body'> {
  const previous = stage - 1 >= Number(plan.settings.phase || 1) ? stage - 1 : 0;
  const builtBefore = (row: CalcRow) =>
    (previous && stageOf(previous)?.rows?.find(earlier => earlier.id === row.id)?.machines) || 0;
  const growing = generators.filter(row => row.machines > builtBefore(row));
  const verb = !growing.length
    ? 'Keep'
    : growing.every(row => !builtBefore(row))
      ? 'Build'
      : 'Expand';
  const sources = [...new Set(generators.map(generatorSource))];
  const lines = generators.map(row => generatorLine(row, builtBefore(row), previous, rows));
  const prerequisites = sources.map(source => SOURCE_PREREQUISITES[source]).filter(Boolean);
  return {
    title: `${verb} ${listNames(sources)} power ${verb === 'Keep' ? 'ahead of' : 'before'} the next production block`,
    body: `Phase ${stage}'s plan generates power with ${lines.join('; ')}. Each line has its own step in this phase with its machines and output.${unburnedText(unburned)} ${prerequisites.join(' ')} ${closingAdvice(verb, previous)}`,
  };
}

// The step's closing advice, by its case (#881). Keep: no line needs more machines, so there is
// no capacity to commission and no replacement. Build and Expand commission new capacity; a
// previous plant to keep online exists only after the profile's start phase (previous is 0 there).
function closingAdvice(verb: string, previous: number): string {
  if (verb === 'Keep')
    return "No line needs more machines in this phase. Before connecting the next factory, check the actual maximum consumption, with the utility allowance, against these lines' output.";
  return `Check the actual maximum consumption with the utility allowance, and commission more capacity before connecting the next factory.${previous ? ' Keep the previous plant online until the replacement is stable.' : ''}`;
}

// One generator line in the step's text: its count and name as its build step shows them, what
// it adds to the previous phase's line, and the fuel it burns with the lines that make it.
function generatorLine(
  row: CalcRow,
  builtBefore: number,
  previous: number,
  rows: CalcRow[],
): string {
  const fuel = generatorFuel(row);
  const makers = rows
    .filter(maker => !isGenerator(maker) && maker.outputs[fuel])
    .map(maker => maker.name);
  const added = !builtBefore
    ? 'new in this phase'
    : row.machines > builtBefore
      ? `${formatNumber(builtBefore)} built in Phase ${previous}, so add ${formatNumber(row.machines - builtBefore)}`
      : `already built in Phase ${previous}`;
  const from = makers.length
    ? ` from the ${listNames(makers)} step${makers.length > 1 ? 's' : ''}`
    : '';
  const burns = fuel ? `, burning ${formatNumber(row.inputs[fuel])} ${fuel}/min${from}` : '';
  return `${formatNumber(row.machines)} × ${row.name} (${row.machine}), ${added}${burns}`;
}

// The MAM node the Alien Power Augmenters need, by its name in progression.json
// (Research_Alien_PowerBooster_C): requiredMilestones lists it, the augmenter step names it.
const AUGMENTER_RESEARCH = 'Power Augmenter';

// The augmenter step's research sentence, naming the MAM node as its milestone step does and the
// phase that lists that step (milestonePhase: Phase 3 with the base-game costs, a milestone-only
// phase before the start phase included), so the two read as one unlock (#825).
function augmenterResearch({ byName, data, stage }: GuideContext): string {
  const entry = byName(AUGMENTER_RESEARCH);
  if (!entry) return `Research ${AUGMENTER_RESEARCH} in the MAM (Alien Technology)`;
  const phase = milestonePhase(entry, data);
  const listed = phase === stage ? 'this phase' : `Phase ${phase}`;
  return `Research ${entry.name} in the MAM (Alien Technology; its step is listed in ${listed})`;
}

// Phase 5: the portals' Singularity Cell supply and the Alien Power Augmenters.
function endgameTasks(context: GuideContext): GuideTask[] {
  const { plan, stage } = context;
  if (stage !== 5) return [];
  const tasks: GuideTask[] = [];
  const cells = plan.settings.cellsPerMinute;
  if (cells > 0)
    tasks.push({
      id: 'portal-supply',
      title: 'Protect the continuous Singularity Cell supply for portals',
      body: `Unlock Tier 9 Spatial Energy Regulation. Each Main Portal consumes 2 Singularity Cells/min while maintaining its connection; the Satellite Portal needs no cells. Your dedicated ${formatNumber(cells)}/min contract supports ${Math.floor(cells / 2)} continuously connected Main Portals. The standard manufacturing recipe produces 10/min, enough for five connections. Feed portals before storage or the sink, add a buffer, and reserve their operating and startup electrical demand separately from the production calculation.`,
    });
  // Plans frozen before the augmenter settings existed have none.
  const count = plan.settings.augmenters ?? 0;
  if (count > 0) {
    const fueled = plan.settings.fueledAugmenters || 0;
    tasks.push({
      id: 'alien-power-augmenter',
      title: `Build ${count} Alien Power Augmenter${count > 1 ? 's' : ''}`,
      body: `${augmenterResearch(context)}, then build ${count} Augmenter${count > 1 ? 's' : ''} at ${formatNumber(10)} Somersloops each — ${formatNumber(10 * count)} in total, and they are not recoverable. Each one generates 500 MW by itself and raises the whole connected grid's base production, so keep ${count > 1 ? 'them' : 'it'} on the main grid rather than an island. ${fueled ? `Feed ${fueled} of them ${formatNumber(5 * fueled)} Alien Power Matrix/min in total (5/min each) to take ${fueled > 1 ? 'those' : 'that one'} from a 10% to a 30% boost; the fuel line is in this phase's factory plan. An augmenter that runs dry falls back to 10%.` : 'Left unfueled each gives 10%. Feeding one 5 Alien Power Matrix/min raises it to 30%, which is worth doing only once your base production is large enough to repay the fuel line.'}`,
    });
  }
  return tasks;
}

// The somersloops reserved for hand-fed constructors, shown only in the profile's starting phase.
function sloopTasks({ plan, stage }: GuideContext): GuideTask[] {
  const reserved = plan.settings.sloopReserved || [];
  if (!(stage === Number(plan.settings.phase || 1) && reserved.length)) return [];
  const labels: Record<string, string> = {
    shards:
      'a Constructor making Power Shards from power slugs — the world holds a fixed number of slugs, so an amplified Constructor is the difference between 2,650 and 5,301 shards for the whole save',
    dna: 'a Constructor chain turning creature remains into Alien Protein and then Alien DNA Capsules, doubling what finite remains are worth',
    biofuel:
      'a Constructor making Solid Biofuel from biomass, doubling what each trip of gathered leaves and wood is worth',
  };
  const picked = reserved.map(id => labels[id]).filter(Boolean);
  return [
    {
      id: 'sloop-hand-fed',
      title: 'Park somersloops in the hand-fed constructors',
      body: `Reserve ${formatNumber(picked.length)} Somersloop${picked.length > 1 ? 's' : ''} for ${picked.join('; ')}. Insert the Somersloop in the Constructor, not the Crafting Bench: hand-crafting cannot be amplified, so anything you craft by hand is worth half. These lines are fed by hand and are deliberately left out of the continuous production balance — they reserve a somersloop and nothing else.`,
    },
  ];
}

// From Phase 4, when the profile runs drones: their protected fuel supply.
function droneFuelTasks({ plan, stage, stageOf }: GuideContext): GuideTask[] {
  if (!(stage >= 4 && plan.settings.droneFuel && plan.settings.droneFuel !== 'none')) return [];
  const fuel = Object.entries(stageOf(stage)?.drone || {})
    .map(([item, quantity]) => formatNumber(quantity) + ' ' + item + '/min')
    .join(', ');
  return [
    {
      id: 'drone-fuel-' + stage,
      title: 'Unlock Aeronautical Engineering and commission drone fuel',
      body: `Complete Tier 8 Aeronautical Engineering (see milestone materials), then build and buffer the dedicated ${fuel} supply before launching routes. ${stage === 4 && plan.settings.droneFuel === 'Packaged Ionized Fuel' ? 'Use batteries now; upgrade to packaged ionized fuel after its Phase 5 unlocks. ' : ''}Route this protected supply to a fuel depot before general storage or sinking. Packaging inputs are included in the factory plan. Measure total fleet consumption at the ports, including fuel-delivery flights, and increase the supply target if necessary. Drone-port electricity shares the ${plan.settings.utilityPercent ?? 20}% utilities allowance with trains, miners and pumps; fuel production power is already calculated. Fuel rods belong at the dedicated fuel depot, outside general storage.`,
    },
  ];
}

// Phase 1 only: the starter base, which phaseSteps spreads around the power and milestone
// steps.
export function baseTasks({ stage }: GuideContext): GuideTask[] {
  if (stage !== 1) return [];
  return [
    {
      id: 'early-base-hub',
      title: 'Finish the HUB tutorial and establish a small powered base',
      body: 'Gather enough iron, copper, limestone, leaves and wood to finish HUB Upgrades 1–6. Use Portable Miners and handcraft the first building materials. Start the HUB burners and one small smelting line before connecting more machines. Leave space for a construction-stock area, separate fuel inputs and later expansion.',
    },
    {
      id: 'early-base-iron',
      title: 'Secure iron plates and rods for construction',
      body: 'Build a Miner and Smelters, then separate plate and rod Constructors with their own storage containers. A useful starter target is 20 Iron Plates/min plus 15 Iron Rods/min: 45 Iron Ingots/min from 45 ore/min using the standard recipes. Use two Smelters (one at 100%, one at 50%) and one Constructor for each part. Before clock control is researched, use full-clock capacity with limited inputs; output will be intermittent. Keep these supplies available for machines, belts and power poles.',
    },
    {
      id: 'early-base-concrete',
      title: 'Keep concrete available for foundations',
      body: 'Start with one Concrete Constructor: 45 Limestone/min → 15 Concrete/min. Expand to two for 90 Limestone/min → 30 Concrete/min when extraction and power permit. Give concrete its own container beside the building-material supplies. Check node/miner throughput before adding the second Constructor.',
    },
    {
      id: 'early-base-copper',
      title: 'Build separate wire and cable reserves',
      body: 'Using standard recipes, one Copper Smelter supplies 30 ingots/min to two Wire Constructors, producing 60 Wire/min. Reserve 30 Wire/min for building and feed the other 30 into one Cable Constructor at 50%, producing 15 Cable/min. Before clock control, limit its input instead. Store wire and cable separately; do not consume the whole wire output in cable production.',
    },
    {
      id: 'early-base-logistics',
      title: 'Organize a construction-stock area and simple production lanes',
      body: 'Prioritize Tier 1 Logistics for splitters and mergers, then Base Building for foundations. Put labelled containers for plates, rods, concrete, wire and cable near the HUB. Keep fuel and construction supplies separate from elevator feeds. Reserve walking space and straight belt routes; Mk.1 belts carry 60/min. This is a practical starter base, not the final storage hall.',
    },
    {
      id: 'early-base-components',
      title: 'Add screws, reinforced plates and rotors as unlock supplies',
      body: 'Feed a dedicated screw line from rods: 10 Rods/min → 40 Screws/min per Constructor. Use these and plate stock for starter reinforced plates; after Part Assembly, automate reinforced plates and rotors in Assemblers. Check the selected recipe before sizing supply. Reserve batches for miners, Assemblers, Mk.2 belts and the next milestones before sending surplus to Smart Plating.',
    },
    {
      id: 'early-base-reserves',
      title: 'Protect building stock before scaling elevator production',
      body: 'Keep at least one clearly labelled container per construction material, then add a separate elevator branch. If stock falls, pause or reduce elevator feed and refill it. Early splitters do not provide priority by themselves: use separate production or controlled feeds until Smart Splitters are unlocked in the Caterium MAM tree. These starter rates and milestone batches are guidance, not extra outputs included in the profile’s steady-state resource budget.',
    },
  ];
}

// The lines retireTasks below retires in phase `stage` (2-5), most machines first: the ones the
// phase before ran (from the start phase on) that neither this phase nor a later one builds,
// leaving out a generator line whose building's generators this phase keeps. The build plan's
// handover summary counts them too, and the Factories page lists them under each factory by the
// row's id (app/handover.ts, #1069).
export interface RetiredLine {
  id: string;
  name: string;
  machine: string;
  machines: number;
  onSite?: CalcRow['onSite'];
}
export function retiredLines(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages'>,
  stage: number,
): RetiredLine[] {
  const stageOf = (phaseNumber: number): StoredStage | undefined =>
    plan.stages[String(phaseNumber) as StageKey];
  const start = Number(plan.settings.phase || 1),
    previous = stage - 1,
    retired = new Map<string, RetiredLine>();
  const kept = new Set(
    (stageOf(stage)?.grid?.generators || [])
      .filter(entry => entry.kept > 0)
      .map(entry => entry.machine),
  );
  if (previous >= start)
    for (const row of stageOf(previous)?.rows || [])
      if (!(row.power < 0 && kept.has(row.machine)))
        retired.set(row.id, {
          id: row.id,
          name: row.name,
          machine: row.machine,
          machines: row.machines,
          ...(row.onSite ? { onSite: row.onSite } : {}),
        });
  for (let later = stage; later <= 5; later++)
    for (const row of stageOf(later)?.rows || []) retired.delete(row.id);
  return [...retired.values()].sort((a, b) => b.machines - a.machines);
}

// A retired line as the retire step and the Factories page's handover name it: "2 × Wire
// (Constructor)".
export const retiredLineText = (line: RetiredLine): string =>
  `${formatNumber(line.machines)} × ${line.name} (${line.machine})`;

// Lines an earlier phase built that this phase's plan drops. Its resource and power budgets do
// not include them, and a replacement is usually a different machine rather than an upgrade in
// place, so say what becomes of them. Only what the previous phase ran: each line is retired
// once, in the phase straight after the last one that needed it. A generator line is not
// retired where this phase keeps its building's generators (#1064, the stage's grid): they burn
// this phase's fuel instead, as "Power available now" says.
export function retireTasks({ plan, stage }: GuideContext): GuideTask[] {
  const previous = stage - 1;
  const all = retiredLines(plan, stage),
    listed = all.slice(0, 10),
    rest = all.length - listed.length;
  if (!listed.length) return [];
  return [
    {
      id: 'retire-' + stage,
      title: 'Retire the lines this phase no longer uses',
      body: `Phase ${stage} does not run ${listed.map(retiredLineText).join('; ')}${rest ? ` and ${rest} more line${rest > 1 ? 's' : ''}` : ''}, all last needed in Phase ${previous}. Its resource and power budgets do not include them. Commission and prove the replacement chain first: a replacement is usually a different machine, so expect to dismantle or repurpose rather than upgrade in place. Leaving them running is not harmful where ore and power are spare — the output reaches storage and then the sink — but it is production this phase does not count.`,
    },
  ];
}
