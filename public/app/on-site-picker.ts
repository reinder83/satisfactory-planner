// Made on site (#877, part of #868) on the Factories page: which items a group's "Made on site"
// picker offers, whether the open plan was calculated with the items the groups mark now, and
// what a group's heading says it makes on site (#931). A
// change to the marks only marks the plan as needing a recalculation: the page offers one, which
// the user starts (OnSiteRecalc.vue). Nothing here recalculates.
import { LINK_DUST, rowPlaces } from './group-order.ts';
import { onSitePlannable, onSiteSettings } from './on-site.ts';
import { milestoneOnlyPhase } from '../progression.ts';
import { listNames } from '../wording.ts';
import type {
  StoredSettings,
  FactoryGroups,
  OnSiteSettings,
  StageKey,
  StoredCalculatedPlan,
  StoredStage,
} from '../types/index.ts';

type PickerPlan = Pick<StoredCalculatedPlan, 'stages' | 'settings' | 'guide'>;
type PickerGroups = Partial<Pick<FactoryGroups, 'groups' | 'assignments' | 'local'>> | undefined;

// The items group `groupId` can mark as made on site in `plan`, sorted: in a phase the plan
// builds (not a milestone-only phase, #759), an item some plan row makes that a row with a share
// in the group uses (rowPlaces, so a group's own line made on site counts as the group's). Raw
// resources are never offered: the planner cannot make them on site (onSitePlannable, its own
// rule, #921).
export function onSiteOffers(plan: PickerPlan, groups: PickerGroups, groupId: string): string[] {
  const offered = new Set<string>();
  for (const [phase, stage] of Object.entries(plan.stages) as [StageKey, StoredStage][]) {
    if (milestoneOnlyPhase(plan, phase)) continue;
    const rows = stage?.rows || [];
    const made = new Set(rows.flatMap(row => Object.keys(row.outputs || {})));
    for (const row of rows) {
      if ((rowPlaces(row, groups).get(groupId) || 0) <= LINK_DUST) continue;
      for (const item of Object.keys(row.inputs || {}))
        if (made.has(item) && onSitePlannable(item)) offered.add(item);
    }
  }
  return [...offered].sort((a, b) => a.localeCompare(b));
}

// The items each group makes on site in `onSite`, as sorted lists by group id.
const itemsByGroup = (onSite: OnSiteSettings | undefined): Record<string, string[]> =>
  Object.fromEntries(
    Object.entries(onSite || {})
      .map(([group, entry]): [string, string[]] => [group, [...entry.items].sort()])
      .sort(([a], [b]) => a.localeCompare(b)),
  );

// The plan's marks against the groups' marks now.
export interface OnSiteChange {
  // settings.onSite for a recalculation with the marks as they are now (onSiteSettings), or
  // undefined when no group marks an item any plan row of it uses.
  want: OnSiteSettings | undefined;
  // Each side in words: "Motors makes Screws and Wire on site; Cables makes Wire on site", or ''
  // for none.
  now: string;
  had: string;
}

// Whether the items the groups mark now differ from the ones `plan` was calculated with
// (settings.onSite), and so whether the plan needs a recalculation; null when they are the same.
// Only the items are compared, not the shares: a recalculation sizes a group's line to its
// consumers in the plan being recalculated, so the shares worked out from the new plan differ a
// little from the ones it was made with, and comparing them would ask for a recalculation forever.
// A group that marks items none of its rows uses gets no line (onSiteSettings leaves it out), so
// it asks for nothing either.
export function onSiteChange(plan: PickerPlan, groups: PickerGroups): OnSiteChange | null {
  const want = onSiteSettings(plan, groups),
    had = plan.settings.onSite;
  const wanted = itemsByGroup(want),
    planned = itemsByGroup(had);
  if (JSON.stringify(wanted) === JSON.stringify(planned)) return null;
  const nameOf = (group: string) =>
    groups?.groups?.find(known => known.id === group)?.name ?? had?.[group]?.name ?? group;
  const words = (marks: Record<string, string[]>) =>
    Object.entries(marks)
      .map(([group, items]) => `${nameOf(group)} makes ${listNames(items)} on site`)
      .join('; ');
  return { want, now: words(wanted), had: words(planned) };
}

// The settings of the recalculation `change` asks for: the plan's own, with settings.onSite the
// groups' marks now, or without it when no group marks anything, so such a plan calculates
// exactly as one never made with it (#875).
export function onSiteRecalcSettings(
  settings: StoredSettings,
  change: OnSiteChange,
): StoredSettings {
  const { onSite: _planned, ...rest } = settings;
  return change.want ? { ...rest, onSite: change.want } : rest;
}

