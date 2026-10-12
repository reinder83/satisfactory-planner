// A phase's mining in words (#1065), shared by the planner's warnings, the build plan's mining
// step, the Resources and Logistics pages and the wizard, so they never word it differently. The
// arithmetic is in preferences/mining.ts; this reads a stored stage's `mining` (absent from plans
// made without mining per phase, which these helpers then leave alone).
import {
  DEFAULT_EXTRACTION,
  EXTRACTOR_MIN_RATE,
  EXTRACTOR_OPTIONS,
  OVERCLOCK,
  PHASE_CLOCK,
  WATER_EXTRACTOR,
  extractorOption,
  isWellKind,
  miningAdvice,
  phaseBelt,
  phaseMiner,
  phaseMining,
  waterClock,
} from './preferences.ts';
import { listNames, localeNumber, powerAmount } from './wording.ts';
import type {
  ItemRates,
  MiningSource,
  StageMining,
  StoredSettings,
  StoredStage,
} from './types/index.ts';
import type { MiningAdvice, MiningRun, MiningSettings } from './preferences/mining.ts';
import type { ExtractorOption } from './preferences/extraction.ts';
import type { StepTable } from './step-table.ts';

// A number as the pages show one (num in app/format.ts): locale-formatted, at most 2 decimals.
const miningNumber = (value: number) => localeNumber(value);
// A clock (1 = 100%) as a percentage to 0.01%, the game's clock input: rounded up for a solid,
// so its miners never give less than the draw, and down for a fluid, which must never overflow
// its pipe (#1024).
const clockWords = (clock: number, fluid: boolean) => {
  const hundredths = clock * 10000;
  const rounded = fluid ? Math.floor(hundredths + 1e-6) : Math.ceil(hundredths - 1e-6);
  return miningNumber(rounded / 100) + '%';
};
// The raw resources that come out of a pipe: crude oil and nitrogen gas (Water has no nodes).
const MINED_FLUIDS = ['Crude Oil', 'Nitrogen Gas'];

// A stage's budget for a raw resource: its mining's (#1065), else the settings'.
export const stageBudget = (
  stage: Pick<StoredStage, 'mining'> | undefined,
  settings: Pick<StoredSettings, 'limits'>,
  resource: string,
): number => stage?.mining?.budgets[resource] ?? settings.limits[resource] ?? 0;

// "Miner Mk.2 at 100%".
export const minerWords = ({ mark, clock }: { mark: number; clock: number }): string =>
  `Miner Mk.${mark} at ${miningNumber(clock * 100)}%`;

// "Miner Mk.2 at 100% · Mk.3 belts (270/min) · Mk.1 pipes (300 m³/min)": what a phase mines and
// carries with.
export const equipmentWords = (mining: StageMining): string =>
  `${minerWords(mining.miner)} · ${mining.belt.mark} belts (${miningNumber(mining.belt.cap)}/min) · ${mining.pipe.mark} pipes (${miningNumber(mining.pipe.cap)} m³/min)`;

// The miners of each phase from `from` to 5, consecutive phases with the same miner together:
// "Miner Mk.1 at 100% in Phase 1, Mk.2 at 100% in Phases 2 and 3 and Mk.3 at 250% in Phases 4
// and 5". `survey` is the settings' node survey, which caps each phase's, and `owned` the miner the
// player already has (settings.ownedMiner, #1068), which raises it.
export function phaseMinersWords(
  survey: MiningSettings['extraction'],
  from = 1,
  owned?: number,
  overclock?: boolean,
): string {
  const runs: { words: string; phases: number[] }[] = [];
  for (let phase = from; phase <= 5; phase++) {
    const miner = phaseMiner(phase, survey, owned, overclock);
    const words = `Mk.${miner.mark} at ${miningNumber(miner.clock * 100)}%`;
    const run = runs.at(-1);
    if (run?.words === words) run.phases.push(phase);
    else runs.push({ words, phases: [phase] });
  }
  return (
    'Miner ' +
    listNames(
      runs.map(
        run =>
          `${run.words} in Phase${run.phases.length > 1 ? 's' : ''} ${listNames(run.phases.map(String))}`,
      ),
    )
  );
}

