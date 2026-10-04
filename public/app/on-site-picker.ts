// Made on site (#877, part of #868) on the Factories page: which items a group's "Made on site"
// picker offers, by the rule a recalculation follows (#951, #967), whether the open plan was
// calculated with the items the groups mark now, and what a group's heading says it makes on
// site (#931). A
// change to the marks only marks the plan as needing a recalculation: the page offers one, which
// the user starts (OnSiteRecalc.vue). Nothing here recalculates.
import { LINK_DUST, rowPlaces } from './group-order.ts';
import { onSiteCopyable, onSitePlannable, onSiteSettings } from './on-site.ts';
import { milestoneOnlyPhase } from '../progression.ts';
import { listNames } from '../wording.ts';
import type {
  CalcRow,
  StoredSettings,
  FactoryGroups,
  OnSiteSettings,
  StageKey,
  StoredCalculatedPlan,
  StoredStage,
} from '../types/index.ts';

type PickerPlan = Pick<StoredCalculatedPlan, 'stages' | 'settings' | 'guide'>;
type PickerGroups = Partial<Pick<FactoryGroups, 'groups' | 'assignments' | 'local'>> | undefined;

// One use of an item the picker offers: the phase, and the name of the group's line that uses it
// there. For an ingredient of a part the group marks (#967), `part` is that part and `line` the
// plan's line of it, whose recipe the group's own line would follow.
interface OfferUse {
  phase: StageKey;
  line: string;
  part?: string;
}

// Each item group `groupId` can mark as made on site in `plan`, with where it would be used, by
// the rule a recalculation follows (onSiteSettings, then siteCopies in planner/on-site.ts; #951,
// #967). In a phase the plan builds (not a milestone-only phase, #759), an item some plan row
// makes that
// - a row with a share in the group uses (rowPlaces), other than a line made on site: a
//   recalculation sizes the group's lines to its other rows (onSiteSettings), so an item only a
//   line made on site uses gets no line of its own, or
// - a line of a part in `marks` would take, when such a row uses the part (Copper Ingot for
//   Wire), and so on down a chain of marked parts: a recalculation gives the group its own line
//   of the part, which takes the marked ingredients from the group's own lines, so one
//   recalculation plans the whole chain.
// `marks` are the items the group marks: the saved ones, or the picker's choice before it is
// saved. Raw resources are never offered: the planner cannot make them on site (onSitePlannable,
// its own rule, #921).
function offerUses(
  plan: PickerPlan,
  groups: PickerGroups,
  groupId: string,
  marks: readonly string[],
): Map<string, OfferUse[]> {
  const uses = new Map<string, OfferUse[]>();
  const marked = new Set(marks.filter(onSitePlannable));
  for (const [phase, stage] of Object.entries(plan.stages) as [StageKey, StoredStage][]) {
    if (milestoneOnlyPhase(plan, phase)) continue;
    const rows = stage?.rows || [];
    const made = new Set(rows.flatMap(row => Object.keys(row.outputs || {})));
    const add = (item: string, use: OfferUse) => {
      if (made.has(item) && onSitePlannable(item)) uses.set(item, [...(uses.get(item) || []), use]);
    };
    const consumers = rows.filter(
      row => !row.onSite && (rowPlaces(row, groups).get(groupId) || 0) > LINK_DUST,
    );
    for (const row of consumers)
      for (const item of Object.keys(row.inputs || {})) add(item, { phase, line: row.name });
    const used = consumers.flatMap(row => Object.keys(row.inputs || {}));
    for (const { item, part, line } of partIngredients(rows, used, marked))
      add(item, { phase, line, part });
  }
  return uses;
}

// The ingredients the group's own lines of its marked parts would take in one phase: for each
// item of `used` (the inputs of the group's rows) that it marks, the inputs of each of `rows`
// that makes it and that a recalculation can copy for a group (onSiteCopyable), then the same
// for each such input it marks too, as siteCopies chains them.
function partIngredients(
  rows: readonly CalcRow[],
  used: readonly string[],
  marked: ReadonlySet<string>,
): { item: string; part: string; line: string }[] {
  const parts = [...new Set(used.filter(item => marked.has(item)))];
  const found: { item: string; part: string; line: string }[] = [];
  // `parts` grows as marked ingredients turn up; each is followed once (i stays within it).
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    for (const row of rows) {
      if (!Object.keys(row.outputs || {}).includes(part) || !onSiteCopyable(row)) continue;
      for (const item of Object.keys(row.inputs || {})) {
        found.push({ item, part, line: row.name });
        if (marked.has(item) && !parts.includes(item)) parts.push(item);
      }
    }
  }
  return found;
}

