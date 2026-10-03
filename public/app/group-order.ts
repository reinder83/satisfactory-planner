// Which factory group a calculated plan row belongs to, and the build plan's production steps
// put in order group by group (#869). Shared by the build plan and its build status
// (orderedPhaseSteps and currentBuildStatus in views/calculated.ts) and the flows between groups
// (group-links.ts).
import type { CalcRow, FactoryGroups } from '../types/index.ts';

// The place of a row, or the part of one, that is in no factory group.
export const UNGROUPED = 'ungrouped';

// Rates this small are rounding dust.
export const LINK_DUST = 1e-6;

// What a row's group shares are measured against: its primary output, or a generator's MW.
export const rowTotal = (row: Pick<CalcRow, 'outputs' | 'generationMW'>): number =>
  Object.values(row.outputs || {})[0] || row.generationMW || 0;

// The share of a row that sits in each place (group id or UNGROUPED), adding up to 1.
export function rowShares(
  total: number,
  memberships: { group: string; rate: number | null }[] | undefined,
): Map<string, number> {
  const shares = new Map<string, number>();
  const add = (place: string, share: number) => {
    if (share > LINK_DUST) shares.set(place, (shares.get(place) || 0) + share);
  };
  if (!memberships?.length || total <= LINK_DUST) {
    shares.set(UNGROUPED, 1);
    return shares;
  }
  const fixed = memberships.filter(m => m.rate != null);
  let taken = 0;
  for (const membership of fixed) {
    // Fixed rates past the row's total are capped at what is left.
    const share = Math.min(membership.rate! / total, 1 - taken);
    add(membership.group, share);
    taken += Math.max(0, share);
  }
  // What the fixed rates leave is split evenly between the memberships without a rate (a row
  // just added to a second group has two), or is Ungrouped when every membership has a rate.
  // The factory cards (allocationText in views/factories.ts) use the same rule (#197).
  const rest = Math.max(0, 1 - taken);
  const open = memberships.filter(m => m.rate == null);
  if (open.length) for (const membership of open) add(membership.group, rest / open.length);
  else add(UNGROUPED, rest);
  return shares;
}

// The factory groups as the build order reads them: a profile's saved `factoryGroups`, whose
// parts may be missing in an older state.
export type GroupsInput = Partial<Pick<FactoryGroups, 'groups' | 'assignments'>> | undefined;

// The group whose site a row's build-plan step belongs to: of the existing groups the row is in,
// the one with the largest share of it (rowShares), the earlier membership on a tie, so a row
// split 40/60 is built with the 60. A part no group takes does not count, so a row in any
// group is never Ungrouped here. UNGROUPED for a row in no existing group: a membership of a
// removed group counts as none, as on the Logistics page.
export function homeGroup(
  row: Pick<CalcRow, 'id' | 'outputs' | 'generationMW'>,
  groups: GroupsInput,
): string {
  const known = new Set((groups?.groups || []).map(group => group.id));
  const memberships = (groups?.assignments?.[row.id] || []).filter(membership =>
    known.has(membership.group),
  );
  if (!memberships.length) return UNGROUPED;
  let home = memberships[0]!.group,
    largest = 0;
  for (const [place, share] of rowShares(rowTotal(row), memberships))
    if (place !== UNGROUPED && share > largest + LINK_DUST) [home, largest] = [place, share];
  return home;
}

// `steps` (in the planner's build order: suppliers before consumers) put in order group by group,
// so the build plan finishes one site before it moves to the next (#869). `placeOf` gives a
// step's group id (UNGROUPED for none) and `places` the groups' order for ties: the user's
// groups as listed, then UNGROUPED; a place it does not list comes after those.
//
// A step needs every step before it in the build order that makes one of its inputs, and never
// goes ahead of one of those; a recycling loop stays as the planner ordered it. The order is
// built one run of a group at a time: a run places that group's steps that can be built, in build
// order, until the rest of the group waits for another group. The next run is the first group
// (by `places`) that can be finished in one run, else the group with the longest run possible
// now (ties again by `places`). So groups that feed each other one way take one run each, in
// dependency order, and a group comes back only when it needs a later group's output.
// Steps that are all in one place keep the build order exactly, so a plan without groups is
// unchanged. Only the order changes: every step is returned once, as given. Deterministic: it
// reads only its arguments.
export function groupedBuildOrder<T extends Pick<CalcRow, 'inputs' | 'outputs'>>(
  steps: readonly T[],
  placeOf: (step: T) => string,
  places: readonly string[],
): T[] {
  const count = steps.length,
    place = steps.map(placeOf);
  if (new Set(place).size < 2) return [...steps];
  const rank = (name: string) => {
    const index = places.indexOf(name);
    return index < 0 ? places.length : index;
  };
  // needs[i]: the earlier steps that make one of step i's inputs.
  const needs = steps.map((step, i) => {
    const inputs = Object.keys(step.inputs || {});
    const found: number[] = [];
    for (let j = 0; j < i; j++)
      if (inputs.some(item => (steps[j]!.outputs || {})[item])) found.push(j);
    return found;
  });
  const placed = new Array<boolean>(count).fill(false),
    ordered: T[] = [];
  // The steps of `name` one run would place now, in build order, without placing them. A step
  // needs only earlier steps, so one pass in build order finds every step the run can reach.
  const run = (name: string): number[] => {
    const taken = new Set<number>();
    for (let i = 0; i < count; i++)
      if (!placed[i] && place[i] === name && needs[i]!.every(j => placed[j] || taken.has(j)))
        taken.add(i);
    return [...taken];
  };
  const pendingIn = (name: string) =>
    place.filter((other, i) => other === name && !placed[i]).length;
  while (ordered.length < count) {
    const names = [...new Set(place.filter((_, i) => !placed[i]))].sort(
      (a, b) => rank(a) - rank(b) || place.indexOf(a) - place.indexOf(b),
    );
    const runs = names.map(name => ({ name, steps: run(name) }));
    // Every need of the first pending step is placed, so its group has a run: each round places
    // something.
    const choice =
      runs.find(option => option.steps.length && option.steps.length === pendingIn(option.name)) ??
      runs.reduce((best, option) => (option.steps.length > best.steps.length ? option : best));
    for (const i of choice.steps) {
      placed[i] = true;
      ordered.push(steps[i]!);
    }
  }
  return ordered;
}

// The rows of a phase in the build plan's order for `groups` (groupedBuildOrder): each row by its
// home group (homeGroup), the user's groups in their listed order for ties, then Ungrouped.
export function groupedRows<T extends CalcRow>(rows: readonly T[], groups: GroupsInput): T[] {
  return groupedBuildOrder(rows, row => homeGroup(row, groups), [
    ...(groups?.groups || []).map(group => group.id),
    UNGROUPED,
  ]);
}

// A phase's generated build-plan steps (phaseSteps in progression.ts) with the production steps,
// the ones that carry a row, in groupedRows order, each in the place of one of them: the other
// steps keep their places and every step its id (#869). The build plan's steps
// (calcTasks and generatedTaskIds in app/) all come through here.
export function groupedSteps<S extends { row?: CalcRow }>(
  steps: readonly S[],
  groups: GroupsInput,
): S[] {
  const rowSteps = steps.filter(step => step.row);
  const byRow = new Map(rowSteps.map(step => [step.row!, step]));
  const ordered = groupedRows(
    rowSteps.map(step => step.row!),
    groups,
  ).map(row => byRow.get(row)!);
  let next = 0;
  return steps.map(step => (step.row ? ordered[next++]! : step));
}
