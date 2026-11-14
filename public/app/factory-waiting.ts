// "10 lines waiting on inputs · Fix first: Plastic → Oil campus" (FAC-2, #1342): what a factory's
// header says when some of its lines are ticked Running but a missing supplier holds them back
// (heldBack in views/calculated.ts, the cards' "Running at 0%: short of Plastic").
//
// The rule for "Fix first", the same everywhere: the missing input that holds back the most of
// the factory's lines; a tie goes to the one the factory's first held-back line is short of (the
// lines are in build order). The place to fix it is the line that makes that input in this phase,
// one not ticked Running before one that is (a ticked one is already built and short of
// something itself); "Show" goes to that line when it is in this same factory, else to the
// factory or shared site it sits in, else, a line in no factory, to the line. An input no line of
// the phase makes (a raw resource) has no place to show.
import { calcStage, calculated, checked, stage } from './session.ts';
import { heldBack } from './views/calculated.ts';
import { membershipsOf, SITE_LABELS, factoryGroupsState } from './views/factories.ts';

export interface WaitingTarget {
  // The id of the line (a calculated row) that makes the input.
  line: string;
  // The section to show: a factory's id or 'site-oil' / 'site-nuclear'; null for a lone line.
  section: string | null;
  // Where the line is, for the banner: the factory's or site's name, else the line's name.
  label: string;
}
export interface Waiting {
  // How many of the factory's lines are held back, and how many of them wait on `item`.
  count: number;
  item: string;
  blocked: number;
  target: WaitingTarget | null;
}

// The banner of one factory (`groupId`) from the ids of its lines, or null with none held back.
export function factoryWaiting(groupId: string, rowIds: string[]): Waiting | null {
  const short = new Map<string, number>();
  let count = 0;
  for (const id of rowIds) {
    const hold = heldBack(id);
    if (!hold) continue;
    count++;
    short.set(hold.shortOf, (short.get(hold.shortOf) ?? 0) + 1);
  }
  if (!count) return null;
  // Map keeps insertion order, so the first maximum is the first held-back line's item.
  let item = '',
    blocked = 0;
  for (const [name, lines] of short)
    if (lines > blocked) {
      item = name;
      blocked = lines;
    }
  return { count, item, blocked, target: makerOf(item, groupId) };
}

function makerOf(item: string, groupId: string): WaitingTarget | null {
  const rows = (calcStage()?.rows || []).filter(row => (row.outputs[item] ?? 0) > 0);
  const maker = rows.find(row => !checked('calc-' + stage() + '-' + row.id)) ?? rows[0];
  if (!maker) return null;
  const group = membershipsOf(maker.id)[0]?.group;
  if (group && group === groupId) return { line: maker.id, section: groupId, label: maker.name };
  if (group) {
    const name = factoryGroupsState().groups.find(known => known.id === group)?.name ?? group;
    return { line: maker.id, section: group, label: name };
  }
  const site = calculated?.guide?.factories?.[maker.id]?.site;
  if (site) return { line: maker.id, section: 'site-' + site, label: SITE_LABELS[site] };
  return { line: maker.id, section: null, label: maker.name };
}

// The banner's sentence: "10 lines waiting on inputs".
export const waitingText = (count: number): string =>
  `${count} ${count === 1 ? 'line' : 'lines'} waiting on inputs`;
