// Production flow of a factory: belts, pipes, inputs, outputs and lane advice.
// A flow model is a plain object describing one factory at one phase: what comes in (with the
// belts or pipes that carry it), the machine bar, and where the output goes. It is built from a
// calculated plan (calcFlowModel, planner rows), and drawn by ui/detail/FlowDiagram.vue and
// LaneAdvice.vue in the factory dialog. Everything in it is data: a link to another factory's
// dialog is { calcFactory: <row id> } (see factoryLink in ui/actions.ts).
//
// An item a factory group makes on site (#868, #876) is shared out as the Logistics page's books
// say (itemBooks in group-links.ts, #956): a group's own line delivers only to that group's
// share of each consumer, and what it makes beyond that to the sink; the other lines making the
// item deliver what is left; and a consumer's input links to the line that feeds most of it.
// After a group edit, or where the plan routed their excess to the central demand (#1063), a
// group's own lines may make more than the sink has room for (#918, ItemBooks.offered): that part
// is shared with the other lines' supply (ordinaryShares).
// Every other item, and every item of a plan without such lines, is shared plan-wide.
import { num, num3 } from './format.ts';
import { wholeShares } from './apportion.ts';
import { itemBooks, placeTotal, sharedRate } from './group-links.ts';
import { LINK_DUST, rowPlaces } from './group-order.ts';
import { calcStage, calculated, checked, progressionData, stage } from './session.ts';
import { factoryGroupsState } from './views/factories.ts';
import { power } from './wizard/fields.ts';
import { sinkCaption, sinkCause } from './sink-cause.ts';
import { BELT_MARKS, PIPE_MARKS, phaseForTier } from '../preferences.ts';
import { rowStepTitle } from '../progression.ts';
import type { ItemBooks } from './group-links.ts';
import type { FactoryLink } from './ui/actions.ts';
import type {
  CalcRow,
  FactoryGroups,
  OnSiteSettings,
  StoredSettings,
  StoredStage,
} from '../types/index.ts';

// A belt or pipe mark: cap per lane, and the milestone that unlocks it.
interface Lane {
  mark: string;
  cap: number;
  entry: string;
}

// The milestone behind a lane mark (laneMilestone).
export interface LaneMilestone {
  name: string;
  tier: number;
  phase: number;
  marked: boolean;
}

// The best mark available (bestLane), with the next one up. `owned`: a belt available only because
// the player already has it (settings.ownedBelt, #1068), its milestone neither ticked nor due yet;
// absent otherwise, so a plan without one gives the lanes it always gave.
export interface BestLane extends Lane {
  fluid: boolean;
  unit: string;
  owned?: true;
  milestone: LaneMilestone | null;
  next: (Lane & { milestone: LaneMilestone | null }) | null;
}

// How many lanes carry a rate (lanePlan).
export interface LanePlan {
  lane: BestLane;
  count: number;
  last: number;
  full: number;
  spare: number;
  word: 'belt' | 'pipe';
}

// One destination row of a flow diagram. kind picks its style: another factory, storage, a
// shipment (the elevator, fuel, the grid), a drone contract, the sink, or folded extra rows.
export interface FlowOutput {
  kind: 'consumer' | 'store' | 'ship' | 'drone' | 'sink' | 'more';
  label: string;
  icon?: string;
  link?: FactoryLink;
  rate?: number;
  unit?: string;
  // Machines of this factory the destination takes at 100%; undefined when not meaningful.
  mach?: number;
  // This line's whole machines for the destination (splitMachines, #1067): the destinations'
  // counts together are the line's machine count, by largest remainder, so the split adds up; and
  // `lineMach`, the exact part of the line's machines at 100% they stand for (`mach`, scaled to
  // the line's own output where the destinations are the plan-wide demand of an item other lines
  // make too). Set together.
  machines?: number;
  lineMach?: number;
  beltTxt?: string;
  // The output item's name, prefixed when a row has byproducts.
  pre?: string;
  shipSub?: string;
  subTxt?: string;
  rateTxt?: string;
  // The destination takes no item: a generator's power grid. It is drawn without an icon or
  // an empty icon frame, and is not item demand for the bank note (#560).
  noItem?: true;
}

// One input of a flow diagram, with its lanes.
export interface FlowInput {
  name: string;
  rate: number;
  link: FactoryLink | null;
  plan: LanePlan;
}

// Another consumer of the same item, for LaneAdvice.vue's spare-lane suggestion.
export interface SameItemConsumer {
  label: string;
  rate: number;
  link: FactoryLink;
}

// A recipe panel cell: an item, its rate per machine, and a link to the factory making it.
export type RecipeCellData = [name: string, rate: number, link?: FactoryLink | null];
// The recipe panel (ui/detail/RecipePanel.vue): per-machine rates in and out.
export interface RecipeView {
  name: string;
  machine: string;
  ins: RecipeCellData[];
  outs: RecipeCellData[];
}

// What a bank note says of the lines a row shares its plan-wide destinations with (supplyNote).
// `shared`: another line makes one of the same items for the same consumers, which the note calls
// "the other recipes producing it", or "the other lines making it" with `sameRecipe`, when one of
// them follows the row's own recipe (a group's copy of it, #1002). `lessOnSite`: the demand leaves
// out what groups' own lines make on site for themselves. `leftover`: after a group edit, groups
// whose own lines' excess, offered to the other places (#918), meets a part of that demand too,
// which the row's destinations leave out; the note names them rather than count those lines among
// the other recipes (#1002).
export interface SupplyNote {
  shared: boolean;
  sameRecipe?: true;
  lessOnSite?: true;
  leftover?: LeftoverLines;
}

