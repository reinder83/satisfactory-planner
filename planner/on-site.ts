// Made on site (#875, part of #868): a factory group that marks an item gets its own
// whole-machine line for it, sized to that group's own consumers, and the central line covers the
// rest. The input is `settings.onSite` (see settings.ts): per group, the items it makes on site,
// and per phase the share of each plan row that group's consumers take (and, for a row with a
// fixed-rate membership, the group's part of it as it follows the row's total, #984). This module
// adds the per-group copies of the recipes to a phase's pool and says which balance each item of a
// recipe feeds or draws from; model.ts builds the constraints from that.
import type {
  CalcRow,
  CurrentSettings,
  CurrentStage,
  OnSiteGroup,
  OnSiteRate,
  StageKey,
} from '../public/types/index.ts';
import type { PoolRecipe, RunResult, Solved } from './types.ts';
import { DATA, RAW, exactBalance } from './data.ts';
import { recipePool, generators, primaryOutput } from './recipes.ts';

// A per-group line's row id: the recipe id, a colon and the group id. A check key
// `calc-<phase>-<rowId>` must pass safeKey (public/state/validate.ts), which allows ':' but not
// '@', so released versions keep accepting a save that ticks one (#876).
export const siteRowId = (recipeId: string, group: string) => `${recipeId}:${group}`;
// The name of a group's own balance of an item in the model, `item:<item>@<group>`. Internal to
// the solve: rows and stages always name the plain item.
export const siteBalance = (item: string, group: string) => `item:${item}@${group}`;

// Items no group line is made for: raw resources (and so existing supply of them), radioactive
// items and nuclear recipes, whose balances the whole-machine rounding never touches (#370).
// Power generators (negative power) are no production line either. Every production recipe draws
// power, but a plan calculated before #935 froze Singularity Cell at 0 MW, so the rule is "not a
// generator" rather than "draws power", as onSiteCopyable in public/app/on-site.ts reads it.
const NUCLEAR = /uranium|plutonium|ficsonium|waste|non-fissile/i;
const copyable = (recipe: PoolRecipe) =>
  recipe.power >= 0 &&
  !recipe.slots &&
  !recipe.onSite &&
  !NUCLEAR.test(
    [recipe.name, ...Object.keys(recipe.inputs), ...Object.keys(recipe.outputs)].join(' '),
  );
const markable = (item: string) =>
  !RAW.includes(item) && !!DATA.items[item] && !DATA.items[item].radioactive;

// The groups with a share of a plan row in `phase`, as [group, entry, share].
type Shares = Record<string, number>;
const phaseShares = (entry: OnSiteGroup, phase: number): Shares =>
  entry.shares[String(phase) as keyof OnSiteGroup['shares']] || {};
// A row's share for a group, by the row's own id only (#904). An amplified twin (`amp:X`) and
// its unamplified line (`X`) are separate rows everywhere else: each has its own memberships
// (factoryGroups.assignments by row id), its own card and its own check key, a recalculation
// carries memberships by the exact id (mergeGroups in public/state/carry.ts), and the books place
// a row by its own memberships alone (rowPlaces in public/app/group-order.ts). So neither twin
// borrows the other's share, nor its part (phaseRate), and a group's line is never drawn on for
// a row the books do not credit the group with.
const shareOf = (shares: Shares, rowId: string) => shares[rowId] ?? 0;
// A group's part of a recipe's row in `phase` as it follows the row's total, for a row with a
// fixed-rate membership (#984), or undefined: then its share sizes it. By the row's own id only,
// as shareOf (#904).
const phaseRate = (entry: OnSiteGroup, phase: number, rowId: string): OnSiteRate | undefined => {
  const parts = entry.rates?.[String(phase) as StageKey];
  return parts && Object.hasOwn(parts, rowId) ? parts[rowId] : undefined;
};
// A row's total per machine, which a fixed rate is measured against: its primary output, or a
// generator's MW (rowTotal in public/app/group-order.ts, per machine).
export const totalPerMachine = (recipe: PoolRecipe) =>
  Object.values(recipe.outputs)[0] || (recipe.power < 0 ? -recipe.power : 0);

