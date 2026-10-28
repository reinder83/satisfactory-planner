// The build plan's power, fuel and endgame steps of a phase (powerTasks), which phaseSteps in
// progression.ts lists with the milestone and production steps. Re-exported by progression.ts.
import type { CalcRow, GridGenerator, StoredStage } from './types/index.ts';
import { durationOfHours, listNames, powerAmount } from './wording.ts';
import { AMPLIFIER_WORDS, handFedPhase } from './somersloops.ts';
import { ownedBeyondKept, powerView } from './power.ts';
import { BURNER_FUELS, BURNER_MW, miningLinearMW, OWNED_GENERATORS } from './preferences.ts';
import { waterPowerWords } from './mining.ts';
import type { StepTable } from './step-table.ts';
import { capital, formatNumber, milestonePhase } from './progression.ts';
import type { GuideContext, GuideTask } from './progression.ts';

// The power unlocks the user has ticked. Without spare existing power in the settings the power
// advice follows these, never advising a source below the one the phase plans (#1048).
interface UnlockedPower {
  coal: boolean;
  petroleum: boolean;
  nuclear: boolean;
  solid: boolean;
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
export const powerStartupCount = (context: GuideContext): number =>
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
// the phase does not fuel, which it does not count (ownedPowerText). Last, which option of Water
// Extractors its power counts (#1142). With spare power, the phase's power balance is also a table
// (#1136, powerBalance): what supplies it and what it needs, part by part.
function powerReviewTask(context: GuideContext, unlocked: UnlockedPower): GuideTask {
  const figures = phasePower(context);
  const tail = unfueledOwnedText(context, figures) + waterPowerText(context, figures);
  const existing = figures.existingMW + figures.augmenterMW > 0 && context.stage >= 2;
  return {
    id: 'startup-' + context.stage + '-power-review',
    title: 'Power available now',
    body:
      (existing
        ? existingPowerText(context, figures, unlocked)
        : unlockText(context, figures, unlocked) + ownedCountText(figures)) + tail,
    ...(existing ? { table: powerBalance(context, figures, unlocked, tail) } : {}),
  };
}

// Which Water Extractor option the phase's power counts, the suggested one, and the other one
// (#1142, waterPowerWords in mining.ts), on a plan whose power is modelled; '' otherwise.
function waterPowerText({ plan, stage, stageOf }: GuideContext, { modelled }: PhasePowerFigures) {
  return modelled ? waterPowerWords(stageOf(stage), stage, plan.settings) : '';
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
const SOURCE_ORDER = ['nuclear', 'ionized fuel', 'rocket fuel', 'turbofuel', 'fuel', 'coal'];
const POWER_UNLOCKS = ['Coal Power', 'Petroleum Power', 'Nuclear Power'] as const;
const SOURCE_UNLOCK: Record<string, (typeof POWER_UNLOCKS)[number]> = {
  coal: 'Coal Power',
  fuel: 'Petroleum Power',
  turbofuel: 'Petroleum Power',
  'rocket fuel': 'Petroleum Power',
  'ionized fuel': 'Petroleum Power',
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
  const { requiredMW, augmenterMW, generators } = figures;
  const { haveMW, have, unlockFirst, check } = existingPowerWords(figures, unlocked);
  const allowance = figures.need.words;
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

// The pieces existingPowerText and powerBalance share: what the phase has before any new
// generation (the spare power and what the augmenters add) in MW and in words, the unlocks to
// tick first, and the closing checks (the peak note, the allowance's setting, the load check).
function existingPowerWords(figures: PhasePowerFigures, unlocked: UnlockedPower) {
  const { existingMW, augmenters, augmenterMW, generators } = figures;
  const yours = `your ${augmenters === 1 ? 'augmenter adds' : formatNumber(augmenters) + ' augmenters add'} ${powerAmount(augmenterMW)}`;
  const have =
    augmenterMW <= 0.01
      ? `You have ${powerAmount(existingMW)} of spare power available`
      : existingMW <= 0.01
        ? `Your Alien Power ${augmenters === 1 ? 'Augmenter adds' : 'Augmenters add'} ${powerAmount(augmenterMW)}`
        : `You have ${powerAmount(existingMW)} of spare power available, and ${yours}`;
  const unlock = missingUnlocks(generators, unlocked);
  return {
    haveMW: existingMW + augmenterMW,
    have,
    unlockFirst: unlock.length ? ` Unlock ${listNames(unlock)} first.` : '',
    check:
      (figures.need.peak ? ' ' + figures.need.peak : '') +
      ` The ${figures.need.percent}% for trains, drones and pumps is ${figures.need.setting} in Preferences: raise it with Edit settings for more margin.` +
      ' Before connecting the next factory, check the actual load against what your grid supplies.',
  };
}

// The names of Power needed's parts in the power balance (#1136), by NeedPart key (power.ts).
const NEED_NAMES: Record<string, string> = {
  load: 'Production lines',
  extraction: 'Miners and extractors',
  peak: 'Production lines',
  utility: 'Trains, drones and pumps',
};

// "Power available now" with spare power as a table (#1136): the phase's power balance, one row
// per supply (the spare power, the augmenters, the new generators) and per part of what it needs,
// a total row with what is left over, the opening sentence above it and the checks under it. The
// same figures and words as existingPowerText, which stays the step's body.
function powerBalance(
  { plan }: GuideContext,
  figures: PhasePowerFigures,
  unlocked: UnlockedPower,
  tail: string,
): StepTable {
  const { requiredMW, existingMW, augmenters, augmenterMW, newMW, leftMW, generators } = figures;
  const { haveMW, have, unlockFirst, check } = existingPowerWords(figures, unlocked);
  const covered = requiredMW - haveMW <= 0.01;
  const sources = listNames(plannedSources(generators));
  const intro = covered
    ? `${have}, which ${augmenterMW > 0.01 ? 'cover' : 'covers'} this phase's ${powerAmount(requiredMW)}: ` +
      (generators.length
        ? `nothing needs building for that. The plan still builds its ${sources} power.`
        : 'nothing needs building for power in this phase.')
    : `${have}. This phase needs ${powerAmount(requiredMW - haveMW)} more` +
      (generators.length
        ? `: build its ${sources} power.`
        : ', and its plan builds no generators for it: see the power headroom on the Resources page.');
  const rows: string[][] = [];
  if (existingMW > 0.01) rows.push(['Spare power', powerAmount(existingMW), '', '']);
  if (augmenterMW > 0.01)
    rows.push([
      'Augmenters',
      powerAmount(augmenterMW),
      '',
      `${formatNumber(augmenters)} Alien Power Augmenter${augmenters === 1 ? '' : 's'}`,
    ]);
  for (const part of figures.need.parts)
    rows.push([
      NEED_NAMES[part.key] ?? part.key,
      '',
      powerAmount(part.mw),
      part.key === 'utility'
        ? `${figures.need.percent}%, ${figures.need.setting} in Preferences`
        : part.key === 'peak'
          ? 'At their whole-machine peak'
          : '',
    ]);
  // Where the spare power covers the phase, all the new generation is left over, and its row says
  // why, as the body does; otherwise the total does, for what is left.
  if (generators.length) {
    const lines = generators.map(
      row => `${formatNumber(row.machines)} × ${row.name} (${row.machine})`,
    );
    rows.push([
      'New generators',
      powerAmount(newMW),
      '',
      listNames(lines) +
        keptText(figures) +
        (covered ? `, which adds ${powerAmount(newMW)}${spareCause(plan, figures, newMW)}` : ''),
    ]);
  }
  const cause = covered ? '' : spareCause(plan, figures, leftMW);
  const left =
    leftMW > 0.01
      ? `${powerAmount(leftMW)} spare${cause}`
      : leftMW < -0.01
        ? `${powerAmount(-leftMW)} short of the need: see the power headroom on the Resources page`
        : '';
  return {
    intro,
    columns: ['Power', 'Supplies', 'Needs', 'Details'],
    rows,
    total: [
      'Total',
      powerAmount(haveMW + (generators.length ? newMW : 0)),
      powerAmount(requiredMW),
      left,
    ],
    after: (unlockFirst + check + tail).trim(),
    caption: "This phase's power: what supplies it and what it needs",
  };
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
export const startPhase = ({ plan }: GuideContext): number => Number(plan.settings.phase || 1);

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
  { coal, petroleum, nuclear, solid }: UnlockedPower,
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
  const sizing = `Standalone Biomass Burners provide 30 MW each; HUB burners provide 20 MW each. Ignoring any HUB capacity not entered as spare power, allow about ${formatNumber(burners)} standalone burners for ${formatNumber(need)} MW of planned additional load plus three fuel-processing Constructors.${ownedBurnersText(plan.settings.ownedGenerators?.['Biomass Burner'] ?? 0, burners)} At full load each standalone burner consumes 4 Solid Biofuel/min; this bank needs up to ${formatNumber(burners * 4)}/min. One 60/min Solid Biofuel Constructor can fuel 15 such burners; a Mk.1-fed 30/min line supports 7.5 burners at full load.`;
  const estimate =
    'This is a startup estimate, not part of the continuous resource model: add processing capacity/power if needed, keep a reserve, and build gradually until coal is unlocked.';
  const fuel = burnerFuel(burners, stageOf(stage)?.hours, solid);
  return [
    ...(first ? once : []),
    {
      id: 'startup-burner-bank-' + stage,
      title: 'Size and feed the biomass burner bank',
      body: `${sizing} ${estimate} ${fuel.text}`,
      // The bank's fuel as a table (#1204): what the burners take by fuel, per minute, for the
      // phase's run time and in stacks.
      table: {
        intro: `${sizing} ${fuel.intro}`,
        columns: fuel.columns,
        rows: fuel.rows,
        after: estimate,
        caption: 'Size and feed the biomass burner bank: fuel the burners take',
      },
    },
  ];
}

// The burner bank's fuel (#1204): what `burners` standalone Biomass Burners at full load take of
// each fuel they burn by hand, per minute, for the phase's `hours` (its planned run time, the
// time to finish its deliveries) and in stacks, from BURNER_FUELS' energy and stack sizes. Each
// fuel is a whole count, rounded up. Without a run time (a phase that never finishes) the table
// is the rates alone. Display only: nothing here is saved or feeds the plan. `text` is the same in
// words, for the step's body; `solid` is whether Obstacle Clearing is ticked.
function burnerFuel(
  burners: number,
  hours: number | null | undefined,
  solid: boolean,
): { text: string; intro: string; columns: string[]; rows: string[][] } {
  const run = typeof hours === 'number' && Number.isFinite(hours) && hours > 0 ? hours : 0;
  const stacks = (items: number, stack: number) => {
    const count = Math.ceil(items / stack);
    return `${formatNumber(count)} stack${count === 1 ? '' : 's'} of ${formatNumber(stack)}`;
  };
  const details: Record<string, string> = {
    Leaves: 'Gathered by hand, burned as they are',
    Wood: 'Gathered by hand, burned as it is',
    Mycelia: 'Gathered by hand, burned as it is',
    Biomass: 'Made from Leaves, Wood or Mycelia in a Constructor',
    'Solid Biofuel': solid
      ? 'Made from Biomass; the fuel this bank is sized for'
      : 'Made from Biomass; the fuel this bank is sized for, once Obstacle Clearing is unlocked',
  };
  const figures = BURNER_FUELS.map(({ name, mj, stack }) => {
    const perMinute = Math.ceil((burners * BURNER_MW * 60) / mj - 1e-9);
    const total = run ? Math.ceil(perMinute * run * 60 - 1e-9) : 0;
    return { name, stack, perMinute, total };
  });
  const rows = figures.map(({ name, stack, perMinute, total }) => [
    name,
    `${formatNumber(perMinute)}/min`,
    ...(run ? [formatNumber(total), stacks(total, stack)] : []),
    details[name] ?? '',
  ]);
  const picks = figures.map(({ name, perMinute, total, stack }) =>
    run
      ? `${formatNumber(total)} ${name} (${stacks(total, stack)}) at ${formatNumber(perMinute)}/min`
      : `${formatNumber(perMinute)} ${name}/min`,
  );
  const when = run ? `, for the phase's planned run time of ${durationOfHours(run)}` : '';
  const lead = `Fuel for the ${formatNumber(burners)} standalone burners at full load${when}, by fuel (burn one kind, not all of them)`;
  return {
    text: `${lead}: ${picks.join('; ')}.`,
    intro: `${lead}:`,
    columns: run
      ? ['Fuel', 'Per minute', 'For the run', 'Stacks', 'Details']
      : ['Fuel', 'Per minute', 'Details'],
    rows,
  };
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
// Rocket Fuel, Ionized Fuel, as generators() in planner/recipes.ts names them), with only their unlocks (#880).
function fuelPowerBody(fuels: string[]): string {
  const research = [
    fuels.includes('Turbofuel') ? ' For turbofuel, complete its Sulfur MAM research.' : '',
    fuels.includes('Rocket Fuel')
      ? ' Rocket fuel also needs its own MAM node, nitrogen supply and Blender access.'
      : '',
    fuels.includes('Ionized Fuel')
      ? ' Ionized fuel needs its own Sulfur MAM node, a Rocket Fuel supply and Power Shards.'
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

// A generator line's power source in words, as the settings name it: coal (any Coal Generator,
// also one burning Compacted Coal or Petroleum Coke, #1055), fuel, turbofuel, rocket fuel, ionized
// fuel or nuclear (any Nuclear Power Plant).
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

// The unlocks and commissioning each power source needs before its generators run; coal's by
// the fuels its lines burn (coalPrerequisites).
const SOURCE_PREREQUISITES: Record<string, string> = {
  fuel: 'Fuel power needs Oil Processing and Petroleum Power.',
  turbofuel:
    'Turbofuel power needs Oil Processing, Petroleum Power and the Sulfur MAM Turbofuel research; use coal until they are complete, and commission all byproduct handling.',
  'ionized fuel':
    'Ionized fuel power needs Petroleum Power, its own Sulfur MAM node, a running Rocket Fuel chain and Power Shards.',
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
): Pick<GuideTask, 'title' | 'body' | 'table'> {
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
  const parts = generators.map(row => generatorParts(row, builtBefore(row), previous, rows));
  const prerequisites = sources
    .map(source =>
      source === 'coal' ? coalPrerequisites(generators) : SOURCE_PREREQUISITES[source],
    )
    .filter(Boolean);
  const own = 'Each line has its own step in this phase with its machines and output.';
  const after = `${unburnedText(unburned)} ${prerequisites.join(' ')} ${closingAdvice(verb, previous)}`;
  const title = `${verb} ${listNames(sources)} power ${verb === 'Keep' ? 'ahead of' : 'before'} the next production block`;
  return {
    title,
    body: `Phase ${stage}'s plan generates power with ${parts.map(part => part.text).join('; ')}. ${own}${after}`,
    // The generator lines as a table (#1136): each line's machines, what this phase adds to the
    // previous phase's line, and the fuel it burns with the lines that make it.
    table: {
      intro: `Phase ${stage}'s plan generates power with these lines. ${own}`,
      columns: ['Generator line', 'Machines', 'This phase', 'Fuel'],
      rows: parts.map(part => part.cells),
      after: after.trim(),
      caption: `${title}: generator lines`,
    },
  };
}

// What the phase's Coal Generator lines need before they run, by the fuels they burn (#1055): "Coal
// power needs Coal Power unlocked, coal extraction and water." for Coal alone, as before; Petroleum
// Coke needs Oil Processing, and Compacted Coal the lines that make it.
function coalPrerequisites(generators: CalcRow[]): string {
  const fuels = generators.filter(row => row.machine === 'Coal Generator').map(generatorFuel);
  const needs = [
    'Coal Power unlocked',
    ...(fuels.includes('Coal') ? ['coal extraction'] : []),
    ...(fuels.includes('Compacted Coal') ? ['a Compacted Coal supply'] : []),
    ...(fuels.includes('Petroleum Coke') ? ['Oil Processing for the Petroleum Coke'] : []),
    'water',
  ];
  return `Coal power needs ${listNames(needs)}.`;
}

// The step's closing advice, by its case (#881). Keep: no line needs more machines, so there is
// no capacity to commission and no replacement. Build and Expand commission new capacity; a
// previous plant to keep online exists only after the profile's start phase (previous is 0 there).
function closingAdvice(verb: string, previous: number): string {
  if (verb === 'Keep')
    return "No line needs more machines in this phase. Before connecting the next factory, check the actual maximum consumption, with the utility allowance, against these lines' output.";
  return `Check the actual maximum consumption with the utility allowance, and commission more capacity before connecting the next factory.${previous ? ' Keep the previous plant online until the replacement is stable.' : ''}`;
}

// How many machines of a line already stand and how many to add: "5 built in Phase 2, so add 1"
// for a generator line the phase before built (generatorParts), "5 Refineries built, so add 1" for
// a production line a recalculation grew (#1174, builtIntro in app/built-lines.ts). `what` names
// the machines, `where` says where they were built.
export const builtSoAdd = (built: number, add: number, what = '', where = ''): string =>
  `${formatNumber(built)}${what ? ' ' + what : ''} built${where}, so add ${formatNumber(add)}`;

// One generator line in the step's text: its count and name as its build step shows them, what
// it adds to the previous phase's line, and the fuel it burns with the lines that make it; and the
// same as a row of the step's table (#1136): the line, its machines, what this phase adds and the
// fuel.
function generatorParts(
  row: CalcRow,
  builtBefore: number,
  previous: number,
  rows: CalcRow[],
): { text: string; cells: string[] } {
  const fuel = generatorFuel(row);
  const makers = rows
    .filter(maker => !isGenerator(maker) && maker.outputs[fuel])
    .map(maker => maker.name);
  const added = !builtBefore
    ? 'new in this phase'
    : row.machines > builtBefore
      ? builtSoAdd(builtBefore, row.machines - builtBefore, '', ` in Phase ${previous}`)
      : `already built in Phase ${previous}`;
  const from = makers.length
    ? ` from the ${listNames(makers)} step${makers.length > 1 ? 's' : ''}`
    : '';
  const burned = fuel ? `${formatNumber(row.inputs[fuel])} ${fuel}/min${from}` : '';
  const machines = `${formatNumber(row.machines)} × ${row.machine}`;
  return {
    text: `${formatNumber(row.machines)} × ${row.name} (${row.machine}), ${added}${burned ? ', burning ' + burned : ''}`,
    cells: [row.name, machines, capital(added), burned],
  };
}

// The MAM node the Alien Power Augmenters need, by its name in progression.json
// (Research_Alien_PowerBooster_C): requiredMilestones lists it, the augmenter step names it.
export const AUGMENTER_RESEARCH = 'Power Augmenter';

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
    const build = `${augmenterResearch(context)}, then build ${count} Augmenter${count > 1 ? 's' : ''}`;
    const grid = `Each one generates 500 MW by itself and raises the whole connected grid's base production, so keep ${count > 1 ? 'them' : 'it'} on the main grid rather than an island.`;
    tasks.push({
      id: 'alien-power-augmenter',
      title: `Build ${count} Alien Power Augmenter${count > 1 ? 's' : ''}`,
      body: `${build} at ${formatNumber(10)} Somersloops each — ${formatNumber(10 * count)} in total, and they are not recoverable. ${grid} ${fueled ? `Feed ${fueled} of them ${formatNumber(5 * fueled)} Alien Power Matrix/min in total (5/min each) to take ${fueled > 1 ? 'those' : 'that one'} from a 10% to a 30% boost; the fuel line is in this phase's factory plan. An augmenter that runs dry falls back to 10%.` : 'Left unfueled each gives 10%. Feeding one 5 Alien Power Matrix/min raises it to 30%, which is worth doing only once your base production is large enough to repay the fuel line.'}`,
      table: augmenterTable(count, fueled, build, grid),
    });
  }
  return tasks;
}

// The augmenter step as a table (#1136): the fueled and the unfueled augmenters, each with their
// count, Somersloops (10 each), fuel (5 Alien Power Matrix/min each, fueled only), the grid boost
// (30% fed, 10% not) and its own power (500 MW each), and a total row; the research and build sentence above it
// and the advice under it, in the body's words.
function augmenterTable(count: number, fueled: number, build: string, grid: string): StepTable {
  const row = (name: string, n: number, fed: boolean) => [
    name,
    formatNumber(n),
    formatNumber(10 * n),
    fed ? `${formatNumber(5 * n)} Alien Power Matrix/min` : 'None',
    fed ? '30%' : '10%',
    powerAmount(500 * n),
  ];
  return {
    intro: `${build}.`,
    // Short column names, so the six columns fit the plan column at 1280 px.
    columns: ['Augmenters', 'Count', 'Somersloops', 'Fuel', 'Boost', 'Power'],
    rows: [
      ...(fueled ? [row('Fueled', fueled, true)] : []),
      ...(count > fueled ? [row('Unfueled', count - fueled, false)] : []),
    ],
    total: [
      'Total',
      formatNumber(count),
      formatNumber(10 * count),
      fueled ? `${formatNumber(5 * fueled)} Alien Power Matrix/min` : 'None',
      '',
      powerAmount(500 * count),
    ],
    after:
      `The Somersloops are not recoverable. ${grid} ` +
      (fueled
        ? "The fuel line is in this phase's factory plan. An augmenter that runs dry falls back to 10%."
        : 'Feeding one 5 Alien Power Matrix/min raises it to 30%, which is worth doing only once your base production is large enough to repay the fuel line.'),
    caption: 'Alien Power Augmenters: Somersloops, fuel, boost and power',
  };
}

// The somersloops reserved for hand-fed constructors, shown once: in the profile's starting phase,
// but not before Phase 3, since machines take somersloops only after the MAM research Production
// Amplifier (#1150, handFedPhase), which requiredMilestones then lists. The id stays
// `sloop-hand-fed` whichever phase lists it, so its tick carries.
function sloopTasks(context: GuideContext): GuideTask[] {
  const { plan, stage } = context,
    reserved = plan.settings.sloopReserved || [];
  if (!(stage === handFedPhase(startPhase(context)) && reserved.length)) return [];
  const labels: Record<string, string> = {
    shards:
      'a Constructor making Power Shards from power slugs — the world holds a fixed number of slugs, so an amplified Constructor is the difference between 2,650 and 5,301 shards for the whole save',
    dna: 'a Constructor chain turning creature remains into Alien Protein and then Alien DNA Capsules, doubling what finite remains are worth',
    biofuel:
      'a Constructor making Solid Biofuel from biomass, doubling what each trip of gathered leaves and wood is worth',
  };
  const picked = reserved.map(id => labels[id]).filter((label): label is string => !!label);
  const reserve = `Reserve ${formatNumber(picked.length)} Somersloop${picked.length > 1 ? 's' : ''}`;
  const after =
    AMPLIFIER_WORDS +
    ' Insert the Somersloop in the Constructor, not the Crafting Bench: hand-crafting cannot be amplified, so anything you craft by hand is worth half. These lines are fed by hand and are deliberately left out of the continuous production balance — they reserve a somersloop and nothing else.';
  return [
    {
      id: 'sloop-hand-fed',
      title: 'Park somersloops in the hand-fed constructors',
      body: `${reserve} for ${picked.join('; ')}. ${after}`,
      // Two or three constructors as a list (#1136), one line each.
      ...(picked.length > 1
        ? {
            list: {
              intro: `${reserve}, one for each:`,
              items: picked.map(label => capital(label) + '.'),
              after,
              label: 'The hand-fed constructors',
            },
          }
        : {}),
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
