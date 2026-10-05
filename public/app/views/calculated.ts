// For a calculated profile: the checklist steps of its plan page
// (ui/pages/CalculatedPlanPage.vue), the options for an infeasible phase, and the machine
// setup and expansion its factory dialog shows (ui/detail/CalcFactoryDialog.vue). Its
// resources page is ui/pages/CalculatedResourcesPage.vue. Everything reads the profile's frozen calculation
// snapshot through calcStage(); nothing here recalculates.
import { groupedRows, groupedSteps } from '../group-order.ts';
import { phaseSteps, rowStepTitle, type PhaseStep } from '../../progression.ts';
import { buildStatus, type BuildStatus } from '../build-status.ts';
import { FLUIDS, itemRate, rateOfItem } from '../flow.ts';
import { num } from '../format.ts';
import { adviceText, lineAdvice, recycleModel } from '../recycle.ts';
import type { AdviceLine, AdviceWords, RecycleModel } from '../recycle.ts';
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
import { factoryGroupsState, siteGroupName } from './factories.ts';
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

// The generated steps of the open calculated profile for phase `shownPhase` (the current phase
// unless given), as phaseSteps in progression.ts lists them with the production steps put in
// order by the profile's factory groups (groupedSteps in group-order.ts, #869). calcTasks below
// and generatedTaskIds (tasks.ts) both read them, so the steps and their ids agree.
export function orderedPhaseSteps(shownPhase: Phase = phase()): PhaseStep[] {
  if (!calculated) return [];
  return groupedSteps(
    phaseSteps(calculated, state, progressionData, shownPhase),
    state.factoryGroups,
  );
}

// The generated checklist of a calculated profile for phase `shownPhase` (the current phase
// unless given), before the user's step edits and personal tasks (tasks.ts adds those): the
// steps orderedPhaseSteps lists, with each production row's step described.
export function calcTasks(shownPhase: Phase = phase()): PlanStepData[] {
  // A page of the profile just left can be drawn once more; it then has no steps.
  if (!calculated) return [];
  // The stage of the phase shown, which need not be the current phase (#1022).
  const snapshot = calculated.stages[shownPhase === 'post' ? '5' : shownPhase];
  return orderedPhaseSteps(shownPhase).map(({ row, ...step }) =>
    row ? { ...step, body: rowStepBody(row, snapshot) } : step,
  );
}

// A production row's build-plan step text: its machines, inputs and outputs, with the pointer
// to an easier rounded option only where the dialog shows one (#379), then the factory dialog's
// byproduct advice in `snapshot`, the stage of the phase the step is in (#1022).
const rowStepBody = (row: CalcRow, snapshot: StoredStage | undefined): string =>
  siteLineText(row) +
  `${machineSetup(row).summary} ${machineSetup(row).partial ? 'Adjustable machine: ≈ ' + num(machineSetup(row).clock) + '% → ≈ ' + machineSetup(row).lastOutput + '.' + (easierSetup(machineSetup(row)) ? ' Open the production line for an easier rounded option.' : '') : 'Each machine: ' + machineSetup(row).fullOutput + '.'} ${row.amplified ? `Insert ${row.slots} somersloop${(row.slots ?? 0) > 1 ? 's' : ''} in each machine — ${row.sloops} in total — for double output from the same inputs at four times the power. ` : ''}Inputs: ${rateList(row.inputs) || 'none'}. Outputs: ${outputList(row)}.` +
  recycleStepText(row, snapshot);

// A step's byproduct advice (adviceText in recycle.ts) after a space, or '' for none.
function recycleStepText(row: CalcRow, snapshot: StoredStage | undefined): string {
  const text = adviceText(rowAdvice(row, snapshot));
  return text ? ' ' + text : '';
}

// The recycling model (recycleModel in recycle.ts) of `snapshot`, a stage of the open plan, for
// the profile's factory groups. The build plan, a group's flow page and the factory dialog ask
// for it once per line, so it is worked out once per stage, groups and plan.
let recycleCache:
  | { snapshot: StoredStage; groups: string; plan: unknown; model: RecycleModel }
  | undefined;
