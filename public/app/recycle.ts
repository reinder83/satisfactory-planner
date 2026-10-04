// Byproduct recycling advice (#1022): where each byproduct of a calculated phase goes, line by
// line, and where an input a byproduct covers gets it from, worded for the factory dialog
// (ui/detail/RecycleAdvice.vue), the build plan's step (rowStepBody in views/calculated.ts) and a
// group's flow page (ui/group-flow/FlowCard.vue).
//
// Nothing here decides how an item is shared out: it follows each place's links as a group's flow
// page draws them (placeLinks in group-flow.ts), which read the Logistics page's books and links
// (itemBooks, groupLinks and shareOut in group-links.ts). So the advice, the flow page's lanes
// and "Between groups" always agree: a line takes its own byproduct back first, then its group's
// lines use it, a group's leftover goes to the group short of the most, then storage and the
// sink; extraction and existing supply cover what is still missing. A transfer between two lines
// of different places is the link between those places shared by what each line sends into it
// and takes from it.
//
// It reads only its arguments (no session), so the pages pass the stage of the phase they show.
import { num } from './format.ts';
import { homeGroup, LINK_DUST, rowPlaces, UNGROUPED } from './group-order.ts';
import { groupLinks, isSource, itemBooks, OUTSIDE, placeName } from './group-links.ts';
import { placeLinks } from './group-flow.ts';
import type { FlowEnd, PhaseBooks } from './group-flow.ts';
import type { CalcRow, FactoryGroups, OnSiteSettings, StoredStage } from '../types/index.ts';

// One end of a line-level transfer: a line (a plan row's id) in a place, or a place that is not a
// line: a raw resource or existing-supply source, or a destination (storage, the sink, …).
export type RecycleEnd =
  | { kind: 'line'; id: string; place: string }
  | { kind: 'place'; id: string };

// Something one end sends the other per minute.
export interface RecycleTransfer {
  item: string;
  rate: number;
  from: RecycleEnd;
  to: RecycleEnd;
}

// What the advice reads: the phase's stage, the profile's groups and every line-level transfer.
export interface RecycleModel {
  stage: StoredStage;
  groups: FactoryGroups;
  transfers: RecycleTransfer[];
}

// A line's byproducts: its outputs after the first, its main product (primaryOutput in
// planner/recipes.ts). A generator's waste is its first output, so it is none.
export const byproductsOf = (row: CalcRow): string[] =>
  Object.keys(row.outputs || {})
    .slice(1)
    .filter(item => (row.outputs[item] || 0) > LINK_DUST);

const isByproductOf = (row: CalcRow | undefined, item: string) =>
  !!row && byproductsOf(row).includes(item);

// The loop test: whether `supplier` feeds `user` directly, by an output of its own other than
// `except` (the byproduct being recycled) that `user` takes in. A byproduct sent back to a line
// that feeds its maker is a loop (Aluminum Scrap's Water back to Alumina Solution, which feeds it
// Alumina Solution), worded "back to …, which feeds this line".
export const feeds = (
  supplier: CalcRow | undefined,
  user: CalcRow | undefined,
  except?: string,
): boolean =>
  !!supplier &&
  !!user &&
  supplier.id !== user.id &&
  Object.keys(supplier.outputs || {}).some(
    item => item !== except && (user.inputs?.[item] || 0) > LINK_DUST,
  );

// Every line-level transfer of the phase (RecycleModel), from each place's links: a link between
// two lines of a place as it is, a link between a line and a source or destination as it is, and
// a link between two places shared out over the lines that send into it and take from it.
export function recycleModel(
  stage: StoredStage,
  groups: FactoryGroups,
  planned?: OnSiteSettings,
): RecycleModel {
  const phase: PhaseBooks = {
    books: itemBooks(stage, groups, planned),
    links: groupLinks(stage, groups, planned),
  };
  const places = new Set<string>();
  for (const row of stage.rows || [])
    for (const place of rowPlaces(row, groups).keys()) places.add(place);
  const transfers: RecycleTransfer[] = [];
  const crossing = new Map<string, Crossing>();
  const crossingOf = (from: string, to: string, item: string) => {
    const key = [from, to, item].join('\u0000');
    const entry = crossing.get(key) ?? { item, out: [], outRates: [], in: [], inRates: [] };
    crossing.set(key, entry);
    return entry;
  };
  const line = (end: FlowEnd, place: string): RecycleEnd =>
    end.kind === 'line' ? { kind: 'line', id: end.id, place } : { kind: 'place', id: end.id };
  for (const place of places)
    for (const link of placeLinks(stage, groups, place, phase)) {
      const from = line(link.from, place),
        to = line(link.to, place);
      if (link.from.kind === 'line' && link.to.kind === 'line')
        transfers.push({ item: link.item, rate: link.rate, from, to });
      else if (link.to.kind === 'place' && places.has(link.to.id)) {
        const entry = crossingOf(place, link.to.id, link.item);
        entry.out.push(from);
        entry.outRates.push(link.rate);
      } else if (link.from.kind === 'place' && places.has(link.from.id)) {
        const entry = crossingOf(link.from.id, place, link.item);
        entry.in.push(to);
        entry.inRates.push(link.rate);
      } else transfers.push({ item: link.item, rate: link.rate, from, to });
    }
  for (const entry of crossing.values()) transfers.push(...crossingTransfers(entry));
  return { stage, groups, transfers };
}