// The groups whose own lines made on site offer their excess (SupplyNote.leftover), by name, and
// how many such lines there are in all.
export interface LeftoverLines {
  groups: string[];
  lines: number;
}

// The note under a factory's destinations (flowNotes). For a group's own line made on site,
// `ownLine` names the group, whose lines it delivers to alone (#956), and `shared` says only
// whether another of that group's own lines makes the same item (#1001). Any other row's note is a
// SupplyNote.
export interface BankNote extends SupplyNote {
  ownLine?: string;
  // An own line's group offers what the sink has no room for to the other places (#918).
  offers?: true;
  // An own line's group asks for none of the item since a group edit, and offers none: all of it
  // goes to the sink (#1002).
  asksNone?: true;
  // An own line's outputs its group does not mark, such as a byproduct (#1001): they go to the
  // plan-wide demand for them, as any other line's do.
  planWide?: SupplyNote & { items: string[] };
}

// A factory's flow at one phase (see the top of this file).
export interface FlowModel {
  stage: string;
  inputs: FlowInput[];
  outputs: FlowOutput[];
  equivalent: number;
  machineCount: number;
  machineName: string;
  // Per-machine rates for the recipe panel.
  recipe: RecipeView | null;
  bar: {
    sub: string;
    // A rate with its unit, or a text (a generator's power).
    out:
      | { rate: string; unit: string; text?: undefined }
      | { text: string; rate?: undefined; unit?: undefined };
    outSub: string;
  } | null;
  bankNote?: BankNote | null;
  sameItemConsumers: (item: string) => SameItemConsumer[];
}

// Belt/pipe logistics. Capacities are game constants; the unlocking milestone (tier, name) comes from progression.json.
// Items that travel by pipe: rates for these are m³/min instead of items/min. Matches the items
// marked fluid in recipes.json.
export const FLUIDS = new Set([
  'Fuel',
  'Rocket Fuel',
  'Nitric Acid',
  'Turbofuel',
  'Ionized Fuel',
  'Dark Matter Residue',
  'Excited Photonic Matter',
  'Heavy Oil Residue',
  'Alumina Solution',
  'Sulfuric Acid',
  'Dissolved Silica',
  'Nitrogen Gas',
  'Water',
  'Crude Oil',
  'Liquid Biofuel',
]);

// Whether an item travels by pipe, as sinkCause asks.
const isFluid = (item: string) => FLUIDS.has(item);

// The unit an item's rate is written in (#351, #361): m³/min for a fluid, /min for anything
// else. A card's headline shows it in its own span beside the number.
export const rateUnit = (item: string): string => (FLUIDS.has(item) ? 'm³/min' : '/min');

// What goes between a headline's number and its unit span (#651): nothing before "/min", so a
// card reads "435/min" like every other rate, and a no-break space before a word unit
// (m³/min, MW, GW), as itemRate and power write them.
export const unitGap = (unit: string): string => (unit.startsWith('/') ? '' : ' ');

// An item's rate with that unit, as the rate lists write it after the item's name: "120 m³/min"
// for a fluid, "45/min" for a solid. A no-break space keeps a fluid's rate on one line, as the
// dialogs' summary line does.
export const itemRate = (item: string, rate: number): string =>
  num(rate) + (FLUIDS.has(item) ? '\u00a0' : '') + rateUnit(item);

// A rate that leads with the amount and names the item in between: "60 m³ Fuel/min" for a
// fluid, "45 Iron Plate/min" for a solid. `formatNumber` formats the number (num3 for a
// per-machine rate).
export const rateOfItem = (item: string, rate: number, formatNumber = num): string =>
  `${formatNumber(rate)}${FLUIDS.has(item) ? '\u00a0m³' : ''} ${item}/min`;

// Conveyor belt and pipeline marks in unlock order, from the one table the planner's mining per
// phase reads too (BELT_MARKS and PIPE_MARKS in preferences/mining.ts, #1065): cap is items/min
// per belt (m³/min per pipe); entry is the progression.json milestone id that unlocks the mark.
// Read when a lane is planned rather than when the module loads: the interface tests supply the
// shared modules' names to the app as it starts.
const toLane = ({ mark, cap, entry }: Lane): Lane => ({ mark, cap, entry });
const laneMarks = (fluid: boolean): Lane[] => (fluid ? PIPE_MARKS : BELT_MARKS).map(toLane);

// The milestone that unlocks a belt or pipe mark: its name, tier, the phase it belongs to and
// whether the user has ticked its `unlock-<id>` step. Null when progression.json lacks the entry.
function laneMilestone(lane: Lane): LaneMilestone | null {
  const entry = progressionData?.entries.find(x => x.id === lane.entry);
  return entry
    ? {
        name: entry.name,
        tier: entry.tier,
        phase: phaseForTier(entry.tier),
        marked: checked('unlock-' + entry.id),
      }
    : null;
}

// The belt mark the open plan says the player already has (settings.ownedBelt, #1068): "Mk.4", or
// null for a plan without one (every plan made before it).
const ownedBeltMark = (): string | null =>
  calculated?.settings.ownedBelt ? `Mk.${calculated.settings.ownedBelt}` : null;

