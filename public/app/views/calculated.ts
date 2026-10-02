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
    .map(([item, rate]) => item + ' ' + itemRate(item, rate))
    .join(', ');

// A step's outputs: a generator's power first, then its items (a nuclear plant's waste, #373).
const outputList = (row: CalcRow): string =>
  [...(row.generationMW > 0 ? [power(row.generationMW)] : []), rateList(row.outputs || {})]
    .filter(Boolean)
    .join(', ') || power(row.generationMW);

// The bundled icon a calculated row shows on its card, its dialog and its build-plan step: a
// generator's building (icons/coal-generator.png and so on), even when it also makes waste
// (#350), else its main output; '' for neither.
export const rowIcon = (row: CalcRow): string =>
  row.generationMW > 0 ? row.machine : Object.keys(row.outputs || {})[0] || '';

// The generated checklist for a calculated profile's current phase, before the user's step
// edits and custom tasks (tasks.ts adds those). Order: startup, power and milestone steps
// from progression.ts, hard drives, one step per production row, storage, then the lines
// this phase retires. Row steps use the saved key `calc-<stage>-<row id>` — the same key as
// that factory card's Running box — and must stay stable.
export function calcTasks(): PlanStepData[] {
  // A page of the profile just left can be drawn once more; it then has no steps.
  if (!calculated) return [];
  // A plan with a guide (#393, a migrated handbook profile) has the guide's steps for this phase
  // instead, with their own check ids; a phase the guide leaves out has none (#466).
  if (calculated.guide) return (calculated.guide.phases[phase()] ?? []).map(t => ({ ...t }));
  const snapshot = calcStage(),
    steps = progression(calculated, state, progressionData, phase());
  // Phase 1 interleaves base, power and milestone steps into a starting order; later
  // phases put power first, then milestones.
  const startup =
    stage() === '1'
      ? [
          // Phase 1 always has its seven base steps (progression.ts).
          steps.baseTasks[0]!,
          ...steps.powerTasks.slice(0, 2),
          ...steps.baseTasks.slice(1, 5),
          ...steps.milestoneTasks,
          ...steps.powerTasks.slice(2),
          ...steps.baseTasks.slice(5),
        ]
      : [...steps.powerTasks, ...steps.milestoneTasks];
  return [
    ...startup,
    ...steps.hardDrives,
    ...(snapshot?.rows || []).map(row => ({
      id: 'calc-' + stage() + '-' + row.id,
      title: row.name,
      // The pointer to an easier rounded option only where the dialog shows one (#379).
      body: `${machineSetup(row).summary} ${machineSetup(row).partial ? 'Adjustable machine: ≈ ' + num(machineSetup(row).clock) + '% → ≈ ' + machineSetup(row).lastOutput + '.' + (easierSetup(machineSetup(row)) ? ' Open factory details for an easier rounded option.' : '') : 'Each machine: ' + machineSetup(row).fullOutput + '.'} ${row.amplified ? `Insert ${row.slots} somersloop${(row.slots ?? 0) > 1 ? 's' : ''} in each machine — ${row.sloops} in total — for double output from the same inputs at four times the power. ` : ''}Inputs: ${rateList(row.inputs) || 'none'}. Outputs: ${outputList(row)}.`,
    })),
    {
      id: 'calc-' + stage() + '-storage',
      title: 'Connect protected storage and overflow',
      body: 'Reserve the listed storage refill rates before elevator exports. Handle every liquid byproduct; send surplus sinkable solids to the AWESOME Sink after unlocking it.',
    },
    ...(steps.retire || []),
  ];
}

// The second sentence of the whole-building power headroom notice (ui/plan/CalcWarnings.vue)
// for stage `snapshot` shown as phase `shownPhase` (#331). Phase 1 has no generators in the plan
// (planner.ts keeps hand-fed biomass burners out of the model), so its power is biomass or what
// already runs. From Phase 2 on the plan builds its own generators: the sentence names the ones
// this stage's rows build, and says only that more is needed when a stage builds none.
export function headroomAdvice(snapshot: StoredStage, shownPhase: Phase): string {
  const label = phaseLabel(shownPhase);
  if (shownPhase === '1') return label + ' needs biomass or existing generation.';
  const machines = [
    ...new Set((snapshot.rows || []).filter(r => (r.generationMW || 0) > 0).map(r => r.machine)),
  ];
  if (!machines.length)
    return label + ' needs generation beyond the plan, or existing spare power.';
  const list = andList(machines.map(m => m + 's'));
  return `${label} plans ${list}; add generation beyond those, or count on existing spare power.`;
}