// One item's link from one place to another, as the lines' parts of it: `out` and `outRates`
// from the sender's flow, `in` and `inRates` from the receiver's (recycleModel).
interface Crossing {
  item: string;
  out: RecycleEnd[];
  outRates: number[];
  in: RecycleEnd[];
  inRates: number[];
}

// The line-to-line transfers of a link between two places: each sending line's part of it,
// shared over the receiving lines in proportion to what each takes from it.
function crossingTransfers(entry: Crossing): RecycleTransfer[] {
  const total = entry.inRates.reduce((sum, rate) => sum + rate, 0);
  if (total <= LINK_DUST) return [];
  return entry.out.flatMap((from, i) =>
    entry.in.flatMap((to, j) => {
      const rate = (entry.outRates[i]! * entry.inRates[j]!) / total;
      return rate > LINK_DUST ? [{ item: entry.item, rate, from, to }] : [];
    }),
  );
}

// --- The advice ---

// What the wording reads besides the model: a line's name as the page names it (buildRowName,
// "Wire for Alpha"), whether an item is a fluid, and its rate with its unit (itemRate in flow.ts),
// passed in so this module stays free of the session.
export interface AdviceWords {
  name: (row: CalcRow) => string;
  fluid: (item: string) => boolean;
  itemRate: (item: string, rate: number) => string;
}

// A piece of advice text: plain text, or another line's name linking to its dialog.
export type AdvicePart = string | { row: string; text: string };

// One paragraph: a byproduct of the line, or one of its inputs a byproduct covers, with the
// item's whole rate on the line (`lead`, "Water 116.27 m³/min") and the sentence as parts.
export interface AdviceLine {
  kind: 'byproduct' | 'input';
  item: string;
  lead: string;
  parts: AdvicePart[];
}

// One other end of a line's transfers of an item, summed: a line (by row id, in a place), or a
// destination or source place.
interface Peer {
  end: RecycleEnd;
  rate: number;
}

// The transfers of `item` out of (`side` 'from') or into (`side` 'to') row `rowId`, summed per
// other end, the row itself first, then the largest rate first.
function peersOf(model: RecycleModel, rowId: string, item: string, side: 'from' | 'to'): Peer[] {
  const other = side === 'from' ? 'to' : 'from';
  const peers = new Map<string, Peer>();
  for (const transfer of model.transfers) {
    const end = transfer[side];
    if (transfer.item !== item || end.kind !== 'line' || end.id !== rowId) continue;
    const peer = transfer[other];
    // The row's own use is one, whatever places a split row is in; another line once per place.
    const key =
      peer.kind !== 'line'
        ? `place|${peer.id}`
        : peer.id === rowId
          ? 'self'
          : `line|${peer.id}|${peer.place}`;
    const entry = peers.get(key) ?? { end: peer, rate: 0 };
    entry.rate += transfer.rate;
    peers.set(key, entry);
  }
  const self = (peer: Peer) => (peer.end.kind === 'line' && peer.end.id === rowId ? 0 : 1);
  return [...peers.values()]
    .filter(peer => peer.rate > LINK_DUST)
    .sort((a, b) => self(a) - self(b) || b.rate - a.rate);
}

// What a paragraph is about (`row`'s `item`), and what it reads to name the other lines.
interface Wording {
  model: RecycleModel;
  words: AdviceWords;
  row: CalcRow;
  item: string;
  rowOf: (id: string) => CalcRow | undefined;
}

// "116.27 m³" for a fluid, "39.52" for a solid: an amount of the item without "/min".
const amountOf = (wording: Wording, rate: number) =>
  num(rate) + (wording.words.fluid(wording.item) ? ' m³' : '');

// " in Electronics" when a line is in another place than `row`'s own (homeGroup), " (ungrouped)"
// for a line in no group seen from a group, else ''.
function whereOf(wording: Wording, end: RecycleEnd): string {
  if (end.kind !== 'line' || end.place === homeGroup(wording.row, wording.model.groups)) return '';
  if (end.place === UNGROUPED) return ' (ungrouped)';
  return ' in ' + placeName(end.place, wording.model.groups.groups, wording.model.stage.raw);
}