// The highest belt (or pipe) mark available at phase `stageKey` (default: the current stage). A mark
// counts as available when its milestone is ticked, belongs to this phase or earlier, or is
// unknown; Mk.1 is the fallback. A belt the player already has (ownedBeltMark, #1068) and the
// belts below it count as available too, as the plan's mining counts them. Returns the lane with
// its display unit, its milestone, whether only owning it makes it available (`owned`) and the
// next mark up (with that mark's milestone), which LaneAdvice.vue mentions as the next upgrade.
export function bestLane(fluid: boolean, stageKey?: string): BestLane {
  const lanes = laneMarks(fluid);
  const stageNo = Number(stageKey ?? stage());
  const ownedUpTo = fluid ? -1 : lanes.findIndex(lane => lane.mark === ownedBeltMark());
  // Both lists start with Mk.1.
  let best = lanes[0]!,
    bestMilestone = laneMilestone(best),
    owned = false;
  lanes.forEach((lane, index) => {
    const milestone = laneMilestone(lane);
    const unlocked = !milestone || milestone.marked || milestone.phase <= stageNo;
    if (unlocked || index <= ownedUpTo) {
      best = lane;
      bestMilestone = milestone;
      owned = !unlocked;
    }
  });
  const next = lanes[lanes.indexOf(best) + 1];
  return {
    ...best,
    fluid,
    unit: fluid ? ' m³/min' : '/min',
    ...(owned ? { owned: true as const } : {}),
    milestone: bestMilestone,
    next: next ? { ...next, milestone: laneMilestone(next) } : null,
  };
}

// What a belt or pipe mark the phase plans with still needs (#1065): "Mk.5 belts need Tier 7 ·
// Logistics Mk.5, which is not ticked yet: until then, plan with Mk.4 belts (480/min).", or ''
// once its milestone is ticked (or for Mk.1, which needs none), and for a belt the player already
// has (#1068).
export function laneUnlockNote(lane: BestLane): string {
  const marks = laneMarks(lane.fluid);
  const milestone = lane.milestone,
    previous = marks[marks.findIndex(mark => mark.mark === lane.mark) - 1];
  if (!milestone || milestone.marked || lane.owned || !previous) return '';
  const word = lane.fluid ? 'pipes' : 'belts';
  return `${lane.mark} ${word} need Tier ${milestone.tier} · ${milestone.name}, which is not ticked yet: until then, plan with ${previous.mark} ${word} (${num(previous.cap)}${lane.unit}).`;
}

// How many belts or pipes of the best available mark carry `rate`. Returns the lane, the lane
// count (at least 1), the rate on the last lane, how many lanes run full, the unused capacity
// (all of it on the last lane) and the word to print. The 1e-9, a fraction of one lane in both
// places, keeps a rate within floating-point noise of an exact multiple of the capacity from
// counting an extra lane or a partly filled last one.
export function lanePlan(rate: number, fluid: boolean, stageKey?: string): LanePlan {
  const lane = bestLane(fluid, stageKey);
  const count = Math.max(1, Math.ceil(rate / lane.cap - 1e-9));
  const last = rate - (count - 1) * lane.cap;
  return {
    lane,
    count,
    last,
    full: count - (last < lane.cap * (1 - 1e-9) ? 1 : 0),
    spare: count * lane.cap - rate,
    word: fluid ? 'pipe' : 'belt',
  };
}

// "1 of the 12 Refineries" or "1 × Refinery": the recipe panel's rates are for one machine.
// The y→ie swap pluralises Refinery and Foundry.
export const machinesLabel = (count: number, machine: string) =>
  count > 1 ? `1 of the ${num(count)} ${machine.replace(/y$/, 'ie')}s` : `1 × ${machine}`;

// "2 × Mk.3 belts": the lanes a lane plan counts, as the destinations and the machine bars
// print them.
export const beltTxt = (lanes: LanePlan) =>
  `${lanes.count} × ${lanes.lane.mark} ${lanes.word}${lanes.count > 1 ? 's' : ''}`;

// The belts or pipes that carry `rate` of `item` at phase `stageKey`, as beltTxt words them
// ("2 × Mk.3 belts", "1 × Mk.1 pipe"). A group's flow (group-flow.ts) takes it as its belts.
export const itemBelts = (item: string, rate: number, stageKey?: string): string =>
  beltTxt(lanePlan(rate, FLUIDS.has(item), stageKey));

// Keeps a destination list to at most ten rows: past that, the first nine stay and the rest become
// one "+ N more destinations" row carrying their summed rate. Order is the caller's, so whatever
// sorts last is what gets folded. The folded row keeps the machines of the rows it folds
// (splitMachines), so the split still adds up to the line's machines.
function capFlowOutputs(list: FlowOutput[], unit = '/min'): FlowOutput[] {
  if (list.length <= 10) return list;
  const rest = list.slice(9),
    sum = rest.reduce((total, output) => total + (output.rate || 0), 0);
  const split = rest.filter(output => output.machines !== undefined);
  const machines = split.length
    ? {
        machines: split.reduce((total, output) => total + (output.machines || 0), 0),
        lineMach: split.reduce((total, output) => total + (output.lineMach || 0), 0),
      }
    : {};
  return [
    ...list.slice(0, 9),
    { kind: 'more', label: `+ ${rest.length} more destinations`, rate: sum, unit, ...machines },
  ];
}

// The line's machines split over its destinations (#1067): the line's whole machines shared out
// over them by largest remainder (wholeShares) in proportion to each one's machines at 100%
// (`mach`, and the sink's, which flowOutputs gives none), so the counts (`machines`) add up to the
// line's machines rather than to more, as rounding each one up did (46 for 43). `lineMach` is each
// one's exact part, scaled to the line's own output when the destinations ask for more (an item
// other lines make too: they are its plan-wide demand). `mach` stays as it was. A row with
// byproducts, whose machines make every output at once, is left as it is.
export function splitMachines(row: CalcRow, outputs: FlowOutput[]): FlowOutput[] {
  const items = Object.keys(row.outputs || {});
  if (items.length !== 1) return outputs;
  const equivalent = rowEquivalent(row),
    perMachine = (row.outputs[items[0]!] || 0) / equivalent;
  if (!(perMachine > 0)) return outputs;
  const splits = (output: FlowOutput) =>
    output.mach !== undefined || (output.kind === 'sink' && !!output.rate);
  const exact = outputs.map(output =>
    splits(output) ? (output.mach ?? (output.rate || 0) / perMachine) : 0,
  );
  const total = exact.reduce((sum, mach) => sum + mach, 0);
  if (!(total > 0)) return outputs;
  // Within rounding noise of the line's output, the parts stay as flowOutputs gave them.
  const scale = total > equivalent * (1 + 1e-9) ? equivalent / total : 1;
  const whole = wholeShares(row.machines, exact);
  return outputs.map((output, i) =>
    splits(output) ? { ...output, machines: whole[i]!, lineMach: exact[i]! * scale } : output,
  );
}