// The picker's notes on a mark that gives the group no line (OnSitePicker.vue): an item none of
// the group's lines uses now, and a raw resource, which the planner can never make on site (#921).
export const UNUSED_NOTE = '(no line here uses it now)';
export const RAW_NOTE = "(can't be made on site)";

// One item under a group's heading, with a note in brackets, or '' for none.
export interface OnSiteEntry {
  item: string;
  note: string;
}

// What a group's heading says outside edit mode (#931), for the phase `stage` shows: `made`, the
// items of the group's own lines there (rows with `onSite`), and `marked`, the items it marks
// that have no such line, each with why. Both sorted.
export interface OnSiteSummary {
  made: OnSiteEntry[];
  marked: OnSiteEntry[];
}

// The heading summary of every group in `groups` for `plan` and its stage `stage` (the phase the
// page shows), by group id. The plan's own lines say what is made on site, so a mark never reads
// as made on site without one. A line for an item the groups' marks now would not ask for
// (onSiteSettings, as the "needs a recalculation" notice compares) is made "until a
// recalculation"; a mark without a line says why (markNote).
export function onSiteSummaries(
  plan: PickerPlan,
  groups: PickerGroups,
  stage: StoredStage | undefined,
): Record<string, OnSiteSummary> {
  const want = onSiteSettings(plan, groups),
    had = plan.settings.onSite;
  const out: Record<string, OnSiteSummary> = {};
  for (const { id } of groups?.groups || []) {
    const lines = siteLineItems(stage, id, had?.[id]?.items);
    const marks: GroupMarks = {
      used: onSiteOffers(plan, groups, id),
      wanted: want?.[id]?.items || [],
      planned: had?.[id]?.items || [],
      dropped: stage?.onSiteDropped?.[id] || [],
    };
    out[id] = {
      made: lines.map(item => ({
        item,
        note: marks.wanted.includes(item) ? '' : '(until a recalculation)',
      })),
      marked: (groups?.local?.[id] || [])
        .filter(item => !lines.includes(item))
        .map(item => ({ item, note: markNote(item, marks) }))
        .sort((a, b) => a.item.localeCompare(b.item)),
    };
  }
  return out;
}

// What one group's marks come to: `used`, the items its lines use (the picker's offers),
// `wanted`, the items a recalculation now would ask for (onSiteSettings), `planned`, the ones the
// plan was calculated with, and `dropped`, the ones the planner made centrally in the phase shown.
interface GroupMarks {
  used: readonly string[];
  wanted: readonly string[];
  planned: readonly string[];
  dropped: readonly string[];
}

// Why a group's mark of `item` gives it no line in the phase shown: the picker's notes for a raw
// resource and for an item none of its lines uses (so a recalculation would give it no line
// either), "needs a recalculation" when the plan was calculated without it, "made centrally in
// this phase" when the planner fell back to central lines there, and otherwise "no line in this
// phase", as when the group uses the item only in other phases.
function markNote(item: string, marks: GroupMarks): string {
  if (!onSitePlannable(item)) return RAW_NOTE;
  if (!marks.used.includes(item) || !marks.wanted.includes(item)) return UNUSED_NOTE;
  if (!marks.planned.includes(item)) return '(needs a recalculation)';
  if (marks.dropped.includes(item)) return '(made centrally in this phase)';
  return '(no line in this phase)';
}

// The items group `groupId`'s own lines make in `stage`, sorted: of each line's outputs, the ones
// the plan was calculated to make on site for the group (`items`, its settings.onSite entry), so
// a byproduct of the recipe is not listed; every output when the plan has no entry for it.
function siteLineItems(
  stage: StoredStage | undefined,
  groupId: string,
  items: readonly string[] | undefined,
): string[] {
  const made = new Set<string>();
  for (const row of stage?.rows || [])
    if (row.onSite?.group === groupId)
      for (const item of Object.keys(row.outputs || {}))
        if (!items || items.includes(item)) made.add(item);
  return [...made].sort((a, b) => a.localeCompare(b));
}

// A list of entries as the heading words it (#955): the items that share a note under that note
// once, each run in the order its note first comes and joined as a list, the runs apart by "; ":
// "Cable and Quickwire (no line here uses it now); Water (can't be made on site)". Items without a
// note make a run of their own: "Copper Ingot (until a recalculation); Wire". '' for none.
export function onSiteEntriesText(entries: readonly OnSiteEntry[]): string {
  const byNote = new Map<string, string[]>();
  for (const { item, note } of entries) byNote.set(note, [...(byNote.get(note) || []), item]);
  return [...byNote]
    .map(([note, items]) => (note ? `${listNames(items)} ${note}` : listNames(items)))
    .join('; ');
}
