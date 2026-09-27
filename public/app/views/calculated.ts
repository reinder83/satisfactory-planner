// For a calculated profile: the checklist steps of its plan page
// (ui/pages/CalculatedPlanPage.vue), the options for an infeasible phase, and the machine
// setup and expansion its factory dialog shows (ui/detail/CalcFactoryDialog.vue). Its
// resources page is ui/pages/CalculatedResourcesPage.vue. Everything reads the profile's frozen calculation
// snapshot through calcStage(); nothing here recalculates.
import { progression } from '../../progression.ts';
import { buildStatus, type BuildStatus } from '../build-status.ts';
import { itemRate, rateOfItem } from '../flow.ts';
import { num } from '../format.ts';
import {
  calcStage,
  calculated,
  fromStart,
  phase,
  phaseLabel,
  progressionData,
  stage,
  state,
} from '../session.ts';
import { power } from '../wizard/fields.ts';
import type { CalcRow, CurrentSettings, ItemRates, Phase, StoredStage } from '../../types/index.ts';

// A build-plan step before the user's edits: its saved check key, title and text.
export interface PlanStepData {
  id: string;
  title: string;
  body: string;
}

// A step's inputs or outputs as "Heavy Oil Residue 46.6 m³/min, Iron Ore 30/min": each item
// with its own rate, a fluid in m³/min (itemRate in flow.ts, #363), or '' for none.
const rateList = (rates: Record<string, number>): string =>
  Object.entries(rates)
    .map(([n, q]) => n + ' ' + itemRate(n, q))
    .join(', ');

// A step's outputs: a generator's power first, then its items (a nuclear plant's waste, #373).
const outputList = (r: CalcRow): string =>
  [...(r.generationMW > 0 ? [power(r.generationMW)] : []), rateList(r.outputs || {})]
    .filter(Boolean)
    .join(', ') || power(r.generationMW);

// The generated checklist for a calculated profile's current phase, before the user's step
// edits and custom tasks (tasks.ts adds those). Order: startup, power and milestone steps
// from progression.ts, hard drives, one step per production row, storage, then the lines
// this phase retires. Row steps use the saved key `calc-<stage>-<row id>` — the same key as
// that factory card's Running box — and must stay stable.
export function calcTasks(): PlanStepData[] {
  // A page of the profile just left can be drawn once more; it then has no steps.
  if (!calculated) return [];
  const p = calcStage(),
    g = progression(calculated, state, progressionData, phase());
  // Phase 1 interleaves base, power and milestone steps into a starting order; later
  // phases put power first, then milestones.
  const startup =
    stage() === '1'
      ? [
          // Phase 1 always has its seven base steps (progression.ts).
          g.baseTasks[0]!,
          ...g.powerTasks.slice(0, 2),
          ...g.baseTasks.slice(1, 5),
          ...g.milestoneTasks,
          ...g.powerTasks.slice(2),
          ...g.baseTasks.slice(5),
        ]
      : [...g.powerTasks, ...g.milestoneTasks];
  return [
    ...startup,
    ...g.hardDrives,
    ...(p?.rows || []).map(r => ({
      id: 'calc-' + stage() + '-' + r.id,
      title: r.name,
      body: `${machineSetup(r).summary} ${machineSetup(r).partial ? 'Adjustable machine: ≈ ' + num(machineSetup(r).clock) + '% → ≈ ' + machineSetup(r).lastOutput + '. Open factory details for an easier rounded option.' : 'Each machine: ' + machineSetup(r).fullOutput + '.'} ${r.amplified ? `Insert ${r.slots} somersloop${(r.slots ?? 0) > 1 ? 's' : ''} in each machine — ${r.sloops} in total — for double output from the same inputs at four times the power. ` : ''}Inputs: ${rateList(r.inputs) || 'none'}. Outputs: ${outputList(r)}.`,
    })),
    {
      id: 'calc-' + stage() + '-storage',
      title: 'Connect protected storage and overflow',
      body: 'Reserve the listed storage refill rates before elevator exports. Handle every liquid byproduct; send surplus sinkable solids to the AWESOME Sink after unlocking it.',
    },
    ...(g.retire || []),
  ];
}

