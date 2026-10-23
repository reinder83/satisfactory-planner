// Where one somersloop pays off most (#1215, slice 7 of #1079): for each production line of the
// phase on screen that could take somersloops under the planner's rules, what amplifying one of
// its machines would save at the plan's own rates, best first by the raw resources it saves per
// somersloop. Presentation only: it reads the stored stage, never solves or stores anything, and
// the build plan's panel (ui/plan/SloopPayoffPanel.vue) and ADA word it.
//
// The planner's rules (public/somersloops.ts, amplified() in planner/recipes.ts):
// - machines take somersloops from the MAM research Production Amplifier on (AMPLIFIER_PHASE);
// - a line can take them when its machine has slots (AMPLIFY_SLOTS) and draws power; never an
//   amplified twin (its machines are full), a factory's own line for an item made on site (the
//   planner never amplifies those) or a storage-only line;
// - amplifying a machine fills every slot: AMPLIFIED_OUTPUT times the output from the same
//   inputs, at AMPLIFIED_POWER times the power.
// So one amplified machine does the work of two. A line of E machine-equivalents keeps its output
// with one amplified machine at clock c = min(1, E / 2) in place of 2c equivalents: it takes c
// equivalents less input, needs 1 + ceil(E - 2c) machines, and draws c × (4 - 2) machines' more
// power. What that input costs upstream is read from the stage's own lines (sloopUpstream): each
// item's cost per unit is shared over the lines making it as their main product and the raw
// resources drawn of it, in proportion to what each gives, so the raw resources and the power of
// the lines and the extraction behind it come out at the plan's rates. A byproduct or existing
// production of an item does not shrink when less is used, so it costs nothing at the margin;
// an item only those give costs nothing.
//
// The measure is the raw resources mined per minute saved per somersloop, Water left out as the
// planner's "least raw resources" objective leaves it out (it never runs out); ties go to the line
// that adds less power. Power is the machines' draw at the plan's consumption multiplier, without
// the utility allowance: the amplified machine's extra draw less the upstream lines' and the
// extraction's.
import {
  AMPLIFIED_OUTPUT,
  AMPLIFIED_POWER,
  AMPLIFIER_PHASE,
  AMPLIFY_SLOTS,
} from '../somersloops.ts';
import { extractionEquipment } from '../power.ts';
import { extractionMWPerUnit } from '../preferences.ts';
import type { CalcRow, StageGrid, StageKey, StoredSettings, StoredStage } from '../types/index.ts';

// The fields of a stage the ranking reads: a stored stage, or a test's few lines.
export type SloopStage = Pick<StoredStage, 'feasible' | 'rows' | 'raw'> & {
  grid?: Pick<StageGrid, 'extraction'>;
};

// What one amplified machine on a line saves (positive is saved; `netMW` positive is more power).
export interface SloopPayoff {
  // The row id, as the line's dialog and step know it.
  id: string;
  name: string;
  machine: string;
  // Somersloops one amplified machine of it takes: its slots.
  sloops: number;
  // Machines of the line itself fewer.
  machinesSaved: number;
  // Raw resources saved per minute, largest first and Water last.
  raw: [string, number][];
  // Raw resources mined per minute saved, Water left out, and that per somersloop.
  rawSaved: number;
  perSloop: number;
  netMW: number;
}

// Below this a rate or a power figure is rounding dust.
const SLOOP_DUST = 1e-6;
// The upstream costs settle geometrically through a loop (Recycled Rubber and Plastic); this many
// rounds is far past any loop a plan holds, and stops a malformed one.
const SLOOP_ROUNDS = 200;
// They have settled once no figure moves by more than this.
const SLOOP_SETTLED = 1e-12;

// What one unit of an item costs upstream: raw resources per unit and MW per unit per minute.
interface UnitCost {
  raw: Map<string, number>;
  mw: number;
}

// Whether the planner would let a line take somersloops (see the header).
export const takesSloops = (row: CalcRow): boolean =>
  row.power > 0 &&
  (AMPLIFY_SLOTS[row.machine] ?? 0) > 0 &&
  !row.amplified &&
  !row.id.startsWith('amp:') &&
  !row.onSite &&
  !row.stock &&
  row.equivalent > SLOOP_DUST;

// A line's main product: its first output, as the planner's primaryOutput reads a recipe.
const sloopMainProduct = (row: CalcRow): string | undefined => Object.keys(row.outputs || {})[0];

// MW per unit of a raw resource drawn: the stage's own extraction figures where it has them
// (its grid, #1064), else the profile's extraction equipment, as the planner sized it.
function sloopExtractionPerUnit(stage: SloopStage, settings: StoredSettings, item: string): number {
  const drawn = stage.raw?.[item] ?? 0,
    measured = stage.grid?.extraction?.[item];
  if (measured !== undefined && drawn > SLOOP_DUST) return measured / drawn;
  return extractionMWPerUnit(item, extractionEquipment(settings)) * (settings.powerFactor ?? 1);
}

