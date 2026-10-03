// Made on site (#877, part of #868) on the Factories page: which items a group's "Made on site"
// picker offers, and whether the open plan was calculated with the items the groups mark now. A
// change to the marks only marks the plan as needing a recalculation: the page offers one, which
// the user starts (OnSiteRecalc.vue). Nothing here recalculates.
import { LINK_DUST, rowPlaces } from './group-order.ts';
import { onSiteSettings } from './on-site.ts';
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
// resources (every key of the plan's budgets) are never offered: no plan row makes them, and the
// planner ignores them (#875).
export function onSiteOffers(plan: PickerPlan, groups: PickerGroups, groupId: string): string[] {
  const raw = new Set(Object.keys(plan.settings.limits || {}));
  const offered = new Set<string>();
  for (const [phase, stage] of Object.entries(plan.stages) as [StageKey, StoredStage][]) {
    if (milestoneOnlyPhase(plan, phase)) continue;
    const rows = stage?.rows || [];
    const made = new Set(rows.flatMap(row => Object.keys(row.outputs || {})));
    for (const row of rows) {
      if ((rowPlaces(row, groups).get(groupId) || 0) <= LINK_DUST) continue;
      for (const item of Object.keys(row.inputs || {}))
        if (made.has(item) && !raw.has(item)) offered.add(item);
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