function recycleModelOf(snapshot: StoredStage): RecycleModel {
  const groups = factoryGroupsState(),
    key = JSON.stringify(groups);
  const cache = recycleCache;
  if (cache?.snapshot === snapshot && cache.groups === key && cache.plan === calculated)
    return cache.model;
  const model = recycleModel(snapshot, groups, calculated?.settings.onSite);
  recycleCache = { snapshot, groups: key, plan: calculated, model };
  return model;
}

// How the advice names a line (as its build-plan step is titled: "Wire for Alpha") and words a rate.
const recycleWords: AdviceWords = {
  name: row => (calculated ? rowStepTitle(calculated, state, row) : row.name),
  fluid: item => FLUIDS.has(item),
  // Called through, not referenced: flow.ts and this module import each other.
  itemRate: (item, rate) => itemRate(item, rate),
};

// A line's byproduct advice (recycle.ts, #1022) in stage `snapshot`, the phase shown unless
// given: where its byproducts go, then where the inputs a byproduct covers come from.
export const rowAdvice = (
  row: CalcRow,
  snapshot: StoredStage | undefined = calcStage(),
): AdviceLine[] => (snapshot ? lineAdvice(row, recycleModelOf(snapshot), recycleWords) : []);

// The first sentence of a step for a factory group's own line made on site (#876), naming the
// group; '' for any other row.
const siteLineText = (row: CalcRow): string =>
  row.onSite
    ? `Made on site for ${siteGroupName(row)}: it feeds that factory's own lines, and what they do not use goes to the AWESOME Sink. `
    : '';

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
      'Keep these budgets instead: untick “Whole machines” (Goals). Exact clocks fit, with one adjustable machine per production line.',
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
  if (wholeGenerators(row)) return generatorSetup(row);
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

// A generator line of a plan made since #1064: whole generators at 100% (its last one is not
// underclocked, lastClock 100), which burn fuel only for the power drawn; its `equivalent` is the
// fuel it burns. Older plans keep their underclocked last generator.
const wholeGenerators = (row: CalcRow) => row.power < 0 && !(row.lastClock < 100 - 1e-7);
function generatorSetup(row: CalcRow) {
  const fullOutput = [
    `${num(-row.power)} MW`,
    ...Object.entries(row.outputs || {}).map(([item, rate]) =>
      rateOfItem(item, rate / (row.equivalent || row.machines)),
    ),
  ].join(' · ');
  return {
    summary: `${row.machines} ${row.machine} total: all at 100%; they burn fuel only for the power drawn.`,
    whole: row.machines,
    partial: false,
    fullOutput,
    lastOutput: fullOutput,
    clock: 0,
    easy: null as EasySetup | null,
  };
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
  // The rows in the build plan's order, which a change of factory groups can change (#869).
  const ordered = groupedRows(snapshot.rows, state.factoryGroups);
  const key =
    stage() +
    '|' +
    snapshot.rows.map(r => (state.checks[prefix + r.id] ? 1 : 0)).join('') +
    '|' +
    ordered.map(r => r.id).join(',');
  if (buildPlan !== calculated || buildCache?.key !== key) {
    buildPlan = calculated;
    const spareMW = (calculated.settings.availablePowerGW || 0) * 1000;
    buildCache = { key, status: buildStatus(snapshot, state.checks, stage(), spareMW, ordered) };
  }
  return buildCache.status;
}

// A row of the open phase by its id, named as its build-plan step is (rowStepTitle): "Wire for
// Alpha" for a factory group's own line made on site (#911), else the row's name; the id itself
// for a row the phase lacks. The build status (BuildStatusPanel.vue) and ADA name rows by it.
export function buildRowName(rowId: string): string {
  const row = calcStage()?.rows?.find(candidate => candidate.id === rowId);
  if (!row) return rowId;
  return calculated ? rowStepTitle(calculated, state, row) : row.name;
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
