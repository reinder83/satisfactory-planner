// Build-so-far status for a calculated stage (#66): from the factory rows the user has ticked as
// built ('calc-<stage>-<rowId>' in the profile's checks), what the half-built plan produces now,
// how much of each Space Elevator part it delivers, which built rows are held back by a missing
// supplier, and which unbuilt row would add the most delivery.
//
// The model, kept deliberately simple and on the cautious side:
// - Raw resources and credited existing production (`raw`, `supplied`) always count as
//   available: extraction has no build steps.
// - A built row runs at the share its scarcest input allows, capped at 1. An unbuilt row runs
//   at 0. Outputs, byproducts included, scale with the share.
// - An item that falls short is shared among everything the plan gives it to (built consumer
//   rows at their full inputs, protected storage, drone fuel and the elevator delivery) in
//   proportion to what the plan gives each. Surplus is left over by definition and takes nothing.
// - A row the phase before marked running and this phase builds again (#1069, phaseCarry in
//   handover.ts) runs, until it is ticked here, at most at the share its earlier machines make
//   (its capacity), and asks for its inputs at that share. A ticked row's capacity is 1.
// - Built rows start at their capacity and are lowered until nothing changes, so byproduct loops (a row fed
//   by a later one) settle, and a fully built plan comes out at exactly its planned rates.
// - Power is reported, not applied: a plan whose built factories draw more than its built
//   generators and the spare power give is flagged, but nothing is slowed down for it. It is
//   measured by the stage's grid (gridPower, #1064), or for a plan made before it as the
//   planner's power constraint did (storedPower). Phase 1 runs on hand-fed biomass and has no
//   power constraint, so it is never flagged.
import { lineLoad } from '../power.ts';
import type { CalcRow, ItemRates, StageGrid, StoredStage } from '../types/index.ts';

export interface RowStatus {
  id: string;
  built: boolean;
  // 0-1: the share of its planned rate the row can run at now (0 when not built).
  share: number;
  // For an unticked row carried from the phase before: the share its earlier machines make.
  carried?: number;
  // For a built row running below full: the input that holds it back.
  shortOf?: string;
}

export interface DeliveryStatus {
  item: string;
  // Per minute: what the plan delivers when finished, and what reaches the elevator now.
  planned: number;
  now: number;
}

export interface BuildStatus {
  rows: RowStatus[];
  // Per minute, per item: what the built rows (plus raw and supplied) make now.
  produced: ItemRates;
  delivery: DeliveryStatus[];
  // The mean of now/planned over the delivered parts: 0 with nothing flowing, 1 when finished.
  deliveryShare: number;
  // MW: what the built factories draw, and what built generators plus listed spare power give.
  power: { drawMW: number; supplyMW: number; short: boolean };
  // The unbuilt row to build next, or null when every row is built. `gain` is how much it
  // raises deliveryShare. When no single row adds delivery yet (a chain needs all its links),
  // it is the row that lets the most already-built machines run, with gain 0 and `unblocks`
  // the machine-equivalents it frees.
  next: { id: string; gain: number; unblocks: number } | null;
  builtCount: number;
  // Unticked rows running from the phase before (#1069).
  carriedCount: number;
  rowCount: number;
}

// Ratios this close to 1 are 1: the planner's balances carry floating-point dust.
const EPSILON = 1e-9;
const settle = (ratio: number) => (ratio > 1 - 1e-6 ? 1 : Math.max(0, ratio));

const add = (into: Record<string, number>, from: ItemRates | undefined, scale = 1) => {
  for (const [item, rate] of Object.entries(from || {}))
    into[item] = (into[item] || 0) + rate * scale;
};
// Per item: what is always available (raw and supplied), and what these built rows ask for
// together with what the plan gives outside the rows (storage, drone fuel, delivery). `capacity`
// is each running row's largest share: 1 for a ticked row, less for a carried one.
type Capacity = ReadonlyMap<string, number>;
const capOf = (capacity: Capacity, id: string) => capacity.get(id) || 0;
function books(stage: StoredStage, capacity: Capacity) {
  const extra: Record<string, number> = {};
  add(extra, stage.raw);
  add(extra, stage.supplied);
  const demand: Record<string, number> = {};
  add(demand, stage.storage);
  add(demand, stage.drone);
  for (const [item, delivery] of Object.entries(stage.delivery || {}))
    add(demand, { [item]: delivery.rate || 0 });
  for (const row of stage.rows || []) add(demand, row.inputs, capOf(capacity, row.id));
  return { extra, demand };
}

