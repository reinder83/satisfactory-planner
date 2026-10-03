// Which factory group a calculated plan row belongs to, and the build plan's production steps
// put in order group by group (#869). Shared by the build plan and its build status
// (orderedPhaseSteps and currentBuildStatus in views/calculated.ts) and the flows between groups
// (group-links.ts).
import type { CalcRow, FactoryGroups, GroupAssignment } from '../types/index.ts';

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

// The memberships a row is placed by. A factory group's own line made on site (#875, #876: row
// id '<recipe>:<group>' with `onSite`) belongs wholly to its group while that group exists,
// whatever is saved for its id. Once its group is removed it is placed by its saved memberships
// like any other row (none: Ungrouped). Every other row: its saved memberships.
export function rowMemberships(
  row: Pick<CalcRow, 'id' | 'onSite'>,
  groups: GroupsInput,
): GroupAssignment[] {
  const group = row.onSite?.group;
  if (group && (groups?.groups || []).some(known => known.id === group))
    return [{ group, rate: null }];
  return groups?.assignments?.[row.id] || [];
}

// The share of `row` in each place (group id or UNGROUPED), as the Logistics page counts it
// (groupLinks in group-links.ts) and a group's flow (group-flow.ts): rowShares of its
// memberships (rowMemberships), where a membership of a group that no longer exists counts as
// Ungrouped.
export function rowPlaces(
  row: Pick<CalcRow, 'id' | 'outputs' | 'generationMW' | 'onSite'>,
  groups: GroupsInput,
): Map<string, number> {
  const known = new Set((groups?.groups || []).map(group => group.id));
  const memberships = rowMemberships(row, groups).map(membership =>
    known.has(membership.group) ? membership : { ...membership, group: UNGROUPED },
  );
  return rowShares(rowTotal(row), memberships);
}

// The group whose site a row's build-plan step belongs to: the group with the largest share of
// the row as the Logistics page and a group's flow place it (rowPlaces), so the build plan never
// builds a row with a group they give a smaller share, or none at all (#900). On a tie, the one
// rowShares lists first: memberships with a fixed rate before open ones, each in saved order, so a
// fixed-rate membership wins a tie even when it was saved later (#928). A part no group takes does not count, so a row with a share in
// any group is never Ungrouped here: a row split 40/60 is built with the 60, and one with 5 of
// 20 in a group and the rest in none is built with that group. When no group has a share and a
// removed group's membership takes up the row, it is UNGROUPED, where rowPlaces puts the row,
// whatever the order of the memberships. Otherwise (no memberships, a total of zero) it is the place
// of the first membership: that group if it exists, else UNGROUPED. A group's own line made on
// site is built with its group (rowMemberships, #876).
export function homeGroup(
  row: Pick<CalcRow, 'id' | 'outputs' | 'generationMW' | 'onSite'>,
  groups: GroupsInput,
): string {
  let home: string | undefined,
    largest = 0;
  for (const [place, share] of rowPlaces(row, groups))
    if (place !== UNGROUPED && share > largest + LINK_DUST) [home, largest] = [place, share];
  if (home) return home;
  const known = new Set((groups?.groups || []).map(group => group.id));
  const memberships = rowMemberships(row, groups);
  if (rowTotal(row) > LINK_DUST && memberships.some(membership => !known.has(membership.group)))
    return UNGROUPED;
  const first = memberships[0]?.group;
  return first && known.has(first) ? first : UNGROUPED;
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
// unchanged. Only the order changes: every step is returned once, as given. `feeds` says whether
// a maker can supply a user at all (by default every maker can): a group's own line made on site
// feeds only its group (sitesFeed). Deterministic: it reads only its arguments.
export function groupedBuildOrder<T extends Pick<CalcRow, 'inputs' | 'outputs'>>(
  steps: readonly T[],
  placeOf: (step: T) => string,
  places: readonly string[],
  feeds: (maker: T, user: T) => boolean = () => true,
): T[] {
  const count = steps.length,
    place = steps.map(placeOf);
  if (new Set(place).size < 2) return [...steps];
  const rank = (name: string) => {
    const index = places.indexOf(name);
    return index < 0 ? places.length : index;
  };
  // needs[i]: the earlier steps that make one of step i's inputs and can feed it.
  const needs = steps.map((step, i) => {
    const inputs = Object.keys(step.inputs || {});
    const found: number[] = [];
    for (let j = 0; j < i; j++)
      if (inputs.some(item => (steps[j]!.outputs || {})[item]) && feeds(steps[j]!, step))
        found.push(j);
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

// Whether `maker` can supply `user` in the build order (#876): a factory group's own line made on
// site feeds only the rows with a share in its group (rowPlaces), so a row of another group never
// waits for it. Once its group is removed it is a line like any other.
export function sitesFeed(groups: GroupsInput) {
  const known = new Set((groups?.groups || []).map(group => group.id));
  return (maker: CalcRow, user: CalcRow): boolean => {
    const site = maker.onSite?.group;
    return !site || !known.has(site) || (rowPlaces(user, groups).get(site) || 0) > LINK_DUST;
  };
}

// What groupedRows reads of `groups` for `rows`: the groups' ids in their order and each row's
// memberships. Two calls with the same signature give the same order.
const groupsSignature = (rows: readonly CalcRow[], groups: GroupsInput): string =>
  JSON.stringify([
    (groups?.groups || []).map(group => group.id),
    rows.map(row => groups?.assignments?.[row.id] || 0),
  ]);

// The last few orders groupedRows worked out: the build status asks for its phase's order once
// per factory card on every redraw (heldBack in views/calculated.ts), and the build plan and ADA
// for theirs, so each is worked out once per change of rows or groups. An entry holds the rows
// it was given, compared one by one, as a phase's steps list them in a new array each time.
const ORDER_MEMO_SIZE = 8;
const orderMemo: { rows: readonly CalcRow[]; signature: string; ordered: readonly CalcRow[] }[] =
  [];
const sameRows = (a: readonly CalcRow[], b: readonly CalcRow[]) =>
  a.length === b.length && a.every((row, i) => row === b[i]);

// The rows of a phase in the build plan's order for `groups` (groupedBuildOrder): each row by its
// home group (homeGroup), the user's groups in their listed order for ties, then Ungrouped.
// The answer may be shared with earlier calls (orderMemo above): callers never change it.
export function groupedRows<T extends CalcRow>(
  rows: readonly T[],
  groups: GroupsInput,
): readonly T[] {
  const signature = groupsSignature(rows, groups);
  const found = orderMemo.findIndex(
    entry => entry.signature === signature && sameRows(entry.rows, rows),
  );
  if (found >= 0) {
    const [entry] = orderMemo.splice(found, 1);
    orderMemo.unshift(entry!);
    return entry!.ordered as readonly T[];
  }
  const ordered = groupedBuildOrder(
    rows,
    row => homeGroup(row, groups),
    [...(groups?.groups || []).map(group => group.id), UNGROUPED],
    sitesFeed(groups),
  );
  orderMemo.unshift({ rows: [...rows], signature, ordered });
  orderMemo.length = Math.min(orderMemo.length, ORDER_MEMO_SIZE);
  return ordered;
}

// Whether `groups` change the build plan's order of `rows` (groupedRows): ADA mentions the
// grouped order only then.
export const groupsReorder = (rows: readonly CalcRow[], groups: GroupsInput): boolean =>
  groupedRows(rows, groups).some((row, i) => row !== rows[i]);

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