// The belts of each phase from `from` to 5 with a belt the player already has (settings.ownedBelt,
// #1068), consecutive phases with the same belt together: "Mk.4 belts in Phases 2 and 3, Mk.5 in
// Phase 4 and Mk.6 in Phase 5, at least the Mk.4 belts you already have". Empty without one, or
// with one no phase from `from` on is raised to.
export function ownedBeltsWords(from = 1, owned?: number): string {
  const runs: { mark: string; phases: number[] }[] = [];
  let raised = false;
  for (let phase = from; phase <= 5; phase++) {
    const belt = phaseBelt(phase, owned);
    raised ||= belt !== phaseBelt(phase);
    const run = runs.at(-1);
    if (run?.mark === belt.mark) run.phases.push(phase);
    else runs.push({ mark: belt.mark, phases: [phase] });
  }
  if (!raised) return '';
  const words = runs.map(
    (run, index) =>
      `${run.mark}${index ? '' : ' belts'} in Phase${run.phases.length > 1 ? 's' : ''} ${listNames(run.phases.map(String))}`,
  );
  return `${listNames(words)}, at least the Mk.${owned} belts you already have`;
}

// How many nodes of each kind an advice taps, in words: "6 pure and 7 normal nodes",
// "12 well satellites".
function nodeCountWords(runs: MiningRun[]): string {
  const counts = new Map<string, number>();
  for (const run of runs.filter(run => !isWellKind(run.kind)))
    counts.set(run.kind, (counts.get(run.kind) ?? 0) + run.full + (run.last === null ? 0 : 1));
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (!total) return '';
  return (
    listNames([...counts].map(([kind, count]) => `${miningNumber(count)} ${kind}`)) +
    (total === 1 ? ' node' : ' nodes')
  );
}

// The clocks an advice's machines run at, whole runs merged: "12 at 100% and 1 at 41.67%".
function clockRunWords(runs: MiningRun[], fluid: boolean): string {
  const merged: { count: number; clock: string }[] = [];
  const add = (count: number, clock: string) => {
    const same = merged.find(entry => entry.clock === clock);
    if (same) same.count += count;
    else merged.push({ count, clock });
  };
  for (const run of runs.filter(run => !isWellKind(run.kind))) {
    if (run.full) add(run.full, clockWords(run.clock, fluid));
    if (run.last !== null) add(1, clockWords(run.last, fluid));
  }
  return listNames(merged.map(entry => `${miningNumber(entry.count)} at ${entry.clock}`));
}

// One way to tap a draw, in words, without the resource's name: "6 pure and 7 normal nodes with
// Miner Mk.2: 12 at 100% and 1 at 41.67%" and, for a resource well, "4 well satellites (2 pure, 2
// normal) on about 1 Resource Well Pressurizer at 85%", with the Power Shards and MW.
export function adviceWords(advice: MiningAdvice, fluid: boolean): string {
  const nodeRuns = advice.runs.filter(run => !isWellKind(run.kind)),
    wellRuns = advice.runs.filter(run => isWellKind(run.kind));
  const parts: string[] = [];
  if (nodeRuns.length)
    parts.push(
      `${nodeCountWords(nodeRuns)} with ${nodeRuns[0]!.machine === 'Oil Extractor' ? 'Oil Extractors' : nodeRuns[0]!.machine}: ${clockRunWords(nodeRuns, fluid)}`,
    );
  if (wellRuns.length) {
    const kinds = listNames(
      wellRuns.map(run => `${miningNumber(run.full)} ${run.kind.slice('well-'.length)}`),
    );
    parts.push(
      `${miningNumber(advice.satellites)} well satellite${advice.satellites === 1 ? '' : 's'} (${kinds}) on about ${miningNumber(advice.pressurizers)} Resource Well Pressurizer${advice.pressurizers === 1 ? '' : 's'} at ${clockWords(wellRuns[0]!.clock, true)}`,
    );
  }
  const shards = advice.shards
    ? `, ${miningNumber(advice.shards)} Power Shard${advice.shards === 1 ? '' : 's'}`
    : '';
  return `${parts.join(', and ')} (${powerAmount(advice.mw)}${shards})`;
}

