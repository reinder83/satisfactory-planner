// For a calculated profile: the checklist steps of its plan page
// (ui/pages/CalculatedPlanPage.vue), the options for an infeasible phase, and the machine
// setup and expansion its factory dialog shows (ui/detail/CalcFactoryDialog.vue). Its
// resources page is ui/pages/CalculatedResourcesPage.vue. Everything reads the profile's frozen calculation
// snapshot through calcStage(); nothing here recalculates.
import { groupedRows, groupedSteps } from '../group-order.ts';
import { phaseSteps, rowStepTitle, type PhaseStep } from '../../progression.ts';
import { buildStatus, siteRouting, type BuildStatus } from '../build-status.ts';
import {
  carriedLine,
  carriedMachinesText,
  carriedText,
  phaseCarry,
  type PhaseCarry,
} from '../handover.ts';
import { FLUIDS, itemRate, rateOfItem, wholeGenerators } from '../flow.ts';
import { siteItems } from '../group-links.ts';
import { num } from '../format.ts';
import { adviceSentence, adviceText, lineAdvice, NO_COVER, recycleModel } from '../recycle.ts';
import type { AdviceLine, AdviceWords, RecycleModel } from '../recycle.ts';
import {
  calcStage,
  calculated,
  fromStart,
  milestoneOnly,
  phase,
  phaseLabel,
  progressionData,
  stage,
  state,
  ticksNoticeDismissed,
  workingPhaseNotShown,
  workspace,
} from '../session.ts';
import {
  dismissedFound,
  foundSince,
  ownedFromTicks,
  ticksPhase,
  type OwnedFound,
} from '../owned-ticks.ts';
import { power } from '../wizard/fields.ts';
import { factoryGroupsState, siteGroupName } from './factories.ts';
import { perRedraw } from '../ui/bridge.ts';
import { minerWords } from '../../mining.ts';
import { ownedBeyondKept } from '../../power.ts';
import type { CalcRow, CurrentSettings, ItemRates, Phase, StoredStage } from '../../types/index.ts';

