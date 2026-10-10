// A phase's mining in words (#1065), shared by the planner's warnings, the build plan's mining
// step, the Resources and Logistics pages and the wizard, so they never word it differently. The
// arithmetic is in preferences/mining.ts; this reads a stored stage's `mining` (absent from plans
// made without mining per phase, which these helpers then leave alone).
import {
  EXTRACTOR_OPTIONS,
  isWellKind,
  miningAdvice,
  phaseBelt,
  phaseMiner,
  phaseMining,
} from './preferences.ts';
import { listNames, powerAmount } from './wording.ts';
import type {
  ItemRates,
  MiningSource,
  StageMining,
  StoredSettings,
  StoredStage,
} from './types/index.ts';
import type { MiningAdvice, MiningRun, MiningSettings } from './preferences/mining.ts';

// A number as the pages show one (num in app/format.ts): locale-formatted, at most 2 decimals.
const miningNumber = (value: number) =>
  Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
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
// nothing to mine: the phase's equipment, then each resource's nodes, and the Power Shards in all
// (#1137). `settings` (the plan's) adds the advice to research Power Shards (overclockSaving).
export function miningStepBody(
  stage: Pick<StoredStage, 'mining' | 'raw'> | undefined,
  phase: string,
  settings?: MiningSettings,
): string | null {
  const resources = stageMiningAdvice(stage);
  if (!stage?.mining || !resources.length) return null;
  const mining = stage.mining;
  const total = resources.reduce((sum, entry) => sum + entry.advice.mw, 0),
    shards = resources.reduce((sum, entry) => sum + entry.advice.shards, 0);
  const shardWords = shards
    ? ` and ${miningNumber(shards)} Power Shard${shards === 1 ? '' : 's'}`
    : '';
  const advice = overclockAdviceWords(overclockSaving(stage, Number(phase), settings));
  return [
    `Phase ${phase} mines with ${minerWords(mining.miner)} and carries on ${mining.belt.mark} belts (${miningNumber(mining.belt.cap)}/min) and ${mining.pipe.mark} pipes (${miningNumber(mining.pipe.cap)} m³/min); the budgets follow from them. Tap the best nodes first: ${powerAmount(total)}${shardWords} for the miners and extractors.`,
    ...resources.map(
      entry =>
        `${entry.resource} ${miningNumber(entry.rate)}${entry.fluid ? ' m³' : ''}/min: ${entry.words.charAt(0).toLowerCase()}${entry.words.slice(1)}`,
    ),
    ...(advice ? [advice] : []),
  ].join(' ');
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