// The copies of `pool`'s recipes a phase plans per on-site group (`pool` is the phase's whole
// pool, before the network of the two-step fit narrows it, so every solve of the phase sees the
// same copies). A group gets a copy of each recipe whose primary product (primaryOutput) is an
// item it marks and has a consumer of in this phase: a row it has a share or a part (#984) of
// that uses the item, or one of its own copies that does (Copper Ingot for its Wire line). A
// recipe's amplified twin is a row of its own with its own share or part (#904), but only the
// inner fit's pool holds it (phasePool in model.ts), so here the recipe stands in for its twin.
// No consumer, no line. A recipe that makes the item only as a byproduct stays central (#1012): a
// copy of it would run the whole recipe for the group, take over the group's own consumer row
// (Rocket Fuel, copied for its Compacted Coal) and so drop and re-add the group's lines at every
// recalculation. A copy is the recipe as it is, whole machines like it and never amplified, with
// the id `<recipe>:<group>` and `onSite`.
export function siteCopies(config: CurrentSettings, phase: number, pool: PoolRecipe[]) {
  const copies: PoolRecipe[] = [];
  for (const [group, entry] of Object.entries(config.onSite || {})) {
    const shares = phaseShares(entry, phase);
    const marked = new Set(entry.items.filter(markable));
    const consumed = new Set<string>();
    const held = (rowId: string) => shareOf(shares, rowId) > 0 || !!phaseRate(entry, phase, rowId);
    for (const recipe of pool)
      if (held(recipe.id) || held('amp:' + recipe.id))
        for (const item of Object.keys(recipe.inputs)) if (marked.has(item)) consumed.add(item);
    const copied = new Set<string>();
    // Each pass copies the makers of the items consumed so far; their inputs may add more.
    for (let size = -1; size !== consumed.size; ) {
      size = consumed.size;
      for (const recipe of pool)
        if (
          !copied.has(recipe.id) &&
          copyable(recipe) &&
          consumed.has(primaryOutput(recipe) ?? '')
        ) {
          copied.add(recipe.id);
          copies.push({
            ...recipe,
            id: siteRowId(recipe.id, group),
            onSite: { group, recipe: recipe.id },
          });
          for (const item of Object.keys(recipe.inputs)) if (marked.has(item)) consumed.add(item);
        }
    }
  }
  return copies;
}

