// For a calculated profile: the checklist steps of its plan page
// (ui/pages/CalculatedPlanPage.vue), the heading over an infeasible phase (its options are in
// app/draft-advice.ts), and the machine setup and expansion its factory dialog shows
// (ui/detail/CalcFactoryDialog.vue). Its
// resources page is ui/pages/CalculatedResourcesPage.vue. Everything reads the profile's frozen calculation
// snapshot through calcStage(); nothing here recalculates.
import { groupedRows, groupedSteps, LINK_DUST } from '../group-order.ts';
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
import {
  builtIntro,
  builtLine,
  builtNote,
  builtShare,
  builtTable,
  changedIntro,
  changedNote,
  changedTable,
  builtLineChanges,
  spareIntro,
  spareLine,
  spareNote,
  spareTable,
  type BuiltLine,
  type ChangedLine,
  type FormerLine,
  type PhaseChanges,
  type SpareLine,
} from '../built-lines.ts';
import { recipeBook, type RecipeBook } from '../../state.ts';
import { siteItems } from '../group-links.ts';
import { num } from '../format.ts';
import { burnNote, COAL_GENERATOR_FUELS } from '../sink-cause.ts';
import { adviceLineText, adviceSentence, lineAdvice, lineSink, NO_COVER } from '../recycle.ts';
import type { AdviceLine, AdviceWords } from '../recycle.ts';
import { recycleModelOf } from '../stage-recycle.ts';
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
import { perRedraw } from '../per-redraw.ts';
import { AMPLIFIER_WORDS } from '../../somersloops.ts';
import { ownedBeyondKept } from '../../power.ts';
import type { CalcRow, ItemRates, Phase, StoredStage } from '../../types/index.ts';
import type { StepList, StepTable } from '../../step-table.ts';

// A build-plan step before the user's edits: its saved check key, title and text.
export interface PlanStepData {
  id: string;
  title: string;
  body: string;
  // Optional, or done by its own condition (GuideTask in progression.ts, #1070).
  optional?: boolean;
  satisfied?: string;
  // The body as a table or a list (#1136, step-table.ts).
  table?: StepTable;
  list?: StepList;
  // A grown line's built machines under its title, "5 of 6 built" (#1174, built-lines.ts), or
  // a switched line's change, "4 to switch from Iron Plate, 1 to add" (#1175); shown while the
  // step is not ticked.
  built?: string;
  // A shrunk line's spare machines under its title, "6 built, 1 spare" (#1175), shown ticked too.
  spare?: string;
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
// for them (perRedraw in per-redraw.ts, #1060), however many components ask.
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
    row ? { ...step, ...rowStep(row, snapshot, shownPhase, step.title) } : step,
  );
});

// A production row's build-plan step text: what already runs and the generators the player has,
// then its machines, inputs and outputs (rowLineText) and why the plan sinks its spare coke
// (burnNotes, #1063), then the factory dialog's byproduct advice in
// `snapshot`, the stage of the phase the step is in (#1022). With advice, the same words as a list
// (#1136): the text before the advice above it, and each paragraph of the advice (one byproduct or
// input, adviceLineText in recycle.ts) as an item, as the dialog shows them. A grown line (#1174,
// grownLine) opens with what stands and what to add, as a table of its machines and inputs (built,
// needed, to add) with the rest of the text under it, and its built machines under its title; it
// says that rather than what ran in the phase before (carriedStepText), which it replaces.
function rowStep(
  row: CalcRow,
  snapshot: StoredStage | undefined,
  shownPhase: Phase,
  title: string,
): Pick<PlanStepData, 'body' | 'list' | 'table' | 'built' | 'spare'> {
  const burn = burnNotes(row, snapshot);
  const built = builtView(row, shownPhase);
  const lead =
    (built ? '' : carriedStepText(row, shownPhase)) +
    ownedGeneratorsText(row, snapshot) +
    rowLineText(row) +
    burn.map(note => ' ' + note).join('');
  const table = built?.table(title, lead);
  const text = table ? table.intro + ' ' + lead : lead;
  const extra = built && table ? { table, ...built.notes } : {};
  const advice = rowAdvice(row, snapshot).map(adviceLineText);
  if (!advice.length) return { body: text, ...extra };
  return {
    body: text + ' ' + advice.join(' '),
    // Under a built line's table, the advice alone.
    list: { intro: table ? '' : lead, items: advice, label: `${title}: byproducts and inputs` },
    ...extra,
  };
}

// A line of phase `shownPhase` a recalculation grew (#1174): the machines that stand on it, the
// ones its plan needs and the ones to add, while its step is not ticked; null for any other line.
// Post Phase 5 reads Phase 5's, as it shares its steps and checks.
export function grownLine(row: CalcRow, shownPhase: Phase = phase()): BuiltLine | null {
  const stageKey = shownPhase === 'post' ? '5' : shownPhase;
  return builtLine(state?.builtMachines, state?.checks || {}, stageKey, row);
}