// What the calculated-row helpers below read besides the row: the phase's stored stage (its
// rows and plan-wide books), the phase key and the plan's settings. calcFlowModel takes them
// from the session.
export interface CalcFlowContext {
  storedStage: StoredStage;
  stageKey: string;
  settings: StoredSettings | undefined;
  // The profile's factory groups and the Logistics page's books for them (itemBooks), when the
  // phase has a group's own line made on site (#956). Absent: every item is shared plan-wide.
  site?: SiteBooks;
}

// The books of a phase with lines made on site (CalcFlowContext.site).
export interface SiteBooks {
  groups: FactoryGroups;
  books: ItemBooks;
}

// The phase's books when some row of it is a group's own line made on site (#868), else
// undefined, so a plan without such lines reads no groups at all. `planned` is the plan's
// settings.onSite: the items made on site for each group (itemBooks, #1003).
export function siteBooks(
  storedStage: StoredStage,
  groups: FactoryGroups,
  planned?: OnSiteSettings,
): SiteBooks | undefined {
  if (!(storedStage.rows || []).some(row => row.onSite)) return undefined;
  return { groups, books: itemBooks(storedStage, groups, planned) };
}

// Another line of the phase as the flow names it, as its build-plan step is titled
// (rowStepTitle): "Wire for Alpha" for a group's own line made on site, so a delivery or a
// spare-lane suggestion tells it from the central "Wire" (#964). The group's name comes from the
// context's groups, else the name the plan was calculated with.
const lineName = (row: CalcRow, context: CalcFlowContext): string =>
  rowStepTitle(
    { settings: context.settings },
    { checks: {}, factoryGroups: context.site?.groups },
    row,
  );

// The books when a group's own lines make `item` on site, else undefined.
const siteItemBooks = (item: string, context: CalcFlowContext): SiteBooks | undefined =>
  context.site?.books.local[item] ? context.site : undefined;

// The group whose own line made on site `row` is for `item`: the row's group, when the books keep
// the line's supply of the item inside the group, as made on site for it (ItemBooks.local: an
// item the plan was calculated to make on site there, #1003, not merely one the group marks).
// Undefined for any other row, and for a byproduct of the line made on site for no group (its
// Water), which share the item out with the central supply.
function ownLineGroup(row: CalcRow, item: string, site: SiteBooks): string | undefined {
  const group = row.onSite?.group;
  return group && site.books.local[item]?.has(group) ? group : undefined;
}

// How `consumer`'s demand for `item` is met (itemBooks): per group, what that group's own lines
// give its share of the consumer, as far as they reach, and what is left for the central supply.
function siteParts(
  consumer: CalcRow,
  item: string,
  site: SiteBooks,
): { own: Map<string, number>; central: number } {
  const rate = consumer.inputs?.[item] || 0,
    local = site.books.local[item];
  const own = new Map<string, number>();
  let central = 0;
  for (const [place, share] of rowPlaces(consumer, site.groups)) {
    const part = rate * share,
      lines = local?.get(place);
    const met =
      lines && lines.asked > LINK_DUST
        ? (part * Math.min(lines.made, lines.asked)) / lines.asked
        : 0;
    if (met > LINK_DUST) own.set(place, met);
    central += part - met;
  }
  return { own, central };
}

// A calculated row's machine equivalents: the planner's figure, else whole machines with the
// last at lastClock, else 1. The floor keeps the per-machine rates finite.
export const rowEquivalent = (row: CalcRow): number =>
  Math.max(row.equivalent || row.machines - 1 + (row.lastClock ?? 100) / 100 || 1, 0.01);

// One output item of a calculated row, as each of its destinations writes it: the unit, the
// prefix (the item's name when the row has byproducts) and the machines a rate takes, which is
// undefined with byproducts, since the same machines make all the outputs at once.
// `site`: the books when groups make the item on site (#956), with the group whose own line the
// row is (undefined for any other line).
interface OutputItem {
  item: string;
  fluid: boolean;
  unit: string;
  pre: string;
  mach: (rate: number) => number | undefined;
  site?: SiteBooks & { group: string | undefined };
}

// A calculated row's output item as its destinations write it (OutputItem).
function outputItem(row: CalcRow, item: string, context: CalcFlowContext): OutputItem {
  const multi = Object.keys(row.outputs || {}).length > 1,
    fluid = FLUIDS.has(item),
    perOut = (row.outputs?.[item] || 0) / rowEquivalent(row),
    site = siteItemBooks(item, context);
  return {
    item,
    fluid,
    unit: fluid ? ' m³/min' : '/min',
    pre: multi ? item : '',
    mach: rate => (multi ? undefined : rate / perOut),
    ...(site ? { site: { ...site, group: ownLineGroup(row, item, site) } } : {}),
  };
}