// Where each item of a recipe goes in the model: [balance, fraction] pairs, the fractions adding
// up to 1. `item:<item>` is the central balance.
export type Routes = (recipe: PoolRecipe, item: string, side: 'in' | 'out') => [string, number][];
// The balances of the groups' own lines in `pool` (the pool a solve actually uses), as
// `<group>|<item>` keys, and the routes into and out of them:
// - a group's copy puts the marked items it makes in that group's balance, and takes the marked
//   items it uses from it: a per-group line belongs wholly to its group;
// - every other recipe takes a group's share (settings.onSite shares) of a marked item from that
//   group's balance, and the rest from the central one;
// - except where the group's part of the recipe's row follows the row's total (settings.onSite
//   rates, #984: a row with a fixed-rate membership): then the group's balance gives the row
//   `open` of the item per machine (none for a fixed rate), and a fixed amount besides, its
//   part less `open` of the whole row (`draws`: rate - open × after, in the item at the row's
//   ratio of input to total), which the central balance gets back. So a fixed rate of 47 Iron
//   Plate/min takes 70.5 Iron Ingot/min from the group's balance whatever the row makes, as the
//   books count it in the plan the recalculation produces (rowParts in public/app/group-order.ts);
//   withinRates covers a row that ends up making less than its fixed rates (followedParts says
//   where a part counts);
// - everything else (other inputs, byproducts, raw resources, existing supply and every demand)
//   stays central, except that the central byproduct of a marked item that balances exactly
//   feeds the groups' balances first (`feeds`, siteFeeds, #1012).
export function siteRoutes(config: CurrentSettings, phase: number, pool: PoolRecipe[]) {
  const active = new Set<string>();
  for (const recipe of pool)
    if (recipe.onSite) {
      const marked = config.onSite?.[recipe.onSite.group]?.items || [];
      for (const item of Object.keys(recipe.outputs))
        if (marked.includes(item)) active.add(recipe.onSite.group + '|' + item);
    }
  const balances = [...active].map(key => {
    const [group, item] = key.split('|') as [string, string];
    return { group, item, name: siteBalance(item, group) };
  });
  const follows = followedParts(config, phase);
  const groupsFor = (item: string) =>
    balances.filter(balance => balance.item === item).map(balance => balance.group);
  const routes: Routes = (recipe, item, side) => {
    const central = 'item:' + item;
    if (!active.size) return [[central, 1]];
    if (recipe.onSite)
      return active.has(recipe.onSite.group + '|' + item)
        ? [[siteBalance(item, recipe.onSite.group), 1]]
        : [[central, 1]];
    if (side === 'out') return [[central, 1]];
    const split: [string, number][] = [];
    for (const group of groupsFor(item)) {
      const part = follows(group, recipe, item);
      const share = part
        ? part.open
        : shareOf(phaseShares(config.onSite![group]!, phase), recipe.id);
      if (share > 0) split.push([siteBalance(item, group), share]);
    }
    // Shares from rowShares add up to at most 1; anything past that is scaled back.
    const taken = split.reduce((total, [, share]) => total + share, 0);
    if (taken > 1) for (const part of split) part[1] /= taken;
    const rest = Math.max(0, 1 - Math.max(taken, 0));
    return rest > 1e-9 ? [[central, rest], ...split] : split;
  };
  return {
    balances,
    routes,
    draws: siteDraws(pool, balances, follows),
    feeds: siteFeeds(pool, balances, routes),
    overflows: balances.filter(
      ({ group, item }) =>
        !exactBalance(item) && !!config.onSite?.[group]?.overflow?.includes(item),
    ),
  };
}

// A group's own lines of a solid item it makes on site can make more than the group uses, because
// whole machines round up, and that excess has only the sink. So a central line can still be
// built for what the other consumers and storage ask, and sink almost all it makes: one Fused
// Quickwire machine for 1/min of storage, its other 89/min sunk, beside a group line sinking 69/min
// (#1063). withOverflow plans such a phase again with a route per group and item,
// `overflow:<item>@<group>` (the group's `overflow`, which only the planner sets), that carries
// the group's excess into the central balance, where it meets the central demand before a central
// line does, so the central line shrinks or is not built. The route costs a thousandth of a
// machine per item (OVERFLOW_COST), so the search does not route for nothing, while carrying what
// one central machine makes (a few hundred items/min) still costs less than that machine. The
// books need nothing new: what the group's lines make beyond the group's use and the plan's
// surplus is `offered` (itemBooks in public/app/group-links.ts, #918), ordinary supply at the
// group that the other places share. An item that balances exactly (a fluid) has no excess and
// gets no route.
export const OVERFLOW_COST = 0.001;
export const overflowRoute = (item: string, group: string) => `overflow:${item}@${group}`;
// How much of what the central lines of an item make the plan must sink before withOverflow
// tries the routes: three quarters, "almost all" (#1063's central lines sank 89 of 90/min and
// 57.5 of 67.5/min).
const ALMOST_ALL_SUNK = 0.75;
// A phase planned by `solve` with `config`, and planned again with the groups' excess routed to
// the central balance (overflowRoute) when the first plan sinks almost all that the central lines
// of an item made on site make (sunkCentrally). The second plan stands only when it fits as the
// first did (no fallback the first did not need) and builds fewer machines, in no more time; any
// other phase is the first plan, exactly as before #1063. A plan without whole machines makes
// exactly what each group uses, so it is never planned again.
export function withOverflow(
  config: CurrentSettings,
  phase: number,
  solve: (settings: CurrentSettings) => RunResult,
): RunResult {
  const first = solve(config);
  if (!first.feasible || first.onSiteDropped || !config.wholeMachines) return first;
  const items = sunkCentrally(config, first);
  if (!items.size) return first;
  const routed = solve(withOverflowItems(config, items));
  return routed.feasible &&
    !routed.onSiteDropped &&
    !fallsBack(routed, first) &&
    buildings(routed) < buildings(first) &&
    routed.hours <= first.hours + 1e-9
    ? routed
    : first;
}
const buildings = (plan: Solved) => plan.rows.reduce((total, row) => total + row.machines, 0);
// The solid items groups make on site in `plan` of which the plan sinks at least ALMOST_ALL_SUNK
// of what the central lines making them as their main product make.
function sunkCentrally(config: CurrentSettings, plan: Solved): Set<string> {
  const items = new Set<string>();
  for (const row of plan.rows) {
    if (!row.onSite) continue;
    const marked = config.onSite?.[row.onSite.group]?.items || [];
    for (const item of Object.keys(row.outputs))
      if (marked.includes(item) && !exactBalance(item)) items.add(item);
  }
  for (const item of items) {
    const central = plan.rows
      .filter(row => !row.onSite && primaryOutput(row) === item)
      .reduce((total, row) => total + (row.outputs[item] || 0), 0);
    if (!(central > 0 && (plan.surplus[item] || 0) >= ALMOST_ALL_SUNK * central))
      items.delete(item);
  }
  return items;
}
// `config` with each group that makes one of `items` on site allowed to route its excess of it to
// the central balance (OnSiteGroup.overflow).
function withOverflowItems(config: CurrentSettings, items: ReadonlySet<string>): CurrentSettings {
  const onSite: NonNullable<CurrentSettings['onSite']> = {};
  for (const [group, entry] of Object.entries(config.onSite || {})) {
    const overflow = entry.items.filter(item => items.has(item));
    onSite[group] = overflow.length ? { ...entry, overflow } : entry;
  }
  return { ...config, onSite };
}

