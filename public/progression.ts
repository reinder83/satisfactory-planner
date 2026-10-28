import type {
  CalcRow,
  Progression,
  ProgressionEntry,
  StageKey,
  StoredCalculatedPlan,
  StoredStage,
} from './types/index.ts';
import { listNames, slug } from './wording.ts';
import { AMPLIFIER_RESEARCH, handFedPhase } from './somersloops.ts';
import {
  BELT_MARKS,
  driveCapWords,
  MINER_MARKS,
  OVERCLOCK_RESEARCH,
  phaseForTier,
  PIPE_MARKS,
  SHARD_RECIPE_RESEARCH,
} from './preferences.ts';
import { gameShards } from './shards.ts';
import {
  miningBuildings,
  miningStep,
  newNodeWords,
  nodeUpgrades,
  rateWords,
  shardNeeds,
  tappedWords,
} from './mining.ts';
import type { PhaseUpgrade } from './mining.ts';
import type { StepList, StepTable } from './step-table.ts';
import { AUGMENTER_RESEARCH, powerStartupCount, powerTasks, startPhase } from './power-steps.ts';
export { builtSoAdd, powerTasks } from './power-steps.ts';

// A generated guidance step: its checklist key, title and text. `optional` marks a step the phase
// can do without (#1070: research only a later phase needs, a storage-only line), which "Required
// steps only" hides. `satisfied` is set while the step's own condition holds (the hard-drive step
// with no recipe left to unlock, the delivery with every counter at its target): the build plan
// then shows it done, says why, and writes no tick. `table` and `list` (#1136, step-table.ts) are
// a step's text as a table or a list, which the build plan draws in place of `body`; `body` keeps
// the same words for search, copying and step edits.
export interface GuideTask {
  id: string;
  title: string;
  body: string;
  optional?: boolean;
  satisfied?: string;
  table?: StepTable;
  list?: StepList;
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
// Whether a row is an amplified twin: the planner marks it `amplified`; its id says so too.
export const isAmplified = (row: Pick<CalcRow, 'id' | 'amplified'>): boolean =>
  !!row.amplified || row.id.startsWith(AMPLIFIED_ID);

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
  // The same cost as rows of its step's table (#1136): each item, its amount and its supply.
  costRows: (entry: ProgressionEntry) => string[][];
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
// unlock it asks for, the Power Shards research where a profile made for a later phase first taps
// its nodes overclocked (#1169, shardResearchTask), the upgrade of the nodes the previous phase
// tapped before tapping more (#1169, upgradeTask), mining, hard drives, one step per production
// row (generators first,
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
    // The Power Shards research before the first nodes tapped overclocked (#1169).
    ...(phase === 'post' ? [] : shardResearchTask(plan, state, data, stage)),
    // The nodes already tapped upgraded before tapping more (#1169).
    ...(phase === 'post' ? [] : upgradeTask(plan, state, data, stage)),
    ...miningTask(plan, stage, phase !== 'post'),
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
// its draw needs, best nodes first, as text and as a table (miningStep in mining.ts, #1136). Its
// key is `mining-<stage>`;
// a plan without mining per phase has no such step, so its build plan is as it was.
// After an upgrade step (`upgraded`, not Post Phase 5's copy of Phase 5's step) it also says
// which of each upgraded resource's nodes are new (phaseUpgrade).
function miningTask(
  plan: Pick<StoredCalculatedPlan, 'stages'> & { settings?: StoredCalculatedPlan['settings'] },
  stage: StageKey,
  upgraded = false,
): GuideTask[] {
  const upgrade =
    upgraded && plan.settings
      ? phaseUpgrade({ settings: plan.settings, stages: plan.stages }, stage)
      : null;
  const step = miningStep(plan.stages[stage], stage, plan.settings, upgrade);
  return step ? [{ id: 'mining-' + stage, title: 'Tap the resource nodes', ...step }] : [];
}

// The upgrade of the nodes the previous phase tapped (nodeUpgrades in mining.ts, #1169), for a
// planned phase after another planned one; null otherwise, and where no resource needs one.
export function phaseUpgrade(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages'>,
  stage: StageKey,
): PhaseUpgrade | null {
  const phase = Number(stage),
    start = Number(plan.settings.phase || 1);
  if (!(phase - 1 >= start)) return null;
  return nodeUpgrades(plan.stages[String(phase - 1) as StageKey], plan.stages[stage], phase);
}

// "Logistics Mk.5 (Tier 7)": the milestone that unlocks a mark, as its step names it; '' when
// progression.json has none.
function markMilestone(id: string | null | undefined, data: Progression): string {
  const entry = id ? data.entries.find(each => each.id === id) : undefined;
  return entry ? ` (milestone ${entry.name}, Tier ${entry.tier})` : '';
}

// Upgrade before expanding (#1169, the owner: "upgrade the belts / miners before placing more
// miners"): in a planned phase after another planned one, when its draw of a resource needs more
// than the nodes the previous phase tapped give at that phase's cap, and this phase's belt, miner,
// pipe or clock raises what those nodes give (phaseUpgrade), this step comes before "Tap the
// resource nodes": it names each upgrade with its milestone (listed earlier in the phase) and,
// per resource, what the tapped nodes give before and after, and how many new nodes are left to
// tap, against how many the draw would take without it. The stored stages are read as they are,
// so a stored plan keeps its numbers: its later phase's node count already counts the tapped
// nodes at that phase's cap (best nodes first, nodeUpgrades). Its key is `upgrade-nodes-<stage>`;
// it shows as done while a later phase is worked on, and ticking it by hand also works.
function upgradeTask(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages'>,
  state: GuideState,
  data: Progression,
  stage: StageKey,
): GuideTask[] {
  const upgrade = phaseUpgrade(plan, stage);
  if (!upgrade) return [];
  const { belt, pipe, miner, clock, previous } = upgrade;
  const beltMark = BELT_MARKS.find(mark => mark.mark === belt?.to),
    pipeMark = PIPE_MARKS.find(mark => mark.mark === pipe?.to),
    minerMark = MINER_MARKS.find(mark => mark.mark === miner?.to);
  const percent = (value: number) => `${formatNumber(value * 100)}%`;
  const actions = [
    ...(belt
      ? [
          `replace their ${belt.from} belts with ${beltMark?.building ?? `Conveyor Belt ${belt.to}`}${markMilestone(beltMark?.entry, data)}`,
        ]
      : []),
    ...(miner
      ? [
          `replace their Miner Mk.${miner.from} with Miner Mk.${miner.to}${markMilestone(minerMark?.entry, data)}`,
        ]
      : []),
    ...(pipe
      ? [
          `replace their ${pipe.from} pipes with ${pipeMark?.building ?? `Pipeline ${pipe.to}`}${markMilestone(pipeMark?.entry, data)}`,
        ]
      : []),
    ...(clock
      ? [
          `overclock them from up to ${percent(clock.from)} to up to ${percent(clock.to)} with Power Shards`,
        ]
      : []),
  ];
  const marks = [
    ...(belt ? [`the belts to ${belt.to}`] : []),
    ...(miner ? [`the miners to Mk.${miner.to}`] : []),
    ...(pipe ? [`the pipes to ${pipe.to}`] : []),
  ];
  const title = marks.length
    ? `Upgrade ${listNames(marks)} before tapping more nodes`
    : 'Overclock the tapped nodes before tapping more';
  const newCount = (own: PhaseUpgrade['resources'][number]) =>
    own.without !== null && own.without > own.added
      ? `${newNodeWords(own.added)} (${formatNumber(own.without)} without the upgrade)`
      : newNodeWords(own.added);
  const tappedCount = (own: PhaseUpgrade['resources'][number]) =>
    own.tapped.reduce((sum, [, count]) => sum + count, 0);
  const resources = upgrade.resources.map(
    own =>
      `${own.resource}: the ${tappedWords(own.tapped)} ${tappedCount(own) === 1 ? 'node gives' : 'nodes give'} up to ${rateWords(own.after, own.fluid)} instead of ${rateWords(own.before, own.fluid)}, ${rateWords(own.after - own.before, own.fluid)} more; Phase ${stage} draws ${rateWords(own.rate, own.fluid)}, so ${newCount(own)}.`,
  );
  const intro = `Phase ${stage} draws more than the nodes Phase ${previous} tapped give at their cap. Upgrade those nodes first, before tapping more: ${listNames(actions)}.`;
  const after = 'Then tap only the new nodes the next step lists.';
  return [
    {
      id: 'upgrade-nodes-' + stage,
      title,
      body: [intro, ...resources, after].join(' '),
      table: {
        intro,
        caption: `Phase ${previous}'s nodes upgraded in Phase ${stage}`,
        columns: [
          'Resource',
          'Tapped nodes',
          'Now',
          'Upgraded',
          `Phase ${stage} draws`,
          'New nodes',
        ],
        rows: upgrade.resources.map(own => [
          own.resource,
          tappedWords(own.tapped),
          rateWords(own.before, own.fluid),
          `${rateWords(own.after, own.fluid)} (+${formatNumber(own.after - own.before)})`,
          rateWords(own.rate, own.fluid),
          own.without !== null && own.without > own.added
            ? `${formatNumber(own.added)} (${formatNumber(own.without)} without the upgrade)`
            : formatNumber(own.added),
        ]),
        after,
      },
      ...(workingPhase(state) > Number(stage) ? { satisfied: LATER_PHASE } : {}),
    },
  ];
}

// The Power Shards research before tapping the nodes (#1169): from Phase 2 the plan taps each node
// overclocked, up to what its belt or pipe carries (PHASE_CLOCK), so the MAM's Blue Power Slugs and
// Overclock Production come first. Those research steps are listed in their own phase, Phase 1
// (milestonesListedIn): before every later phase's nodes in a profile made for Phase 1, but in a
// milestone-only phase before the start phase of a profile made for a later one. Such a profile
// gets this step right before the mining step of its first planned phase whose nodes take Power
// Shards (shardNeeds), once. Its key is `power-shards-<stage>`. It shows as done while Overclock
// Production is ticked, the player can overclock (settings.overclock, "I can overclock"), or the
// phase worked on is later; ticking it by hand also works. A plan without mining per phase, and a
// phase whose stage was stored at 100% before #1169, have no such step, unless the phase runs
// production lines overclocked with Power Shards (#1239, settings.lineClocks: rows with `shards`),
// which need the same research: the step then comes before the first such phase too, and says
// what those lines hold. Nothing changes for a plan without them.
const lineShardNeeds = (stage: Pick<StoredStage, 'rows'> | undefined) => {
  const rows = (stage?.rows ?? []).filter(row => (row.shards ?? 0) > 0);
  // A line is its recipe's plain row, its amplified twin (somersloops) and its factories' own
  // lines: one, however many rows it takes (recipeIdOf).
  const lines = new Set(rows.map(recipeIdOf));
  return rows.length
    ? { lines: lines.size, shards: rows.reduce((sum, row) => sum + gameShards(row), 0) }
    : null;
};
function shardResearchTask(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages'>,
  state: GuideState,
  data: Progression,
  stage: StageKey,
): GuideTask[] {
  const research = data.entries.find(entry => entry.id === OVERCLOCK_RESEARCH),
    recipe = data.entries.find(entry => entry.id === SHARD_RECIPE_RESEARCH);
  const start = Number(plan.settings.phase || 1);
  if (!research || !recipe || !(milestonePhase(research, data) < start)) return [];
  const first = (['2', '3', '4', '5'] as const).find(
    key =>
      Number(key) >= start &&
      (shardNeeds(plan.stages[key], key, plan.settings) || lineShardNeeds(plan.stages[key])),
  );
  if (first !== stage) return [];
  const needs = shardNeeds(plan.stages[stage], stage, plan.settings);
  const lines = lineShardNeeds(plan.stages[stage]);
  const shardCount = (count: number) =>
    `${formatNumber(count)} Power Shard${count === 1 ? '' : 's'}`;
  const saving =
    needs?.at100 === null
      ? ', more than its nodes could give at 100%'
      : needs && needs.at100 > needs.machines
        ? `, where 100% would take ${formatNumber(needs.at100)} machines`
        : '';
  const nodes = needs
    ? `Phase ${stage} taps its nodes overclocked, each up to what its belt or pipe carries, so fewer nodes give the same ore: its miners and extractors take ${formatNumber(needs.machines)} machines and ${shardCount(needs.shards)}${saving}.`
    : '';
  const overclocked = lines
    ? `${needs ? 'It also runs' : `Phase ${stage} runs`} ${lines.lines === 1 ? 'a production line' : `${formatNumber(lines.lines)} production lines`} overclocked at the clock you pinned, whose machines hold ${shardCount(lines.shards)}.`
    : '';
  const cost = Object.entries(research.cost)
    .map(([item, amount]) => `${formatNumber(amount)} ${item}`)
    .join(', ');
  const listed = milestonePhase(research, data);
  const done =
    state.checks['unlock-' + OVERCLOCK_RESEARCH] === true
      ? `Done: ${research.name} is ticked.`
      : plan.settings.overclock
        ? 'Done: you can overclock (“I can overclock” in your settings).'
        : workingPhase(state) > Number(stage)
          ? LATER_PHASE
          : '';
  return [
    {
      id: 'power-shards-' + stage,
      title: needs
        ? 'Research Power Shards before tapping the nodes'
        : 'Research Power Shards before building the overclocked lines',
      body: `${[nodes, overclocked].filter(Boolean).join(' ')} Research Power Shards in the MAM first: find a Blue Power Slug and research ${recipe.name}, which unlocks the Power Shard recipe; make a Power Shard from the slug in a Constructor; then research ${research.name} (${cost}), which lets machines take them. A Blue Power Slug makes 1 Power Shard, a Yellow one 2 and a Purple one 5, each after its own research. Both research steps are also listed under Phase ${listed}; ticking ${research.name} there, or “I can overclock” in Edit settings, marks this step done.`,
      ...(done ? { satisfied: done } : {}),
    },
  ];
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
    costRows: entry =>
      Object.entries(entry.cost).map(([item, quantity]) => [
        item,
        formatNumber(quantity),
        capital(status(item)),
      ]),
  };
}