// A build-plan step before the user's edits: its saved check key, title and text.
export interface PlanStepData {
  id: string;
  title: string;
  body: string;
  // Optional, or done by its own condition (GuideTask in progression.ts, #1070).
  optional?: boolean;
  satisfied?: string;
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

// The session values the build plan's steps are worked out from: a save replaces the progress
// state and opening a profile the plan, so the steps of a phase are worked out once per redraw
// for them (perRedraw in ui/bridge.ts, #1060), however many components ask.
const stepInputs = () => [calculated, state, progressionData];

// The generated steps of the open calculated profile for phase `shownPhase` (the current phase
// unless given), as phaseSteps in progression.ts lists them with the production steps put in
// order by the profile's factory groups (groupedSteps in group-order.ts, #869). calcTasks below
// and generatedTaskIds (tasks.ts) both read them, so the steps and their ids agree.
export const orderedPhaseSteps = (shownPhase: Phase = phase()): PhaseStep[] =>
  orderedStepsOf(shownPhase);
const orderedStepsOf = perRedraw(stepInputs, (shownPhase: Phase): PhaseStep[] => {
  if (!calculated) return [];
  return groupedSteps(
    phaseSteps(calculated, state, progressionData, shownPhase),
    state.factoryGroups,
  );
});

// The generated checklist of a calculated profile for phase `shownPhase` (the current phase
// unless given), before the user's step edits and personal tasks (tasks.ts adds those): the
// steps orderedPhaseSteps lists, with each production row's step described.
export const calcTasks = (shownPhase: Phase = phase()): PlanStepData[] => calcTasksOf(shownPhase);
const calcTasksOf = perRedraw(stepInputs, (shownPhase: Phase): PlanStepData[] => {
  // A page of the profile just left can be drawn once more; it then has no steps.
  if (!calculated) return [];
  // The stage of the phase shown, which need not be the current phase (#1022).
  const snapshot = calculated.stages[shownPhase === 'post' ? '5' : shownPhase];
  return orderedPhaseSteps(shownPhase).map(({ row, ...step }) =>
    row
      ? {
          ...step,
          body:
            carriedStepText(row, shownPhase) +
            ownedGeneratorsText(row, snapshot) +
            rowStepBody(row, snapshot),
        }
      : step,
  );
});

// The opening sentence of a generator line's step where the player already has generators of its
// building that the phase counts (#1068, settings.ownedGenerators, ownedBeyondKept in power.ts):
// how many of its machines they are, and how many are left to build. With one line in the
// building: "You already have 4 of these 6 Coal Generators: build 2 more. " or "You already have
// 8 Coal Generators, enough for this line's 6: build none. "; with several, counted over them
// together ("… of the 30 Fuel Generators this phase's 2 Fuel Generator lines run: build 27 more
// between them. "). '' for any other line. It reads the stored plan and changes nothing.
export function ownedGeneratorsText(row: CalcRow, snapshot: StoredStage | undefined): string {
  if (!(row.power < 0)) return '';
  const entry = ownedBeyondKept(snapshot?.grid).find(owned => owned.machine === row.machine);
  if (!entry) return '';
  const have = entry.owned ?? 0,
    plural = (count: number) => row.machine + (count === 1 ? '' : 's');
  const lines = (snapshot?.rows || []).filter(
    other => other.power < 0 && other.machine === row.machine,
  ).length;
  const left = entry.machines - Math.max(have, entry.kept);
  if (lines > 1) {
    const run = `this phase's ${lines} ${row.machine} lines run`;
    return have < entry.own
      ? `You already have ${num(have)} of the ${num(entry.own)} ${plural(entry.own)} ${run}: build ${num(left)} more between them. `
      : `You already have ${num(have)} ${plural(have)}, enough for the ${num(entry.own)} ${run}: build none. `;
  }
  return have < entry.own
    ? `You already have ${num(have)} of these ${num(entry.own)} ${plural(entry.own)}: build ${num(left)} more. `
    : `You already have ${num(have)} ${plural(have)}, enough for this line's ${num(entry.own)}: build none. `;
}

// The opening sentence of a step for a line the phase before marked running and this phase builds
// again (carriedText in handover.ts, #1069): what already runs and what to add or change; '' for
// any other line. It reads the saved ticks of the phase before and changes none.
function carriedStepText(row: CalcRow, shownPhase: Phase): string {
  const carried = calculated && carriedLine(calculated, state.checks, shownPhase, row.id);
  return carried ? carriedText(carried, row) : '';
}

// A production row's build-plan step text: its machines, inputs and outputs, with the pointer
// to an easier rounded option only where the dialog shows one (#379), then the factory dialog's
// byproduct advice in `snapshot`, the stage of the phase the step is in (#1022). The machine
// setup is worked out once per row (#1060).
const rowStepBody = (row: CalcRow, snapshot: StoredStage | undefined): string =>
  siteLineText(row) +
  stockLineText(row) +
  `${setupText(machineSetup(row))} ${sloopText(row)}Inputs: ${rateList(row.inputs) || 'none'}. Outputs: ${outputList(row)}.` +
  recycleStepText(row, snapshot);

// A step's machines (machineSetup): the summary, then the adjustable machine's clock and output
// with the pointer to an easier rounded option, or what each machine makes.
const setupText = (setup: ReturnType<typeof machineSetup>): string =>
  `${setup.summary} ${setup.partial ? 'Adjustable machine: ≈ ' + num(setup.clock) + '% → ≈ ' + setup.lastOutput + '.' + (easierSetup(setup) ? ' Open the production line for an easier rounded option.' : '') : 'Each machine: ' + setup.fullOutput + '.'}`;

// The somersloops an amplified line takes, as a sentence with a space after it; '' for any other.
const sloopText = (row: CalcRow): string =>
  row.amplified
    ? `Insert ${row.slots} somersloop${(row.slots ?? 0) > 1 ? 's' : ''} in each machine — ${row.sloops} in total — for double output from the same inputs at four times the power. `
    : '';

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
  name: row => stepRowName(row),
  fluid: item => FLUIDS.has(item),
  // Called through, not referenced: flow.ts and this module import each other.
  itemRate: (item, rate) => itemRate(item, rate),
};

// A line's byproduct advice (recycle.ts, #1022) in stage `snapshot`, the phase shown unless
// given: where its byproducts go, then where the inputs a byproduct covers come from. With
// `place` (a group id), only the line's part in that group, as its flow page shows a split row.
export const rowAdvice = (
  row: CalcRow,
  snapshot: StoredStage | undefined = calcStage(),
  place?: string,
): AdviceLine[] => (snapshot ? lineAdvice(row, recycleModelOf(snapshot), recycleWords, place) : []);

// One ♻ line of a group's flow page: the advice for an output (`out`, a byproduct) or an input
// (`in`) of the group's part of a line, as text, with the Water Extractors after the sentence.
// `recycled` is false for Water no byproduct covers, which is not drawn as recycling.
export interface FlowAdvice {
  side: 'in' | 'out';
  item: string;
  lead: string;
  text: string;
  recycled: boolean;
}