// One raw resource's mining advice for a stage, for the pages and the build plan.
export interface ResourceMining {
  resource: string;
  rate: number;
  budget: number;
  fluid: boolean;
  // The advice at the phase's clock, which the power model counts.
  advice: MiningAdvice;
  // "Tap 6 pure and 7 normal nodes with Miner Mk.2: 12 at 100% and 1 at 41.67% (195 MW)." A
  // fluid lists its extractors at 100% and, from Phase 4, at 250% with Power Shards, as the
  // Water Extractors do (#1024).
  words: string;
}

// The clocks a phase at `clock` offers a fluid's extractors: the options (EXTRACTOR_OPTIONS) up
// to it, and the clock itself when it is neither (a survey's 150%). So Phases 1–3, at 100%,
// offer no 250% their budgets do not count on.
export const fluidClocks = (clock: number): number[] =>
  [...new Set([...EXTRACTOR_OPTIONS.filter(option => option <= clock + 1e-9), clock])].sort(
    (a, b) => a - b,
  );

// The advice for a fluid at each clock its phase offers (fluidClocks): "at 100%: …; at 250%: …",
// or only "at 100%: …" before Phase 4.
function fluidWords(rate: number, sources: MiningSource[], clock: number): string {
  return (
    fluidClocks(clock)
      .map(at => {
        const option = miningAdvice(rate, sources, at);
        const words = option.short
          ? `the nodes give only ${miningNumber(rate - option.short)} m³/min`
          : 'tap ' + adviceWords(option, true);
        return `at ${miningNumber(at * 100)}%: ${words}`;
      })
      .join('; ')
      .replace(/^a/, 'A') + '.'
  );
}

// What a stage's draw of each raw resource taps, the resources with nodes that it draws from,
// in the stage's raw order (Water has no nodes: each line that takes it says how many Water
// Extractors to build, #1024). Empty for a stage without mining per phase.
export function stageMiningAdvice(
  stage: Pick<StoredStage, 'mining' | 'raw'> | undefined,
): ResourceMining[] {
  const mining = stage?.mining;
  if (!mining) return [];
  const out: ResourceMining[] = [];
  for (const [resource, rate] of Object.entries(stage.raw || {})) {
    const sources = mining.sources[resource];
    if (!sources || !(rate > 1e-6)) continue;
    const fluid = MINED_FLUIDS.includes(resource);
    const advice = miningAdvice(rate, sources, mining.miner.clock);
    const beyond = advice.short
      ? ` That is ${miningNumber(advice.short)}${fluid ? ' m³' : ''}/min more than this phase's nodes give.`
      : '';
    out.push({
      resource,
      rate,
      budget: mining.budgets[resource] ?? 0,
      fluid,
      advice,
      words: fluid
        ? fluidWords(rate, sources, mining.miner.clock) + beyond
        : `Tap ${adviceWords(advice, false)}.${beyond}`,
    });
  }
  return out;
}