// How the ordinary supply of an item groups make on site meets `wanted`, a demand the groups' own
// lines do not meet (itemBooks): what each group's offer gives (ItemBooks.offered, #918: its own
// lines' excess the sink has no room for since a group edit), and what the other lines making the
// item give (`lines`). Without offers the other lines give all of it.
function ordinaryShares(
  item: string,
  site: SiteBooks,
  wanted: number,
): { lines: number; offers: Map<string, number> } {
  const offers = site.books.offered[item];
  if (!offers) return { lines: wanted, offers: new Map() };
  const made = placeTotal(site.books.supply[item]),
    asked = placeTotal(site.books.demand[item]);
  const give = (supplied: number) =>
    supplied > LINK_DUST && asked > LINK_DUST ? sharedRate(made, asked, supplied, wanted) : 0;
  return {
    lines: give(made - placeTotal(offers)),
    offers: new Map([...offers].map(([group, rate]) => [group, give(rate)])),
  };
}

// The part of `wanted`, a demand the groups' own lines do not meet, that `row` gives
// (ordinaryShares): a group's own line its part of its group's offer (none without one), any other
// line what the other lines give.
function ordinaryPart(row: CalcRow, output: OutputItem, wanted: number): number {
  const { item, site } = output;
  if (!site) return wanted;
  const shares = ordinaryShares(item, site, wanted);
  if (!site.group) return shares.lines;
  // ownLineGroup found the group's lines in the books.
  const lines = site.books.local[item]!.get(site.group)!;
  return ((shares.offers.get(site.group) || 0) * (row.outputs[item] || 0)) / lines.made;
}

// What `row` delivers of the item to `consumer`: all its demand, unless groups make the item on
// site (#956). Then a group's own line gives its part of what the group's own lines give the
// consumer (sharedRate, as the group's flow shares them), and any other line the part they leave;
// after a group edit, an own line whose group offers its excess shares that part too (#918).
function deliveredTo(row: CalcRow, consumer: CalcRow, output: OutputItem): number {
  const { item, site } = output;
  const rate = consumer.inputs[item] || 0;
  if (!site) return rate;
  const central = ordinaryPart(row, output, siteParts(consumer, item, site).central);
  if (!site.group) return central;
  // ownLineGroup found the group's lines in the books.
  const lines = site.books.local[item]!.get(site.group)!;
  const wanted = rate * (rowPlaces(consumer, site.groups).get(site.group) || 0);
  // A group that asks for none of the item since a group edit gets none from its lines.
  const own =
    lines.asked > 0 ? sharedRate(lines.made, lines.asked, row.outputs[item] || 0, wanted) : 0;
  return own + central;
}

// The other rows of the phase consuming the item, with what `row` delivers to each. For an item
// groups make on site (#956), only those it delivers to.
function deliveries(
  row: CalcRow,
  output: OutputItem,
  context: CalcFlowContext,
): { consumer: CalcRow; rate: number }[] {
  // The filter keeps only rows consuming the item.
  return (context.storedStage.rows || [])
    .filter(consumer => consumer.id !== row.id && consumer.inputs?.[output.item])
    .map(consumer => ({ consumer, rate: deliveredTo(row, consumer, output) }))
    .filter(({ rate }) => !output.site || rate > LINK_DUST);
}

// The other rows of the phase consuming the item (deliveries), each named as its build-plan step
// (lineName) with the belts that carry its rate.
function consumerOutputs(row: CalcRow, output: OutputItem, context: CalcFlowContext) {
  const { item, fluid, unit, pre, mach } = output;
  return deliveries(row, output, context).map(({ consumer, rate }): FlowOutput => {
    return {
      kind: 'consumer',
      label: lineName(consumer, context),
      icon: Object.keys(consumer.outputs || {})[0] || item,
      link: { calcFactory: consumer.id },
      rate,
      unit,
      pre,
      mach: mach(rate),
      beltTxt: beltTxt(lanePlan(rate, fluid, context.stageKey)),
    };
  });
}

// The item's protected storage, Space Elevator delivery and drone fuel from the phase's books.
// For an item groups make on site, the part `row` gives of each (ordinaryPart): none from a group's
// own line, unless its group offers its excess since a group edit (#918).
function bookOutputs(row: CalcRow, output: OutputItem, storedStage: StoredStage) {
  const { item, unit, pre, mach } = output;
  const outputs: FlowOutput[] = [];
  const part = (rate: number | undefined) => rate && ordinaryPart(row, output, rate);
  const stored = part(storedStage.storage?.[item]),
    delivered = part(storedStage.delivery?.[item]?.rate),
    drone = part(storedStage.drone?.[item]);
  if (stored)
    outputs.push({
      kind: 'store',
      label: 'Protected storage',
      icon: item,
      rate: stored,
      unit,
      pre,
      mach: mach(stored),
    });
  if (delivered)
    outputs.push({
      kind: 'ship',
      label: 'Space Elevator delivery',
      icon: item,
      rate: delivered,
      unit,
      pre,
      mach: mach(delivered),
    });
  if (drone)
    outputs.push({
      kind: 'drone',
      label: 'Drone fuel contract',
      icon: item,
      rate: drone,
      unit,
      pre,
      mach: mach(drone),
    });
  return outputs;
}

// Phase 5 extras the planner reserves on top of factory demand: matrix for fueled Alien Power
// Augmenters, and the configured extra Singularity Cells.
function reserveOutputs(output: OutputItem, context: CalcFlowContext) {
  const { item, unit, pre, mach } = output;
  const { storedStage, stageKey, settings } = context;
  const outputs: FlowOutput[] = [];
  if (stageKey === '5' && item === 'Alien Power Matrix' && storedStage.matrixRate)
    outputs.push({
      kind: 'ship',
      label: 'Alien Power Augmenter fuel',
      shipSub:
        num(settings?.fueledAugmenters) +
        ' fueled augmenter' +
        ((settings?.fueledAugmenters ?? 0) > 1 ? 's' : ''),
      icon: item,
      rate: storedStage.matrixRate,
      unit,
      pre,
      mach: mach(storedStage.matrixRate),
    });
  const cells = settings?.cellsPerMinute;
  if (stageKey === '5' && item === 'Singularity Cell' && cells)
    outputs.push({
      kind: 'ship',
      label: 'Extra Singularity Cells',
      shipSub: 'configured portal supply',
      icon: item,
      rate: cells,
      unit,
      pre,
      mach: mach(cells),
    });
  return outputs;
}