// The ♻ lines of line `rowId` on group `place`'s flow page, in the phase shown: its card's lines
// under the rows (ui/group-flow/FlowCard.vue) and the table's (FlowTable.vue). A row split over
// several places gets its part in the group, not the whole line's advice.
export function flowAdvice(rowId: string, place: string): FlowAdvice[] {
  const row = calcStage()?.rows?.find(candidate => candidate.id === rowId);
  return (row ? rowAdvice(row, calcStage(), place) : []).map(line => ({
    side: line.kind === 'byproduct' ? 'out' : 'in',
    item: line.item,
    lead: line.lead,
    text: [adviceSentence(line), line.extractors].filter(Boolean).join(' '),
    recycled: line.parts[0] !== NO_COVER,
  }));
}

// The first sentence of a step for a factory group's own line made on site (#876), naming the
// group; '' for any other row. Only the outputs the plan was calculated to make on site for the
// group (siteItems, as the Logistics books keep them) feed it first; when the line also makes
// another, a byproduct such as the Water of "Aluminum Scrap for Group 1", the sentence names the
// items, and that byproduct goes to the rest of the plan like any line's (#1001).
function siteLineText(row: CalcRow): string {
  if (!row.onSite) return '';
  const outputs = Object.keys(row.outputs || {});
  const kept = siteItems(factoryGroupsState(), row.onSite.group, calculated?.settings.onSite);
  const own = outputs.filter(item => kept.includes(item)),
    other = outputs.filter(item => !kept.includes(item));
  const verb = (items: string[], one: string, more: string) => (items.length > 1 ? more : one);
  const rest = ` that factory's own lines first, and what they do not use goes to any other line that still needs it, then to the AWESOME Sink. `;
  return own.length && other.length
    ? `Made on site for ${siteGroupName(row)}: its ${listNames(own)} ${verb(own, 'feeds', 'feed')}${rest}Its ${listNames(other)} ${verb(other, 'goes', 'go')} to the rest of the plan, like any line's byproduct. `
    : `Made on site for ${siteGroupName(row)}: it feeds${rest}`;
}

// The first sentence of a step for a storage-only line (#1061), saying it is optional; '' for any
// other row.
const stockLineText = (row: CalcRow): string =>
  row.stock
    ? 'Optional, built last: this line only serves protected storage, for the containers the plan has no surplus to fill, and no other line needs it. A full container overflows to the AWESOME Sink. '
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

// One short budget in draftFixes' words: "Iron Ore to about 1,200/min (entered: 1,000/min)". With
// mining per phase (#1065) the phase gets a share of the entered budget, so the entered budget it
// would take, and what the phase gets now: "Iron Ore to about 12,000/min (entered: 9,210/min;
// this phase gets 921/min of it with Miner Mk.1 at 100%)". "to at least" for an unconfirmed amount.
function shortfallWords(
  shortfall: NonNullable<StoredStage['shortfalls']>[number],
  snapshot: StoredStage,
  settings: Partial<CurrentSettings> | undefined,
): string {
  const entered = settings?.limits?.[shortfall.name];
  const mining = snapshot.mining;
  // A whole-machine draft amount the real fit did not confirm is a floor (#1091).
  const about = shortfall.atLeast ? 'at least' : 'about';
  if (!mining || entered === undefined || !(shortfall.budget > 0))
    return `${shortfall.name} to ${about} ${itemRate(shortfall.name, shortfall.needed)} (entered: ${itemRate(shortfall.name, shortfall.budget)})`;
  const share = shortfall.budget / entered;
  return `${shortfall.name} to ${about} ${itemRate(shortfall.name, Math.ceil(shortfall.needed / share))} (entered: ${itemRate(shortfall.name, entered)}; this phase gets ${itemRate(shortfall.name, shortfall.budget)} of it with ${minerWords(mining.miner)})`;
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
      `Raise the short budget${snapshot.shortfalls.length > 1 ? 's' : ''} (Resources): ${snapshot.shortfalls.map(shortfall => shortfallWords(shortfall, snapshot, settings)).join('; ')}.`,
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
  else if (snapshot.shortfalls?.length && !snapshot.wholeMachinesOnly) {
    // Storage fed from surplus is not a demand of a whole-machine draft's solve (#1100), so
    // lowering it does not help; a draft stored before that, whose solve held storage, names it.
    const fromSurplus =
      settings?.wholeMachines &&
      settings.storageFromSurplus === true &&
      !Object.values(snapshot.storage ?? {}).some(rate => rate > 0);
    const demands = `${fromSurplus ? '' : 'the protected storage refill rate, '}drone-fuel supply or extra Singularity Cells (Preferences)`;
    fixes.push(
      settings?.goal === 'maximum'
        ? `Lower ${demands}.`
        : `More time alone will not fit: lower ${demands}${settings?.roundRates ? ', or untick delivery-rate rounding (Goals)' : ''}.`,
    );
  }
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

// A generator line of a plan made since #1064 (wholeGenerators in flow.ts): whole generators at
// 100%, none adjustable.
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
      // The line's Running tick in that phase (#1069).
      running: !!required && !!state.checks['calc-' + stagePhase + '-' + id],
    };
  });
}