// --- Water Extractors: both options, one suggested (#1142) ---
//
// Every advice for Water Extractors gives both ways to build them (#1024): at 100%, and
// overclocked with Power Shards up to 250% (one extractor's 300 m³/min, which a Mk.1 pipe still
// carries), each with the last one underclocked to the exact remainder, never rounded up. The
// user picks; the plan only suggests one, first: the one its power counts (waterClock, which
// settings.waterOverclock sets, #1137; a stage stored before that counts its miner's clock, and a
// plan without mining per phase its survey's clock, else 250%). So a stored plan suggests what
// its numbers were calculated with until the user recalculates. Before Power Shards are
// researched (no settings.overclock, and Phases 1–3 of a plan with mining per phase) the
// overclocked option is the advice to research them instead of a count, once the MAM is usable
// (OVERCLOCK_ADVICE_FROM); before that only the 100% option is given.
export interface WaterChoice {
  // The overclocked option's clock (1 = 100%): the counted clock when that is above 100%, else
  // OVERCLOCK.
  overclock: number;
  // Whether the power counts the overclocked option, which is then suggested first.
  suggestOverclocked: boolean;
  // What the overclocked option gives: its extractors and Power Shards (`count`), the advice to
  // research Power Shards (`research`), or nothing (`none`, before the MAM).
  shards: 'count' | 'research' | 'none';
}
// The Water Extractor options of a stage in `phase` of a plan with `settings`.
export function waterChoice(
  stage: Pick<StoredStage, 'mining'> | undefined,
  phase: number,
  settings?: Pick<MiningSettings, 'overclock' | 'extraction'>,
): WaterChoice {
  const counted = stage?.mining
    ? waterClock(stage.mining)
    : (settings?.extraction?.clock ?? DEFAULT_EXTRACTION.clock);
  const overclocked = counted > 1 + 1e-9;
  const canOverclock =
    overclocked ||
    !!settings?.overclock ||
    (stage?.mining ? (PHASE_CLOCK[phase] ?? 1) > 1 : phase >= OVERCLOCK_ADVICE_FROM);
  return {
    overclock: overclocked ? counted : OVERCLOCK,
    suggestOverclocked: overclocked,
    shards: canOverclock ? 'count' : phase >= OVERCLOCK_ADVICE_FROM ? 'research' : 'none',
  };
}
// Where to research Power Shards, as the mining step's advice says it (#1137).
const SHARD_RESEARCH =
  'research Power Shards in the MAM (Blue Power Slugs, then Overclock Production)';
// The choice when nothing says otherwise: both options counted, 100% suggested.
const BOTH_AT_100: WaterChoice = {
  overclock: OVERCLOCK,
  suggestOverclocked: false,
  shards: 'count',
};

// The two options for `rate` m³/min of Water, the suggested one first: each its name ("at 100%",
// "overclocked up to 250%") and its extractors (extractorOption), or for the overclocked one the
// research advice. `same` when both are the same extractors (one at 100% or less), and null for
// less Water than one extractor gives at its lowest clock.
export interface WaterOptions {
  first: { name: string; option: ExtractorOption };
  second: { name: string; option: ExtractorOption } | { name: string; research: string } | null;
  same: boolean;
}
export function waterOptions(rate: number, choice: WaterChoice = BOTH_AT_100): WaterOptions | null {
  if (!(rate >= EXTRACTOR_MIN_RATE - 1e-6)) return null;
  const plain = extractorOption(rate, 100),
    sharded = extractorOption(rate, Math.min(choice.overclock * 100, WATER_EXTRACTOR.maxClock));
  if (!plain || !sharded) return null;
  const atFull = { name: 'at 100%', option: plain };
  const overName = `overclocked up to ${miningNumber(choice.overclock * 100)}%`;
  const same = plain.extractors <= 1 && runWords(plain) === runWords(sharded);
  if (choice.shards === 'none') return { first: atFull, second: null, same };
  if (choice.shards === 'research')
    return {
      first: atFull,
      second: { name: overName, research: `with fewer extractors: ${SHARD_RESEARCH} first` },
      same,
    };
  const over = { name: overName, option: sharded };
  return choice.suggestOverclocked
    ? { first: over, second: atFull, same }
    : { first: atFull, second: over, same };
}
// An option's extractors as the player sets them: "2 at 100% + 1 at 15.03%".
const runWords = (option: ExtractorOption): string =>
  option.runs.map(run => `${miningNumber(run.count)} at ${miningNumber(run.clock)}%`).join(' + ');
const extractorCount = (count: number) =>
  `${miningNumber(count)} extractor${count === 1 ? '' : 's'}`;
// "overclocked …" as a sentence's start: "Overclocked …".
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const shardCount = (count: number) => `${miningNumber(count)} Power Shard${count === 1 ? '' : 's'}`;
// An option's extractors, shards and MW: "2 at 100% + 1 at 15.03% (3 extractors, 41.63 MW)".
const optionWords = (option: ExtractorOption): string =>
  `${runWords(option)} (${[extractorCount(option.extractors), ...(option.shards ? [shardCount(option.shards)] : []), powerAmount(option.mw)].join(', ')})`;