// The central byproduct of an item a group makes on site that balances exactly (a fluid), as
// buildModel offers it to the groups' balances (#1012, the owner's decision there): a recipe that
// makes such an item only as a byproduct stays central (siteCopies), so a group that marks Dark
// Matter Residue gets its own line of the Residue's recipe while the central Space Elevator part
// lines still make Dark Matter Residue, which nothing central may use and a fluid cannot overflow
// to the sink. So per such item a route from the central balance into each group's balance of it,
// `byproduct:<item>@<group>`, carries at most what the central lines make of it as a byproduct
// (`makers`: per recipe of the pool, its output of the item as a byproduct that goes to the
// central balance, per machine), and is preferred to the group's own line (BYPRODUCT_FIRST): the
// group's line makes only the rest, and none when the byproduct covers the group's need, as a
// player pipes the byproduct to the site. A solid byproduct has the sink, so its group's line
// makes all the group uses, as before (a route for it would let the sink-bound byproduct stand in
// for a line the group asked to make on site, and plans without it calculate as they did).
// Empty unless a pool recipe makes such an item as a byproduct, so every other plan's model is
// exactly as before.
export interface SiteFeed {
  item: string;
  groups: string[];
  makers: [recipeId: string, rate: number][];
}
// What the route takes off the cost per unit it carries, below the 0.0001 of a unit of a raw
// resource and far below a machine (1): it decides only between the group's own line and the
// central lines making the same item, which cost the same machines.
export const BYPRODUCT_FIRST = 0.00001;
// The variable of a route of the central byproduct of `item` into `group`'s balance, and the
// constraint that caps every group's route of it together.
export const feedRoute = (item: string, group: string) => `byproduct:${item}@${group}`;
export const feedCap = (item: string) => `byproducts:${item}`;
function siteFeeds(
  pool: PoolRecipe[],
  balances: { group: string; item: string }[],
  routes: Routes,
): SiteFeed[] {
  const feeds: SiteFeed[] = [];
  for (const item of new Set(balances.map(balance => balance.item))) {
    if (!exactBalance(item)) continue;
    const makers: [string, number][] = [];
    for (const recipe of pool) {
      const rate = recipe.outputs[item];
      if (!rate || primaryOutput(recipe) === item) continue;
      const central = routes(recipe, item, 'out').find(([balance]) => balance === 'item:' + item);
      if (central) makers.push([recipe.id, rate * central[1]]);
    }
    const groups = balances.filter(balance => balance.item === item).map(({ group }) => group);
    if (makers.length) feeds.push({ item, groups, makers });
  }
  return feeds;
}
// The group's part of a recipe's row that the group's balance of `item` follows the row's total
// by (#984): a part of a row with a total, for an item that overflows to the sink. An item that
// balances exactly (a fluid) keeps its share, as before #984: the group's lines must make exactly
// what the group's consumers take, and a fixed part would move the rest onto central lines whose
// whole-machine byproducts of it (Dark Matter Residue) may then have nowhere to go.
type Follows = (group: string, recipe: PoolRecipe, item: string) => OnSiteRate | undefined;
const followedParts =
  (config: CurrentSettings, phase: number): Follows =>
  (group, recipe, item) => {
    const entry = config.onSite?.[group];
    return entry && !exactBalance(item) && totalPerMachine(recipe) > 0
      ? phaseRate(entry, phase, recipe.id)
      : undefined;
  };