// A sentence's words with a capital first letter, for a table cell.
export const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

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
  // Amplified lines take somersloops only once the MAM's Production Amplifier is researched
  // (#1056); their rows have no recipe of their own to bring it in. A plan stored before the
  // planner waited for it may amplify in Phases 1-2, where the research cannot be listed yet.
  if (rows.some(isAmplified)) add(byName(AMPLIFIER_RESEARCH));
  // So do the hand-fed constructors' somersloops (#1150), from the phase that lists their step on.
  if (plan.settings.sloopReserved?.length && stage >= handFedPhase(startPhase(context)))
    add(byName(AMPLIFIER_RESEARCH));
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
    const note = `Optional in this phase: none of its lines needs it${later ? `; Phase ${later}’s lines do` : ''}. Research it now if the materials are at hand, or later. `;
    return {
      ...task,
      title: task.title + ' (optional)',
      body: note + task.body,
      // Its cost table (#1136) says so too, above the cost.
      ...(task.table ? { table: { ...task.table, intro: note + task.table.intro } } : {}),
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
  const { data, stage, sources, funding, costRows } = context;
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
  return prerequisitesFirst(milestones).map((entry): GuideTask => {
    const title = `${entry.mam ? 'MAM' : 'Tier ' + entry.tier}: ${entry.name}`;
    const lead = `${entry.mam ? 'Follow this MAM branch and complete its parent research nodes first.' : 'Unlock at the HUB before using its machines or recipes.'} ${listedNames(entry.requires, data, 'Prerequisites')}Cost (base game; adjust if your milestone-cost settings differ):`;
    const rows = costRows(entry);
    return {
      id: 'unlock-' + entry.id,
      title,
      body: `${lead} ${funding(entry) || 'No item cost listed'}. ${CHECKMARKS}`,
      // The cost as a table (#1136): one row per item with its amount and supply.
      ...(rows.length
        ? {
            table: {
              intro: lead,
              columns: ['Item', 'Amount', 'Supply'],
              rows,
              after: CHECKMARKS,
              caption: `Cost of ${title}`,
            },
          }
        : {}),
    };
  });
}