// One of the options in words: "at 100% (suggested): 2 at 100% + 1 at 15.03% (3 extractors,
// 41.63 MW)", or "overclocked up to 250%, with fewer extractors: research Power Shards …".
const optionPart = (part: NonNullable<WaterOptions['second']>, suggested: boolean): string =>
  'research' in part
    ? `${part.name}, ${part.research}`
    : `${part.name}${suggested ? ' (suggested)' : ''}: ${optionWords(part.option)}`;

// The Water Extractors for `rate` m³/min of Water, as a line's advice gives them (#1024, #1142):
// "Water Extractors at 100% (suggested): 2 at 100% + 1 at 15.03% (3 extractors, 41.63 MW). Or
// overclocked up to 250%: 1 at 215.03% (1 extractor, 3 Power Shards, 55.03 MW)." The suggested
// option first; one extractor at 100% or less is the same either way, so it is one option. ''
// for less Water than one extractor gives at its lowest clock.
export function waterExtractorWords(rate: number, choice?: WaterChoice): string {
  const options = waterOptions(rate, choice);
  if (!options) return '';
  if (options.same)
    return `Water Extractors: ${runWords(options.first.option)} (${powerAmount(options.first.option.mw)}); no Power Shards needed.`;
  if (!options.second) return `Water Extractors ${optionPart(options.first, false)}.`;
  return `Water Extractors ${optionPart(options.first, true)}. Or ${optionPart(options.second, false)}.`;
}

// The Water row of the mining step's table (#1142): what the phase extracts in all, its
// extractors in the suggested option with the other option after them, and the suggested
// option's Power Shards and MW, which the step's total adds. Null without Water to extract.
function waterRow(
  stage: Pick<StoredStage, 'mining' | 'raw'>,
  choice: WaterChoice,
): { cells: string[]; words: string; machines: number; shards: number; mw: number } | null {
  const rate = stage.raw?.Water ?? 0;
  const options = waterOptions(rate, choice);
  if (!options) return null;
  const { first, second } = options;
  const machines = options.same
    ? `Water Extractor: ${runWords(first.option)}`
    : `Water Extractor ${first.name}${second ? ' (suggested)' : ''}: ${runWords(first.option)}` +
      (!second
        ? ''
        : 'research' in second
          ? `. ${capital(second.name)}, ${second.research}`
          : `. ${capital(second.name)}: ${optionWords(second.option)}`);
  return {
    cells: [
      'Water',
      `${miningNumber(rate)} m³/min`,
      'None: any open water',
      machines,
      first.option.shards ? miningNumber(first.option.shards) : 'None',
      powerAmount(first.option.mw),
    ],
    words: `Water ${miningNumber(rate)} m³/min: ${waterExtractorWords(rate, choice)}`,
    machines: first.option.extractors,
    shards: first.option.shards,
    mw: first.option.mw,
  };
}
// Under the mining table when it has a Water row: the counts are for all of the phase's Water
// together, and each line that takes it gives its own.
export const WATER_ROW_NOTE =
  "The Water row counts all of this phase's Water together; each production line that takes Water says how many extractors it needs on its own.";

// What the power step says about the phase's Water Extractors (#1142): which option its power
// counts, the suggested one, with that MW (the grid's, as Power needed counts it), and the other
// option's extractors, Power Shards and MW, or the research advice. '' without extracted Water or
// a grid.
export function waterPowerWords(
  stage: Pick<StoredStage, 'mining' | 'raw' | 'grid'> | undefined,
  phase: number,
  settings?: Pick<MiningSettings, 'overclock' | 'extraction'>,
): string {
  const mw = stage?.grid?.extraction?.Water;
  const rate = stage?.raw?.Water ?? 0;
  const choice = waterChoice(stage, phase, settings);
  const options = waterOptions(rate, choice);
  if (!options || !(mw && mw > 0)) return '';
  const { first, second } = options;
  const counted = `This phase's power counts its Water Extractors ${first.name}`;
  // "2 extractors drawing 30.72 MW", "1 extractor and 2 Power Shards, drawing 41.26 MW".
  const takes = (option: ExtractorOption, drawn: number) =>
    option.shards
      ? `${extractorCount(option.extractors)} and ${shardCount(option.shards)}, drawing ${powerAmount(drawn)}`
      : `${extractorCount(option.extractors)} drawing ${powerAmount(drawn)}`;
  if (options.same || !second) return ` ${counted}: ${takes(first.option, mw)}.`;
  if ('research' in second)
    return ` ${counted}, the suggested option: ${takes(first.option, mw)}. ${capital(second.name)}, ${second.research}.`;
  // The other option's MW at the power model's rate per m³ (waterMWPerUnit): its clock's share.
  const clockOf = (option: ExtractorOption) => (option.full > 100 ? choice.overclock : 1);
  const otherMW =
    mw * (clockOf(second.option) / clockOf(first.option)) ** (WATER_EXTRACTOR.exponent - 1);
  return ` ${counted}, the suggested option: ${takes(first.option, mw)}. ${capital(second.name)} instead, they would take ${takes(second.option, otherMW)}.`;
}

