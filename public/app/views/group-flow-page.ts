// The words of a factory group's build order page (#894, #1346, ui/pages/GroupFlowPage.vue), from
// the group's flow (groupFlow in group-flow.ts, #893): how the page names a link's ends, the
// source and destination chips of a row, and what the "Comes in" row says of each input.
import type { FlowLine, FlowLink, FlowPort, GroupFlow } from '../group-flow.ts';

// A line's number as the cards show it: "01".
export const lineNumber = (no: number) => String(no).padStart(2, '0');

// A link from a line back into itself (#898): a recipe that uses what it makes. Newer models
// mark it `self`; it is also the only link whose two ends are the same line. It rides no lane.
export const isSelfLink = (link: FlowLink): boolean =>
  ('self' in link && link.self === true) ||
  (link.from.kind === 'line' && link.to.kind === 'line' && link.from.id === link.to.id);

// A link between two different lines of the group, drawn as a lane.
export const isLaneLink = (link: FlowLink) =>
  link.from.kind === 'line' && link.to.kind === 'line' && !isSelfLink(link);

// How the page names the far end of a link: a line by its number (with its name where there
// is room), a place outside the group by its label, and a self link as "itself".
export interface FlowNames {
  lines: Map<string, FlowLine>;
  places: Map<string, string>;
  // The places that are other factory groups, which have a page of their own to go to.
  groups: Set<string>;
}
// A raw resource's or an existing supply's place is named after its item, which the row already
// says: the row names the kind of source instead.
const PORT_WORDS: Partial<Record<FlowPort['kind'], string>> = {
  raw: 'Raw resource',
  supply: 'Existing supply',
};
// Where a port comes from or goes, in words: a place by its label, a raw resource or existing
// supply by its kind.
export const placeWords = (port: FlowPort): string => PORT_WORDS[port.kind] ?? port.label;
export function flowNames(flow: GroupFlow): FlowNames {
  const places = new Map<string, string>();
  for (const port of [...flow.ins, ...flow.outs, ...flow.fold.ports])
    places.set(port.place, placeWords(port));
  const groups = new Set(
    [...flow.ins, ...flow.outs].filter(port => port.kind === 'group').map(port => port.place),
  );
  return { lines: new Map(flow.lines.map(line => [line.id, line])), places, groups };
}
// One end of a link: a place by its words, a line by its number and its build-plan name
// ("01 Wire for Alpha") with `withName`, else by its number alone ("01").
const endName = (names: FlowNames, end: FlowLink['from'], withName: boolean) => {
  if (end.kind === 'place') return names.places.get(end.id) ?? end.id;
  const line = names.lines.get(end.id);
  if (!line) return end.id;
  return withName ? `${lineNumber(line.no)} ${line.name}` : lineNumber(line.no);
};

// Where an input row's item comes from: "from 01 Iron Ingot", "from itself", or a place outside
// the group such as "Raw resource", joined by commas.
export const sourcesText = (links: readonly FlowLink[], names: FlowNames): string =>
  links
    .map(link =>
      isSelfLink(link)
        ? 'from itself'
        : link.from.kind === 'line'
          ? 'from ' + endName(names, link.from, true)
          : endName(names, link.from, true),
    )
    .join(', ');

// Where an output row's item goes: "to 02, 03, AWESOME Sink", or "to itself" for a self link.
export const destinationsText = (links: readonly FlowLink[], names: FlowNames): string =>
  links.length
    ? 'to ' +
      links.map(link => (isSelfLink(link) ? 'itself' : endName(names, link.to, false))).join(', ')
    : '';

// Every link of the flow once, for the table: each input row's links (from inside the group,
// from outside it and from itself), then each output row's links to places outside the group.
export interface FlowConnection {
  from: string;
  to: string;
  link: FlowLink;
}
export function flowConnections(flow: GroupFlow, names: FlowNames): FlowConnection[] {
  const connection = (link: FlowLink): FlowConnection => ({
    from: endName(names, link.from, true),
    to: isSelfLink(link) ? 'itself' : endName(names, link.to, true),
    link,
  });
  return [
    ...flow.lines.flatMap(line => line.inputs.flatMap(row => row.links.map(connection))),
    ...flow.lines.flatMap(line =>
      line.outputs.flatMap(row =>
        row.links.filter(link => link.to.kind === 'place').map(connection),
      ),
    ),
  ];
}

// Whether a table cell's text has a word too long to keep whole (#988): longer than LONG_WORD
// characters. No item, recipe or machine name has a word that long (the longest, "Electromagnetic"
// and "Crystallization", have 15), but a factory group's name can be one word of up to 80
// (`label()` in public/state/validate.ts), alone or in a line's name ("Wire for <group>"). Only a
// cell holding such a word breaks it (gf-cell-name in FlowTable.vue), so a table of ordinary names
// is laid out as before.
const LONG_WORD = 20;
export const hasLongWord = (text: string): boolean =>
  text.split(/\s+/).some(word => [...word].length > LONG_WORD);

// One end of a row's links as a chip (BO-2, #1346): "from 01" or "to 02" for a line of the group
// (a button that moves to its step, named in full for a screen reader), the other factory's name
// for another group (a link to its page), plain words for the rest ("Raw resource", "AWESOME
// Sink") and "from itself" / "to itself" for a self link.
export interface LinkChip {
  key: string;
  kind: 'line' | 'group' | 'plain';
  text: string;
  // The line (its row id) or factory group the chip goes to, and the name a screen reader gets.
  target?: string;
  label?: string;
}
export function linkChips(
  links: readonly FlowLink[],
  names: FlowNames,
  side: 'from' | 'to',
): LinkChip[] {
  const word = side === 'from' ? 'from ' : 'to ';
  const seen = new Set<string>();
  return links.flatMap((link): LinkChip[] => {
    const end = link[side];
    const key = isSelfLink(link) ? 'self' : end.kind + '|' + end.id;
    if (seen.has(key)) return [];
    seen.add(key);
    if (isSelfLink(link)) return [{ key, kind: 'plain', text: word + 'itself' }];
    if (end.kind === 'line') {
      const line = names.lines.get(end.id);
      const number = line ? lineNumber(line.no) : end.id;
      const full = line ? `${number} ${line.name}` : end.id;
      return [
        { key, kind: 'line', text: word + number, target: end.id, label: `Go to step ${full}` },
      ];
    }
    const place = names.places.get(end.id) ?? end.id;
    return names.groups.has(end.id)
      ? [
          {
            key,
            kind: 'group',
            text: place,
            target: end.id,
            label: `Open the build order of ${place}`,
          },
        ]
      : [{ key, kind: 'plain', text: place }];
  });
}

// One input of the "Comes in" row (BO-3, #1346). `held` is what the factory's running lines are
// short of (heldBack, the factories page's "short of", #1342) and `produced` what the built lines
// make now per item (buildStatus): a held-back item arrives in part, or not at all.
export interface ComesIn {
  port: FlowPort;
  // What arrives of the rate asked, when the item is held back; else null.
  arriving: number | null;
  state: 'ok' | 'short' | 'none';
}
export function comesIn(
  ports: readonly FlowPort[],
  held: ReadonlySet<string>,
  produced: Readonly<Record<string, number>>,
): ComesIn[] {
  return ports.map(port => {
    if (!held.has(port.item)) return { port, arriving: null, state: 'ok' };
    const arriving = Math.min(port.rate, Math.max(0, produced[port.item] ?? 0));
    return { port, arriving, state: arriving > 1e-6 ? 'short' : 'none' };
  });
}