// What the machines built on a line of phase `shownPhase` come to under its plan, for its step,
// card and dialog: a line built lines of other recipes switch to (#1175), else a grown line
// (#1174), else one with machines to spare (#1175); null for any other line. A switched line's
// step is not ticked (built-match.ts); a shrunk one may be.
interface BuiltView {
  table: (title: string, after: string) => StepTable;
  intro: string;
  notes: Pick<PlanStepData, 'built' | 'spare'>;
  card: string;
}
function builtView(row: CalcRow, shownPhase: Phase = phase()): BuiltView | null {
  const changed = changedLine(row, shownPhase);
  if (changed)
    return {
      table: (title, after) => changedTable(changed, row, title, after),
      intro: changedIntro(changed, row),
      notes: { built: changedNote(changed) },
      card: changedNote(changed),
    };
  const grown = grownLine(row, shownPhase);
  if (grown)
    return {
      table: (title, after) => builtTable(grown, row, itemRate, title, after),
      intro: builtIntro(grown, row, itemRate),
      notes: { built: builtNote(grown) },
      card: `${num(grown.built)} of ${num(grown.needed)} machines built: add ${num(grown.add)}`,
    };
  const spare = spareLineOf(row, shownPhase);
  if (spare)
    return {
      table: (title, after) => spareTable(spare, row.machine, title, after),
      intro: spareIntro(spare, row.machine),
      notes: { spare: spareNote(spare) },
      card: spare.spare
        ? `${num(spare.built)} machines built, ${num(spare.needed)} needed: ${num(spare.spare)} spare`
        : `${num(spare.built)} of ${num(spare.needed)} machines built: tick once they run`,
    };
  return null;
}

// A built line's card state (builtView): "5 of 6 machines built: add 1", "6 machines built, 5
// needed: 1 spare", "4 to switch from Iron Plate, 1 to add"; else ''.
export const grownCard = (row: CalcRow): string => builtView(row)?.card ?? '';

// A line of phase `shownPhase` with at least the machines it needs standing (#1175, spareLine):
// shrunk lines, ticked or not. Post Phase 5 reads Phase 5's.
export function spareLineOf(row: CalcRow, shownPhase: Phase = phase()): SpareLine | null {
  const stageKey = shownPhase === 'post' ? '5' : shownPhase;
  return spareLine(state?.builtMachines, state?.checks || {}, stageKey, row);
}

// The catalog's recipes (recipeBook, built-match.ts), which name the built lines the plan no
// longer has; worked out again only when the workspace brings another catalog.
let bookOf: { catalog: unknown; book: RecipeBook } | undefined;
function catalogBook(): RecipeBook {
  const catalog = workspace?.catalog;
  if (bookOf?.catalog !== catalog) bookOf = { catalog, book: recipeBook(catalog) };
  return bookOf.book;
}

// The built lines of a phase ('1'-'5') the plan no longer has (#1175, builtLineChanges): the lines
// they switch to and the ones no longer needed. Worked out once per redraw.
const changesOf = perRedraw(
  stepInputs,
  (stageKey: string): PhaseChanges =>
    calculated
      ? builtLineChanges(
          state?.builtMachines,
          state?.checks || {},
          stageKey,
          calculated,
          catalogBook(),
        )
      : { changed: new Map(), removed: [] },
);

// The line of phase `shownPhase` built lines of other recipes switch to (#1175), with what to
// switch and add; null for any other line.
export function changedLine(row: CalcRow, shownPhase: Phase = phase()): ChangedLine | null {
  return changesOf(shownPhase === 'post' ? '5' : shownPhase).changed.get(row.id) ?? null;
}

// The built lines of phase `shownPhase` no longer needed (#1175): they can be dismantled or kept.
export const formerLines = (shownPhase: Phase = phase()): FormerLine[] =>
  changesOf(shownPhase === 'post' ? '5' : shownPhase).removed;

// How many lines of the phase shown have a change task (#1175, ADA's changed-lines): switched
// lines, lines with spare machines and lines no longer needed.
export function changedLineCount(rows: readonly CalcRow[]): number {
  return (
    rows.filter(row => changedLine(row) || spareLineOf(row)?.spare).length + formerLines().length
  );
}

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

// A production row's machines, inputs and outputs in its build-plan step (rowStep), with the
// pointer to an easier rounded option only where the dialog shows one (#379). The machine setup is
// worked out once per row (#1060).
const rowLineText = (row: CalcRow): string =>
  siteLineText(row) +
  stockLineText(row) +
  `${setupText(machineSetup(row))} ${sloopText(row)}Inputs: ${rateList(row.inputs) || 'none'}. Outputs: ${outputList(row)}.`;