// Names as a sentence lists them: "2", "2 and 3", "2, 3 and 4" (#735). The planner's warnings
// use the same function, from public/wording.ts (#748). Imported here rather than with the
// imports above only to keep this change apart from the import block.
import { listNames } from '../../wording.ts';
export const andList = listNames;

// Whether the planner measured a budget problem for infeasible stage `snapshot`: shortfalls, the
// hours it would fit in, or whole machines breaking it. draftHeading and the wizard Review's
// Budget column (ui/wizard/ReviewStep.vue) name a budget only then (#626, #632).
export function budgetMeasured(snapshot: StoredStage): boolean {
  return Boolean(snapshot.shortfalls || snapshot.minHours || snapshot.wholeMachinesOnly);
}

// The bold heading over an infeasible phase `snapshot`'s reason: the plan page's draft notice
// (ui/plan/CalcWarnings.vue), or with `phase` the wizard's Review (ui/wizard/ReviewStep.vue).
// It names a budget only when the planner measured one (shortfalls, the hours it would fit in,
// or whole machines breaking it). A stopped search, recipes that cannot make the goal and an
// older snapshot carry none of those, so the heading stays neutral and the reason says why (#626).
export function draftHeading(snapshot: StoredStage, phase?: string): string {
  const overBudget = budgetMeasured(snapshot);
  if (phase) return `Phase ${phase}${overBudget ? ' — budget exceeded' : ''}:`;
  return overBudget ? 'Planning draft — budget exceeded.' : 'Planning draft.';
}

// Older snapshots carry only a reason sentence; shortfalls/minHours render as concrete options when present.
// The options for an infeasible phase `snapshot` under `settings`, as sentences (none for an
// older snapshot). ui/plan/CalcWarnings.vue and the wizard's Review
// (ui/wizard/ReviewStep.vue) list them.
export function draftFixes(
  snapshot: StoredStage,
  settings: Partial<CurrentSettings> | undefined,
): string[] {
  const fixes: string[] = [];
  if (snapshot.shortfalls?.length)
    fixes.push(
      `Raise the short budget${snapshot.shortfalls.length > 1 ? 's' : ''} (Resources): ${snapshot.shortfalls.map(shortfall => `${shortfall.name} to about ${itemRate(shortfall.name, shortfall.needed)} (entered: ${itemRate(shortfall.name, shortfall.budget)})`).join('; ')}.`,
    );
  if (snapshot.wholeMachinesOnly)
    fixes.push(
      'Keep these budgets instead: untick “Run solid-part machines at 100%” (Goals). Precise balancing fits, with one adjustable machine per production line.',
    );
  if (snapshot.minHours)
    fixes.push(
      settings?.goal === 'timed'
        ? `Raise “Hours per phase” (Goals) to at least ${num(snapshot.minHours)} h.`
        : `Switch the goal (Goals) to “Target completion time” with at least ${num(snapshot.minHours)} hours per phase.`,
    );
  else if (snapshot.shortfalls?.length && !snapshot.wholeMachinesOnly)
    fixes.push(
      settings?.goal === 'maximum'
        ? 'Lower the protected storage refill rate, drone-fuel supply or extra Singularity Cells (Preferences).'
        : `More time alone will not fit: lower the protected storage refill rate, drone-fuel supply or extra Singularity Cells (Preferences)${settings?.roundRates ? ', or untick delivery-rate rounding (Goals)' : ''}.`,
    );
  if (snapshot.shortfalls?.length && settings?.recipes === 'standard')
    fixes.push('Allow alternate recipes (Preferences) to cut raw resource use.');
  if (snapshot.shortfalls?.length && settings?.sam === 'avoid')
    fixes.push(
      'Allow SAM resource conversion (Preferences) to turn plentiful resources into the short ones.',
    );
  return fixes;
}

