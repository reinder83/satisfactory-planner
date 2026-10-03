// PROTOTYPE for #883 (branch proto-883-group-flow, never merged): the flow diagram of one
// factory group. Built from the same books as the Logistics page (groupLinks in group-links.ts),
// so what comes in and goes out agrees with "Between groups"; inside the group, each item's
// in-group supply is shared out among the in-group lines that use it in proportion to what each
// asks, as groupLinks shares an item between places.
import { groupLinks, isSource, placeName, rowShares, sourceItem, UNGROUPED } from './group-links.ts';
import type { CalcRow, FactoryGroups, StoredStage } from '../types/index.ts';

const DUST = 1e-6;

// A line of the group: the part of a calculated row that sits in it (its share).
export interface FlowLine {
  key: string;
  id: string;
  // Build order position, 1-based (suppliers before consumers, as the build plan orders rows).
  no: number;
  recipe: string;
  machine: string;
  // The row's whole machine count, and this group's part of it (equal unless the row is split).
  machines: number;
  here: number;
  share: number;
  lastClock: number;
  // Primary output and its rate here, or a generator's MW.
  output: string | null;
  rate: number;
  mw: number;
  // Every item it makes here, largest first.
  outputs: { item: string; rate: number }[];
  // Columns for a left-to-right layout: 0 for a line fed only from outside the group.
  depth: number;
}

// A place outside the group, for one item: what comes in from it or goes out to it.
export interface FlowPort {
  key: string;
  dir: 'in' | 'out';
  item: string;
  rate: number;
  place: string;
  placeLabel: string;
  // raw resource, existing supply, another group, ungrouped lines, or a destination.
  kind: 'raw' | 'supply' | 'group' | 'ungrouped' | 'outside';
}

export interface FlowEdge {
  from: string;
  to: string;
  item: string;
  rate: number;
  // A link from a later line back to an earlier one (a recycling loop): seed it first.
  loop: boolean;
}

export interface GroupFlow {
  lines: FlowLine[];
  ins: FlowPort[];
  outs: FlowPort[];
  edges: FlowEdge[];
  split: boolean;
}

const firstOutput = (row: CalcRow) => Object.keys(row.outputs || {})[0] ?? null;

