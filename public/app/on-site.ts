// Made on site (#875, part of #868): the planner input `settings.onSite`, worked out from the
// profile's factory groups only when the user starts a recalculation, and then frozen with the new
// plan like settings.transportFuel. Opening the app or updating never recalculates.
import { LINK_DUST, rowShares, rowTotal } from './group-order.ts';
import { listNames } from '../wording.ts';
import type {
  CalcRow,
  FactoryGroups,
  OnSiteSettings,
  StageKey,
  StoredCalculatedPlan,
} from '../types/index.ts';

type OnSiteMembership = FactoryGroups['assignments'][string][number];

// settings.onSite from the factory groups as they are now and `plan`, the plan being
// recalculated: per group that marks items it makes on site (factoryGroups.local), its name, the
// items, and per phase the share of each row its memberships give it. A consumer split over
// several groups is attributed as the factory cards split it (rowShares): measured against that
// row's total in the same phase of `plan`, fixed rates first, then the null-rate memberships
// split the rest. A row `plan` lacks in that phase has no total for a fixed rate to be measured
// against, so only its null-rate memberships count, split evenly. Only rows that use one of the
// group's items somewhere in `plan` are listed, and a group's own lines (`onSite` rows) are left
// out: they belong wholly to their group. Returns undefined when no group marks an item, so the
// setting stays absent.
export function onSiteSettings(
  plan: Pick<StoredCalculatedPlan, 'stages'>,
  groups: Partial<Pick<FactoryGroups, 'groups' | 'assignments' | 'local'>> | undefined,
): OnSiteSettings | undefined {
  const names = new Map((groups?.groups || []).map(group => [group.id, group.name]));
  const marking = Object.entries(groups?.local || {}).filter(
    ([group, items]) => names.has(group) && items.length,
  );
  if (!marking.length) return undefined;
  const stages = Object.entries(plan.stages) as [StageKey, { rows?: CalcRow[] }][];
  const inputsOf = onSiteRowInputs(stages);
  const out: OnSiteSettings = {};
  for (const [group, items] of marking) {
    const shares: OnSiteSettings[string]['shares'] = {};
    for (const [phase, stage] of stages) {
      const phaseShares: Record<string, number> = {};
      for (const [rowId, list] of Object.entries(groups?.assignments || {})) {
        const memberships = list.filter(membership => names.has(membership.group));
        if (!memberships.some(membership => membership.group === group)) continue;
        if (!items.some(item => inputsOf.get(rowId)?.has(item))) continue;
        const row = stage.rows?.find(candidate => candidate.id === rowId);
        if (row?.onSite) continue;
        const share = onSiteShare(group, memberships, row);
        if (share > LINK_DUST) phaseShares[rowId] = share;
      }
      if (Object.keys(phaseShares).length) shares[phase] = phaseShares;
    }
    // names holds every marking group (the filter above).
    if (Object.keys(shares).length)
      out[group] = { name: names.get(group)!, items: [...items].sort(), shares };
  }
  return Object.keys(out).length ? out : undefined;
}

// The items each row id uses in any phase of the plan.
function onSiteRowInputs(stages: [StageKey, { rows?: CalcRow[] }][]): Map<string, Set<string>> {
  const inputs = new Map<string, Set<string>>();
  for (const [, stage] of stages)
    for (const row of stage.rows || []) {
      const used = inputs.get(row.id) ?? new Set<string>();
      for (const item of Object.keys(row.inputs || {})) used.add(item);
      inputs.set(row.id, used);
    }
  return inputs;
}

// `group`'s share of a row: rowShares against the row's total in this phase, or, for a row the
// phase lacks, an even split of the null-rate memberships.
function onSiteShare(
  group: string,
  memberships: OnSiteMembership[],
  row: CalcRow | undefined,
): number {
  if (row) return rowShares(rowTotal(row), memberships).get(group) || 0;
  const open = memberships.filter(membership => membership.rate == null);
  return open.some(membership => membership.group === group) ? 1 / open.length : 0;
}

// One tick a recalculation kept for review because of lines made on site (#876,
// ProgressState.onSiteReview), as the Notes page lists it: `what` names the line and its phase,
// `now` says where its machines are in the plan now.
export interface SiteReviewEntry {
  key: string;
  ticked: boolean;
  what: string;
  now: string;
}

// The entries of `review` for `plan` and the profile's groups, in key order. A key the plan
// cannot place any more (say, a phase recalculated again) is listed by its key, so every tick
// is still shown.
export function siteReviewEntries(
  review: Record<string, boolean> | undefined,
  plan: Pick<StoredCalculatedPlan, 'stages' | 'settings'> | null | undefined,
  groups: Partial<Pick<FactoryGroups, 'groups'>> | undefined,
): SiteReviewEntry[] {
  const groupName = (id: string) =>
    groups?.groups?.find(group => group.id === id)?.name ?? plan?.settings.onSite?.[id]?.name ?? id;
  return Object.entries(review || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, ticked]) => {
      const found = /^calc-([1-5])-(.+)$/.exec(key);
      const fallback = { key, ticked, what: key, now: '' };
      if (!found) return fallback;
      // The pattern matched both groups.
      const phase = found[1] as StageKey,
        rowId = found[2]!;
      const rows = plan?.stages[phase]?.rows || [];
      const central = rows.find(row => row.id === rowId);
      const lines = rows.filter(row => row.onSite?.recipe === rowId);
      if (lines.length) {
        // Every line here has `onSite` (the filter above).
        const names = listNames(lines.map(row => groupName(row.onSite!.group)));
        return {
          key,
          ticked,
          what: `${(central ?? lines[0]!).name}, Phase ${phase}`,
          now: `Now made on site for ${names}${central ? ', and on a central line' : ''}.`,
        };
      }
      // The line itself is in this plan (a later recalculation brought it back).
      if (central)
        return {
          key,
          ticked,
          what:
            central.name +
            (central.onSite ? ' for ' + groupName(central.onSite.group) : '') +
            ', Phase ' +
            phase,
          now: 'This line is in this plan.',
        };
      // A group's own line the plan no longer has: its recipe's central line, '<recipe>:<group>'.
      const recipe = rows
        .filter(row => !row.onSite && rowId.startsWith(row.id + ':'))
        .sort((a, b) => b.id.length - a.id.length)[0];
      if (!recipe) return fallback;
      return {
        key,
        ticked,
        what: `${recipe.name} for ${groupName(rowId.slice(recipe.id.length + 1))}, Phase ${phase}`,
        now: 'Now made on the central line.',
      };
    });
}