// Row shares for given row capacities, lowered from the capacity to a fixed point.
function shares(stage: StoredStage, capacity: Capacity): Map<string, number> {
  const rows = stage.rows || [];
  const { extra, demand } = books(stage, capacity);
  const share = new Map(rows.map(r => [r.id, capOf(capacity, r.id)]));
  for (let round = 0; round < 100; round++) {
    const supply: Record<string, number> = { ...extra };
    for (const row of rows) add(supply, row.outputs, share.get(row.id)!);
    let changed = false;
    for (const row of rows) {
      const cap = capOf(capacity, row.id);
      if (!cap) continue;
      // A short input reaches each consumer in proportion to what it asks, so a carried row
      // gets that part of its capacity.
      let fed = 1;
      for (const item of Object.keys(row.inputs || {}))
        fed = Math.min(
          fed,
          demand[item]! > EPSILON ? settle((supply[item] || 0) / demand[item]!) : 1,
        );
      const rowShare = cap * fed;
      if (Math.abs(rowShare - share.get(row.id)!) > EPSILON) changed = true;
      share.set(row.id, rowShare);
    }
    if (!changed) break;
  }
  return share;
}

// What the built rows make, the delivery that reaches the elevator, and the mean delivery share.
function flows(stage: StoredStage, capacity: Capacity, share: Map<string, number>) {
  const { extra: produced, demand } = books(stage, capacity);
  for (const row of stage.rows || []) add(produced, row.outputs, share.get(row.id)!);
  const delivery: DeliveryStatus[] = Object.entries(stage.delivery || {}).map(
    ([item, stageDelivery]) => {
      const planned = stageDelivery.rate || 0;
      const fraction =
        demand[item]! > EPSILON ? Math.min(1, settle((produced[item] || 0) / demand[item]!)) : 0;
      return { item, planned, now: planned * fraction };
    },
  );
  const parts = delivery.filter(d => d.planned > EPSILON);
  const deliveryShare = parts.length
    ? parts.reduce((sum, part) => sum + part.now / part.planned, 0) / parts.length
    : 0;
  return { produced, demand, delivery, deliveryShare };
}

// What powers stage `stage` once it is fully built, in MW, as the planner balances it: the
// generation its own rows build, with the augmenter boost, and the spare part of availableMW
// that this generation does not account for (the entered spare power, plus what Phase 5's
// augmenters add). A plan saved without availableMW uses `sparePowerMW`. The stage's
// additionalHeadroomMW is requiredMW minus both. ADA's power remark (app/ada-panel.ts) states
// these figures (#334).
export function stageSupply(
  stage: StoredStage,
  sparePowerMW = 0,
): { generationMW: number; spareMW: number } {
  const generationMW = (stage.generationMW || 0) * (1 + (stage.boost || 0));
  const spareMW = stage.availableMW !== undefined ? stage.availableMW - generationMW : sparePowerMW;
  return { generationMW, spareMW };
}

// What the built rows draw and what powers them, in MW, by the stage's grid (#1064, stageGrid in
// public/power.ts): each consumer at its clocked power with the utility allowance, the miners and
// extractors for the raw resources the built rows take, against each built generator line's whole
// generators with the augmenter boost, the augmenters' own part and the spare power. A fully
// built plan draws its grid's need, which its own generators cover (the ones kept from the phase
// before are left out, so this never counts on more than the rows build).
function gridPower(stage: StoredStage, grid: StageGrid, share: Map<string, number>) {
  const rows = stage.rows || [];
  const peak = rows.reduce((sum, row) => sum + lineLoad(row).peak, 0);
  const scale = peak > 0 ? (grid.loadMW + grid.allowanceMW) / peak : 0;
  const taken: Record<string, number> = {};
  let drawMW = 0,
    supplyMW = grid.spareMW + grid.augmenterMW;
  for (const row of rows) {
    const rowShare = share.get(row.id)!;
    if (row.power > 0) drawMW += lineLoad(row).peak * scale * rowShare;
    else supplyMW += row.machines * -row.power * (1 + (stage.boost || 0)) * rowShare;
    for (const [item, rate] of Object.entries(row.inputs || {}))
      if (grid.extraction[item]) taken[item] = (taken[item] || 0) + rate * rowShare;
  }
  for (const [item, mw] of Object.entries(grid.extraction)) {
    const drawn = stage.raw?.[item] || 0;
    if (drawn > 0) drawMW += (mw / drawn) * Math.min(drawn, taken[item] || 0);
  }
  return { drawMW, supplyMW };
}

// The same for a plan made before #1064, as the planner balanced it then. peakMW is whole
// machines at full power x powerFactor, so a row's share of it per machine-equivalent is
// peakMW / machines; the utility allowance is the stage's requiredMW / peakMW. The spare part
// comes from stageSupply.
function storedPower(stage: StoredStage, share: Map<string, number>, sparePowerMW: number) {
  const boost = stage.boost || 0;
  const utility = stage.peakMW && stage.requiredMW ? stage.requiredMW / stage.peakMW : 1;
  const { spareMW } = stageSupply(stage, sparePowerMW);
  let drawMW = 0,
    supplyMW = spareMW;
  for (const row of stage.rows || []) {
    const rowShare = share.get(row.id)!;
    if (row.power > 0) {
      const perEquivalent = row.machines && row.peakMW ? row.peakMW / row.machines : row.power;
      drawMW += perEquivalent * (row.equivalent || 0) * utility * rowShare;
    } else supplyMW += (row.generationMW || 0) * (1 + boost) * rowShare;
  }
  return { drawMW, supplyMW };
}

