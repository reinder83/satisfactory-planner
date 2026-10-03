// Made on site (#875, part of #868): the planner input `settings.onSite`, worked out from the
// profile's factory groups only when the user starts a recalculation, and then frozen with the new
// plan like settings.transportFuel. Opening the app or updating never recalculates.
import { LINK_DUST, rowShares, rowTotal } from './group-order.ts';
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