// A fixed amount of an item a group's balance gives a row in the pool besides `open` per machine
// (siteRoutes), which the central balance gets back: `balance` gives `rate` per minute to
// `central`. buildModel adds it to the two balances' bounds.
export interface SiteDraw {
  balance: string;
  central: string;
  rate: number;
}
function siteDraws(
  pool: PoolRecipe[],
  balances: { group: string; item: string; name: string }[],
  follows: Follows,
): SiteDraw[] {
  const draws: SiteDraw[] = [];
  for (const recipe of pool) {
    if (recipe.onSite) continue;
    for (const balance of balances) {
      const part = follows(balance.group, recipe, balance.item);
      const perTotal = (recipe.inputs[balance.item] || 0) / totalPerMachine(recipe);
      const rate = part ? (part.rate - part.open * part.after) * perTotal : 0;
      if (Math.abs(rate) > 1e-9)
        draws.push({ balance: balance.name, central: 'item:' + balance.item, rate });
    }
  }
  return draws;
}

// The rows of `pool` a phase holds to at least what their fixed rates take (#984), as { recipe
// id: rate per minute of the row's total }: those with a part withinRates marked `floor` that a
// group's balance of an item it marks follows (followedParts). buildModel adds the constraints.
export function siteFloors(
  config: CurrentSettings,
  phase: number,
  pool: PoolRecipe[],
): Map<string, number> {
  const floors = new Map<string, number>();
  const follows = followedParts(config, phase);
  for (const recipe of pool)
    for (const [group, entry] of Object.entries(config.onSite || {})) {
      const part = phaseRate(entry, phase, recipe.id);
      const followed = Object.keys(recipe.inputs).some(
        item => entry.items.includes(item) && follows(group, recipe, item),
      );
      if (!recipe.onSite && part?.floor && followed)
        floors.set(recipe.id, Math.max(floors.get(recipe.id) ?? 0, part.after + part.rate));
    }
  return floors;
}