// `checks` is the profile's progress checks and `stageKey` the stage's key in the plan ('1'-'5'),
// as in the build plan's step ids. `buildOrder` is the stage's rows in the order the build plan
// lists them (groupedRows in group-order.ts, #869), which decides ties for the next step.
// `carried` is the share each unticked row carried from the phase before makes (phaseCarry in
// handover.ts, #1069); without it only the ticked rows run, as before.
export function buildStatus(
  stage: StoredStage,
  checks: Record<string, boolean>,
  stageKey: string,
  sparePowerMW = 0,
  buildOrder: readonly CalcRow[] = stage.rows || [],
  carried: ReadonlyMap<string, number> = new Map(),
): BuildStatus {
  const rows = stage.rows || [];
  const built = new Set(rows.filter(r => checks[`calc-${stageKey}-${r.id}`]).map(r => r.id));
  const capacity = new Map<string, number>();
  for (const row of rows) {
    const cap = built.has(row.id) ? 1 : carried.get(row.id) || 0;
    if (cap > 0) capacity.set(row.id, cap);
  }
  const share = shares(stage, capacity);
  const { produced, demand, delivery, deliveryShare } = flows(stage, capacity, share);
  const statusRows: RowStatus[] = rows.map(row => {
    const rowShare = share.get(row.id)!;
    const status: RowStatus = { id: row.id, built: built.has(row.id), share: rowShare };
    if (!status.built && capacity.has(row.id)) status.carried = capOf(capacity, row.id);
    if (capacity.has(row.id) && rowShare < capOf(capacity, row.id)) {
      // The input with the lowest supply against everything that asks for it (the ratio
      // shares() limits the row by), so a competing consumer or storage counts too.
      let worst = Infinity;
      for (const item of Object.keys(row.inputs || {})) {
        const ratio = demand[item]! > EPSILON ? (produced[item] || 0) / demand[item]! : Infinity;
        if (ratio < worst) [worst, status.shortOf] = [ratio, item];
      }
    }
    return status;
  });
  // Lines carried from Phase 1 into Phase 2 run on Phase 1's hand-fed biomass, which no plan
  // models, so they are left out of the power check; from Phase 2 on the carried generators are
  // rows too and count with their consumers.
  const powered =
    stageKey === '2'
      ? new Map([...share].map(([id, rowShare]) => [id, built.has(id) ? rowShare : 0]))
      : share;
  const { drawMW, supplyMW } = stage.grid
    ? gridPower(stage, stage.grid, powered)
    : storedPower(stage, powered, sparePowerMW);
  // The planner's own balance leaves float dust, so a fully built plan never trips the flag.
  const short = stageKey !== '1' && drawMW > supplyMW + 1e-6 * Math.max(1, supplyMW);
  // Machine-equivalents running among the rows running now (ticked or carried), other than
  // `skip`, under a set of shares.
  const running = (sharesById: Map<string, number>, skip: string) =>
    rows.reduce(
      (sum, row) =>
        sum +
        (capacity.has(row.id) && row.id !== skip
          ? (row.equivalent || 0) * sharesById.get(row.id)!
          : 0),
      0,
    );
  // The unbuilt row whose completion adds the most delivery, then the one that frees the most
  // running machines; ties go to build order. With neither, the first unbuilt row in build order.
  // A carried row counts as unbuilt: completing it is the step to tick here.
  let next: BuildStatus['next'] = null;
  for (const row of buildOrder) {
    if (built.has(row.id)) continue;
    const trial = new Map(capacity).set(row.id, 1);
    const trialShares = shares(stage, trial);
    const gain = Math.max(0, flows(stage, trial, trialShares).deliveryShare - deliveryShare);
    const unblocks = Math.max(0, running(trialShares, row.id) - running(share, row.id));
    const better =
      !next ||
      gain > next.gain + 1e-6 ||
      (Math.abs(gain - next.gain) <= 1e-6 && unblocks > next.unblocks + 1e-6);
    if (better) next = { id: row.id, gain: gain > 1e-6 ? gain : 0, unblocks };
  }
  return {
    rows: statusRows,
    produced,
    delivery,
    deliveryShare,
    power: { drawMW, supplyMW, short },
    next,
    builtCount: built.size,
    carriedCount: capacity.size - built.size,
    rowCount: rows.length,
  };
}