// The link to another line's dialog, named as the page names it.
function lineLink(wording: Wording, id: string): AdvicePart {
  const row = wording.rowOf(id);
  return { row: id, text: row ? wording.words.name(row) : id };
}

// The destinations a solid's leftover goes to, worded as one: "store or sink the other 2.05".
const STORE_OR_SINK = new Set<string>([OUTSIDE.storage, OUTSIDE.surplus]);
// The other destinations a byproduct could reach, as the advice names them.
const DESTINATION_WORDS: Record<string, string> = {
  [OUTSIDE.delivery]: 'to the Space Elevator',
  [OUTSIDE.drone]: 'for drone fuel',
  [OUTSIDE.transport]: 'for vehicle fuel',
};

// Where `row`'s byproducts go: one paragraph per byproduct (#1022). The row's own input first
// ("Pipe all of it back into this line's own Water input."), then the lines using it, the largest
// first, each linked, "in <group>" when it is in another place and "back to …, which feeds this
// line" for a loop; a solid's leftover is stored or sunk (the owner's choice 5), and a fluid,
// which the planner balances exactly, never gets that advice.
export function byproductAdvice(
  row: CalcRow,
  model: RecycleModel,
  words: AdviceWords,
): AdviceLine[] {
  const rows = new Map((model.stage.rows || []).map(other => [other.id, other]));
  return byproductsOf(row).flatMap(item => {
    const wording: Wording = { model, words, row, item, rowOf: id => rows.get(id) };
    const parts = byproductParts(wording, peersOf(model, row.id, item, 'from'));
    return parts.length
      ? [
          {
            kind: 'byproduct',
            item,
            lead: item + ' ' + words.itemRate(item, row.outputs[item]!),
            parts,
          },
        ]
      : [];
  });
}

// The advice for a solid byproduct no line uses (the owner's choice 5 in #1022).
const NO_LINE = 'No line uses it: store it or send it to the AWESOME Sink.';

// The sentence of one byproduct (byproductAdvice), as parts; none when nothing takes it.
function byproductParts(wording: Wording, peers: Peer[]): AdvicePart[] {
  const fluid = wording.words.fluid(wording.item);
  const kept = peers.filter(peer => !(peer.end.kind === 'place' && STORE_OR_SINK.has(peer.end.id)));
  // What storage and the sink take: a solid's rest. A fluid has none in a planned phase.
  const left = peers.filter(peer => !kept.includes(peer)).reduce((sum, peer) => sum + peer.rate, 0);
  const rest = fluid ? 0 : left;
  const sent = kept.filter(peer => peer.end.kind === 'line' || DESTINATION_WORDS[peer.end.id]);
  if (!sent.length) return rest > LINK_DUST ? [NO_LINE] : [];
  const all = sent.length === 1 && left <= LINK_DUST;
  const phrases = sent.map(peer =>
    destinationPhrase(wording, peer, all ? 'all of it' : amountOf(wording, peer.rate)),
  );
  const self = sent[0]!.end.kind === 'line' && sent[0]!.end.id === wording.row.id;
  const restText =
    rest > LINK_DUST
      ? `${phrases.length > 1 ? ', and ' : andAfter(phrases[0]!)}store or sink the other ${amountOf(wording, rest)}`
      : '';
  return [self && fluid ? 'Pipe ' : 'Send ', ...joinPhrases(phrases), restText + '.'];
}

const LOOP_CLAUSE = ', which feeds this line';

// One destination of a byproduct, after "Send": "88.85 to Aluminum Ingot ↗ in Electronics".
function destinationPhrase(wording: Wording, peer: Peer, amount: string): AdvicePart[] {
  const end = peer.end;
  if (end.kind === 'place') return [`${amount} ${DESTINATION_WORDS[end.id]}`];
  if (end.id === wording.row.id)
    return [`${amount} back into this line’s own ${wording.item} input`];
  const loop = feeds(wording.rowOf(end.id), wording.row, wording.item);
  return [
    `${amount} ${loop ? 'back ' : ''}to `,
    lineLink(wording, end.id),
    whereOf(wording, end) + (loop ? LOOP_CLAUSE : ''),
  ];
}

// Phrases joined as a sentence lists them, keeping their links: "a, b and c" (as listNames in
// wording.ts), with a comma before the "and" after a phrase that ends in a clause of its own
// ("…, which feeds this line, and …").
function joinPhrases(phrases: AdvicePart[][]): AdvicePart[] {
  return phrases.flatMap((phrase, i) => [
    ...(i === 0 ? [] : i < phrases.length - 1 ? [', '] : [andAfter(phrases[i - 1]!)]),
    ...phrase,
  ]);
}