// A phase planned by `solve` with `config` (#984). A group's part that follows its row's total
// (rowParts) holds only while the row makes at least the fixed rates it comes after, and it takes
// a fixed amount from the group's line whatever the row makes, so a plan that makes the row
// smaller could have the group's line make the central lines' part too. A plan in which every
// row makes its fixed rates stands, so a phase is mostly planned once. Otherwise (or when the
// parts leave no plan with the groups' lines) the phase is planned with every part as the share
// it was calculated with (as before #984), which gives each row's own total, and then with the
// parts settled at those totals (settledParts), and again at each settled plan's totals, at most
// RATE_ROUNDS times, until a settled plan's parts were measured at its own totals (`measured`):
// then each group's line makes what the books give the group there, and that plan stands. A row
// can move its total, or be dropped or built again (one twin or the other), from one settled plan
// to the next, so a plan settled at another plan's totals can size a line by a share the books do
// not use (#1042). The rounds end when a settled plan does not fit, or fits only by making the
// items centrally or by rounding a stopped search where the plan with the shares did not; then,
// and when no settled plan was measured at its own totals, the plan with the shares stands if it
// was (its shares are those rowShares gives at its totals), else the last plan that fits, as
// before. A phase without parts is planned once, as before #984.
// A part of a row the plan being recalculated lacked in the phase (`ifBuilt`, #1038) counts only
// where a plan builds the row. The solver never reads it, so the first plan sizes the group's
// line by the row's share, as before, and a plan that leaves the row out stands as it did, with
// no extra solve. When the first plan builds such a row and every part of `rates` holds there,
// the parts are settled at the first plan's totals as above, and the first plan stands when no
// settled plan was measured at its own totals.
const RATE_ROUNDS = 4;
export function withinRates(
  config: CurrentSettings,
  phase: number,
  solve: (settings: CurrentSettings) => RunResult,
): RunResult {
  const parts = partsOf(config, phase);
  const first = solve(config);
  if (!parts.size) return first;
  const fits = first.feasible && !first.onSiteDropped;
  if (fits && measured(config, phase, config, first)) return first;
  if (fits && holdAll(config, phase, rowTotals(first.rows)))
    return settle(config, phase, parts, first, solve).measured ?? first;
  const frozen = withParts(config, phase, parts, () => null);
  const shared = solve(frozen);
  if (!shared.feasible) return first.feasible ? first : shared;
  const settled = settle(config, phase, parts, shared, solve);
  return settled.measured ?? (measured(config, phase, frozen, shared) ? shared : settled.last);
}
// withinRates' rounds from `start`: the parts settled at its totals, and again at each settled
// plan's totals, at most RATE_ROUNDS times. `measured` is the first settled plan whose parts were
// measured at its own totals, if any, and `last` the last plan that fits (`start` when none
// does). The rounds end early when a settled plan does not fit, or fits only by making the items
// centrally or by rounding a stopped search where `start` did not (fallsBack).
function settle(
  config: CurrentSettings,
  phase: number,
  parts: ReadonlySet<string>,
  start: Solved,
  solve: (settings: CurrentSettings) => RunResult,
): { measured?: Solved; last: Solved } {
  let last = start,
    totals = rowTotals(start.rows);
  for (let round = 0; round < RATE_ROUNDS; round++) {
    const settings = settledParts(config, phase, parts, totals);
    const settled = solve(settings);
    if (!settled.feasible || fallsBack(settled, start)) break;
    if (measured(config, phase, settings, settled)) return { measured: settled, last: settled };
    last = settled;
    totals = rowTotals(settled.rows);
  }
  return { last };
}
// Whether `plan`, planned with `settings`, sizes each group's part of a row as the books count it
// at the plan's own totals (rowPlaces): a part that follows the row's total (rowParts) where the
// row makes at least the fixed rates it comes after, any other as the share rowShares gives it
// at the row's total (settledShare, within rounding: the shares the plan was calculated with are
// rowShares' own sums), and any share of a row the plan does not build. The parts of `ifBuilt`
// count alike (#1038), so one whose row the plan does not build asks nothing.
function measured(config: CurrentSettings, phase: number, settings: CurrentSettings, plan: Solved) {
  const key = String(phase) as StageKey;
  const totals = rowTotals(plan.rows);
  return Object.entries(config.onSite || {}).every(([group, entry]) =>
    phaseParts(entry, key).every(([rowId, part]) => {
      const total = totals.get(rowId) ?? 0;
      const used = settings.onSite?.[group];
      if (used?.rates?.[key]?.[rowId]) return holds(part, total);
      const share = used?.shares[key]?.[rowId] ?? 0;
      return total <= 0 || Math.abs(share - settledShare(part, total)) <= 1e-9;
    }),
  );
}
// Whether every row with a part makes at least the fixed rates its parts come after, at `totals`:
// the parts of `rates`, which the solver takes whether the row is built or not.
const holdAll = (config: CurrentSettings, phase: number, totals: ReadonlyMap<string, number>) =>
  Object.values(config.onSite || {}).every(entry =>
    Object.entries(entry.rates?.[String(phase) as StageKey] || {}).every(([rowId, part]) =>
      holds(part, totals.get(rowId) ?? 0),
    ),
  );