// What goes to the sink of an item groups make on site (#956), as the books send it: from a
// group's own line its part of what the group's own lines make beyond the group's demand
// (`sunk`), from any other line the plan's surplus less all of that (ordinaryPart: shared with
// any group's offer, #918).
function siteSinkRate(row: CalcRow, output: OutputItem, surplus: number): number {
  const { item, site } = output;
  if (!site) return surplus;
  const sunk = site.books.sunk[item];
  const rest = ordinaryPart(row, output, surplus - placeTotal(sunk));
  if (!site.group) return rest;
  // ownLineGroup found the group's lines in the books.
  const made = site.books.local[item]!.get(site.group)!.made;
  return ((sunk?.get(site.group) || 0) * (row.outputs[item] || 0)) / made + rest;
}

// Plutonium rods the waste strategy sinks, then the plan's surplus for the item. The planner
// leaves fluids, radioactive and unsinkable items out of `surplus`, so they never show here.
// For an item groups make on site, the part of it this row sends (siteSinkRate). The surplus is
// captioned by its cause (sinkCause, #1063): whole-machine rounding only where rounding explains
// it.
function sinkOutputs(row: CalcRow, output: OutputItem, context: CalcFlowContext) {
  const { storedStage, settings } = context;
  const { item, unit, pre } = output;
  const outputs: FlowOutput[] = [];
  if (item === 'Plutonium Fuel Rod' && storedStage.plutoniumSink)
    outputs.push({
      kind: 'sink',
      label: 'AWESOME Sink',
      subTxt: 'waste strategy — sink these rods',
      icon: item,
      rate: storedStage.plutoniumSink,
      unit,
      pre,
    });
  const surplus = siteSinkRate(row, output, storedStage.surplus?.[item] ?? 0);
  if (surplus > 0.002) {
    const cause = sinkCause(row, item, surplus, storedStage, !!settings?.wholeMachines, isFluid);
    outputs.push({
      kind: 'sink',
      label: 'AWESOME Sink',
      subTxt: sinkCaption(cause),
      icon: item,
      rate: surplus,
      unit,
      pre,
    });
  }
  return outputs;
}

// The destinations of a calculated row's output items, largest rate first: one pass per item,
// with its consuming rows, then its books, reserves and sinks. With byproducts, every
// destination is prefixed with its item name and carries no machine count. A group's own line
// made on site delivers an item its group marks to the group's consumers and the sink alone
// (#876, #956): storage, deliveries and reserves draw on the other lines making the item. After a
// group edit its group may offer the excess the sink has no room for (#918): then the line also
// shares the other consumers, storage, deliveries and drone fuel (bookOutputs).
export function flowOutputs(row: CalcRow, context: CalcFlowContext): FlowOutput[] {
  const outputs = Object.keys(row.outputs || {}).flatMap(item => {
    const output = outputItem(row, item, context);
    if (output.site?.group)
      return [
        ...consumerOutputs(row, output, context),
        ...bookOutputs(row, output, context.storedStage),
        ...sinkOutputs(row, output, context),
      ];
    return [
      ...consumerOutputs(row, output, context),
      ...bookOutputs(row, output, context.storedStage),
      ...reserveOutputs(output, context),
      ...sinkOutputs(row, output, context),
    ];
  });
  return outputs.sort((a, b) => (b.rate || 0) - (a.rate || 0));
}

// A generator's power-grid destination, which calcFlowModel lists first; empty for any other
// row. A nuclear plant also belts its waste to the destinations flowOutputs gives (#373); a
// coal or fuel plant has the grid alone.
export const generatorOutputs = (row: CalcRow): FlowOutput[] =>
  row.generationMW > 0
    ? [
        {
          kind: 'ship',
          label: 'Power grid',
          shipSub: 'generation',
          rateTxt: power(row.generationMW),
          noItem: true,
        },
      ]
    : [];

// The row an input of `row` links to: the single other line that gives the row the most of the
// item (#972), compared line by line. Plan-wide, the lines making an item share each demand in
// proportion to what they make, so that is the line making the most. For an item groups make on
// site (#956), as the books share it (deliveredTo): a group's own line gives its part of its
// group's share of the row (and of its group's offer since a group edit, #918); every other line
// its part, in proportion to what it makes, of what those lines give together. On a tie the
// group's own line comes first, in the order the row's memberships list the groups (rowPlaces,
// as its build-plan step does), then the other lines in the phase's order.
function inputSource(row: CalcRow, item: string, context: CalcFlowContext): CalcRow | undefined {
  const makers = otherMakers(row, item, context);
  const site = siteItemBooks(item, context);
  const groupOf = (maker: CalcRow) => (site ? ownLineGroup(maker, item, site) : undefined);
  const shared = makers.filter(maker => !groupOf(maker));
  const sharedMade = shared.reduce((sum, maker) => sum + (maker.outputs[item] || 0), 0);
  const gives = (maker: CalcRow): number => {
    const delivered = deliveredTo(maker, row, outputItem(maker, item, context));
    if (groupOf(maker)) return delivered;
    return sharedMade > 0 ? (delivered * (maker.outputs[item] || 0)) / sharedMade : 0;
  };
  const places = site ? [...rowPlaces(row, site.groups).keys()] : [];
  const rank = (maker: CalcRow) => {
    const group = groupOf(maker);
    if (!group) return places.length + 1;
    const at = places.indexOf(group);
    return at < 0 ? places.length : at;
  };
  // A stable sort: lines of the same rank keep the phase's order.
  const ordered = [...makers].sort((a, b) => rank(a) - rank(b));
  let source: CalcRow | undefined,
    largest = 0;
  for (const maker of ordered) {
    const rate = gives(maker);
    if (rate > largest + LINK_DUST) [source, largest] = [maker, rate];
  }
  return source ?? makers[0];
}