// The first phase in which the MAM's Power Shards research is worth advising (#1137): before it
// the player cannot use the MAM yet, so the step says nothing about overclocking.
export const OVERCLOCK_ADVICE_FROM = 2;
// What researching Power Shards would save on a stage's nodes (#1137): the miners and extractors
// its draw takes now, and how many it would take overclocked (phaseMiner with overclock, each
// machine up to 250% and never past its belt or pipe). Null when the player can overclock
// already (settings.overclock), before OVERCLOCK_ADVICE_FROM, when overclocking would not raise
// the phase's clock (Phases 4 and 5 already run 250%, or a survey caps it) or would save none.
export function overclockSaving(
  stage: Pick<StoredStage, 'mining' | 'raw'> | undefined,
  phase: number,
  settings: MiningSettings | undefined,
): { now: number; overclocked: number } | null {
  const mining = stage?.mining;
  if (!mining || !settings || settings.overclock || phase < OVERCLOCK_ADVICE_FROM) return null;
  const clock = phaseMiner(phase, settings.extraction, settings.ownedMiner, true).clock;
  if (!(clock > mining.miner.clock + 1e-9)) return null;
  let now = 0,
    overclocked = 0;
  for (const entry of stageMiningAdvice(stage)) {
    now += entry.advice.nodes;
    overclocked += miningAdvice(entry.rate, mining.sources[entry.resource]!, clock).nodes;
  }
  return overclocked < now ? { now, overclocked } : null;
}
// The advice to research Power Shards (#1137), or '' (overclockSaving).
export function overclockAdviceWords(saving: { now: number; overclocked: number } | null): string {
  if (!saving) return '';
  const saved = saving.now - saving.overclocked;
  return `Research Power Shards in the MAM (Blue Power Slugs, then Overclock Production) to halve the miners on these nodes: overclocked up to what their belts and pipes carry, the same draw takes ${miningNumber(saving.overclocked)} machines instead of ${miningNumber(saving.now)}, ${miningNumber(saved)} fewer.`;
}

