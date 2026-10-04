// Made on site (#875, part of #868): the planner input `settings.onSite`, worked out from the
// profile's factory groups only when the user starts a recalculation, and then frozen with the new
// plan like settings.transportFuel. Opening the app or updating never recalculates.
import { LINK_DUST, rowShares, rowTotal } from './group-order.ts';
import { rawResources } from '../preferences.ts';
import { milestoneOnlyPhase } from '../progression.ts';
import { ITEM_NAMES } from '../state.ts';
import { listNames } from '../wording.ts';
import type {
  CalcRow,
  FactoryGroups,
  OnSiteSettings,
  StageKey,
  StoredCalculatedPlan,
} from '../types/index.ts';

type OnSiteMembership = FactoryGroups['assignments'][string][number];

// Whether the planner can make `item` on site: the planner's own rule for settings.onSite
// (`suppliable` in planner/settings.ts), a known item that is not a raw resource. A saved state
// may still mark one it cannot (validateState accepts any known item, so older and hand-edited
// saves keep loading), and the planner refuses a request naming one, so onSiteSettings leaves
// such marks out and a stored mark never blocks a recalculation (#921). A test checks the two
// rules agree on every item name.
export const onSitePlannable = (item: string): boolean =>
  !rawResources.includes(item) && ITEM_NAMES.includes(item);

// The names of a nuclear recipe, which the planner never copies for a group (NUCLEAR in
// planner/on-site.ts).
const SITE_NUCLEAR = /uranium|plutonium|ficsonium|waste|non-fissile/i;

// Whether a recalculation can give a group its own line of `row`'s recipe for `item`, a part the
// group marks, as the planner decides it (siteCopies, copyable and markable in
// planner/on-site.ts): `item` is the row's primary product, its first output (#1012, the
// planner's primaryOutput, read from a plan row here), so a recipe that makes it only as a
// byproduct stays central; and the recipe is a machine that takes power, not a nuclear one (so
// never one making a radioactive item). The Made on site picker follows only these from a marked
// part to its ingredients (#967). A test checks the two rules agree on every recipe and output.
export const onSiteCopyable = (
  row: Pick<CalcRow, 'name' | 'power' | 'inputs' | 'outputs'>,
  item: string,
) =>
  Object.keys(row.outputs || {})[0] === item &&
  row.power > 0 &&
  !SITE_NUCLEAR.test(
    [row.name, ...Object.keys(row.inputs || {}), ...Object.keys(row.outputs || {})].join(' '),
  );

// The plan onSiteSettings reads: its stages, and its settings and guide where it has them, which
// say which phases are milestone-only (milestoneOnlyPhase).
type OnSitePlan = Pick<StoredCalculatedPlan, 'stages'> &
  Partial<Pick<StoredCalculatedPlan, 'settings' | 'guide'>>;
type OnSiteStages = [StageKey, { rows?: CalcRow[] }][];
type OnSiteShares = OnSiteSettings[string]['shares'];
type OnSiteGroupsInput =
  | Partial<Pick<FactoryGroups, 'groups' | 'assignments' | 'local'>>
  | undefined;

// settings.onSite from the factory groups as they are now and `plan`, the plan being
// recalculated: per group that marks items it makes on site (factoryGroups.local), its name, the
// items a recalculation gives it a line for, and per phase the share of each row its memberships
// give it. The items are decided per item (#938, #970, #985: onSiteLineItems), so a mark no row of
// the group uses is left out, as the planner gives it no line, the picker no offer and the
// heading no line either. A consumer split over several groups is attributed as the factory
// cards split it (rowShares): measured against that row's total in the same phase of `plan`,
// fixed rates first, then the null-rate memberships split the rest. A row `plan` lacks in that
// phase has no total for a fixed rate to be measured against, so only its null-rate memberships
// count, split evenly. Only rows that use one of the group's items somewhere in `plan` are listed,
// and a group's own lines (`onSite` rows) are left out: they belong wholly to their group. A
// marked item the planner cannot make on site (a raw resource such as Water, onSitePlannable) is
// left out, so the request is always one the planner accepts. Returns undefined when no group
// has an item, so the setting stays absent.
export function onSiteSettings(
  plan: OnSitePlan,
  groups: OnSiteGroupsInput,
): OnSiteSettings | undefined {
  const names = new Map((groups?.groups || []).map(group => [group.id, group.name]));
  const marking = Object.entries(groups?.local || {})
    .map(([group, items]): [string, string[]] => [group, items.filter(onSitePlannable)])
    .filter(([group, items]) => names.has(group) && items.length);
  if (!marking.length) return undefined;
  const stages = Object.entries(plan.stages) as OnSiteStages;
  const inputsOf = onSiteRowInputs(stages);
  const out: OnSiteSettings = {};
  for (const [group, marks] of marking) {
    const consumers = onSiteGroupShares(stages, groups, names, group, marks, inputsOf);
    const items = onSiteLineItems(plan, consumers, marks);
    const shares = sharesUsing(consumers, items, inputsOf);
    // names holds every marking group (the filter above).
    if (items.length && Object.keys(shares).length)
      out[group] = { name: names.get(group)!, items, shares };
  }
  return Object.keys(out).length ? out : undefined;
}