// The second sentence of the whole-building power headroom notice (ui/plan/CalcWarnings.vue)
// for stage `x` shown as phase `p` (#331). Phase 1 has no generators in the plan (planner.ts
// keeps hand-fed biomass burners out of the model), so its power is biomass or what already
// runs. From Phase 2 on the plan builds its own generators: the sentence names the ones this
// stage's rows build, and says only that more is needed when a stage builds none.
export function headroomAdvice(x: StoredStage, p: Phase): string {
  const label = phaseLabel(p);
  if (p === '1') return label + ' needs biomass or existing generation.';
  const machines = [
    ...new Set((x.rows || []).filter(r => (r.generationMW || 0) > 0).map(r => r.machine)),
  ];
  if (!machines.length)
    return label + ' needs generation beyond the plan, or existing spare power.';
  const names = machines.map(m => m + 's');
  const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names.at(-1) : names[0];
  return `${label} plans ${list}; add generation beyond those, or count on existing spare power.`;
}

// Older snapshots carry only a reason sentence; shortfalls/minHours render as concrete options when present.
// The options for an infeasible phase `x` under settings `s`, as sentences (none for an
// older snapshot). ui/plan/CalcWarnings.vue and the wizard's Review
// (ui/wizard/ReviewStep.vue) list them.
export function draftFixes(x: StoredStage, s: Partial<CurrentSettings> | undefined): string[] {
  const fixes: string[] = [];
  if (x.shortfalls?.length)
    fixes.push(
      `Raise the short budget${x.shortfalls.length > 1 ? 's' : ''} (Resources): ${x.shortfalls.map(f => `${f.name} to about ${num(f.needed)}/min (entered: ${num(f.budget)}/min)`).join('; ')}.`,
    );
  if (x.wholeMachinesOnly)
    fixes.push(
      'Keep these budgets instead: untick “Run solid-part machines at 100%” (Goals). Precise balancing fits, with one adjustable machine per production line.',
    );
  if (x.minHours)
    fixes.push(
      s?.goal === 'timed'
        ? `Raise “Hours per phase” (Goals) to at least ${num(x.minHours)} h.`
        : `Switch the goal (Goals) to “Target completion time” with at least ${num(x.minHours)} hours per phase.`,
    );
  else if (x.shortfalls?.length && !x.wholeMachinesOnly)
    fixes.push(
      s?.goal === 'maximum'
        ? 'Lower the protected storage refill rate, drone-fuel supply or extra Singularity Cells (Preferences).'
        : `More time alone will not fit: lower the protected storage refill rate, drone-fuel supply or extra Singularity Cells (Preferences)${s?.roundRates ? ', or untick delivery-rate rounding (Goals)' : ''}.`,
    );
  if (x.shortfalls?.length && s?.recipes === 'standard')
    fixes.push('Allow alternate recipes (Preferences) to cut raw resource use.');
  if (x.shortfalls?.length && s?.sam === 'avoid')
    fixes.push(
      'Allow SAM resource conversion (Preferences) to turn plentiful resources into the short ones.',
    );
  return fixes;
}