// `config` with the parts in `parts` settled at the rows' `totals`: a part whose row makes its
// fixed rates there still follows the total, with the row held to at least those rates (`floor`);
// any other becomes the share rowShares gives it at that total, capped as rowShares caps it (none
// for a row the phase dropped). Either way the row's share is the one rowShares gives at that
// total, which is what the two-step fit's exact LP sizes the group's line by (sharedSettings): with
// the share it was calculated with there, a row of which a fixed rate is now only a part could
// leave the network no central line for the rest, and the settled plan no fit with the groups'
// lines (#1037, #1043). A part of `ifBuilt` (#1038) is settled only where its row is built at
// `totals`; elsewhere it stays as it was: the row's share as calculated, and no part.
const settledParts = (
  config: CurrentSettings,
  phase: number,
  parts: ReadonlySet<string>,
  totals: ReadonlyMap<string, number>,
) =>
  withParts(config, phase, parts, (rowId, part, ifBuilt) => {
    const total = totals.get(rowId) ?? 0;
    if (ifBuilt && total <= 0) return undefined;
    const share = settledShare(part, total);
    return holds(part, total) ? { part: { ...part, floor: true }, share } : { share };
  });
// The share of a row of `total` a part settles as (settledParts): the share rowShares gives it,
// none for a share too small to count (withParts drops it) or for a row the plan does not build.
const settledShare = (part: OnSiteRate, total: number) => {
  const share = total > 0 ? cappedPart(part, total) / total : 0;
  return share > 1e-6 ? share : 0;
};
// Whether `plan` makes its groups' items centrally, or rounds a stopped search, where `shared`
// (the phase planned with the shares) does not.
const fallsBack = (plan: Solved, shared: Solved) =>
  (!!plan.onSiteDropped && !shared.onSiteDropped) ||
  (plan.roundedAfterStop !== undefined && shared.roundedAfterStop === undefined) ||
  (!!plan.fractionalAfterStop && !shared.fractionalAfterStop);
// Each row's total: its primary output per minute, or a generator's MW (rowTotal).
const rowTotals = (rows: CalcRow[]) =>
  new Map(rows.map(row => [row.id, Object.values(row.outputs)[0] || row.generationMW || 0]));
// The parts of `config`'s rates and ifBuilt in `phase`, as `group|rowId`.
function partsOf(config: CurrentSettings, phase: number): Set<string> {
  const parts = new Set<string>();
  for (const [group, entry] of Object.entries(config.onSite || {}))
    for (const [rowId] of phaseParts(entry, String(phase) as StageKey))
      parts.add(group + '|' + rowId);
  return parts;
}
// A group's parts in a phase as [row id, part, whether it is one of `ifBuilt`]: those of `rates`,
// then those of `ifBuilt` (#1038). settings() keeps a row out of `ifBuilt` where `rates` has it.
const phaseParts = (entry: OnSiteGroup, key: StageKey): [string, OnSiteRate, boolean][] => [
  ...Object.entries(entry.rates?.[key] || {}).map(
    ([rowId, part]): [string, OnSiteRate, boolean] => [rowId, part, false],
  ),
  ...Object.entries(entry.ifBuilt?.[key] || {}).map(
    ([rowId, part]): [string, OnSiteRate, boolean] => [rowId, part, true],
  ),
];
// Whether a row of `total` makes at least the fixed rates `part` comes after (and its own).
const holds = (part: OnSiteRate, total: number) =>
  total >= part.after + part.rate - 1e-6 * Math.max(1, total);
// A group's part of a row of `total` as rowShares gives it: a fixed rate capped at what the
// earlier ones leave, `open` of what all of them leave.
const cappedPart = (part: OnSiteRate, total: number) =>
  part.rate > 0
    ? Math.min(part.rate, Math.max(0, total - part.after))
    : part.open * Math.max(0, total - part.after);