// The build plan's mining step for a stage (#1065), or null without mining per phase or with
// nothing to mine: the phase's equipment, then each resource's nodes, its Water Extractors in both
// options with the suggested one counted (#1142, waterRow), and the Power Shards in all (#1137),
// as one text (`body`, which search, copying and step edits read) and as a table, one
// row per resource with a total row (`table`, #1136). `settings` (the plan's) adds the advice to
// research Power Shards (overclockSaving).
export function miningStep(
  stage: Pick<StoredStage, 'mining' | 'raw'> | undefined,
  phase: string,
  settings?: MiningSettings,
): { body: string; table: StepTable } | null {
  const resources = stageMiningAdvice(stage);
  if (!stage?.mining || !resources.length) return null;
  const mining = stage.mining;
  // The phase's Water Extractors, the suggested option counted in the totals (#1142).
  const water = waterRow(stage, waterChoice(stage, Number(phase), settings));
  const total = resources.reduce((sum, entry) => sum + entry.advice.mw, water?.mw ?? 0),
    shards = resources.reduce((sum, entry) => sum + entry.advice.shards, water?.shards ?? 0);
  const shardWords = shards
    ? ` and ${miningNumber(shards)} Power Shard${shards === 1 ? '' : 's'}`
    : '';
  const advice = overclockAdviceWords(overclockSaving(stage, Number(phase), settings));
  const intro = `Phase ${phase} mines with ${minerWords(mining.miner)} and carries on ${mining.belt.mark} belts (${miningNumber(mining.belt.cap)}/min) and ${mining.pipe.mark} pipes (${miningNumber(mining.pipe.cap)} m³/min); the budgets follow from them. Tap the best nodes first: ${powerAmount(total)}${shardWords} for the miners and extractors.`;
  const body = [
    intro,
    ...resources.map(
      entry =>
        `${entry.resource} ${miningNumber(entry.rate)}${entry.fluid ? ' m³' : ''}/min: ${entry.words.charAt(0).toLowerCase()}${entry.words.slice(1)}`,
    ),
    ...(water ? [water.words] : []),
    ...(advice ? [advice] : []),
  ].join(' ');
  const count = (entry: ResourceMining) => ({
    nodes: entry.advice.nodes + entry.advice.satellites,
    machines: entry.advice.nodes + entry.advice.pressurizers,
  });
  const nodes = resources.reduce((sum, entry) => sum + count(entry).nodes, 0),
    machines = resources.reduce((sum, entry) => sum + count(entry).machines, water?.machines ?? 0);
  const after = [...(advice ? [advice] : []), ...(water ? [WATER_ROW_NOTE] : [])].join(' ');
  return {
    body,
    table: {
      intro,
      caption: `Phase ${phase}'s resource nodes`,
      columns: ['Resource', 'Rate', 'Nodes', 'Machines', 'Shards', 'Power'],
      rows: [
        ...resources.map(entry => [
          entry.resource,
          `${miningNumber(entry.rate)}${entry.fluid ? ' m³' : ''}/min`,
          nodeCells(entry.advice.runs),
          machineCells(entry, stage.mining!),
          entry.advice.shards ? miningNumber(entry.advice.shards) : 'None',
          powerAmount(entry.advice.mw),
        ]),
        ...(water ? [water.cells] : []),
      ],
      total: [
        'Total',
        '',
        `${miningNumber(nodes)} node${nodes === 1 ? '' : 's'}`,
        `${miningNumber(machines)} machine${machines === 1 ? '' : 's'}`,
        shards ? miningNumber(shards) : 'None',
        powerAmount(total),
      ],
      ...(after ? { after } : {}),
    },
  };
}
// The mining step's text alone (miningStep).
export const miningStepBody = (
  stage: Pick<StoredStage, 'mining' | 'raw'> | undefined,
  phase: string,
  settings?: MiningSettings,
): string | null => miningStep(stage, phase, settings)?.body ?? null;

// A resource's nodes for the mining table: "8 pure, 9 normal" and "4 well satellites (2 pure, 2
// normal)".
function nodeCells(runs: MiningRun[]): string {
  const counts = new Map<string, number>();
  for (const run of runs.filter(run => !isWellKind(run.kind)))
    counts.set(run.kind, (counts.get(run.kind) ?? 0) + run.full + (run.last === null ? 0 : 1));
  const parts = [...counts].map(([kind, count]) => `${miningNumber(count)} ${kind}`);
  const wells = runs.filter(run => isWellKind(run.kind));
  const satellites = wells.reduce((sum, run) => sum + run.full, 0);
  if (satellites)
    parts.push(
      `${miningNumber(satellites)} well satellite${satellites === 1 ? '' : 's'} (${wells.map(run => `${miningNumber(run.full)} ${run.kind.slice('well-'.length)}`).join(', ')})`,
    );
  return parts.join('; ');
}
// A resource's machines for the mining table: "Miner Mk.2: 4 at 200% and 1 at 181.98%", a
// resource well's "about 1 Resource Well Pressurizer at 85%", a fluid's other clocks after it
// ("At 100%: 16 at 100% and 1 at 20.44%"), and what the nodes cannot give.
function machineCells(entry: ResourceMining, mining: StageMining): string {
  const nodeRuns = entry.advice.runs.filter(run => !isWellKind(run.kind)),
    wellRuns = entry.advice.runs.filter(run => isWellKind(run.kind));
  const parts: string[] = [];
  if (nodeRuns.length)
    parts.push(`${nodeRuns[0]!.machine}: ${clockRunWords(nodeRuns, entry.fluid)}`);
  if (wellRuns.length)
    parts.push(
      `about ${miningNumber(entry.advice.pressurizers)} Resource Well Pressurizer${entry.advice.pressurizers === 1 ? '' : 's'} at ${clockWords(wellRuns[0]!.clock, true)}`,
    );
  let text = parts.join('; ');
  if (entry.fluid)
    for (const at of fluidClocks(mining.miner.clock)) {
      if (Math.abs(at - mining.miner.clock) < 1e-9) continue;
      const option = miningAdvice(entry.rate, mining.sources[entry.resource]!, at);
      const runs = option.runs.filter(run => !isWellKind(run.kind));
      if (runs.length && !option.short)
        text += `. At ${miningNumber(at * 100)}%: ${clockRunWords(runs, true)} (${powerAmount(option.mw)})`;
    }
  if (entry.advice.short)
    text += `. ${miningNumber(entry.advice.short)}${entry.fluid ? ' m³' : ''}/min more than this phase's nodes give`;
  return text;
}

