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
// Every other item, and every item of a plan without such lines, is shared plan-wide.
import { num, num3 } from './format.ts';
import { itemBooks, placeTotal, sharedRate } from './group-links.ts';
import { LINK_DUST, rowPlaces } from './group-order.ts';
import { calcStage, calculated, checked, progressionData, stage } from './session.ts';
import { factoryGroupsState } from './views/factories.ts';
import { power } from './wizard/fields.ts';
import type { ItemBooks } from './group-links.ts';
import type { FactoryLink } from './ui/actions.ts';
import type { CalcRow, FactoryGroups, StoredSettings, StoredStage } from '../types/index.ts';

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

// The best mark available (bestLane), with the next one up.
export interface BestLane extends Lane {
  fluid: boolean;
  unit: string;
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
  // Machines of this factory the destination takes; undefined when not meaningful.
  mach?: number;
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

// The note under a factory's destinations (flowNotes). `shared`: another line makes one of the
// same items for the same consumers. `ownLine`: the row is the named group's own line made on
// site, which delivers to that group alone (#956). `lessOnSite`: the demand leaves out what
// groups' own lines make on site for themselves.
export interface BankNote {
  shared: boolean;
  ownLine?: string;
  lessOnSite?: true;
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

// Conveyor belt marks in unlock order. cap is items/min per belt; entry is the progression.json
// milestone id that unlocks the mark.
const BELT_LANES: Lane[] = [
  { mark: 'Mk.1', cap: 60, entry: 'Schematic_1-2_C' },
  { mark: 'Mk.2', cap: 120, entry: 'Schematic_3-2_C' },
  { mark: 'Mk.3', cap: 270, entry: 'Schematic_5-3_C' },
  { mark: 'Mk.4', cap: 480, entry: 'Schematic_6-1_C' },
  { mark: 'Mk.5', cap: 780, entry: 'Schematic_7-2_C' },
  { mark: 'Mk.6', cap: 1200, entry: 'Schematic_9-5_C' },
];

// Pipeline marks, same shape as BELT_LANES; cap is m³/min per pipe.
const PIPE_LANES: Lane[] = [
  { mark: 'Mk.1', cap: 300, entry: 'Schematic_3-1_C' },
  { mark: 'Mk.2', cap: 600, entry: 'Schematic_6-5_C' },
];

// The planner phase in which a milestone tier becomes available: Tiers 1–2 are Phase 1, 3–4
// Phase 2, 5–6 Phase 3, 7–8 Phase 4 and 9 Phase 5.
const phaseForLaneTier = (tier: number) =>
  tier <= 2 ? 1 : tier <= 4 ? 2 : tier <= 6 ? 3 : tier <= 8 ? 4 : 5;

// The milestone that unlocks a belt or pipe mark: its name, tier, the phase it belongs to and
// whether the user has ticked its `unlock-<id>` step. Null when progression.json lacks the entry.
function laneMilestone(lane: Lane): LaneMilestone | null {
  const entry = progressionData?.entries.find(x => x.id === lane.entry);
  return entry
    ? {
        name: entry.name,
        tier: entry.tier,
        phase: phaseForLaneTier(entry.tier),
        marked: checked('unlock-' + entry.id),
      }
    : null;
}

// The highest belt (or pipe) mark available at phase `stageKey` (default: the current stage). A mark
// counts as available when its milestone is ticked, belongs to this phase or earlier, or is
// unknown; Mk.1 is the fallback. Returns the lane with its display unit, its milestone and the
// next mark up (with that mark's milestone), which LaneAdvice.vue mentions as the next upgrade.
export function bestLane(fluid: boolean, stageKey?: string): BestLane {
  const lanes = fluid ? PIPE_LANES : BELT_LANES;
  const stageNo = Number(stageKey ?? stage());
  // Both lists start with Mk.1.
  let best = lanes[0]!,
    bestMilestone = laneMilestone(best);
  for (const lane of lanes) {
    const milestone = laneMilestone(lane);
    if (!milestone || milestone.marked || milestone.phase <= stageNo) {
      best = lane;
      bestMilestone = milestone;
    }
  }
  const next = lanes[lanes.indexOf(best) + 1];
  return {
    ...best,
    fluid,
    unit: fluid ? ' m³/min' : '/min',
    milestone: bestMilestone,
    next: next ? { ...next, milestone: laneMilestone(next) } : null,
  };
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
// sorts last is what gets folded.
function capFlowOutputs(list: FlowOutput[], unit = '/min'): FlowOutput[] {
  if (list.length <= 10) return list;
  const rest = list.slice(9),
    sum = rest.reduce((total, output) => total + (output.rate || 0), 0);
  return [
    ...list.slice(0, 9),
    { kind: 'more', label: `+ ${rest.length} more destinations`, rate: sum, unit },
  ];
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
// undefined, so a plan without such lines reads no groups at all.
export function siteBooks(storedStage: StoredStage, groups: FactoryGroups): SiteBooks | undefined {
  if (!(storedStage.rows || []).some(row => row.onSite)) return undefined;
  return { groups, books: itemBooks(storedStage, groups) };
}

// The books when a group's own lines make `item` on site, else undefined.
const siteItemBooks = (item: string, context: CalcFlowContext): SiteBooks | undefined =>
  context.site?.books.local[item] ? context.site : undefined;

// The group whose own line made on site `row` is for `item`: the row's group, when that group
// marks the item and so keeps the line's supply of it inside the group (itemBooks). Undefined for
// any other row, which shares the item out with the central supply.
function ownLineGroup(row: CalcRow, item: string, site: SiteBooks): string | undefined {
  const group = row.onSite?.group;
  return group &&
    site.books.local[item]?.has(group) &&
    (site.groups.local?.[group] || []).includes(item)
    ? group
    : undefined;
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

// What `row` delivers of the item to `consumer`: all its demand, unless groups make the item on
// site (#956). Then a group's own line gives its part of what the group's own lines give the
// consumer (sharedRate, as the group's flow shares them), and any other line the part they leave.
function deliveredTo(row: CalcRow, consumer: CalcRow, output: OutputItem): number {
  const { item, site } = output;
  const rate = consumer.inputs[item] || 0;
  if (!site) return rate;
  if (!site.group) return siteParts(consumer, item, site).central;
  // ownLineGroup found the group's lines in the books.
  const lines = site.books.local[item]!.get(site.group)!;
  const wanted = rate * (rowPlaces(consumer, site.groups).get(site.group) || 0);
  return sharedRate(lines.made, lines.asked, row.outputs[item] || 0, wanted);
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

// The other rows of the phase consuming the item (deliveries), each with the belts that carry
// its rate.
function consumerOutputs(row: CalcRow, output: OutputItem, context: CalcFlowContext) {
  const { item, fluid, unit, pre, mach } = output;
  return deliveries(row, output, context).map(({ consumer, rate }): FlowOutput => {
    return {
      kind: 'consumer',
      label: consumer.name,
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
function bookOutputs(output: OutputItem, storedStage: StoredStage) {
  const { item, unit, pre, mach } = output;
  const outputs: FlowOutput[] = [];
  const stored = storedStage.storage?.[item],
    delivered = storedStage.delivery?.[item]?.rate,
    drone = storedStage.drone?.[item];
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
// (`sunk`), from any other line the plan's surplus less all of that.
function siteSinkRate(row: CalcRow, output: OutputItem, surplus: number): number {
  const { item, site } = output;
  if (!site) return surplus;
  const sunk = site.books.sunk[item];
  if (!site.group) return surplus - placeTotal(sunk);
  // ownLineGroup found the group's lines in the books.
  const made = site.books.local[item]!.get(site.group)!.made;
  return ((sunk?.get(site.group) || 0) * (row.outputs[item] || 0)) / made;
}

// Plutonium rods the waste strategy sinks, then the plan's surplus for the item. The planner
// leaves fluids, radioactive and unsinkable items out of `surplus`, so they never show here.
// For an item groups make on site, the part of it this row sends (siteSinkRate).
function sinkOutputs(row: CalcRow, output: OutputItem, storedStage: StoredStage) {
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
  if (surplus > 0.002)
    outputs.push({ kind: 'sink', label: 'AWESOME Sink', icon: item, rate: surplus, unit, pre });
  return outputs;
}

// The destinations of a calculated row's output items, largest rate first: one pass per item,
// with its consuming rows, then its books, reserves and sinks. With byproducts, every
// destination is prefixed with its item name and carries no machine count. A group's own line
// made on site delivers an item its group marks to the group's consumers and the sink alone
// (#876, #956): storage, deliveries and reserves draw on the other lines making the item.
export function flowOutputs(row: CalcRow, context: CalcFlowContext): FlowOutput[] {
  const outputs = Object.keys(row.outputs || {}).flatMap(item => {
    const output = outputItem(row, item, context);
    if (output.site?.group)
      return [
        ...consumerOutputs(row, output, context),
        ...sinkOutputs(row, output, context.storedStage),
      ];
    return [
      ...consumerOutputs(row, output, context),
      ...bookOutputs(output, context.storedStage),
      ...reserveOutputs(output, context),
      ...sinkOutputs(row, output, context.storedStage),
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

// The row an input of `row` links to: the first other row producing the item; there may be more
// than one. For an item groups make on site (#956), the line that gives the row most of it, as
// the books share it (siteParts): a group's own line for that group's share, else the first other
// line making the item; on a tie, the group rowPlaces lists first.
function inputSource(row: CalcRow, item: string, context: CalcFlowContext): CalcRow | undefined {
  const makers = (context.storedStage.rows || []).filter(
    maker => maker.id !== row.id && maker.outputs?.[item],
  );
  const site = siteItemBooks(item, context);
  if (!site) return makers[0];
  const { own, central } = siteParts(row, item, site);
  let source: CalcRow | undefined,
    largest = 0;
  for (const [group, rate] of own) {
    const line = makers.find(maker => ownLineGroup(maker, item, site) === group);
    if (line && rate > largest + LINK_DUST) [source, largest] = [line, rate];
  }
  const centralLine = makers.find(maker => !ownLineGroup(maker, item, site));
  if (centralLine && central > largest + LINK_DUST) source = centralLine;
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

// The notes of a calculated row's flow model (flowNotes).
export interface FlowNotes {
  // " · split ≈ 3 / 2 across the deliveries below", or empty with one delivery or none.
  split: string;
  clock: string;
  bankNote: BankNote | null;
}

// Whether another row makes `item` for the same consumers as `row`: any other row making it, or
// for an item groups make on site (#956) another of the same group's own lines for an own line,
// and another line that is no group's own line for any other row.
function sharesItem(row: CalcRow, item: string, context: CalcFlowContext): boolean {
  const site = siteItemBooks(item, context);
  const group = site && ownLineGroup(row, item, site);
  return (context.storedStage.rows || []).some(
    other =>
      other.id !== row.id &&
      other.outputs?.[item] &&
      (!site || ownLineGroup(other, item, site) === group),
  );
}

// The bank note's words for lines made on site (#956): the group's name when `row` is its own
// line for one of its items, else whether groups make one of its items on site.
function siteNote(row: CalcRow, context: CalcFlowContext): Omit<BankNote, 'shared'> {
  const site = context.site;
  if (!site) return {};
  const items = Object.keys(row.outputs || {}).filter(item => siteItemBooks(item, context));
  const group = items.map(item => ownLineGroup(row, item, site)).find(Boolean);
  if (group)
    return { ownLine: site.groups.groups.find(known => known.id === group)?.name ?? group };
  return items.length ? { lessOnSite: true } : {};
}

// The notes for a calculated row whose (capped) destinations are `outputs`. With more than one
// delivery, the split suggests how the machines divide between them. A calculated row is whole
// machines at 100% plus, when the equivalent is fractional, one adjustable machine; its clock
// is in the dialog's Machine setup table. Consumer, storage and delivery rates are the item's
// plan-wide demand, not this row's share: the bank note under the destinations says so, and
// `shared` adds that another row makes one of the same items. A group's own line made on site
// delivers to its group alone, and the other lines making its item leave that out (#956):
// the note names the group, or says so (siteNote). No item destinations (none, or a generator's
// power grid alone), no bank note (#560).
export function flowNotes(
  row: CalcRow,
  outputs: FlowOutput[],
  context: CalcFlowContext,
): FlowNotes {
  const splits = outputs.filter(o => o.mach !== undefined && o.kind !== 'sink');
  const shared = Object.keys(row.outputs || {}).some(item => sharesItem(row, item, context));
  return {
    split:
      splits.length > 1
        ? ` · split ≈ ${splits.map(o => num(Math.ceil(o.mach! - 1e-9))).join(' / ')} across the deliveries below`
        : '',
    clock: row.machines - rowEquivalent(row) > 1e-7 ? '@ 100% + 1 adjustable' : '@ 100%',
    bankNote: outputs.some(o => !o.noItem) ? { shared, ...siteNote(row, context) } : null,
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
  const site = siteBooks(storedStage, factoryGroupsState());
  const context: CalcFlowContext = {
    storedStage,
    stageKey: stage(),
    settings: calculated?.settings,
    ...(site ? { site } : {}),
  };
  const inputs = flowInputs(row, context);
  const outputs = capFlowOutputs([...generatorOutputs(row), ...flowOutputs(row, context)]);
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
// (#956), the other rows the line feeding that input delivers to, at what it delivers them.
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
    label: consumer.name,
    rate,
    link: { calcFactory: consumer.id },
  }));
}
