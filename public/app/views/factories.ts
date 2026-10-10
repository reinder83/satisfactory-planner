// Factory groups: the profile's named groups and which factories belong to them, shared by
// the factories page (ui/pages/CalculatedFactoriesPage.vue, with its parts in ui/factories/),
// a group's flow page (ui/pages/GroupFlowPage.vue, its build order since #895) and ADA.
import { itemRate } from '../flow.ts';
import { num } from '../format.ts';
import { rowShares } from '../group-links.ts';
import { rowMemberships } from '../group-order.ts';
import { calculated, checked, sectionCollapsed, state } from '../session.ts';
import { inputText } from './storage.ts';
import type {
  CalcRow,
  CompletionLine,
  FactoryGroups,
  GroupAssignment,
  OnSiteLine,
  StoredCalculatedPlan,
} from '../../types/index.ts';

// The profile's factory groups with defaults filled in. `assignments` maps a factory key
// (a calculated row id; a handbook factory id on an original profile) to a list of { group,
// rate } memberships;
// a null rate means the whole output, or the rest once other groups take theirs.
export function factoryGroupsState(): FactoryGroups {
  const saved: Partial<FactoryGroups> = state?.factoryGroups || {};
  return {
    groups: saved.groups || [],
    assignments: saved.assignments || {},
    ...(saved.links ? { links: saved.links } : {}),
    // The items each group makes on site (#874); the Logistics page's books read them (#876).
    ...(saved.local ? { local: saved.local } : {}),
  };
}

// The factory groups' own lines made on site in a plan (#875: row id '<recipe>:<group>' with
// `onSite`), by row id, worked out once per plan. A line has the same id in every phase.
const siteLinesMemo = new WeakMap<StoredCalculatedPlan, Map<string, OnSiteLine>>();
function siteLines(plan: StoredCalculatedPlan): Map<string, OnSiteLine> {
  let lines = siteLinesMemo.get(plan);
  if (!lines) {
    lines = new Map();
    for (const stage of Object.values(plan.stages))
      for (const row of stage?.rows || []) if (row.onSite) lines.set(row.id, row.onSite);
    siteLinesMemo.set(plan, lines);
  }
  return lines;
}

// The group line made on site that factory key `key` names in the open plan, if it is one.
export const siteLineOf = (key: string): OnSiteLine | undefined =>
  calculated ? siteLines(calculated).get(key) : undefined;

// A factory's memberships (rowMemberships in group-order.ts): a group's own line made on site
// belongs wholly to its group (#876), so the cards, allocationText and the group build-order
// dialog place it there; any other factory has its saved memberships.
export const membershipsOf = (key: string): GroupAssignment[] =>
  rowMemberships({ id: key, onSite: siteLineOf(key) }, factoryGroupsState());

// The name of the group a line made on site is for (#876): the group's name now, else the name
// the plan was calculated with, else its id. '' for any other row.
export function siteGroupName(row: Pick<CalcRow, 'onSite'>): string {
  const group = row.onSite?.group;
  if (!group) return '';
  return (
    factoryGroupsState().groups.find(known => known.id === group)?.name ??
    calculated?.settings.onSite?.[group]?.name ??
    group
  );
}

