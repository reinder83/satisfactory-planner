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
  sameItemConsumers: (n: string) => SameItemConsumer[];
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
const phaseForLaneTier = (t: number) => (t <= 2 ? 1 : t <= 4 ? 2 : t <= 6 ? 3 : t <= 8 ? 4 : 5);

// The milestone that unlocks a belt or pipe mark: its name, tier, the phase it belongs to and
// whether the user has ticked its `unlock-<id>` step. Null when progression.json lacks the entry.
function laneMilestone(l: Lane): LaneMilestone | null {
  const e = progressionData?.entries.find(x => x.id === l.entry);
  return e
    ? {
        name: e.name,
        tier: e.tier,
        phase: phaseForLaneTier(e.tier),
        marked: checked('unlock-' + e.id),
      }
    : null;
}

// The highest belt (or pipe) mark available at phase `st` (default: the current stage). A mark
// counts as available when its milestone is ticked, belongs to this phase or earlier, or is
// unknown; Mk.1 is the fallback. Returns the lane with its display unit, its milestone and the
// next mark up (with that mark's milestone), which LaneAdvice.vue mentions as the next upgrade.
export function bestLane(fluid: boolean, st?: string): BestLane {
  const lanes = fluid ? PIPE_LANES : BELT_LANES;
  const stageNo = Number(st ?? stage());
  // Both lists start with Mk.1.
  let best = lanes[0]!,
    ms = laneMilestone(best);
  for (const l of lanes) {
    const m = laneMilestone(l);
    if (!m || m.marked || m.phase <= stageNo) {
      best = l;
      ms = m;
    }
  }
  const next = lanes[lanes.indexOf(best) + 1];
  return {
    ...best,
    fluid,
    unit: fluid ? ' m³/min' : '/min',
    milestone: ms,
    next: next ? { ...next, milestone: laneMilestone(next) } : null,
  };
}

