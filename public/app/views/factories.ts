// Factory groups: the profile's named groups and which factories belong to them, shared by
// both factories pages (ui/pages/FactoriesPage.vue and CalculatedFactoriesPage.vue, with their
// parts in ui/factories/), the group build-order dialog (factory-detail.ts) and ADA.
import { num } from '../format.ts';
import { rowShares } from '../group-links.ts';
import { state } from '../session.ts';
import type { FactoryGroups, GroupAssignment } from '../../types/index.ts';

// The profile's factory groups with defaults filled in. `assignments` maps a factory key
// (a handbook factory id, or a calculated row id) to a list of { group, rate } memberships;
// a null rate means the whole output, or the remainder once other groups take theirs.
export function factoryGroupsState(): FactoryGroups {
  const g: Partial<FactoryGroups> = state?.factoryGroups || {};
  return {
    groups: g.groups || [],
    assignments: g.assignments || {},
    ...(g.links ? { links: g.links } : {}),
  };
}

export const membershipsOf = (key: string): GroupAssignment[] =>
  factoryGroupsState().assignments[key] || [];

// The line on a grouped card saying how much of the factory's output this group gets, or ''
// when the factory sits whole in a single group. Shares follow rowShares (group-links.ts), so
// the cards and "Between groups" agree: fixed rates first, and what they leave split evenly
// between the null-rate memberships (#197). Machines are scaled by the same share.
export function allocationText(
  key: string,
  groupId: string,
  total: number,
  machines: number,
  unit = '/min',
): string {
  const ms = membershipsOf(key),
    m = ms.find(x => x.group === groupId);
  if (!m || (ms.length === 1 && m.rate == null)) return '';
  const share = total > 0 ? rowShares(total, ms).get(groupId) || 0 : 0;
  const rate = total > 0 ? share * total : (m.rate ?? 0);
  const sharing = ms.filter(x => x.rate == null).length;
  return (
    (m.rate != null
      ? 'Here: '
      : sharing > 1
        ? `Remaining here, split ${sharing} ways: `
        : 'Remaining here: ') +
    `${num(rate)}${unit} of ${num(total)}${unit}` +
    (machines > 0 && share < 1 ? ` · ≈ ${num(machines * share)} of ${num(machines)} machines` : '')
  );
}
// A factory card's second line (SP-14): how many machines, and the last one's clock when it runs
// below 100%, as "30 × Refinery · last at 62%". A single machine is "1 × Refinery · at 62%". The
// clock is shown to one decimal and never rounded up to 100%; the dialog has the exact figure.
export function machineLine(machines: number, machine: string, lastClock = 100): string {
  const text = `${num(machines)} × ${machine}`;
  const clock = clockText(lastClock);
  if (!clock) return text;
  return text + (machines > 1 ? ` · last at ${clock}%` : ` · at ${clock}%`);
}

// The last machine's clock as the cards and dialogs show it (SP-14): one decimal, never rounded
// up to 100%. Undefined when every machine runs at 100%.
export function clockText(lastClock = 100): string | undefined {
  if (!(lastClock < 100 - 1e-7)) return undefined;
  return Math.min(Math.round(lastClock * 10) / 10, 99.9).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  });
}

// The factory dialogs' three machine cells (SP-20, #255): the total, how many run at 100% and
// the adjustable one with its clock, read from the same count and clock as the card's
// machineLine, so the two agree. A single machine below 100% is 1 · 0 · 1 at N%; when every
// machine runs at 100% there is no adjustable machine and no clock.
export interface MachineCounts {
  total: number;
  full: number;
  adjustable: number;
  clock?: string;
}
export function machineCounts(machines: number, lastClock = 100): MachineCounts {
  const clock = clockText(lastClock);
  if (!clock) return { total: machines, full: machines, adjustable: 0 };
  return { total: machines, full: Math.max(0, machines - 1), adjustable: 1, clock };
}

// The status filter of both factories pages (SP-16, #251): a chip per status, each with how many
// of the factories matching the search it keeps. The chosen value is `factoryFilter` in
// session.ts, view state only and never saved, and keeps the values the handbook page's old
// select used ('all', 'todo', 'done', 'local'); the calculated page adds 'held'. Local is a
// handbook chip and Held back a calculated one, so a value the open page has no chip for (or
// any other) shows All, and is kept for when the other page is open again. Local and Held back
// are subsets: a held-back row is ticked Running.
export type StatusFilter = 'all' | 'todo' | 'done' | 'local' | 'held';
export type FilterChip = { value: StatusFilter; label: string; count: number };
const FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  todo: 'Not running',
  done: 'Running',
  local: 'Local',
  held: 'Held back',
};
export function statusFilter<T>(
  items: T[],
  current: string,
  running: (x: T) => boolean,
  extra: [StatusFilter, (x: T) => boolean][] = [],
): { chips: FilterChip[]; active: FilterChip; list: T[] } {
  const tests: [StatusFilter, (x: T) => boolean][] = [
    ['all', () => true],
    ['todo', x => !running(x)],
    ['done', running],
    ...extra,
  ];
  const chips = tests.map(([value, keep]) => ({
    value,
    label: FILTER_LABELS[value],
    count: items.filter(keep).length,
  }));
  const at = Math.max(
    0,
    tests.findIndex(([value]) => value === current),
  );
  // at is an index into tests, which chips maps one to one.
  return { chips, active: chips[at]!, list: items.filter(tests[at]![1]) };
}

// The jump bar of both factories pages (SP-17, #252, ui/factories/JumpBar.vue): one entry per
// group or shared site the page draws, with how many of its factories are marked running. The
// counts follow the search, like the status chips, but not the chosen chip: under Running a
// group would always read 5/5, under Not running 0/3. `key` is the section's id (a group id, or
// 'site-oil'), which names its element (`section-<key>`) and its folded state.
export type JumpEntry = { key: string; label: string; running: number; total: number };
export const jumpEntry = <T>(
  key: string,
  label: string,
  members: T[],
  running: (x: T) => boolean,
): JumpEntry => ({ key, label, running: members.filter(running).length, total: members.length });

// The user groups' entries: `found` is what the search found and `shown` what the chip keeps, and
// a group has an entry exactly when GroupSections.vue draws it (members shown, or editing).
export function groupJumps<T>(
  found: T[],
  shown: T[],
  keyOf: (x: T) => string,
  running: (x: T) => boolean,
  editing: boolean,
): JumpEntry[] {
  const inGroup = (id: string) => (x: T) => membershipsOf(keyOf(x)).some(m => m.group === id);
  return factoryGroupsState()
    .groups.filter(gr => editing || shown.some(inGroup(gr.id)))
    .map(gr => jumpEntry(gr.id, gr.name, found.filter(inGroup(gr.id)), running));
}

// What an empty factories page says: the search found nothing, or the chosen chip keeps none of
// what it found. `noun` is what the page lists ("factories", "production lines").
export function filterEmptyText(noun: string, active: FilterChip, query: string): string {
  if (active.value === 'all') return `No ${noun} match this search.`;
  return `No ${noun} match “${active.label}”${query ? ' and this search' : ''}.`;
}