// A step's machines (machineSetup): the summary, then the adjustable machine's clock and output
// with the pointer to an easier rounded option, or what each machine makes.
const setupText = (setup: ReturnType<typeof machineSetup>): string =>
  `${setup.summary} ${setup.partial ? 'Adjustable machine: ≈ ' + num(setup.clock) + '% → ≈ ' + setup.lastOutput + '.' + (easierSetup(setup) ? ' Open the production line for an easier rounded option.' : '') : 'Each machine: ' + setup.fullOutput + '.'}`;

// The somersloops an amplified line takes, as a sentence with a space after it; '' for any other.
// Machines take them only after the MAM's Production Amplifier research (#1056), whose own step
// the build plan lists (requiredMilestones in progression.ts).
const sloopText = (row: CalcRow): string =>
  row.amplified
    ? `Insert ${row.slots} somersloop${(row.slots ?? 0) > 1 ? 's' : ''} in each machine — ${row.sloops} in total — for double output from the same inputs at four times the power. ${AMPLIFIER_WORDS} `
    : '';

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

// Why the plan sinks `row`'s spare Petroleum Coke or Compacted Coal rather than burning it, and
// that coal power burns it (burnNote in sink-cause.ts, #1063), in stage `snapshot`, the phase
// shown unless given: one sentence per such output the line sends to the sink, for the end of its
// build-plan step (rowStep) and under the flow in its dialog (CalcFactoryDialog.vue). What the
// line sends to the sink is its part of the books' sink (recycleModelOf), as its byproduct advice
// words it ("store or sink the other …"). Empty for any other line.
export function burnNotes(row: CalcRow, snapshot: StoredStage | undefined = calcStage()): string[] {
  const outputs = Object.keys(row.outputs || {}).filter(item =>
    COAL_GENERATOR_FUELS.includes(item),
  );
  if (!snapshot || !calculated || !outputs.length) return [];
  const model = recycleModelOf(snapshot);
  const phase = Number(
    Object.entries(calculated.stages).find(([, stage]) => stage === snapshot)?.[0] ?? 0,
  );
  return outputs.flatMap(item => {
    const sunk = lineSink(model, row.id, item);
    const note =
      sunk > LINK_DUST
        ? burnNote(row, item, sunk, snapshot, calculated?.settings, phase, piped =>
            FLUIDS.has(piped),
          )
        : undefined;
    return note ? [note] : [];
  });
}

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
// 100%, none adjustable. A Coal Generator line burning a fuel other lines make (Petroleum Coke,
// Compacted Coal, #1055) also says to give it an overflow to the sink: the generators burn only
// for the power drawn, and the rest would back up the lines making it (for Petroleum Coke, the
// Plastic and Rubber lines whose Heavy Oil Residue it uses up).
function generatorSetup(row: CalcRow) {
  const fullOutput = [
    `${num(-row.power)} MW`,
    ...Object.entries(row.outputs || {}).map(([item, rate]) =>
      rateOfItem(item, rate / (row.equivalent || row.machines)),
    ),
  ].join(' · ');
  return {
    summary: `${row.machines} ${row.machine} total: all at 100%; they burn fuel only for the power drawn.${madeFuelOverflow(row)}`,
    whole: row.machines,
    partial: false,
    fullOutput,
    lastOutput: fullOutput,
    clock: 0,
    easy: null as EasySetup | null,
  };
}

// The overflow sentence of a generator line burning Petroleum Coke or Compacted Coal, after a
// space; '' for any other line.
const madeFuelOverflow = (row: CalcRow): string => {
  const fuel = ['Petroleum Coke', 'Compacted Coal'].find(item => row.inputs?.[item]);
  return fuel
    ? ` Give the ${fuel} belt an overflow to the AWESOME Sink, so the lines making it never back up.`
    : '';
};

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
// its expansion table; for a line a recalculation grew, its step's opening sentence instead
// (builtIntro, #1174); '' for any other line.
export function carriedLineText(row: CalcRow): string {
  const built = builtView(row);
  return built ? built.intro : carriedStepText(row, phase()).trim();
}

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
  // The lines still running from the phase before, at the share they make (#1069), and the grown
  // lines at the share their built machines make (#1174).
  const carried = new Map([...(currentCarry()?.shares || []), ...grownShares(snapshot.rows)]);
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

// The grown lines of the phase shown (#1174, grownLine) with the share their built machines make
// (builtShare), which the build status runs them at until their steps are ticked.
export function grownShares(rows: readonly CalcRow[]): Map<string, number> {
  const shares = new Map<string, number>();
  for (const row of rows) {
    const grown = grownLine(row);
    if (grown) shares.set(row.id, builtShare(grown, row));
  }
  return shares;
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