// How to build row `r`: how many machines run at 100% and whether one last machine runs
// underclocked, with per-machine output text. `easy` is an optional rounded-up clock for
// that last machine and the extra inputs/outputs it causes; it is never offered for nuclear
// or waste lines, whose balance must stay exact. Used by calcTasks and
// ui/detail/CalcFactoryDialog.vue.
// A rounded-up clock for the last machine, and what it adds.
export interface EasySetup {
  clock: number;
  output: ItemRates;
  inputs: ItemRates;
  extraOutputs: ItemRates;
}
export function machineSetup(r: CalcRow) {
  const equivalent = r.equivalent || r.machines - 1 + r.lastClock / 100,
    whole = Math.floor(equivalent + 1e-7),
    fraction = Math.max(0, equivalent - whole),
    partial = fraction > 1e-7;
  const rates = Object.fromEntries(
    Object.entries(r.outputs || {}).map(([n, q]) => [n, q / equivalent]),
  );
  // What one machine makes, at 100% and at the adjustable one's clock: a generator's power
  // first, then its items, so a nuclear plant gives its MW with its waste alongside (#373).
  const perMachine = (share: number) =>
    [
      ...(r.generationMW > 0 ? [`${num((r.generationMW / equivalent) * share)} MW`] : []),
      ...Object.entries(rates).map(([n, q]) => rateOfItem(n, q * share)),
    ].join(' · ') || `${num((r.generationMW / equivalent) * share)} MW`;
  const fullOutput = perMachine(1);
  const lastOutput = perMachine(fraction);
  const summary = `${r.machines} ${r.machine} total: ${partial ? (whole ? whole + ' at 100% + ' : '') + '1 adjustable machine' : whole + ' at 100% (no underclock needed)'}.`;
  const sensitive = /uranium|plutonium|ficsonium|waste|non-fissile/i.test(
    [r.name, ...Object.keys(r.inputs || {}), ...Object.keys(r.outputs || {})].join(' '),
  );
  let easy: EasySetup | null = null;
  if (partial && !sensitive) {
    // Round the final clock upward to a whole percent, never silently underproduce.
    let clock = Math.ceil(fraction * 100 - 1e-7);
    const primary = Object.entries(rates)[0];
    if (primary) {
      const target = Math.ceil(primary[1] * fraction - 1e-7),
        candidate = (target / primary[1]) * 100;
      if (candidate <= 100 && Math.abs(candidate - Math.round(candidate)) < 1e-7)
        clock = Math.max(clock, Math.round(candidate));
    }
    const extra = clock / 100 - fraction;
    if (extra > 1e-7)
      easy = {
        clock,
        output: Object.fromEntries(Object.entries(rates).map(([n, q]) => [n, (q * clock) / 100])),
        inputs: Object.fromEntries(
          Object.entries(r.inputs || {}).map(([n, q]) => [n, (q / equivalent) * extra]),
        ),
        extraOutputs: Object.fromEntries(Object.entries(rates).map(([n, q]) => [n, q * extra])),
      };
  }
  return { summary, whole, partial, fullOutput, lastOutput, clock: fraction * 100, easy };
}

// Phases where a line is not built yet, or needs no more machines, have nothing
// to add: say so with a dash rather than claiming capacity is being kept.
// One row per phase from the profile's start phase on: { phase, required, add }, the machines
// required for row `id` and how many to add over the most installed so far.
export function calcExpansion(id: string) {
  let installed = 0;
  return fromStart(calculated?.stages).map(([ph, p]) => {
    const required = p.rows?.find(x => x.id === id)?.machines || 0;
    const add = Math.max(0, required - installed);
    installed = Math.max(installed, required);
    return { phase: ph, required: required || '—', add: add ? '+' + add : '—' };
  });
}

// The open calculated stage's build-so-far status (build-status.ts, #66): what the factory rows
// ticked as built produce now. null without a calculated plan with rows. The pages and ADA ask
// for it on every redraw, and finding the next step recalculates the stage once per unbuilt row,
// so the last answer is kept until the plan, the stage or a row tick changes.
let buildCache: { key: string; status: BuildStatus | null } | null = null;
let buildPlan: unknown = null;
export function currentBuildStatus(): BuildStatus | null {
  const x = calcStage();
  if (!calculated || !x?.rows?.length) return null;
  const prefix = 'calc-' + stage() + '-';
  const key = stage() + '|' + x.rows.map(r => (state.checks[prefix + r.id] ? 1 : 0)).join('');
  if (buildPlan !== calculated || buildCache?.key !== key) {
    buildPlan = calculated;
    const spareMW = (calculated.settings.availablePowerGW || 0) * 1000;
    buildCache = { key, status: buildStatus(x, state.checks, stage(), spareMW) };
  }
  return buildCache.status;
}

// A row marked running that a missing supplier holds back (build-status.ts, #66): the share of
// full output it runs at and the item it is short of, or null. Its factory card says so
// (CalcFactoryCard.vue) and the factories page's Held back chip counts it (SP-16, #251).
export function heldBack(rowId: string): { share: number; shortOf: string } | null {
  const s = currentBuildStatus()?.rows.find(x => x.id === rowId);
  return s?.built && s.share < 1 && s.shortOf ? { share: s.share, shortOf: s.shortOf } : null;
}