// `config` with each part in `parts` (`group|rowId`) of `phase` replaced as `change` says: by
// another part (`part`) or by none, with the row's `share` (of which 0 drops it), or (null) by
// the share it was calculated with and no part, or (undefined) not at all. `change` learns
// whether the part is one of `ifBuilt` (#1038); a part it gives in place of one goes to `rates`.
function withParts(
  config: CurrentSettings,
  phase: number,
  parts: ReadonlySet<string>,
  change: (
    rowId: string,
    part: OnSiteRate,
    ifBuilt: boolean,
  ) => { part?: OnSiteRate; share: number } | null | undefined,
): CurrentSettings {
  const key = String(phase) as StageKey;
  const onSite: NonNullable<CurrentSettings['onSite']> = {};
  for (const [group, entry] of Object.entries(config.onSite || {})) {
    const shares: Record<string, number> = { ...entry.shares[key] },
      rates: Record<string, OnSiteRate> = { ...entry.rates?.[key] },
      ifBuilt: Record<string, OnSiteRate> = { ...entry.ifBuilt?.[key] };
    for (const [rowId, part, conditional] of phaseParts(entry, key)) {
      if (!parts.has(group + '|' + rowId)) continue;
      const replaced = change(rowId, part, conditional);
      if (replaced === undefined) continue;
      delete ifBuilt[rowId];
      if (replaced?.part) rates[rowId] = replaced.part;
      else delete rates[rowId];
      if (replaced && replaced.share > 1e-6) shares[rowId] = replaced.share;
      else if (replaced) delete shares[rowId];
    }
    onSite[group] = {
      ...entry,
      shares: { ...entry.shares, [key]: shares },
      rates: { ...entry.rates, [key]: rates },
      ifBuilt: { ...entry.ifBuilt, [key]: ifBuilt },
    };
  }
  return { ...config, onSite };
}

// The groups and items a phase offers lines for, as { group: items } (onSiteDropped records them
// when they do not fit). Empty without settings.onSite.
export function plannedSites(config: CurrentSettings, phase: number) {
  const sites: Record<string, string[]> = {};
  if (!config.onSite) return sites;
  const conversion = phase === 5 && config.sam !== 'avoid';
  const pool = [...recipePool(config, phase, conversion), ...generators(config, phase)];
  for (const copy of siteCopies(config, phase, pool)) {
    const group = copy.onSite!.group;
    const marked = config.onSite?.[group]?.items || [];
    for (const item of Object.keys(copy.outputs))
      if (marked.includes(item) && !sites[group]?.includes(item)) (sites[group] ??= []).push(item);
  }
  for (const items of Object.values(sites)) items.sort();
  return sites;
}

// The settings with every item made centrally: what a phase falls back to when the groups' own
// whole-machine lines do not fit (onSiteDropped), and what a re-solve of that phase uses.
export function centralSettings(config: CurrentSettings): CurrentSettings {
  const { onSite: _dropped, ...central } = config;
  return central;
}
// The settings with every group's line sized by its shares, its parts that follow a row's total
// left out (#984): what the two-step fit's exact LP chooses the network with. A part takes a
// fixed amount whatever the row makes, so in the exact LP, whose rows are smaller than whole
// machines make them, the group's line could stand in for a central line the whole-machine fit
// then lacks.
export function sharedSettings(config: CurrentSettings): CurrentSettings {
  if (!config.onSite) return config;
  const onSite = Object.fromEntries(
    Object.entries(config.onSite).map(([group, { rates: _parts, ...entry }]) => [group, entry]),
  );
  return { ...config, onSite };
}
// The settings a re-solve of a finished stage uses (phaseTime 'final', the augmenter fuel
// verdict): central when the stage had to make its items centrally.
export const stageSettings = (config: CurrentSettings, stage: CurrentStage | undefined) =>
  stage?.onSiteDropped ? centralSettings(config) : config;