// Each item's cost per unit at the stage's rates (see the header): the lines making it as their
// main product and the raw draw of it, in proportion to what each gives.
export function sloopUpstream(stage: SloopStage, settings: StoredSettings): Map<string, UnitCost> {
  const factor = settings.powerFactor ?? 1;
  const makers = new Map<string, { row: CalcRow | null; rate: number }[]>();
  const add = (item: string, row: CalcRow | null, rate: number) => {
    if (rate > SLOOP_DUST) makers.set(item, [...(makers.get(item) || []), { row, rate }]);
  };
  for (const row of stage.rows || []) {
    const item = sloopMainProduct(row);
    if (item && row.power >= 0 && !row.stock && row.equivalent > SLOOP_DUST)
      add(item, row, row.outputs[item] ?? 0);
  }
  for (const [item, rate] of Object.entries(stage.raw || {})) add(item, null, rate);
  const extraction = new Map(
    [...makers.keys()].map(item => [item, sloopExtractionPerUnit(stage, settings, item)]),
  );
  let costs = new Map<string, UnitCost>();
  for (let round = 0; round < SLOOP_ROUNDS; round++) {
    const next = new Map<string, UnitCost>();
    let change = 0;
    for (const [item, sources] of makers) {
      const total = sources.reduce((sum, source) => sum + source.rate, 0);
      const cost: UnitCost = { raw: new Map(), mw: 0 };
      for (const { row, rate } of sources) {
        const share = rate / total;
        if (!row) {
          cost.raw.set(item, (cost.raw.get(item) ?? 0) + share);
          cost.mw += share * (extraction.get(item) ?? 0);
          continue;
        }
        // Per unit of the item from this line: its own power and its inputs' costs.
        const perUnit = share / rate;
        cost.mw += perUnit * row.power * factor * row.equivalent;
        for (const [input, amount] of Object.entries(row.inputs || {}))
          addSloopCost(cost, costs.get(input), perUnit * amount);
      }
      const before = costs.get(item);
      change = Math.max(
        change,
        Math.abs(cost.mw - (before?.mw ?? 0)),
        Math.abs(sloopRawSum(cost) - (before ? sloopRawSum(before) : 0)),
      );
      next.set(item, cost);
    }
    costs = next;
    if (change < SLOOP_SETTLED) break;
  }
  return costs;
}

const sloopRawSum = (cost: UnitCost): number =>
  [...cost.raw.values()].reduce((sum, rate) => sum + rate, 0);

// Adds `amount` units of an item's cost to `cost`.
function addSloopCost(cost: UnitCost, of: UnitCost | undefined, amount: number) {
  if (!of || !(amount > 0)) return;
  cost.mw += amount * of.mw;
  for (const [item, rate] of of.raw) cost.raw.set(item, (cost.raw.get(item) ?? 0) + amount * rate);
}

// What one amplified machine on `row` saves, at the upstream costs of its stage.
export function sloopPayoffOf(
  row: CalcRow,
  costs: Map<string, UnitCost>,
  powerFactor: number,
): SloopPayoff {
  const equivalent = row.equivalent,
    clock = Math.min(1, equivalent / AMPLIFIED_OUTPUT),
    sloops = AMPLIFY_SLOTS[row.machine] ?? 0;
  const saved: UnitCost = { raw: new Map(), mw: 0 };
  for (const [input, amount] of Object.entries(row.inputs || {}))
    addSloopCost(saved, costs.get(input), (amount / equivalent) * clock);
  const after = 1 + Math.max(0, Math.ceil(equivalent - AMPLIFIED_OUTPUT * clock - SLOOP_DUST));
  const raw = [...saved.raw]
    .filter(([, rate]) => rate > SLOOP_DUST)
    .sort(
      (a, b) =>
        Number(a[0] === 'Water') - Number(b[0] === 'Water') ||
        b[1] - a[1] ||
        a[0].localeCompare(b[0]),
    );
  const rawSaved = raw.reduce((sum, [item, rate]) => sum + (item === 'Water' ? 0 : rate), 0);
  return {
    id: row.id,
    name: row.name,
    machine: row.machine,
    sloops,
    machinesSaved: Math.max(0, row.machines - after),
    raw,
    rawSaved,
    perSloop: rawSaved / sloops,
    netMW: row.power * powerFactor * clock * (AMPLIFIED_POWER - AMPLIFIED_OUTPUT) - saved.mw,
  };
}

// The ranking for a stage: every line that could take somersloops and saves something, best
// first; none before the Production Amplifier research's phase.
export function sloopPayoffs(
  stage: SloopStage | undefined,
  stageKey: StageKey,
  settings: StoredSettings,
): SloopPayoff[] {
  if (!stage?.feasible || Number(stageKey) < AMPLIFIER_PHASE) return [];
  const costs = sloopUpstream(stage, settings),
    factor = settings.powerFactor ?? 1;
  return (stage.rows || [])
    .filter(takesSloops)
    .map(row => sloopPayoffOf(row, costs, factor))
    .filter(entry => entry.perSloop > SLOOP_DUST || entry.machinesSaved > 0)
    .sort((a, b) => b.perSloop - a.perSloop || a.netMW - b.netMW || a.name.localeCompare(b.name));
}