// A calculated row's inputs, each with its lanes, linked to the row that feeds it (inputSource).
export function flowInputs(row: CalcRow, context: CalcFlowContext): FlowInput[] {
  return Object.entries(row.inputs || {}).map(([item, rate]) => {
    const source = inputSource(row, item, context);
    return {
      name: item,
      rate,
      link: source ? { calcFactory: source.id } : null,
      plan: lanePlan(rate, FLUIDS.has(item), context.stageKey),
    };
  });
}

// A destination's whole machines (splitMachines) as the split writes them: "<1" for one that
// shares a machine with the others.
export const machinesText = (machines: number): string => (machines < 1 ? '<1' : num(machines));

// The notes of a calculated row's flow model (flowNotes).
export interface FlowNotes {
  // " · split ≈ 3 / 2 across the deliveries below", or empty with one delivery or none. The
  // counts add up to the line's machines (splitMachines).
  split: string;
  clock: string;
  bankNote: BankNote | null;
}

// The recipe a row follows: a group's own line made on site follows the recipe it copies.
const recipeOf = (row: CalcRow): string => row.onSite?.recipe ?? row.id;

// The other rows of the phase making `item`.
const otherMakers = (row: CalcRow, item: string, context: CalcFlowContext): CalcRow[] =>
  (context.storedStage.rows || []).filter(other => other.id !== row.id && other.outputs?.[item]);

// What the note of `row`, which is no group's own line for `items`, says of the lines it shares
// their destinations with (SupplyNote): every other line making one of them, except a group's own
// line for an item its group makes on site, which serves its group alone (#956), unless its group
// offers its excess since a group edit (#918), when the note names the group (`leftover`).
function supplyNote(row: CalcRow, items: string[], context: CalcFlowContext): SupplyNote {
  let shared = false,
    sameRecipe = false;
  const leftover = new Map<string, number>();
  for (const item of items) {
    const site = siteItemBooks(item, context);
    for (const other of otherMakers(row, item, context)) {
      const group = site && ownLineGroup(other, item, site);
      if (!group) {
        shared = true;
        sameRecipe ||= recipeOf(other) === recipeOf(row);
      } else if (site.books.offered[item]?.has(group))
        leftover.set(group, (leftover.get(group) || 0) + 1);
    }
  }
  const site = context.site;
  return {
    shared,
    ...(sameRecipe ? { sameRecipe: true as const } : {}),
    ...(items.some(item => siteItemBooks(item, context)) ? { lessOnSite: true as const } : {}),
    ...(site && leftover.size
      ? {
          leftover: {
            groups: site.groups.groups
              .filter(known => leftover.has(known.id))
              .map(known => known.name),
            lines: placeTotal(leftover),
          },
        }
      : {}),
  };
}

// The note of `row` as `group`'s own line made on site for `ownItems` (#956): the group's name;
// `shared` only when another of the group's own lines makes one of those items (#1001), so a
// byproduct another line makes counts for nothing there; whether the group offers its excess since
// a group edit (#918) or asks for none of it (#1002); and the row's other outputs, which go to the
// plan-wide demand as any other line's do (planWide).
function ownLineNote(
  row: CalcRow,
  group: string,
  ownItems: string[],
  site: SiteBooks,
  context: CalcFlowContext,
): BankNote {
  const offers = ownItems.some(item => site.books.offered[item]?.has(group));
  // ownLineGroup found the group's lines in the books.
  const asksNone = ownItems.every(item => site.books.local[item]!.get(group)!.asked <= LINK_DUST);
  const rest = Object.keys(row.outputs || {}).filter(item => !ownItems.includes(item));
  return {
    shared: ownItems.some(item =>
      otherMakers(row, item, context).some(other => ownLineGroup(other, item, site) === group),
    ),
    ownLine: site.groups.groups.find(known => known.id === group)?.name ?? group,
    ...(offers ? { offers: true as const } : asksNone ? { asksNone: true as const } : {}),
    ...(rest.length ? { planWide: { items: rest, ...supplyNote(row, rest, context) } } : {}),
  };
}

// The bank note of a calculated row: its own line's note when it is a group's own line made on
// site for one of its outputs (ownLineNote), else what it says of the lines it shares its
// destinations with (supplyNote).
function bankNoteOf(row: CalcRow, context: CalcFlowContext): BankNote {
  const items = Object.keys(row.outputs || {});
  const site = context.site;
  const group = site && items.map(item => ownLineGroup(row, item, site)).find(Boolean);
  if (site && group)
    return ownLineNote(
      row,
      group,
      items.filter(item => ownLineGroup(row, item, site) === group),
      site,
      context,
    );
  return supplyNote(row, items, context);
}