// The items group `groupId` can mark as made on site in `plan`, sorted (offerUses), with `marks`
// its marks (by default the saved ones). Every phase the plan builds counts, not only the one the
// page shows: a mark is the group's in every phase (factoryGroups.local), and a recalculation
// gives the group a line wherever its rows use the item (onSiteSettings).
export const onSiteOffers = (
  plan: PickerPlan,
  groups: PickerGroups,
  groupId: string,
  marks: readonly string[] = groups?.local?.[groupId] || [],
): string[] =>
  [...offerUses(plan, groups, groupId, marks).keys()].sort((a, b) => a.localeCompare(b));

// The boxes of group `groupId`'s "Made on site" picker while the page shows phase `shown` (#941,
// #963), with `marks` the picker's choice, saved or not. `here`: the items its lines in that phase
// use first, without a note, as the page's cards show them; then the ingredients of a part it
// marks there, each naming the part ("(for Wire made on site)", #967). `elsewhere`: the items it
// uses only in other phases, grouped by those phases, so the picker gives each group one heading
// ("Used only by this group's lines in Phases 4 and 5") and each item a short note naming only
// the lines ("(used by Alternate: Turbo Pressure Motor)") or the parts ("(for Wire made on
// site)"), so an item no card on the page uses still says why it is offered. Groups in the order
// of their phases, items sorted within each part. The same items as onSiteOffers.
export interface OnSitePickerOffers {
  here: OnSiteEntry[];
  elsewhere: OnSiteElsewhere[];
}

// The items the group uses only in `phases` (not the one shown), and those phases in words:
// "Phase 4", or "Phases 4 and 5".
export interface OnSiteElsewhere {
  phases: StageKey[];
  where: string;
  entries: OnSiteEntry[];
}

export function onSitePickerOffers(
  plan: PickerPlan,
  groups: PickerGroups,
  groupId: string,
  shown: StageKey | undefined,
  marks: readonly string[] = groups?.local?.[groupId] || [],
): OnSitePickerOffers {
  const here: OnSiteEntry[] = [],
    ingredients: OnSiteEntry[] = [],
    elsewhere = new Map<string, OnSiteElsewhere>();
  const addElsewhere = (uses: readonly OfferUse[], entry: OnSiteEntry) => {
    const phases = uniqueSorted(uses.map(use => use.phase));
    const key = phases.join(',');
    const found = elsewhere.get(key);
    if (found) found.entries.push(entry);
    else elsewhere.set(key, { phases, where: phasesText(phases), entries: [entry] });
  };
  for (const [item, uses] of offerUses(plan, groups, groupId, marks)) {
    const direct = uses.filter(use => !use.part),
      shownUses = uses.filter(use => use.phase === shown);
    if (direct.some(use => use.phase === shown)) here.push({ item, note: '' });
    else if (shownUses.length) ingredients.push({ item, note: partNote(shownUses) });
    else if (direct.length) {
      const lines = listNames(uniqueSorted(direct.map(use => use.line)));
      addElsewhere(direct, { item, note: `(used by ${lines})` });
    } else addElsewhere(uses, { item, note: partNote(uses) });
  }
  const byItem = (a: OnSiteEntry, b: OnSiteEntry) => a.item.localeCompare(b.item);
  return {
    here: [...here.sort(byItem), ...ingredients.sort(byItem)],
    elsewhere: [...elsewhere.values()]
      .sort((a, b) => a.phases.join(',').localeCompare(b.phases.join(',')))
      .map(group => ({ ...group, entries: group.entries.sort(byItem) })),
  };
}

const uniqueSorted = <Name extends string>(names: Name[]): Name[] =>
  [...new Set(names)].sort((a, b) => a.localeCompare(b));
// "Phase 4", or "Phases 4 and 5".
const phasesText = (phases: readonly StageKey[]) =>
  (phases.length > 1 ? 'Phases ' : 'Phase ') + listNames(phases);
// The note on an ingredient of marked parts: "(for Wire made on site)".
function partNote(uses: readonly OfferUse[]): string {
  const parts = uniqueSorted(uses.flatMap(use => (use.part ? [use.part] : [])));
  return `(for ${listNames(parts)} made on site)`;
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

// One item under a group's heading, or one box of its picker (onSitePickerOffers), with a note in
// brackets, or '' for none.
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