// The line on a grouped card saying how much of the factory's output this group gets, or ''
// when the factory sits whole in a single group. Shares follow rowShares (group-links.ts), so
// the cards and "Between groups" agree: fixed rates first, and what they leave split evenly
// between the null-rate memberships (#197). Machines are scaled by the same share. `rate` writes
// a rate with its unit: itemRate (flow.ts) for an item, so a fluid reads m³/min (#351), or MW.
export function allocationText(
  key: string,
  groupId: string,
  total: number,
  machines: number,
  rate: (amount: number) => string,
): string {
  const memberships = membershipsOf(key),
    membership = memberships.find(m => m.group === groupId);
  if (!membership || (memberships.length === 1 && membership.rate == null)) return '';
  const share = total > 0 ? rowShares(total, memberships).get(groupId) || 0 : 0;
  const here = total > 0 ? share * total : (membership.rate ?? 0);
  const sharing = memberships.filter(m => m.rate == null).length;
  return (
    (membership.rate != null
      ? 'Here: '
      : sharing > 1
        ? `Remaining here, split ${sharing} ways: `
        : 'Remaining here: ') +
    `${rate(here)} of ${rate(total)}` +
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

// The status filter of the factories page (SP-16, #251): a chip per status, each with how many
// of the factories matching the search it keeps. The chosen value is `factoryFilter` in
// session.ts, view state only and never saved, and keeps the values the old status select used
// ('all', 'todo', 'done', 'local'), with 'held' added. Local shows when a plan guide builds rows
// locally (#478), so a value the page has no chip for (or any other) shows All, and is kept for
// when it has one again. Local and Held back are subsets: a held-back row is ticked Running.
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
  running: (item: T) => boolean,
  extra: [StatusFilter, (item: T) => boolean][] = [],
): { chips: FilterChip[]; active: FilterChip; list: T[] } {
  const tests: [StatusFilter, (item: T) => boolean][] = [
    ['all', () => true],
    ['todo', item => !running(item)],
    ['done', running],
    ...extra,
  ];
  const chips = tests.map(([value, keep]) => ({
    value,
    label: FILTER_LABELS[value],
    count: items.filter(keep).length,
  }));
  const activeIndex = Math.max(
    0,
    tests.findIndex(([value]) => value === current),
  );
  // activeIndex is an index into tests, which chips maps one to one.
  return { chips, active: chips[activeIndex]!, list: items.filter(tests[activeIndex]![1]) };
}

// The jump bar of both factories pages (SP-17, #252, ui/factories/JumpBar.vue): one entry per
// group or shared site the page draws, with how many of its factories are marked running. The
// counts follow the search, like the status chips, but not the chosen chip: under Running a
// group would always read 5/5, under Not running 0/3. `key` is the section's id (a group id, or
// 'site-oil'), which names its element (`section-<key>`) and its folded state.
export type JumpEntry = { key: string; label: string; running: number; total: number };

// A shared site on a factories page (ui/factories/SiteSection.vue, #468): the oil campus or the
// nuclear site with the ungrouped factories built there, and its jump-bar entry, which counts
// what the search found at the site whatever the chip keeps. null when nothing shown is there.
export interface SiteEntry {
  kind: 'oil' | 'nuclear';
  key: string;
  label: string;
  sub: string;
  count: number;
  collapsed: boolean;
  jump: JumpEntry;
}
export const SITE_LABELS: Record<SiteEntry['kind'], string> = {
  oil: 'Oil campus',
  nuclear: 'Nuclear site',
};
export function siteEntry<T>(
  kind: SiteEntry['kind'],
  sub: string,
  members: T[],
  atSite: T[],
  running: (item: T) => boolean,
): (SiteEntry & { members: T[] }) | null {
  const key = 'site-' + kind,
    label = SITE_LABELS[kind];
  return members.length
    ? {
        kind,
        key,
        label,
        sub,
        members,
        count: members.length,
        collapsed: sectionCollapsed(key),
        jump: jumpEntry(key, label, atSite, running),
      }
    : null;
}

// Post Phase 5's additional completion modules as their cards show them
// (ui/factories/CompletionModules.vue, #468), matching the search text.
export interface CompletionView extends CompletionLine {
  check: string;
  done: boolean;
  line: string;
  inputText: string;
  byproductText: string;
}
export const completionView = (lines: CompletionLine[], query: string): CompletionView[] =>
  lines
    .filter(line => line.name.toLowerCase().includes(query.toLowerCase()))
    .map(completion => ({
      ...completion,
      check: 'completion-' + completion.id,
      done: checked('completion-' + completion.id),
      // The last machine is only named when it runs below 100%.
      line:
        `${itemRate(completion.name, completion.output)} · ${num(completion.machines)} ${completion.machine}` +
        ((completion.lastClock ?? 100) < 100 ? ` · last at ${num(completion.lastClock)}%` : ''),
      inputText: inputText(completion.inputs),
      byproductText: Object.keys(completion.byproducts).length
        ? inputText(completion.byproducts)
        : '',
    }));
export const jumpEntry = <T>(
  key: string,
  label: string,
  members: T[],
  running: (item: T) => boolean,
): JumpEntry => ({ key, label, running: members.filter(running).length, total: members.length });

// The user groups' entries: `found` is what the search found and `shown` what the chip keeps, and
// a group has an entry exactly when GroupSections.vue draws it (members shown, or editing).
export function groupJumps<T>(
  found: T[],
  shown: T[],
  keyOf: (item: T) => string,
  running: (item: T) => boolean,
  editing: boolean,
): JumpEntry[] {
  const inGroup = (id: string) => (item: T) => membershipsOf(keyOf(item)).some(m => m.group === id);
  return factoryGroupsState()
    .groups.filter(group => editing || shown.some(inGroup(group.id)))
    .map(group => jumpEntry(group.id, group.name, found.filter(inGroup(group.id)), running));
}

// What an empty factories page says: the search found nothing, or the chosen chip keeps none of
// what it found. `noun` is what the page lists ("factories", "production lines").
export function filterEmptyText(noun: string, active: FilterChip, query: string): string {
  if (active.value === 'all') return `No ${noun} match this search.`;
  return `No ${noun} match “${active.label}”${query ? ' and this search' : ''}.`;
}