export function groupFlow(stage: StoredStage, groups: FactoryGroups, groupId: string): GroupFlow {
  const known = new Set(groups.groups.map(g => g.id));
  const rows = stage.rows || [];
  // The group's part of each row, in the plan's build order.
  const parts: { row: CalcRow; share: number }[] = [];
  for (const row of rows) {
    const total = Object.values(row.outputs || {})[0] || row.generationMW || 0;
    const memberships = (groups.assignments[row.id] || []).map(m =>
      known.has(m.group) ? m : { ...m, group: UNGROUPED },
    );
    const share = rowShares(total, memberships).get(groupId) || 0;
    if (share > DUST) parts.push({ row, share });
  }
  const lines: FlowLine[] = parts.map(({ row, share }, i) => {
    const output = firstOutput(row);
    return {
      key: 'line:' + row.id,
      id: row.id,
      no: i + 1,
      recipe: row.name,
      machine: row.machine,
      machines: row.machines,
      here: row.machines * share,
      share,
      lastClock: row.lastClock,
      output,
      rate: output ? (row.outputs[output] || 0) * share : 0,
      mw: (row.generationMW || 0) * share,
      outputs: Object.entries(row.outputs || {})
        .map(([item, rate]) => ({ item, rate: rate * share }))
        .sort((a, b) => b.rate - a.rate),
      depth: 0,
    };
  });
  // Plan-wide totals per item, as groupLinks counts them.
  const made: Record<string, number> = {},
    asked: Record<string, number> = {};
  const add = (books: Record<string, number>, item: string, rate: number) => {
    if (rate > DUST) books[item] = (books[item] || 0) + rate;
  };
  for (const row of rows) {
    for (const [item, rate] of Object.entries(row.outputs || {})) add(made, item, rate);
    for (const [item, rate] of Object.entries(row.inputs || {})) add(asked, item, rate);
  }
  for (const books of [stage.raw, stage.supplied])
    for (const [item, rate] of Object.entries(books || {})) add(made, item, rate);
  for (const books of [stage.storage, stage.drone, stage.transport, stage.surplus])
    for (const [item, rate] of Object.entries(books || {})) add(asked, item, rate as number);
  for (const [item, delivery] of Object.entries(stage.delivery || {}))
    add(asked, item, delivery.rate || 0);
  // In-group supply and demand per item, per line.
  const supply: Record<string, Map<string, number>> = {},
    demand: Record<string, Map<string, number>> = {};
  parts.forEach(({ row, share }, i) => {
    const key = lines[i]!.key;
    for (const [item, rate] of Object.entries(row.outputs || {}))
      (supply[item] ??= new Map()).set(key, rate * share);
    for (const [item, rate] of Object.entries(row.inputs || {}))
      (demand[item] ??= new Map()).set(key, rate * share);
  });
  const sum = (map?: Map<string, number>) =>
    [...(map?.values() || [])].reduce((total, rate) => total + rate, 0);
  const order = new Map(lines.map(line => [line.key, line.no]));
  const edges: FlowEdge[] = [];
  for (const [item, makers] of Object.entries(supply)) {
    const users = demand[item];
    if (!users) continue;
    const groupMade = sum(makers),
      groupAsked = sum(users);
    const moved = Math.min(made[item] || 0, asked[item] || 0);
    const inside =
      (moved * groupMade * groupAsked) / ((made[item] || 1) * (asked[item] || 1));
    for (const [from, supplied] of makers)
      for (const [to, wanted] of users) {
        if (from === to) continue;
        const rate = (inside * supplied * wanted) / (groupMade * groupAsked);
        if (rate > DUST)
          edges.push({ from, to, item, rate, loop: order.get(from)! > order.get(to)! });
      }
  }
  // Columns: one past the deepest in-group supplier, loops left out.
  for (const line of lines)
    line.depth = Math.max(
      0,
      ...edges
        .filter(edge => edge.to === line.key && !edge.loop)
        .map(edge => lines.find(l => l.key === edge.from)!.depth + 1),
    );
  // What crosses the group's edge, from the Logistics page's links.
  const ins: FlowPort[] = [],
    outs: FlowPort[] = [];
  const kindOf = (place: string): FlowPort['kind'] =>
    isSource(place)
      ? stage.raw?.[sourceItem(place)]
        ? 'raw'
        : 'supply'
      : place === UNGROUPED
        ? 'ungrouped'
        : known.has(place)
          ? 'group'
          : 'outside';
  for (const link of groupLinks(stage, groups)) {
    if (link.to === groupId)
      for (const { item, rate } of link.items)
        ins.push({
          key: `in:${link.from}:${item}`,
          dir: 'in',
          item,
          rate,
          place: link.from,
          placeLabel: isSource(link.from)
            ? stage.raw?.[item]
              ? 'Raw resource'
              : 'Existing supply'
            : placeName(link.from, groups.groups, stage.raw),
          kind: kindOf(link.from),
        });
    if (link.from === groupId)
      for (const { item, rate } of link.items)
        outs.push({
          key: `out:${link.to}:${item}`,
          dir: 'out',
          item,
          rate,
          place: link.to,
          placeLabel: placeName(link.to, groups.groups, stage.raw),
          kind: kindOf(link.to),
        });
  }
  // Each port's rate shared among the lines that use (or make) its item.
  for (const port of ins) {
    const users = demand[port.item];
    const total = sum(users);
    for (const [to, wanted] of users || [])
      edges.push({ from: port.key, to, item: port.item, rate: (port.rate * wanted) / total, loop: false });
  }
  for (const port of outs) {
    const makers = supply[port.item];
    const total = sum(makers);
    for (const [from, supplied] of makers || [])
      edges.push({ from, to: port.key, item: port.item, rate: (port.rate * supplied) / total, loop: false });
  }
  const bySize = (a: FlowPort, b: FlowPort) => b.rate - a.rate;
  ins.sort((a, b) => a.kind.localeCompare(b.kind) || bySize(a, b));
  outs.sort((a, b) => a.kind.localeCompare(b.kind) || bySize(a, b));
  return { lines, ins, outs, edges, split: lines.some(line => line.share < 1 - DUST) };
}
