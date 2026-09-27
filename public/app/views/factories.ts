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
  if (!(lastClock < 100 - 1e-7)) return text;
  const clock = Math.min(Math.round(lastClock * 10) / 10, 99.9).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  });
  return text + (machines > 1 ? ` · last at ${clock}%` : ` · at ${clock}%`);
}