// How to build `row`: how many machines run at 100% and whether one last machine runs
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
export function machineSetup(row: CalcRow) {
  const equivalent = row.equivalent || row.machines - 1 + row.lastClock / 100,
    whole = Math.floor(equivalent + 1e-7),
    fraction = Math.max(0, equivalent - whole),
    partial = fraction > 1e-7;
  const rates = Object.fromEntries(
    Object.entries(row.outputs || {}).map(([item, rate]) => [item, rate / equivalent]),
  );
  // What one machine makes, at 100% and at the adjustable one's clock: a generator's power
  // first, then its items, so a nuclear plant gives its MW with its waste alongside (#373).
  const perMachine = (share: number) =>
    [
      ...(row.generationMW > 0 ? [`${num((row.generationMW / equivalent) * share)} MW`] : []),
      ...Object.entries(rates).map(([item, rate]) => rateOfItem(item, rate * share)),
    ].join(' · ') || `${num((row.generationMW / equivalent) * share)} MW`;
  const fullOutput = perMachine(1);
  const lastOutput = perMachine(fraction);
  const summary = `${row.machines} ${row.machine} total: ${partial ? (whole ? whole + ' at 100% + ' : '') + '1 adjustable machine' : whole + ' at 100% (no underclock needed)'}.`;
  const sensitive = /uranium|plutonium|ficsonium|waste|non-fissile/i.test(
    [row.name, ...Object.keys(row.inputs || {}), ...Object.keys(row.outputs || {})].join(' '),
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
        output: Object.fromEntries(
          Object.entries(rates).map(([item, rate]) => [item, (rate * clock) / 100]),
        ),
        inputs: Object.fromEntries(
          Object.entries(row.inputs || {}).map(([item, rate]) => [
            item,
            (rate / equivalent) * extra,
          ]),
        ),
        extraOutputs: Object.fromEntries(
          Object.entries(rates).map(([item, rate]) => [item, rate * extra]),
        ),
      };
  }
  return { summary, whole, partial, fullOutput, lastOutput, clock: fraction * 100, easy };
}

// The easier rounded setting the factory dialog offers (ui/detail/CalcFactoryDialog.vue), and
// the build-plan step points to (calcTasks): none for a nuclear or waste line, or when the
// profile runs whole machines (#379).
export const easierSetup = (setup: ReturnType<typeof machineSetup>): EasySetup | null =>
  calculated?.settings.wholeMachines ? null : setup.easy;

// Phases where a line is not built yet, or needs no more machines, have nothing
// to add: say so with a dash rather than claiming capacity is being kept.
// One row per phase from the profile's start phase on: { phase, required, add }, the machines
// required for row `id` and how many to add over the most installed so far.
export function calcExpansion(id: string) {
  let installed = 0;
  return fromStart(calculated?.stages).map(([stagePhase, snapshot]) => {
    const required = snapshot.rows?.find(row => row.id === id)?.machines || 0;
    const add = Math.max(0, required - installed);
    installed = Math.max(installed, required);
    return {
      phase: stagePhase,
      ...expansionPhase(stagePhase),
      required: required || '—',
      add: add ? '+' + add : '—',
    };
  });
}

// An expansion table row's phase (SP-22): its label, and whether it is the phase being worked
// on, which the dialogs mark with an accent edge and a "current" tag. Post Phase 5 works on
// Phase 5's targets, so that row is the current one then, and its tag says so.
export function expansionPhase(rowPhase: string) {
  const current = rowPhase === stage();
  return {
    label: phaseLabel(rowPhase),
    current,
    tag: current ? (phase() === 'post' ? 'current: Post Phase 5' : 'current') : '',
  };
}

// The open calculated stage's build-so-far status (build-status.ts, #66): what the factory rows
// ticked as built produce now. null without a calculated plan with rows. The pages and ADA ask
// for it on every redraw, and finding the next step recalculates the stage once per unbuilt row,
// so the last answer is kept until the plan, the stage or a row tick changes.
let buildCache: { key: string; status: BuildStatus | null } | null = null;
let buildPlan: unknown = null;
export function currentBuildStatus(): BuildStatus | null {
  const snapshot = calcStage();
  if (!calculated || !snapshot?.rows?.length) return null;
  const prefix = 'calc-' + stage() + '-';
  const key =
    stage() + '|' + snapshot.rows.map(r => (state.checks[prefix + r.id] ? 1 : 0)).join('');
  if (buildPlan !== calculated || buildCache?.key !== key) {
    buildPlan = calculated;
    const spareMW = (calculated.settings.availablePowerGW || 0) * 1000;
    buildCache = { key, status: buildStatus(snapshot, state.checks, stage(), spareMW) };
  }
  return buildCache.status;
}

// A row marked running that a missing supplier holds back (build-status.ts, #66): the share of
// full output it runs at and the item it is short of, or null. Its factory card says so
// (CalcFactoryCard.vue) and the factories page's Held back chip counts it (SP-16, #251).
export function heldBack(rowId: string): { share: number; shortOf: string } | null {
  const status = currentBuildStatus()?.rows.find(row => row.id === rowId);
  return status?.built && status.share < 1 && status.shortOf
    ? { share: status.share, shortOf: status.shortOf }
    : null;
}