// The buildings a stage's mining uses (#1065): its belt (for any line), its pipe (for a fluid
// it draws), its miner (for an ore), Oil Extractors and resource wells where it taps them and
// Water Extractors for Water. The build plan lists the milestone of each as a step of the phase.
export function miningBuildings(stage: StoredStage | undefined): string[] {
  const mining = stage?.mining;
  if (!mining) return [];
  const drawn = (resource: string) => (stage.raw?.[resource] ?? 0) > 1e-6;
  const buildings = new Set<string>();
  if (stage.rows?.length) buildings.add(`Conveyor Belt ${mining.belt.mark}`);
  if (['Water', ...MINED_FLUIDS].some(drawn)) buildings.add(`Pipeline ${mining.pipe.mark}`);
  if (drawn('Water')) buildings.add('Water Extractor');
  for (const entry of stageMiningAdvice(stage))
    for (const run of entry.advice.runs)
      buildings.add(isWellKind(run.kind) ? 'Resource Well Pressurizer' : run.machine);
  return [...buildings];
}

// The budgets each phase of a draft's settings would plan with (#1065): per phase, its miner,
// belts and pipes, and the share of the entered budgets it gets over the resources it can mine
// by then (lowest and highest), for the wizard's budgets step.
export interface PhaseBudgetRow {
  phase: number;
  equipment: string;
  low: number;
  high: number;
}
export function phaseBudgetRows(settings: MiningSettings, from = 1): PhaseBudgetRow[] {
  const rows: PhaseBudgetRow[] = [];
  for (let phase = from; phase <= 5; phase++) {
    const mining = phaseMining(settings, phase);
    const shares = Object.entries(mining.sources)
      .filter(([resource, kinds]) => kinds.length && (settings.limits[resource] ?? 0) > 0)
      .map(([resource]) => mining.budgets[resource]! / settings.limits[resource]!);
    rows.push({
      phase,
      equipment: equipmentWords(mining),
      low: shares.length ? Math.min(...shares) : 1,
      high: shares.length ? Math.max(...shares) : 1,
    });
  }
  return rows;
}

// A phase's budgets as a share of the entered ones: "40%", or "0–40%" when they differ.
export const budgetShareWords = (row: Pick<PhaseBudgetRow, 'low' | 'high'>): string => {
  const percent = (share: number) => miningNumber(Math.round(share * 1000) / 10);
  return Math.abs(row.high - row.low) < 0.0005
    ? `${percent(row.low)}%`
    : `${percent(row.low)}–${percent(row.high)}%`;
};

// Each resource's budget in a stage, for a quick lookup: { resource: budget }.
export const stageBudgets = (
  stage: Pick<StoredStage, 'mining'> | undefined,
  settings: Pick<StoredSettings, 'limits'>,
): ItemRates => ({ ...settings.limits, ...(stage?.mining?.budgets ?? {}) });