// Per phase, `group`'s share of each row of its memberships that uses one of `marks` somewhere in
// the plan, other than its own lines made on site (onSiteShare).
function onSiteGroupShares(
  stages: OnSiteStages,
  groups: OnSiteGroupsInput,
  names: ReadonlyMap<string, string>,
  group: string,
  marks: readonly string[],
  inputsOf: ReadonlyMap<string, ReadonlySet<string>>,
): OnSiteShares {
  const shares: OnSiteShares = {};
  for (const [phase, stage] of stages) {
    const phaseShares: Record<string, number> = {};
    for (const [rowId, list] of Object.entries(groups?.assignments || {})) {
      const memberships = list.filter(membership => names.has(membership.group));
      if (!memberships.some(membership => membership.group === group)) continue;
      if (!marks.some(item => inputsOf.get(rowId)?.has(item))) continue;
      const row = stage.rows?.find(candidate => candidate.id === rowId);
      if (row?.onSite) continue;
      const share = onSiteShare(group, memberships, row);
      if (share > LINK_DUST) phaseShares[rowId] = share;
    }
    if (Object.keys(phaseShares).length) shares[phase] = phaseShares;
  }
  return shares;
}

// The items of `marks` a recalculation gives the group its own line for, sorted, decided per item
// (#938, #970, #985) as the planner's siteCopies decides it from the shares, and as the picker
// offers them (onSiteOffers, #951, #967): in a phase the plan builds (not a milestone-only phase,
// #759), an item that a row of `plan` with a share in the group (`shares`) uses, then each marked
// ingredient of a line of `plan` that makes such an item (Copper Ingot for Wire), down a chain of
// marked parts. Only an item a line of that phase makes as its primary product by a recipe the
// planner copies for a group (onSiteCopyable) counts, so a radioactive item (#933) gets no line,
// and nor does one the phase makes only as a byproduct (Heavy Oil Residue from Plastic, #1012).
function onSiteLineItems(
  plan: OnSitePlan,
  shares: OnSiteShares,
  marks: readonly string[],
): string[] {
  const marked = new Set(marks);
  const items = new Set<string>();
  for (const [phase, stage] of Object.entries(plan.stages) as OnSiteStages) {
    if (plan.settings && milestoneOnlyPhase({ settings: plan.settings, guide: plan.guide }, phase))
      continue;
    const rows = stage?.rows || [];
    const makersOf = (item: string) => rows.filter(row => onSiteCopyable(row, item));
    const lined = (item: string) => marked.has(item) && makersOf(item).length > 0;
    const found = [
      ...new Set(
        rows
          .filter(row => (shares[phase]?.[row.id] ?? 0) > 0)
          .flatMap(row => Object.keys(row.inputs || {}))
          .filter(lined),
      ),
    ];
    // `found` grows as marked ingredients turn up; each is followed once (i stays within it).
    for (let i = 0; i < found.length; i++)
      for (const row of makersOf(found[i]!))
        for (const item of Object.keys(row.inputs || {}))
          if (lined(item) && !found.includes(item)) found.push(item);
    for (const item of found) items.add(item);
  }
  return [...items].sort();
}

// The items of the group lines `plan` has, as sorted lists by group id (#938, #970, #985): per
// group of the plan's settings.onSite, its items that the same per-item rule gives a line for
// from the shares it was calculated with (onSiteLineItems), so both sides of onSiteChange are
// counted alike and the plan's own solve never makes it ask again. An item stored without a row
// of the group using it (an earlier release stored every mark of a group with any consumer) is no
// line, so such a plan matches the marks now without a recalculation, and so is a radioactive
// item (#933), for which the planner made none. A plan calculated before #1012 may hold a group's
// copy of a recipe that makes a marked item only as a byproduct: by this rule the copy is no line
// of that item on either side, so the plan loads and asks nothing for it, and the next
// recalculation drops the copy.
export function onSitePlannedItems(
  plan: OnSitePlan & Pick<StoredCalculatedPlan, 'settings'>,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(plan.settings.onSite || {})
      .map(([group, entry]): [string, string[]] => [
        group,
        onSiteLineItems(plan, entry.shares || {}, (entry.items || []).filter(onSitePlannable)),
      ])
      .filter(([, items]) => items.length)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

// `shares` with only the rows that use one of `items` somewhere in the plan.
function sharesUsing(
  shares: OnSiteShares,
  items: readonly string[],
  inputsOf: ReadonlyMap<string, ReadonlySet<string>>,
): OnSiteShares {
  const out: OnSiteShares = {};
  for (const [phase, rows] of Object.entries(shares) as [StageKey, Record<string, number>][]) {
    const kept = Object.entries(rows).filter(([rowId]) =>
      items.some(item => inputsOf.get(rowId)?.has(item)),
    );
    if (kept.length) out[phase] = Object.fromEntries(kept);
  }
  return out;
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
