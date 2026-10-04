// MOCK-UP for #1022 and #1024 (design pass, not the implementation): where each byproduct of a
// phase goes, line by line, and how many Water Extractors the Water nobody recycles takes. It
// shows the proposed wording in place; the full version moves the sharing rule into
// group-links.ts so the Logistics page and the flow page's lanes follow it too.
//
// The rule (the recommendation in the proposal): a line that uses its own byproduct takes it
// back first; then each factory group uses what its own lines make; what a group has left goes
// to the groups still short of the item, the largest leftover to the largest shortfall first;
// what is left after that goes to storage or the sink, and extraction covers what is still
// missing. Inside a group, lines share in proportion to what they make and use.
import { num } from './format.ts';
import { LINK_DUST, rowPlaces } from './group-order.ts';
import { placeName } from './group-links.ts';
import type { CalcRow, FactoryGroups, StoredStage } from '../types/index.ts';

// Water Extractor, from the SatisfactoryTools dataset at the revision recorded in recipes.json:
// 120 m³/min and 20 MW at 100%, overclockable to 250% with 3 Power Shards; power rises with the
// clock to the power of 1.321928 (the game's overclock exponent, log2 2.5).
export const WATER_EXTRACTOR = { rate: 120, mw: 20, maxClock: 2.5, exponent: 1.321928 };

// The other end of a transfer: a line, or a place outside the lines.
export type RecycleEnd = { row: string } | { outside: 'extract' | 'sink' | 'storage' };

export interface RecycleTransfer {
  item: string;
  from: RecycleEnd;
  to: RecycleEnd;
  fromPlace: string;
  toPlace: string;
  rate: number;
}

interface PlacePart {
  row: CalcRow;
  rate: number;
}

// Items some line of the phase makes as a byproduct (an output other than its first), and
// Water whenever the phase extracts it.
export function recycledItems(stage: StoredStage): string[] {
  const items = new Set<string>();
  for (const row of stage.rows || [])
    Object.keys(row.outputs || {})
      .slice(1)
      .forEach(item => items.add(item));
  if ((stage.raw?.Water || 0) > LINK_DUST) items.add('Water');
  return [...items];
}

export function recycleTransfers(stage: StoredStage, groups: FactoryGroups): RecycleTransfer[] {
  return recycledItems(stage).flatMap(item => itemTransfers(stage, groups, item));
}

function itemTransfers(stage: StoredStage, groups: FactoryGroups, item: string) {
  const transfers: RecycleTransfer[] = [];
  const makers = new Map<string, PlacePart[]>(),
    users = new Map<string, PlacePart[]>();
  for (const row of stage.rows || [])
    for (const [place, share] of rowPlaces(row, groups)) {
      const made = (row.outputs?.[item] || 0) * share,
        used = (row.inputs?.[item] || 0) * share;
      // A line that uses its own byproduct takes it back first.
      const self = Math.min(made, used);
      if (self > LINK_DUST)
        transfers.push({
          item,
          from: { row: row.id },
          to: { row: row.id },
          fromPlace: place,
          toPlace: place,
          rate: self,
        });
      if (made - self > LINK_DUST)
        (makers.get(place) ?? makers.set(place, []).get(place)!).push({ row, rate: made - self });
      if (used - self > LINK_DUST)
        (users.get(place) ?? users.set(place, []).get(place)!).push({ row, rate: used - self });
    }
  const total = (parts: PlacePart[] | undefined) =>
    (parts || []).reduce((sum, part) => sum + part.rate, 0);
  // Share `rate` from one set of parts to another, in proportion to both.
  const share = (
    rate: number,
    from: PlacePart[],
    fromPlace: string,
    to: PlacePart[],
    toPlace: string,
  ) => {
    const made = total(from),
      asked = total(to);
    for (const maker of from)
      for (const user of to) {
        const part = (rate * maker.rate * user.rate) / (made * asked);
        if (part > LINK_DUST)
          transfers.push({
            item,
            from: { row: maker.row.id },
            to: { row: user.row.id },
            fromPlace,
            toPlace,
            rate: part,
          });
      }
  };
  const leftover = new Map<string, number>(),
    shortfall = new Map<string, number>();
  for (const place of new Set([...makers.keys(), ...users.keys()])) {
    const made = total(makers.get(place)),
      asked = total(users.get(place));
    const inside = Math.min(made, asked);
    if (inside > LINK_DUST) share(inside, makers.get(place)!, place, users.get(place)!, place);
    if (made - inside > LINK_DUST) leftover.set(place, made - inside);
    if (asked - inside > LINK_DUST) shortfall.set(place, asked - inside);
  }
  // The largest leftover to the largest shortfall first.
  const largest = (places: Map<string, number>) => [...places].sort((a, b) => b[1] - a[1])[0];
  for (
    let next = largest(leftover), short = largest(shortfall);
    next && short;
    next = largest(leftover), short = largest(shortfall)
  ) {
    const rate = Math.min(next[1], short[1]);
    share(rate, makers.get(next[0])!, next[0], users.get(short[0])!, short[0]);
    for (const [places, [place, left]] of [
      [leftover, next],
      [shortfall, short],
    ] as const)
      if (left - rate > LINK_DUST) places.set(place, left - rate);
      else places.delete(place);
  }
  for (const [place, left] of leftover)
    for (const maker of makers.get(place)!)
      transfers.push({
        item,
        from: { row: maker.row.id },
        to: { outside: (stage.surplus?.[item] || 0) > LINK_DUST ? 'sink' : 'storage' },
        fromPlace: place,
        toPlace: place,
        rate: (left * maker.rate) / total(makers.get(place)),
      });
  for (const [place, short] of shortfall)
    for (const user of users.get(place)!)
      transfers.push({
        item,
        from: { outside: 'extract' },
        to: { row: user.row.id },
        fromPlace: place,
        toPlace: place,
        rate: (short * user.rate) / total(users.get(place)),
      });
  return transfers;
}

