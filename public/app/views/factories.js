// Factory groups: the profile's named groups and which factories belong to them, shared by
// both factories pages (ui/pages/FactoriesPage.vue and CalculatedFactoriesPage.vue, with their
// parts in ui/factories/), the group build-order dialog (factory-detail.js) and ADA.
import { num } from '../format.ts';
import { state } from '../session.js';

// The profile's factory groups with defaults filled in. `assignments` maps a factory key
// (a handbook factory id, or a calculated row id) to a list of { group, rate } memberships;
// a null rate means the whole output, or the remainder once other groups take theirs.
export function factoryGroupsState() {
  const g = state?.factoryGroups || {};
  return { groups: g.groups || [], assignments: g.assignments || {} };
}

export const membershipsOf = key => factoryGroupsState().assignments[key] || [];

// The line on a grouped card saying how much of the factory's output this group gets, or ''
// when the factory sits whole in a single group. A null-rate membership receives what the
// fixed-rate ones leave over; machines are scaled by the same share.
export function allocationText(key, groupId, total, machines, unit = '/min') {
  const ms = membershipsOf(key),
    m = ms.find(x => x.group === groupId);
  if (!m || (ms.length === 1 && m.rate == null)) return '';
  const rate =
    m.rate == null ? Math.max(0, total - ms.reduce((a, x) => a + (x.rate || 0), 0)) : m.rate;
  const share = total > 0 ? Math.min(1, rate / total) : 0;
  return (
    (m.rate == null ? 'Remaining here: ' : 'Here: ') +
    `${num(rate)}${unit} of ${num(total)}${unit}` +
    (machines > 0 && share < 1 ? ` · ≈ ${num(machines * share)} of ${num(machines)} machines` : '')
  );
}