// ' and ' after a phrase, or ', and ' after one that ends in a clause (joinPhrases).
const andAfter = (phrase: AdvicePart[]): string =>
  String(phrase.at(-1)).endsWith(LOOP_CLAUSE) ? ', and ' : ' and ';

// Where `row`'s inputs that a byproduct covers come from (#1022): one paragraph per such input,
// each source line linked, the largest first ("recycled from" a line this one feeds, else "from
// the byproduct of"; "from this line's own byproduct" for its own), then the rest: "extract the
// other …" for a raw resource, "the other … from existing supply" otherwise.
export function inputAdvice(row: CalcRow, model: RecycleModel, words: AdviceWords): AdviceLine[] {
  const rows = new Map((model.stage.rows || []).map(other => [other.id, other]));
  return Object.keys(row.inputs || {}).flatMap(item => {
    const wording: Wording = { model, words, row, item, rowOf: id => rows.get(id) };
    const peers = peersOf(model, row.id, item, 'to');
    const lines = peers.filter(peer => peer.end.kind === 'line');
    const byproduct = (peer: Peer) =>
      peer.end.kind === 'line' && isByproductOf(rows.get(peer.end.id), item);
    if (!lines.some(byproduct)) return [];
    const extracted = peers
      .filter(peer => peer.end.kind === 'place' && isSource(peer.end.id))
      .reduce((sum, peer) => sum + peer.rate, 0);
    const raw = (model.stage.raw?.[item] || 0) > LINK_DUST;
    const all = lines.length === 1 && extracted <= LINK_DUST;
    const parts = lines.flatMap((peer, i): AdvicePart[] => [
      ...(i ? [', '] : []),
      ...sourcePhrase(wording, peer, all ? 'All of it' : amountOf(wording, peer.rate)),
    ]);
    const rest =
      extracted <= LINK_DUST
        ? '.'
        : raw
          ? `; extract the other ${amountOf(wording, extracted)}.`
          : `; the other ${amountOf(wording, extracted)} from existing supply.`;
    return [
      {
        kind: 'input' as const,
        item,
        lead: item + ' ' + words.itemRate(item, row.inputs[item]!),
        parts: [...parts, rest],
      },
    ];
  });
}

// One source of an input: "116.27 m³ recycled from Aluminum Scrap ↗", "10.21 from the byproduct of
// Alumina Solution ↗ in Aluminum campus", "59.97 from Alternate: Distilled Silica ↗".
function sourcePhrase(wording: Wording, peer: Peer, amount: string): AdvicePart[] {
  const end = peer.end;
  if (end.kind !== 'line') return [];
  if (end.id === wording.row.id) return [`${amount} from this line’s own byproduct`];
  const source = wording.rowOf(end.id);
  const words = !isByproductOf(source, wording.item)
    ? 'from '
    : feeds(wording.row, source, wording.item)
      ? 'recycled from '
      : 'from the byproduct of ';
  return [`${amount} ${words}`, lineLink(wording, end.id), whereOf(wording, end)];
}

// The advice of a line as one paragraph's text: its sentence without links.
export const adviceSentence = (line: AdviceLine): string =>
  line.parts.map(part => (typeof part === 'string' ? part : part.text)).join('');

// The advice as the build plan's step writes it (rowStepBody), after "Outputs: …":
// "Byproduct Water 116.27 m³/min: send all of it back to Alumina Solution, which feeds this line.
// Water 381.81 m³/min: 116.27 m³ recycled from Aluminum Scrap; extract the other 258.04 m³." The
// sentence for a byproduct no line uses has a colon of its own, so it follows its lead after a
// full stop: "Byproduct Compacted Coal 10.4/min. No line uses it: …".
export const adviceText = (lines: AdviceLine[]): string =>
  lines
    .map(line => {
      const lead = (line.kind === 'byproduct' ? 'Byproduct ' : '') + line.lead;
      const sentence = adviceSentence(line);
      return sentence === NO_LINE
        ? `${lead}. ${sentence}`
        : `${lead}: ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`;
    })
    .join(' ');

// Every paragraph of a line's advice: its byproducts, then the inputs a byproduct covers.
export const lineAdvice = (row: CalcRow, model: RecycleModel, words: AdviceWords): AdviceLine[] => [
  ...byproductAdvice(row, model, words),
  ...inputAdvice(row, model, words),
];

// How many byproducts the lines of a phase make, one per line and byproduct (ADA's
// recycle-byproducts remark).
export const byproductCount = (stage: StoredStage): number =>
  (stage.rows || []).reduce((count, row) => count + byproductsOf(row).length, 0);