// The notes for a calculated row whose (capped) destinations are `outputs`. With more than one
// delivery, the split suggests how the machines divide between them, the sink included, adding up
// to the line's machines (splitMachines, #1067). A calculated row is whole
// machines at 100% plus, when the equivalent is fractional, one adjustable machine; its clock
// is in the dialog's Machine setup table. Consumer, storage and delivery rates are the item's
// plan-wide demand, not this row's share: the bank note under the destinations says so, and
// `shared` adds that another row makes one of the same items. A group's own line made on site
// delivers to its group alone, and the other lines making its item leave that out (#956):
// the note names the group, or says so (bankNoteOf). No item destinations (none, or a
// generator's power grid alone), no bank note (#560).
export function flowNotes(
  row: CalcRow,
  outputs: FlowOutput[],
  context: CalcFlowContext,
): FlowNotes {
  const splits = outputs.filter(o => o.machines !== undefined);
  return {
    split:
      splits.length > 1
        ? ` · split ≈ ${splits.map(o => machinesText(o.machines!)).join(' / ')} across the deliveries below`
        : '',
    clock: row.machines - rowEquivalent(row) > 1e-7 ? '@ 100% + 1 adjustable' : '@ 100%',
    bankNote: outputs.some(o => !o.noItem) ? bankNoteOf(row, context) : null,
  };
}

// Per-machine rates for the recipe panel; a generator's power is its first cell, before any
// waste it makes.
function flowRecipe(row: CalcRow, inputs: FlowInput[]): RecipeView {
  const equivalent = rowEquivalent(row),
    outName = Object.keys(row.outputs || {})[0];
  return {
    name: row.name,
    machine: row.machine,
    ins: inputs.map(i => [i.name, i.rate / equivalent, i.link]),
    outs: [
      ...(row.generationMW > 0 || !outName
        ? [['MW', row.generationMW / equivalent] as [string, number]]
        : []),
      ...Object.entries(row.outputs || {}).map(([item, rate]): [string, number] => [
        item,
        rate / equivalent,
      ]),
    ],
  };
}

// The machine bar of a calculated row: recipe, clock, per-machine rate and split, then the
// row's output. A generator's bar leads with its power; a nuclear plant's waste follows in the
// line under it, with the belts that carry it (#373).
function flowBar(row: CalcRow, notes: FlowNotes, stageKey: string): NonNullable<FlowModel['bar']> {
  const equivalent = rowEquivalent(row),
    multi = Object.keys(row.outputs || {}).length > 1,
    generator = row.generationMW > 0,
    outName = Object.keys(row.outputs || {})[0];
  return {
    sub: `${row.name} · ${notes.clock}${outName && !multi ? ` · ${generator ? num3(row.generationMW / equivalent) + ' MW + ' : ''}${rateOfItem(outName, row.outputs[outName]! / equivalent, num3)} out per machine` : ''}${notes.split}`,
    out:
      outName && !generator
        ? { rate: num(row.outputs[outName]), unit: FLUIDS.has(outName) ? ' m³/min' : '/min' }
        : { text: power(row.generationMW) },
    outSub: outName
      ? (generator ? 'generation + ' : 'out · ') +
        (multi
          ? outName + ' + byproducts'
          : (generator ? rateOfItem(outName, row.outputs[outName]!) + ' · ' : '') +
            beltTxt(lanePlan(row.outputs[outName]!, FLUIDS.has(outName), stageKey)))
      : 'generation',
  };
}

// Flow model for a row of a calculated plan, at the current phase. `row` is a row of
// calcStage().rows from planner.ts: inputs and outputs are totals for the whole row (per-machine
// rate × equivalent), and a row may have several outputs (byproducts) or none (a generator, with
// generationMW). Destinations come from the phase's plan-wide books: consuming rows, storage,
// delivery, drone fuel, augmenter fuel, extra cells, plutonium and surplus sinks. Those are
// totals for the item, not this row's share, when several rows make it (bankNote says so). An
// item a group makes on site follows the Logistics page's books for the profile's groups
// instead (siteBooks, #956; see the top of this file). Links are { calcFactory: <row id> }.
export function calcFlowModel(row: CalcRow): FlowModel {
  // A dialog of the profile just left can be drawn once more; it then shows no destinations.
  const storedStage = calcStage() ?? { feasible: false };
  const site = siteBooks(storedStage, factoryGroupsState(), calculated?.settings.onSite);
  const context: CalcFlowContext = {
    storedStage,
    stageKey: stage(),
    settings: calculated?.settings,
    ...(site ? { site } : {}),
  };
  const inputs = flowInputs(row, context);
  const outputs = capFlowOutputs(
    splitMachines(row, [...generatorOutputs(row), ...flowOutputs(row, context)]),
  );
  const notes = flowNotes(row, outputs, context);
  return {
    stage: context.stageKey,
    inputs,
    outputs,
    equivalent: rowEquivalent(row),
    machineCount: row.machines,
    machineName: row.machine,
    recipe: flowRecipe(row, inputs),
    bar: flowBar(row, notes, context.stageKey),
    bankNote: notes.bankNote,
    sameItemConsumers: item => busConsumers(row, item, context),
  };
}

// The other factories that could share the belts of `row`'s input of `item` (LaneAdvice.vue):
// every other row consuming the item, at its whole demand. For an item groups make on site
// (#956), the other rows the line feeding that input delivers to, at what it delivers them. Each
// is named as its build-plan step (lineName, #964).
function busConsumers(row: CalcRow, item: string, context: CalcFlowContext): SameItemConsumer[] {
  const source = siteItemBooks(item, context) && inputSource(row, item, context);
  const consumers = source
    ? deliveries(source, outputItem(source, item, context), context).filter(
        ({ consumer }) => consumer.id !== row.id,
      )
    : (context.storedStage.rows || [])
        .filter(consumer => consumer.id !== row.id && consumer.inputs?.[item])
        .map(consumer => ({ consumer, rate: consumer.inputs[item]! }));
  return consumers.map(({ consumer, rate }) => ({
    label: lineName(consumer, context),
    rate,
    link: { calcFactory: consumer.id },
  }));
}