// How many belts or pipes of the best available mark carry `rate`. Returns the lane, the lane
// count (at least 1), the rate on the last lane, how many lanes run full, the unused capacity
// (all of it on the last lane) and the word to print. The 1e-9, a fraction of one lane in both
// places, keeps a rate within floating-point noise of an exact multiple of the capacity from
// counting an extra lane or a partly filled last one.
export function lanePlan(rate: number, fluid: boolean, st?: string): LanePlan {
  const lane = bestLane(fluid, st);
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

// Keeps a destination list to at most ten rows: past that, the first nine stay and the rest become
// one "+ N more destinations" row carrying their summed rate. Order is the caller's, so whatever
// sorts last is what gets folded.
function capFlowOutputs(list: FlowOutput[], unit = '/min'): FlowOutput[] {
  if (list.length <= 10) return list;
  const rest = list.slice(9),
    sum = rest.reduce((s, x) => s + (x.rate || 0), 0);
  return [
    ...list.slice(0, 9),
    { kind: 'more', label: `+ ${rest.length} more destinations`, rate: sum, unit },
  ];
}

// Flow model for an original-handbook factory (plan.json). `f` is the factory, `st` the phase key,
// `r` its stage record (output, demand, storage, delivery, inputs, machines, lastClock, machine,
// recipe) and `localInput(name)` returns the local factory that makes that input on site, if any.
// A handbook factory makes one item; its destinations are the other handbook factories that list
// it as an input in the same phase, plus its storage refill, elevator delivery and any surplus.
// `bankOnly` (the oil campus products) keeps only the destinations: no inputs, recipe panel, bar
// or machine counts, because ui/detail/OilCampus.vue draws the campus itself.
// Returns { stage, inputs, outputs, equivalent, machineCount, machineName, local, recipe, bar,
// sameItemConsumers }; links are { factory: <handbook id> }.
export function handbookFlowModel(
  f: HandbookFactory,
  st: string,
  r: HandbookFactoryStage,
  localInput: (name: string) => HandbookFactory | undefined,
  bankOnly = false,
): FlowModel {
  const fluidOut = FLUIDS.has(f.name);
  const unit = fluidOut ? ' m³/min' : '/min';
  // Machine equivalents: all at 100% except the last at lastClock. The floor keeps perOut finite
  // for the oil products, which record 0 machines.
  const eq = Math.max(r.machines - 1 + (r.lastClock ?? 100) / 100, 0.01);
  const perOut = r.output / eq;
  const beltTxt = (p: LanePlan) => `${p.count} × ${p.lane.mark} ${p.word}${p.count > 1 ? 's' : ''}`;
  const mach = (q: number) => (bankOnly ? undefined : q / perOut);
  // Destinations: every other factory consuming this item in this phase, largest first.
  const consumers = plan.factories
    .filter(o => o.id !== f.id && o.stages[st]?.inputs?.[f.name])
    .map((o): FlowOutput & { rate: number } => {
      // The filter above keeps only factories consuming the item at this stage.
      const q = o.stages[st]!.inputs[f.name]!;
      return {
        kind: 'consumer',
        label: o.name,
        icon: o.name,
        link: { factory: o.id },
        rate: q,
        unit,
        mach: mach(q),
        beltTxt: f.local ? 'made on site' : beltTxt(lanePlan(q, fluidOut, st)),
      };
    })
    .sort((a, b) => b.rate - a.rate);
  // Then the non-factory destinations. Nuclear parts nobody else consumes go to the power fleet,
  // which the handbook plans on the resources page rather than as a factory.
  const outputs: FlowOutput[] = [...consumers];
  if (f.nuclear && !consumers.length)
    outputs.push({
      kind: 'ship',
      label: 'Nuclear power fleet',
      shipSub: 'planned in Power & resources',
      icon: f.name,
      rateTxt: '',
    });
  if (r.storage)
    outputs.push({
      kind: 'store',
      label: 'Storage refill',
      icon: f.name,
      rate: r.storage,
      unit,
      mach: mach(r.storage),
    });
  if (r.delivery)
    outputs.push({
      kind: 'ship',
      label: 'Space Elevator delivery',
      icon: f.name,
      rate: r.delivery,
      unit,
      mach: mach(r.delivery),
    });
  // Output above the stage's recorded demand is whole-machine rounding surplus, bound for the
  // sink. The 0.002/min threshold hides floating-point leftovers.
  const surplus = Math.max(0, r.output - (r.demand ?? r.output));
  if (surplus > 0.002)
    outputs.push({ kind: 'sink', label: 'AWESOME Sink', icon: f.name, rate: surplus, unit });
  // Inputs, each with its lane plan. The link prefers a local factory making it on site, otherwise
  // the handbook factory producing the item in this phase; local ones also get a button with the
  // machines to build beside this factory (stage `rate` is one local machine's output).
  const inputs: FlowInput[] = bankOnly
    ? []
    : Object.entries(r.inputs || {}).map(([n, q]) => {
        const lp = localInput(n);
        const src = lp || plan.factories.find(x => x.name === n && x.stages[st]);
        return {
          name: n,
          rate: q,
          link: src ? { factory: src.id } : null,
          plan: lanePlan(q, FLUIDS.has(n), st),
          // A local input: the button to its factory, with the machines to build here.
          local: lp
            ? {
                id: lp.id,
                // localInput only returns factories with this stage.
                count: num(Math.ceil(q / lp.stages[st]!.rate!)),
                machine: lp.stages[st]!.machine,
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
    (r.lastClock ?? 100) < 100 ? `@ 100% except the last at ${num(r.lastClock)}%` : '@ 100%';
  return {
    stage: st,
    inputs,
    outputs: capped,
    equivalent: eq,
    machineCount: r.machines,
    machineName: r.machine,
    local: !!f.local,
    recipe: bankOnly
      ? null
      : {
          name: String(r.recipe || '').replace('Alternate: ', ''),
          machine: r.machine,
          ins: inputs.map(i => [i.name, i.rate / eq, i.link]),
          outs: [[f.name, perOut]],
        },
    bar: bankOnly
      ? null
      : {
          sub: `${String(r.recipe || '').replace('Alternate: ', '')} · ${clock} · ${num3(perOut)} ${f.name}/min out per machine${splitTxt}${f.local ? ' · built beside the consumers' : ''}`,
          out: { rate: num(r.output), unit },
          outSub: f.local
            ? 'out · distributed'
            : 'out · ' + beltTxt(lanePlan(r.output, fluidOut, st)),
        },
    // Other factories consuming item `n` this phase, for LaneAdvice.vue's spare-lane suggestion.
    sameItemConsumers: n =>
      plan.factories
        .filter(o => o.id !== f.id && o.stages[st]?.inputs?.[n])
        .map(o => ({
          label: o.name,
          rate: o.stages[st]!.inputs[n]!,
          link: { factory: o.id },
        })),
  };
}

// Flow model for a row of a calculated plan, at the current phase. `r` is a row of
// calcStage().rows from planner.ts: inputs and outputs are totals for the whole row (per-machine
// rate × equivalent), and a row may have several outputs (byproducts) or none (a generator, with
// generationMW). Unlike the handbook, destinations come from the phase's plan-wide books:
// consuming rows, storage, delivery, drone fuel, augmenter fuel, extra cells, plutonium and
// surplus sinks. Those are totals for the item, not this row's share, when several rows make it
// (bankNote says so). Same return shape as handbookFlowModel plus bankNote; links are
// { calcFactory: <row id> }.
export function calcFlowModel(r: CalcRow): FlowModel {
  // A dialog of the profile just left can be drawn once more; it then shows no destinations.
  const x: StoredStage = calcStage() ?? { feasible: false },
    st = stage(),
    settings = calculated?.settings,
    multi = Object.keys(r.outputs || {}).length > 1;
  const eq = Math.max(r.equivalent || r.machines - 1 + (r.lastClock ?? 100) / 100 || 1, 0.01);
  const beltTxt = (p: LanePlan) => `${p.count} × ${p.lane.mark} ${p.word}${p.count > 1 ? 's' : ''}`;
  const outputs: FlowOutput[] = [];
  // One pass per output item. With byproducts, every row is prefixed with its item name and no
  // machine counts are given, since the same machines make all the outputs at once.
  for (const n of Object.keys(r.outputs || {})) {
    const fluid = FLUIDS.has(n),
      unit = fluid ? ' m³/min' : '/min',
      pre = multi ? n : '',
      perOut = r.outputs[n]! / eq;
    const mach = (q: number) => (multi ? undefined : q / perOut);
    // The filter keeps only rows consuming n.
    for (const o of (x.rows || []).filter(o => o.id !== r.id && o.inputs?.[n])) {
      const q = o.inputs[n]!;
      outputs.push({
        kind: 'consumer',
        label: o.name,
        icon: Object.keys(o.outputs || {})[0] || n,
        link: { calcFactory: o.id },
        rate: q,
        unit,
        pre,
        mach: mach(q),
        beltTxt: beltTxt(lanePlan(q, fluid, st)),
      });
    }
    const stored = x.storage?.[n],
      delivered = x.delivery?.[n]?.rate,
      drone = x.drone?.[n];
    if (stored)
      outputs.push({
        kind: 'store',
        label: 'Protected storage',
        icon: n,
        rate: stored,
        unit,
        pre,
        mach: mach(stored),
      });
    if (delivered)
      outputs.push({
        kind: 'ship',
        label: 'Space Elevator delivery',
        icon: n,
        rate: delivered,
        unit,
        pre,
        mach: mach(delivered),
      });
    if (drone)
      outputs.push({
        kind: 'drone',
        label: 'Drone fuel contract',
        icon: n,
        rate: drone,
        unit,
        pre,
        mach: mach(drone),
      });
    // Phase 5 extras the planner reserves on top of factory demand: matrix for fueled Alien Power
    // Augmenters, and the configured extra Singularity Cells.
    if (st === '5' && n === 'Alien Power Matrix' && x.matrixRate)
      outputs.push({
        kind: 'ship',
        label: 'Alien Power Augmenter fuel',
        shipSub:
          num(settings?.fueledAugmenters) +
          ' fueled augmenter' +
          ((settings?.fueledAugmenters ?? 0) > 1 ? 's' : ''),
        icon: n,
        rate: x.matrixRate,
        unit,
        pre,
        mach: mach(x.matrixRate),
      });
    const cells = settings?.cellsPerMinute;
    if (st === '5' && n === 'Singularity Cell' && cells)
      outputs.push({
        kind: 'ship',
        label: 'Extra Singularity Cells',
        shipSub: 'configured portal supply',
        icon: n,
        rate: cells,
        unit,
        pre,
        mach: mach(cells),
      });
    // Plutonium rods the waste strategy sinks, then the plan's surplus for the item. The planner
    // leaves fluids, radioactive and unsinkable items out of `surplus`, so they never show here.
    if (n === 'Plutonium Fuel Rod' && x.plutoniumSink)
      outputs.push({
        kind: 'sink',
        label: 'AWESOME Sink',
        subTxt: 'waste strategy — sink these rods',
        icon: n,
        rate: x.plutoniumSink,
        unit,
        pre,
      });
    const surplus = x.surplus?.[n] ?? 0;
    if (surplus > 0.002)
      outputs.push({ kind: 'sink', label: 'AWESOME Sink', icon: n, rate: surplus, unit, pre });
  }
  // A generator row has no item outputs; its one destination is the power grid.
  outputs.sort((a, b) => (b.rate || 0) - (a.rate || 0));
  if (!outputs.length && r.generationMW)
    outputs.push({
      kind: 'ship',
      label: 'Power grid',
      shipSub: 'generation',
      rateTxt: power(r.generationMW),
    });
  // Inputs link to the first other row producing the item; there may be more than one.
  const inputs: FlowInput[] = Object.entries(r.inputs || {}).map(([n, q]) => {
    const src = (x.rows || []).find(o => o.id !== r.id && o.outputs?.[n]);
    return {
      name: n,
      rate: q,
      link: src ? { calcFactory: src.id } : null,
      plan: lanePlan(q, FLUIDS.has(n), st),
    };
  });
  const outName = Object.keys(r.outputs || {})[0];
  const capped = capFlowOutputs(outputs);
  const splits = capped.filter(o => o.mach !== undefined && o.kind !== 'sink');
  const splitTxt =
    splits.length > 1
      ? ` · split ≈ ${splits.map(o => num(Math.ceil(o.mach! - 1e-9))).join(' / ')} across the deliveries below`
      : '';
  // A calculated row is whole machines at 100% plus, when the equivalent is fractional, one
  // adjustable machine; its clock is in the dialog's Machine setup table. `shared` is true when
  // another row makes one of the same items, which the bank note mentions.
  const clock = r.machines - eq > 1e-7 ? '@ 100% + 1 adjustable' : '@ 100%';
  const shared = Object.keys(r.outputs || {}).some(n =>
    (x.rows || []).some(o => o.id !== r.id && o.outputs?.[n]),
  );
  return {
    stage: st,
    inputs,
    outputs: capped,
    equivalent: eq,
    machineCount: r.machines,
    machineName: r.machine,
    local: false,
    // Per-machine rates for the recipe panel; a generator's single cell is its MW.
    recipe: {
      name: r.name,
      machine: r.machine,
      ins: inputs.map(i => [i.name, i.rate / eq, i.link]),
      outs: outName
        ? Object.entries(r.outputs).map(([n, q]): [string, number] => [n, q / eq])
        : [['MW', r.generationMW / eq]],
    },
    bar: {
      sub: `${r.name} · ${clock}${outName && !multi ? ` · ${num3(r.outputs[outName]! / eq)} ${outName}/min out per machine` : ''}${splitTxt}`,
      out: outName
        ? { rate: num(r.outputs[outName]), unit: FLUIDS.has(outName) ? ' m³/min' : '/min' }
        : { text: power(r.generationMW) },
      outSub: outName
        ? multi
          ? 'out · ' + outName + ' + byproducts'
          : 'out · ' + beltTxt(lanePlan(r.outputs[outName]!, FLUIDS.has(outName), st))
        : 'generation',
    },
    // Consumer, storage and delivery rates are the item's plan-wide demand, not this row's share.
    // The note under the destinations; `shared` adds that other recipes supply the item too.
    bankNote: outputs.length ? { shared } : null,
    sameItemConsumers: n =>
      (x.rows || [])
        .filter(o => o.id !== r.id && o.inputs?.[n])
        .map(o => ({ label: o.name, rate: o.inputs[n]!, link: { calcFactory: o.id } })),
  };
}