// --- Water Extractors (#1024) ---

export interface ExtractorCount {
  rate: number;
  // Without shards: whole extractors at 100%, the last at `lastClock` %.
  count: number;
  lastClock: number;
  mw: number;
  // With shards: the fewest extractors at up to 250%, the last at `shardClock` %.
  shardCount: number;
  shardClock: number;
  shards: number;
  shardMW: number;
}

const extractorMW = (clock: number) =>
  WATER_EXTRACTOR.mw * Math.pow(clock / 100, WATER_EXTRACTOR.exponent);
const shardsFor = (clock: number) => Math.max(0, Math.ceil((clock - 100) / 50 - 1e-9));

export function waterExtractors(rate: number): ExtractorCount {
  const per = WATER_EXTRACTOR.rate,
    top = per * WATER_EXTRACTOR.maxClock;
  const count = Math.max(1, Math.ceil(rate / per - 1e-9)),
    lastClock = ((rate - (count - 1) * per) / per) * 100;
  const shardCount = Math.max(1, Math.ceil(rate / top - 1e-9)),
    shardClock = ((rate - (shardCount - 1) * top) / per) * 100;
  return {
    rate,
    count,
    lastClock,
    mw: (count - 1) * WATER_EXTRACTOR.mw + extractorMW(lastClock),
    shardCount,
    shardClock,
    shards: (shardCount - 1) * 3 + shardsFor(shardClock),
    shardMW: (shardCount - 1) * extractorMW(250) + extractorMW(shardClock),
  };
}

const extractorClock = (clock: number) => num(Math.round(clock * 10) / 10) + '%';
const mwText = (mw: number) => num(Math.round(mw * 10) / 10) + ' MW';
const countOf = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

// "3 Water Extractors (2 at 100% + 1 at 15%, 41.6 MW), or 1 at 215% with 3 Power Shards (55 MW)"
export function extractorText(rate: number): string {
  const count = waterExtractors(rate);
  const plain =
    count.count === 1
      ? `1 Water Extractor at ${extractorClock(count.lastClock)} (${mwText(count.mw)})`
      : `${countOf(count.count, 'Water Extractor')} (${count.count - 1} at 100% + 1 at ${extractorClock(count.lastClock)}, ${mwText(count.mw)})`;
  if (count.shardCount >= count.count) return plain;
  const sharded =
    count.shardCount === 1
      ? `1 at ${extractorClock(count.shardClock)}`
      : `${count.shardCount - 1} at 250% + 1 at ${extractorClock(count.shardClock)}`;
  return `${plain}, or ${sharded} with ${countOf(count.shards, 'Power Shard')} (${mwText(count.shardMW)})`;
}

// --- Wording ---

export interface RecycleContext {
  stage: StoredStage;
  groups: FactoryGroups;
  name: (rowId: string) => string;
  // flow.ts's FLUIDS and itemRate, passed in so this module stays free of the session.
  fluid: (item: string) => boolean;
  itemRate: (item: string, rate: number) => string;
}

// One piece of advice: a lead (the item and its rate) and text with links to other lines'
// dialogs between its parts.
export type AdvicePart = string | { row: string; text: string };
export interface AdviceLine {
  kind: 'byproduct' | 'input';
  item: string;
  lead: string;
  parts: AdvicePart[];
  // Water only: the extractors for what no byproduct covers (#1024).
  extract?: string;
}

const rowOf = (context: RecycleContext, id: string) =>
  (context.stage.rows || []).find(row => row.id === id);
const amount = (context: RecycleContext, item: string, rate: number) =>
  num(rate) + (context.fluid(item) ? ' m³' : '');
const placeLabel = (context: RecycleContext, place: string) =>
  placeName(place, context.groups.groups, context.stage.raw);
// Whether `supplier` feeds `user` directly: a byproduct sent back to its own supplier.
const feeds = (supplier: CalcRow | undefined, user: CalcRow | undefined) =>
  !!supplier && !!user && Object.keys(supplier.outputs || {}).some(item => user.inputs?.[item]);
const isByproduct = (row: CalcRow | undefined, item: string) =>
  !!row && Object.keys(row.outputs || {}).indexOf(item) > 0;

