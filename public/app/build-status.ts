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
// - Built rows start at full and are lowered until nothing changes, so byproduct loops (a row fed
//   by a later one) settle, and a fully built plan comes out at exactly its planned rates.
// - Power is reported, not applied: a plan whose built factories draw more than its built
//   generators and the listed spare power give is flagged, but nothing is slowed down for it.
import type { ItemRates, StoredStage } from '../types/index.ts';

export interface RowStatus {
  id: string;
  built: boolean;
  // 0-1: the share of its planned rate the row can run at now (0 when not built).
  share: number;
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
  rowCount: number;
}

// Ratios this close to 1 are 1: the planner's balances carry floating-point dust.
const EPSILON = 1e-9;
const settle = (x: number) => (x > 1 - 1e-6 ? 1 : Math.max(0, x));

const add = (into: Record<string, number>, from: ItemRates | undefined, scale = 1) => {
  for (const [n, v] of Object.entries(from || {})) into[n] = (into[n] || 0) + v * scale;
};
// Per item: what is always available (raw and supplied), and what these built rows ask for
// together with what the plan gives outside the rows (storage, drone fuel, delivery).
function books(stage: StoredStage, built: Set<string>) {
  const extra: Record<string, number> = {};
  add(extra, stage.raw);
  add(extra, stage.supplied);
  const demand: Record<string, number> = {};
  add(demand, stage.storage);
  add(demand, stage.drone);
  for (const [n, d] of Object.entries(stage.delivery || {})) add(demand, { [n]: d.rate || 0 });
  for (const r of stage.rows || []) if (built.has(r.id)) add(demand, r.inputs);
  return { extra, demand };
}

// Row shares for a given set of built row ids, lowered from full to a fixed point.
function shares(stage: StoredStage, built: Set<string>): Map<string, number> {
  const rows = stage.rows || [];
  const { extra, demand } = books(stage, built);
  const share = new Map(rows.map(r => [r.id, built.has(r.id) ? 1 : 0]));
  for (let round = 0; round < 100; round++) {
    const supply: Record<string, number> = { ...extra };
    for (const r of rows) add(supply, r.outputs, share.get(r.id)!);
    let changed = false;
    for (const r of rows) {
      if (!built.has(r.id)) continue;
      let s = 1;
      for (const n of Object.keys(r.inputs || {}))
        s = Math.min(s, demand[n]! > EPSILON ? settle((supply[n] || 0) / demand[n]!) : 1);
      if (Math.abs(s - share.get(r.id)!) > EPSILON) changed = true;
      share.set(r.id, s);
    }
    if (!changed) break;
  }
  return share;
}

// What the built rows make, the delivery that reaches the elevator, and the mean delivery share.
function flows(stage: StoredStage, built: Set<string>, share: Map<string, number>) {
  const { extra: produced, demand } = books(stage, built);
  for (const r of stage.rows || []) add(produced, r.outputs, share.get(r.id)!);
  const delivery: DeliveryStatus[] = Object.entries(stage.delivery || {}).map(([item, d]) => {
    const planned = d.rate || 0;
    const fraction =
      demand[item]! > EPSILON ? Math.min(1, settle((produced[item] || 0) / demand[item]!)) : 0;
    return { item, planned, now: planned * fraction };
  });
  const parts = delivery.filter(d => d.planned > EPSILON);
  const deliveryShare = parts.length
    ? parts.reduce((t, d) => t + d.now / d.planned, 0) / parts.length
    : 0;
  return { produced, delivery, deliveryShare };
}

// `checks` is the profile's progress checks and `stageKey` the stage's key in the plan ('1'-'5'),
// as in the build plan's step ids.
export function buildStatus(
  stage: StoredStage,
  checks: Record<string, boolean>,
  stageKey: string,
  sparePowerMW = 0,
): BuildStatus {
  const rows = stage.rows || [];
  const built = new Set(rows.filter(r => checks[`calc-${stageKey}-${r.id}`]).map(r => r.id));
  const share = shares(stage, built);
  const { produced, delivery, deliveryShare } = flows(stage, built, share);
  const statusRows: RowStatus[] = rows.map(r => {
    const s = share.get(r.id)!;
    const status: RowStatus = { id: r.id, built: built.has(r.id), share: s };
    if (status.built && s < 1) {
      // The input with the lowest supply against the plan's demand for it.
      let worst = Infinity;
      for (const n of Object.keys(r.inputs || {})) {
        const ratio = (produced[n] || 0) / (r.inputs[n] || 1);
        if (ratio < worst) [worst, status.shortOf] = [ratio, n];
      }
    }
    return status;
  });
  // Power: MW per machine times machine-equivalents, scaled by how much of the row runs.
  let drawMW = 0,
    supplyMW = sparePowerMW;
  for (const r of rows) {
    const s = share.get(r.id)!;
    if (r.power > 0) drawMW += r.power * (r.equivalent || 0) * s;
    else supplyMW += (r.generationMW || 0) * s;
  }
  // Machine-equivalents running among the rows built now, under a set of shares.
  const running = (s: Map<string, number>) =>
    rows.reduce((t, r) => t + (built.has(r.id) ? (r.equivalent || 0) * s.get(r.id)! : 0), 0);
  const runningNow = running(share);
  // The unbuilt row whose completion adds the most delivery, then the one that frees the most
  // built machines; ties go to build order. With neither, the first unbuilt row in build order.
  let next: BuildStatus['next'] = null;
  for (const r of rows) {
    if (built.has(r.id)) continue;
    const trial = new Set(built).add(r.id);
    const trialShares = shares(stage, trial);
    const gain = Math.max(0, flows(stage, trial, trialShares).deliveryShare - deliveryShare);
    const unblocks = Math.max(0, running(trialShares) - runningNow);
    const better =
      !next ||
      gain > next.gain + 1e-6 ||
      (Math.abs(gain - next.gain) <= 1e-6 && unblocks > next.unblocks + 1e-6);
    if (better) next = { id: r.id, gain: gain > 1e-6 ? gain : 0, unblocks };
  }
  return {
    rows: statusRows,
    produced,
    delivery,
    deliveryShare,
    power: { drawMW, supplyMW, short: drawMW > supplyMW + 1e-6 },
    next,
    builtCount: built.size,
    rowCount: rows.length,
  };
}