// What a line the phase before marked running already does in the phase shown, and what this
// phase changes on it (carriedText in handover.ts, #1069), for the production line dialog under
// its expansion table; '' for any other line.
export const carriedLineText = (row: CalcRow): string => carriedStepText(row, phase()).trim();

// The lines of the phase shown that run from the phase before and are not ticked here yet, with
// the share of each that already runs (phaseCarry in handover.ts, #1069). It reads the saved
// ticks and changes none.
export const currentCarry = (): PhaseCarry | null =>
  calculated ? phaseCarry(calculated, state.checks, phase()) : null;

// A line's card state while it runs from the phase before and is not ticked here yet: that phase
// and "Running since Phase 1: 2 of 5 machines" (carriedMachinesText in handover.ts, #1069), else
// null.
export function carriedCard(row: CalcRow): { from: string; text: string } | null {
  if (!calculated || state.checks['calc-' + phase() + '-' + row.id]) return null;
  const carried = carriedLine(calculated, state.checks, phase(), row.id);
  return carried ? { from: carried.from, text: carriedMachinesText(carried, row) } : null;
}

// The build plan's "Your ticks show more than this plan counts" notice (#1068,
// ui/plan/OwnedTicksNotice.vue, ADA's owned-ticks line): what the open profile's ticks show
// beyond its plan's settings (ownedFromTicks in owned-ticks.ts), while the page shows the saved
// working phase (not an earlier phase it opened on, nor a milestone-only one), and only when it
// holds something the user has not dismissed in this browser (ticksNoticeDismissed). Null
// otherwise. It reads the ticks and changes nothing.
export function ownedTicksNotice(): OwnedFound | null {
  // The phase picker says "Showing" for any other phase (#992); this is about the working one.
  if (!calculated || milestoneOnly() || workingPhaseNotShown()) return null;
  const working = ticksPhase(calculated, state.settings.phase);
  const found = ownedFromTicks(calculated, state.checks, working, workspace.catalog?.alternates);
  return found && foundSince(found, dismissedFound(ticksNoticeDismissed())) ? found : null;
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
// ticked as built, and the lines running from the phase before at their earlier size (#1069),
// produce now. null without a calculated plan with rows. The pages and ADA ask
// for it on every redraw, and finding the next step recalculates the stage once per unbuilt row,
// so the last answer is kept until the plan, the stage, a row tick or where the lines made on site
// send their items (siteRouting, #907) changes.
let buildCache: { key: string; status: BuildStatus | null } | null = null;
let buildPlan: unknown = null;
export function currentBuildStatus(): BuildStatus | null {
  const snapshot = calcStage();
  if (!calculated || !snapshot?.rows?.length) return null;
  const prefix = 'calc-' + stage() + '-';
  // The rows in the build plan's order, which a change of factory groups can change (#869).
  const ordered = groupedRows(snapshot.rows, state.factoryGroups);
  // The lines still running from the phase before, at the share they make (#1069).
  const carried = currentCarry()?.shares || new Map<string, number>();
  // Where the lines made on site send their items, by the profile's groups (#907).
  const sites = siteRouting(snapshot, factoryGroupsState(), calculated.settings.onSite);
  const key =
    stage() +
    '|' +
    snapshot.rows.map(r => (state.checks[prefix + r.id] ? 1 : 0)).join('') +
    '|' +
    ordered.map(r => r.id).join(',') +
    '|' +
    [...carried].map(([id, share]) => id + ':' + share).join(',') +
    '|' +
    JSON.stringify([[...sites.inputs], [...sites.outputs]]);
  if (buildPlan !== calculated || buildCache?.key !== key) {
    buildPlan = calculated;
    const spareMW = (calculated.settings.availablePowerGW || 0) * 1000;
    buildCache = {
      key,
      status: buildStatus(snapshot, state.checks, stage(), spareMW, ordered, carried, sites),
    };
  }
  return buildCache.status;
}

// A row of the open plan named as its build-plan step is (rowStepTitle): "Wire for Alpha" for a
// factory group's own line made on site (#911), else the row's name. A step's linked-line choices
// name the lines by it (taskLinkChoices, #954).
export const stepRowName = (row: CalcRow): string =>
  calculated ? rowStepTitle(calculated, state, row) : row.name;

// A row of the open phase by its id, named as its build-plan step is (stepRowName); the id
// itself for a row the phase lacks. The build status (BuildStatusPanel.vue) and ADA name rows
// by it.
export function buildRowName(rowId: string): string {
  const row = calcStage()?.rows?.find(candidate => candidate.id === rowId);
  return row ? stepRowName(row) : rowId;
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