interface Share {
  rate: number;
  place: string;
  home: string;
}
// Transfers summed per other line.
function perRow(transfers: RecycleTransfer[], end: 'from' | 'to'): [string, Share][] {
  const rows = new Map<string, Share>();
  for (const transfer of transfers) {
    const side = transfer[end];
    if (!('row' in side)) continue;
    const entry = rows.get(side.row) ?? {
      rate: 0,
      place: end === 'to' ? transfer.toPlace : transfer.fromPlace,
      home: end === 'to' ? transfer.fromPlace : transfer.toPlace,
    };
    entry.rate += transfer.rate;
    rows.set(side.row, entry);
  }
  return [...rows].sort((a, b) => b[1].rate - a[1].rate);
}
const elsewhere = (context: RecycleContext, share: Share) =>
  share.place !== share.home ? ` in ${placeLabel(context, share.place)}` : '';

// Where `row`'s byproducts go: one line per byproduct.
export function byproductAdvice(row: CalcRow, context: RecycleContext): AdviceLine[] {
  const transfers = recycleTransfers(context.stage, context.groups);
  return Object.keys(row.outputs || {})
    .slice(1)
    .map(item => {
      const out = transfers.filter(
        t => t.item === item && 'row' in t.from && t.from.row === row.id,
      );
      const sunk = out.filter(t => !('row' in t.to)).reduce((sum, t) => sum + t.rate, 0);
      const destinations = perRow(out, 'to');
      const line: AdviceLine = {
        kind: 'byproduct',
        item,
        lead: `${item} ${context.itemRate(item, row.outputs[item] || 0)}`,
        parts: [],
      };
      const parts = line.parts;
      if (!destinations.length) {
        parts.push('No line uses it: send it to the AWESOME Sink.');
        return line;
      }
      const all = sunk <= 0.005 && destinations.length === 1;
      destinations.forEach(([id, share], i) => {
        const last = i === destinations.length - 1 && sunk <= 0.005;
        parts.push(i === 0 ? (id === row.id ? 'Pipe ' : 'Send ') : last ? ' and ' : ', ');
        parts.push(all ? 'all of it ' : amount(context, item, share.rate) + ' ');
        if (id === row.id) {
          parts.push(`back into this line’s own ${item} input`);
          return;
        }
        const loop = feeds(rowOf(context, id), row);
        parts.push(loop ? 'back to ' : 'to ', { row: id, text: context.name(id) });
        parts.push(elsewhere(context, share) + (loop ? ', which feeds this line' : ''));
      });
      parts.push(sunk > 0.005 ? ` and sink the other ${amount(context, item, sunk)}.` : '.');
      return line;
    });
}

// Where `row`'s inputs that a byproduct covers come from, and the extractors for the Water no
// byproduct covers.
export function inputAdvice(row: CalcRow, context: RecycleContext): AdviceLine[] {
  const transfers = recycleTransfers(context.stage, context.groups);
  return Object.keys(row.inputs || {}).flatMap((item): AdviceLine[] => {
    const into = transfers.filter(t => t.item === item && 'row' in t.to && t.to.row === row.id);
    const sources = perRow(into, 'from');
    const extracted = into.filter(t => !('row' in t.from)).reduce((sum, t) => sum + t.rate, 0);
    const water = item === 'Water' && extracted > 0.005;
    if (!sources.some(([id]) => isByproduct(rowOf(context, id), item)) && !water) return [];
    const line: AdviceLine = {
      kind: 'input',
      item,
      lead: `${item} ${context.itemRate(item, row.inputs[item] || 0)}`,
      parts: [],
    };
    const parts = line.parts;
    const all = sources.length === 1 && extracted <= 0.005;
    sources.forEach(([id, share], i) => {
      parts.push(i ? ', ' : '', all ? 'All of it ' : amount(context, item, share.rate) + ' ');
      if (id === row.id) {
        parts.push('from this line’s own byproduct');
        return;
      }
      const source = rowOf(context, id);
      const by = isByproduct(source, item);
      parts.push(
        by && feeds(row, source) ? 'recycled from ' : 'from ',
        { row: id, text: context.name(id) },
        (by && !feeds(row, source) ? '’s byproduct' : '') + elsewhere(context, share),
      );
    });
    if (water) {
      parts.push(
        sources.length
          ? `; extract the other ${amount(context, item, extracted)}.`
          : 'No byproduct covers it: extract all of it.',
      );
      line.extract = `Build ${extractorText(extracted)}.`;
    } else
      parts.push(
        extracted > 0.005
          ? `; the other ${amount(context, item, extracted)} from ${item} supply.`
          : '.',
      );
    return [line];
  });
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
// The advice as plain text, for a build-plan step.
export const adviceText = (lines: AdviceLine[]): string =>
  lines
    .map(
      line =>
        `${line.kind === 'byproduct' ? 'Byproduct ' : ''}${line.lead}: ` +
        lowerFirst(line.parts.map(part => (typeof part === 'string' ? part : part.text)).join('')) +
        (line.extract ? ' ' + line.extract : ''),
    )
    .join(' ');