// The last sentence of a milestone step.
const CHECKMARKS = 'Production checkmarks do not confirm inventory or spare capacity.';

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
  const { checks, data, stage, rows, plan } = context;
  const earlier = earlierAlternates(context);
  // The plan's cap on hard drives (#1233), which picked the alternates its lines use.
  const capped = driveCapWords(plan.settings?.driveCap);
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
      body: `${missing.length} selected recipe unlocks remain unconfirmed. Complete Field Research and build the MAM. Take materials and portable power for crash sites, collect hard drives, and run 10-minute scans while building. Choices are random: this is not a guaranteed drive count. Finish each recipe’s prerequisite milestones/research first.${capped ? ` Your cap on hard drives holds the whole plan to ${capped} beyond the ones you own, and these steps stay within it.` : ''}`,
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
  const budgets = 'Its resource and power budgets do not include them.';
  const advice =
    'Commission and prove the replacement chain first: a replacement is usually a different machine, so expect to dismantle or repurpose rather than upgrade in place. Leaving them running is not harmful where ore and power are spare — the output reaches storage and then the sink — but it is production this phase does not count.';
  return [
    {
      id: 'retire-' + stage,
      title: 'Retire the lines this phase no longer uses',
      body: `Phase ${stage} does not run ${listed.map(retiredLineText).join('; ')}${rest ? ` and ${rest} more line${rest > 1 ? 's' : ''}` : ''}, all last needed in Phase ${previous}. ${budgets} ${advice}`,
      // The retired lines as a table (#1136): every one of them, the body's ten and the rest, each
      // with its machine and how many, most machines first, as the body lists them.
      table: {
        intro: `Phase ${stage} does not run ${all.length === 1 ? 'this line' : 'these ' + formatNumber(all.length) + ' lines'}, all last needed in Phase ${previous}. ${budgets}`,
        columns: ['Line', 'Machine', 'Machines'],
        rows: all.map(line => [line.name, line.machine, formatNumber(line.machines)]),
        after: advice,
        caption: `Lines Phase ${stage} retires`,
      },
    },
  ];
}
