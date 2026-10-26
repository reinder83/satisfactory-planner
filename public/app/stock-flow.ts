// Where a storage-only line's output goes (#1173), for its production line dialog. A storage-only
// line (#1061, `stock` rows, planner/stock.ts) is added after the phase is solved, only to top up
// protected storage: storage takes the plan's surplus of an item first, the plan's surplus left
// after that feeds the storage-only lines, and their own lines make the rest. So the line's output
// goes to protected storage, to the other storage-only lines that use the item (on their way to
// storage), and to the plan's generators that burn more fuel to power the storage-only lines.
// Nothing else in the plan uses it, so it is never shared out over the plan's other consumers.
//
// The stored stage keeps no record of which source fed what, but its books say it: the plan's
// other lines leave `left` of the item, which is what storage and the sink receive, less what the
// storage-only lines make beyond what they use. Storage takes that first, the storage-only lines
// use what is left of it, and the storage-only lines making the item give the rest of both. When
// `left` is negative the plan's other lines take that much from the storage-only lines. What is
// still left goes to the sink. Several storage-only lines making the same item give each of these
// in proportion to what each makes. It reads only its arguments (no session).
import type { CalcRow, StoredStage } from '../types/index.ts';

// One of the line's destinations, at the line's own rate: a storage-only line or another line of
// the plan using the item.
export interface StockDelivery {
  consumer: CalcRow;
  rate: number;
}

// What a storage-only line gives of one of its items: to the other storage-only lines, to the
// plan's other lines (generators burning more fuel for the storage-only lines' power), to
// protected storage and to the sink. Together these are what the line makes of the item.
export interface StockShares {
  lines: StockDelivery[];
  plan: StockDelivery[];
  storage: number;
  sink: number;
}

const sumOf = (rows: CalcRow[], rate: (row: CalcRow) => number | undefined): number =>
  rows.reduce((total, row) => total + (rate(row) || 0), 0);

// Each consumer's part of `total`, in proportion to what it takes of `item`.
function shareOver(consumers: CalcRow[], item: string, total: number): StockDelivery[] {
  const taken = sumOf(consumers, consumer => consumer.inputs[item]);
  if (!(total > 0) || !(taken > 0)) return [];
  return consumers.map(consumer => ({
    consumer,
    rate: (total * (consumer.inputs[item] || 0)) / taken,
  }));
}

// What storage-only line `row` gives of `item` (StockShares; see the top of this file).
export function stockShares(row: CalcRow, item: string, stage: StoredStage): StockShares {
  const rows = stage.rows || [];
  const stockRows = rows.filter(other => other.stock);
  const made = sumOf(stockRows, other => other.outputs[item]),
    own = row.outputs[item] || 0;
  if (!(made > 0) || !(own > 0)) return { lines: [], plan: [], storage: 0, sink: 0 };
  const share = own / made;
  const lineUsers = stockRows.filter(other => other.id !== row.id && other.inputs[item]);
  const used = sumOf(lineUsers, other => other.inputs[item]);
  const stored = stage.storage?.[item] || 0,
    surplus = stage.surplus?.[item] || 0;
  const left = stored + surplus - (made - sumOf(stockRows, other => other.inputs[item]));
  const fromPlan = Math.max(0, left);
  const toStorage = Math.min(made, Math.max(0, stored - fromPlan));
  const toLines = Math.min(made - toStorage, Math.max(0, used - Math.max(0, fromPlan - stored)));
  const toPlan = Math.min(made - toStorage - toLines, Math.max(0, -left));
  // The plan's other lines that take the item from the storage-only lines: the generators burning
  // more fuel for their power, else any line using the item.
  const planUsers = rows.filter(other => !other.stock && other.inputs[item]);
  const generators = planUsers.filter(other => other.power < 0);
  return {
    lines: shareOver(lineUsers, item, toLines * share),
    plan: shareOver(generators.length ? generators : planUsers, item, toPlan * share),
    storage: toStorage * share,
    sink: Math.max(0, made - toStorage - toLines - toPlan) * share,
  };
}
