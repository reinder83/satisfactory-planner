// Production flow of a factory: belts, pipes, inputs, outputs and lane advice.
// A flow model is a plain object describing one factory at one phase: what comes in (with the
// belts or pipes that carry it), the machine bar, and where the output goes. It is built either
// from the original handbook (handbookFlowModel, plan.json factories) or from a calculated plan
// (calcFlowModel, planner rows), and drawn by ui/detail/FlowDiagram.vue and LaneAdvice.vue in
// the factory dialogs. Everything in it is data: a link to another factory's dialog is
// { factory: <handbook id> } or { calcFactory: <row id> } (see factoryLink in ui/actions.ts).
import { num, num3 } from './format.ts';
import { calcStage, calculated, checked, plan, progressionData, stage } from './session.ts';
import { power } from './wizard/fields.ts';
import type { FactoryLink } from './ui/actions.ts';
import type {
  CalcRow,
  HandbookFactory,
  HandbookFactoryStage,
  ItemRates,
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

// One input of a flow diagram, with its lanes; local marks one made on site.
export interface FlowInput {
  name: string;
  rate: number;
  link: FactoryLink | null;
  plan: LanePlan;
  local?: { id: string; count: string; machine: string } | null;
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

// A factory's flow at one phase (see the top of this file).
export interface FlowModel {
  stage: string;
  inputs: FlowInput[];
  outputs: FlowOutput[];
  equivalent: number;
  machineCount: number;
  machineName: string;
  local: boolean;
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
  bankNote?: { shared: boolean } | null;
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
// fluid, as the oil campus writes it, "45 Iron Plate/min" for a solid. `formatNumber` formats the number
// (num3 for a per-machine rate).
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

// Oil-campus recipes per machine at 100%, per minute; values from the bundled recipes.json dataset.
// Keyed by the recipe names in plan.json plans[phase].oil; `in`/`out` map item to rate (fluids in
// m³/min). Only the handbook's shared oil campus (ui/detail/OilCampus.vue) reads it.
export const OIL_RECIPES: Record<string, { in: ItemRates; out: ItemRates }> = {
  Plastic: { in: { 'Crude Oil': 30 }, out: { Plastic: 20, 'Heavy Oil Residue': 10 } },
  Rubber: { in: { 'Crude Oil': 30 }, out: { Rubber: 20, 'Heavy Oil Residue': 20 } },
  'Residual Fuel': { in: { 'Heavy Oil Residue': 60 }, out: { Fuel: 40 } },
  'Residual Rubber': { in: { 'Polymer Resin': 40, Water: 40 }, out: { Rubber: 20 } },
  'Alternate: Heavy Oil Residue': {
    in: { 'Crude Oil': 30 },
    out: { 'Heavy Oil Residue': 40, 'Polymer Resin': 20 },
  },
  'Alternate: Diluted Fuel': { in: { 'Heavy Oil Residue': 50, Water: 100 }, out: { Fuel: 100 } },
  'Alternate: Recycled Plastic': { in: { Rubber: 30, Fuel: 30 }, out: { Plastic: 60 } },
  'Alternate: Recycled Rubber': { in: { Plastic: 30, Fuel: 30 }, out: { Rubber: 60 } },
};

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

// Flow model for an original-handbook factory (plan.json). `factory` is the factory, `stageKey`
// the phase key, `factoryStage` its stage record (output, demand, storage, delivery, inputs,
// machines, lastClock, machine, recipe) and `localInput(name)` returns the local factory that
// makes that input on site, if any.
// A handbook factory makes one item; its destinations are the other handbook factories that list
// it as an input in the same phase, plus its storage refill, elevator delivery and any surplus.
// `bankOnly` (the oil campus products) keeps only the destinations: no inputs, recipe panel, bar
// or machine counts, because ui/detail/OilCampus.vue draws the campus itself.
// Returns { stage, inputs, outputs, equivalent, machineCount, machineName, local, recipe, bar,
// sameItemConsumers }; links are { factory: <handbook id> }.
export function handbookFlowModel(
  factory: HandbookFactory,
  stageKey: string,
  factoryStage: HandbookFactoryStage,
  localInput: (name: string) => HandbookFactory | undefined,
  bankOnly = false,
): FlowModel {
  const fluidOut = FLUIDS.has(factory.name);
  const unit = fluidOut ? ' m³/min' : '/min';
  // Machine equivalents: all at 100% except the last at lastClock. The floor keeps perOut finite
  // for the oil products, which record 0 machines.
  const equivalent = Math.max(
    factoryStage.machines - 1 + (factoryStage.lastClock ?? 100) / 100,
    0.01,
  );
  const perOut = factoryStage.output / equivalent;
  const mach = (rate: number) => (bankOnly ? undefined : rate / perOut);
  // Destinations: every other factory consuming this item in this phase, largest first.
  const consumers = plan.factories
    .filter(
      consumer => consumer.id !== factory.id && consumer.stages[stageKey]?.inputs?.[factory.name],
    )
    .map((consumer): FlowOutput & { rate: number } => {
      // The filter above keeps only factories consuming the item at this stage.
      const rate = consumer.stages[stageKey]!.inputs[factory.name]!;
      return {
        kind: 'consumer',
        label: consumer.name,
        icon: consumer.name,
        link: { factory: consumer.id },
        rate,
        unit,
        mach: mach(rate),
        beltTxt: factory.local ? 'made on site' : beltTxt(lanePlan(rate, fluidOut, stageKey)),
      };
    })
    .sort((a, b) => b.rate - a.rate);
  // Then the non-factory destinations. Nuclear parts nobody else consumes go to the power fleet,
  // which the handbook plans on the resources page rather than as a factory.
  const outputs: FlowOutput[] = [...consumers];
  if (factory.nuclear && !consumers.length)
    outputs.push({
      kind: 'ship',
      label: 'Nuclear power fleet',
      shipSub: 'planned in Power & resources',
      icon: factory.name,
      rateTxt: '',
    });
  if (factoryStage.storage)
    outputs.push({
      kind: 'store',
      label: 'Storage refill',
      icon: factory.name,
      rate: factoryStage.storage,
      unit,
      mach: mach(factoryStage.storage),
    });
  if (factoryStage.delivery)
    outputs.push({
      kind: 'ship',
      label: 'Space Elevator delivery',
      icon: factory.name,
      rate: factoryStage.delivery,
      unit,
      mach: mach(factoryStage.delivery),
    });
  // Output above the stage's recorded demand is whole-machine rounding surplus, bound for the
  // sink. The 0.002/min threshold hides floating-point leftovers.
  const surplus = Math.max(0, factoryStage.output - (factoryStage.demand ?? factoryStage.output));
  if (surplus > 0.002)
    outputs.push({ kind: 'sink', label: 'AWESOME Sink', icon: factory.name, rate: surplus, unit });
  // Inputs, each with its lane plan. The link prefers a local factory making it on site, otherwise
  // the handbook factory producing the item in this phase; local ones also get a button with the
  // machines to build beside this factory (stage `rate` is one local machine's output).
  const inputs: FlowInput[] = bankOnly
    ? []
    : Object.entries(factoryStage.inputs || {}).map(([item, rate]) => {
        const localFactory = localInput(item);
        const source =
          localFactory || plan.factories.find(x => x.name === item && x.stages[stageKey]);
        return {
          name: item,
          rate,
          link: source ? { factory: source.id } : null,
          plan: lanePlan(rate, FLUIDS.has(item), stageKey),
          // A local input: the button to its factory, with the machines to build here.
          local: localFactory
            ? {
                id: localFactory.id,
                // localInput only returns factories with this stage.
                count: num(Math.ceil(rate / localFactory.stages[stageKey]!.rate!)),
                machine: localFactory.stages[stageKey]!.machine,
              }
            : null,
        };
      });
  // With more than one destination, the bar suggests how the machines split between them.
  const capped = capFlowOutputs(outputs, unit);
  const splits = capped.filter(o => o.mach !== undefined && o.kind !== 'sink');
  const splitTxt =
    splits.length > 1
      ? ` · split ≈ ${splits.map(o => num(Math.ceil(o.mach! - 1e-9))).join(' / ')} across the deliveries below`
      : '';
  // The handbook records the last machine's clock, so it is printed as a figure.
  const clock =
    (factoryStage.lastClock ?? 100) < 100
      ? `@ 100% except the last at ${num(factoryStage.lastClock)}%`
      : '@ 100%';
  return {
    stage: stageKey,
    inputs,
    outputs: capped,
    equivalent,
    machineCount: factoryStage.machines,
    machineName: factoryStage.machine,
    local: !!factory.local,
    recipe: bankOnly
      ? null
      : {
          name: String(factoryStage.recipe || '').replace('Alternate: ', ''),
          machine: factoryStage.machine,
          ins: inputs.map(i => [i.name, i.rate / equivalent, i.link]),
          outs: [[factory.name, perOut]],
        },
    bar: bankOnly
      ? null
      : {
          sub: `${String(factoryStage.recipe || '').replace('Alternate: ', '')} · ${clock} · ${rateOfItem(factory.name, perOut, num3)} out per machine${splitTxt}${factory.local ? ' · built beside the consumers' : ''}`,
          out: { rate: num(factoryStage.output), unit },
          outSub: factory.local
            ? 'out · distributed'
            : 'out · ' + beltTxt(lanePlan(factoryStage.output, fluidOut, stageKey)),
        },
    // Other factories consuming `item` this phase, for LaneAdvice.vue's spare-lane suggestion.
    sameItemConsumers: item =>
      plan.factories
        .filter(consumer => consumer.id !== factory.id && consumer.stages[stageKey]?.inputs?.[item])
        .map(consumer => ({
          label: consumer.name,
          rate: consumer.stages[stageKey]!.inputs[item]!,
          link: { factory: consumer.id },
        })),
  };
}

// What the calculated-row helpers below read besides the row: the phase's stored stage (its
// rows and plan-wide books), the phase key and the plan's settings. calcFlowModel takes them
// from the session.
export interface CalcFlowContext {
  storedStage: StoredStage;
  stageKey: string;
  settings: StoredSettings | undefined;
}

// A calculated row's machine equivalents: the planner's figure, else whole machines with the
// last at lastClock, else 1. The floor keeps the per-machine rates finite.
export const rowEquivalent = (row: CalcRow): number =>
  Math.max(row.equivalent || row.machines - 1 + (row.lastClock ?? 100) / 100 || 1, 0.01);

// One output item of a calculated row, as each of its destinations writes it: the unit, the
// prefix (the item's name when the row has byproducts) and the machines a rate takes, which is
// undefined with byproducts, since the same machines make all the outputs at once.
interface OutputItem {
  item: string;
  fluid: boolean;
  unit: string;
  pre: string;
  mach: (rate: number) => number | undefined;
}

// The other rows of the phase consuming the item, each with the belts that carry its rate.
function consumerOutputs(row: CalcRow, output: OutputItem, context: CalcFlowContext) {
  const { item, fluid, unit, pre, mach } = output;
  // The filter keeps only rows consuming the item.
  return (context.storedStage.rows || [])
    .filter(consumer => consumer.id !== row.id && consumer.inputs?.[item])
    .map((consumer): FlowOutput => {
      const rate = consumer.inputs[item]!;
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

// Plutonium rods the waste strategy sinks, then the plan's surplus for the item. The planner
// leaves fluids, radioactive and unsinkable items out of `surplus`, so they never show here.
function sinkOutputs(output: OutputItem, storedStage: StoredStage) {
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
  const surplus = storedStage.surplus?.[item] ?? 0;
  if (surplus > 0.002)
    outputs.push({ kind: 'sink', label: 'AWESOME Sink', icon: item, rate: surplus, unit, pre });
  return outputs;
}

// The destinations of a calculated row's output items, largest rate first: one pass per item,
// with its consuming rows, then its books, reserves and sinks. With byproducts, every
// destination is prefixed with its item name and carries no machine count.
export function flowOutputs(row: CalcRow, context: CalcFlowContext): FlowOutput[] {
  const multi = Object.keys(row.outputs || {}).length > 1,
    equivalent = rowEquivalent(row);
  const outputs = Object.keys(row.outputs || {}).flatMap(item => {
    const fluid = FLUIDS.has(item),
      perOut = row.outputs[item]! / equivalent;
    const output: OutputItem = {
      item,
      fluid,
      unit: fluid ? ' m³/min' : '/min',
      pre: multi ? item : '',
      mach: rate => (multi ? undefined : rate / perOut),
    };
    return [
      ...consumerOutputs(row, output, context),
      ...bookOutputs(output, context.storedStage),
      ...reserveOutputs(output, context),
      ...sinkOutputs(output, context.storedStage),
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

// A calculated row's inputs, each with its lanes. An input links to the first other row
// producing the item; there may be more than one.
export function flowInputs(row: CalcRow, context: CalcFlowContext): FlowInput[] {
  return Object.entries(row.inputs || {}).map(([item, rate]) => {
    const source = (context.storedStage.rows || []).find(o => o.id !== row.id && o.outputs?.[item]);
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
  bankNote: { shared: boolean } | null;
}

// The notes for a calculated row whose (capped) destinations are `outputs`. With more than one
// delivery, the split suggests how the machines divide between them. A calculated row is whole
// machines at 100% plus, when the equivalent is fractional, one adjustable machine; its clock
// is in the dialog's Machine setup table. Consumer, storage and delivery rates are the item's
// plan-wide demand, not this row's share: the bank note under the destinations says so, and
// `shared` adds that another row makes one of the same items. No item destinations (none, or
// a generator's power grid alone), no bank note (#560).
export function flowNotes(
  row: CalcRow,
  outputs: FlowOutput[],
  context: CalcFlowContext,
): FlowNotes {
  const splits = outputs.filter(o => o.mach !== undefined && o.kind !== 'sink');
  const shared = Object.keys(row.outputs || {}).some(item =>
    (context.storedStage.rows || []).some(o => o.id !== row.id && o.outputs?.[item]),
  );
  return {
    split:
      splits.length > 1
        ? ` · split ≈ ${splits.map(o => num(Math.ceil(o.mach! - 1e-9))).join(' / ')} across the deliveries below`
        : '',
    clock: row.machines - rowEquivalent(row) > 1e-7 ? '@ 100% + 1 adjustable' : '@ 100%',
    bankNote: outputs.some(o => !o.noItem) ? { shared } : null,
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
// generationMW). Unlike the handbook, destinations come from the phase's plan-wide books:
// consuming rows, storage, delivery, drone fuel, augmenter fuel, extra cells, plutonium and
// surplus sinks. Those are totals for the item, not this row's share, when several rows make it
// (bankNote says so). Same return shape as handbookFlowModel plus bankNote; links are
// { calcFactory: <row id> }.
export function calcFlowModel(row: CalcRow): FlowModel {
  // A dialog of the profile just left can be drawn once more; it then shows no destinations.
  const context: CalcFlowContext = {
    storedStage: calcStage() ?? { feasible: false },
    stageKey: stage(),
    settings: calculated?.settings,
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
    local: false,
    recipe: flowRecipe(row, inputs),
    bar: flowBar(row, notes, context.stageKey),
    bankNote: notes.bankNote,
    sameItemConsumers: item =>
      (context.storedStage.rows || [])
        .filter(consumer => consumer.id !== row.id && consumer.inputs?.[item])
        .map(consumer => ({
          label: consumer.name,
          rate: consumer.inputs[item]!,
          link: { calcFactory: consumer.id },
        })),
  };
}
