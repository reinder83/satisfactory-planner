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
const NUCLEAR = /uranium|plutonium|ficsonium|waste|non-fissile/i;
const copyable = (recipe: PoolRecipe) =>
  recipe.power > 0 &&
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
// A row's share for a group: its own, or an amplified twin's unamplified line's.
const shareOf = (shares: Shares, rowId: string) =>
  shares[rowId] ?? (rowId.startsWith('amp:') ? shares[rowId.slice(4)] : undefined) ?? 0;
// A group's part of a recipe's row in `phase` as it follows the row's total, for a row with a
// fixed-rate membership (#984), or undefined: then its share sizes it.
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
// that uses the item, or one of its own copies that does (Copper Ingot for its Wire line). No
// consumer, no line. A recipe that makes the item only as a byproduct stays central (#1012): a
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
    for (const recipe of pool)
      if (
        shareOf(shares, recipe.id) > 0 ||
        (shares['amp:' + recipe.id] ?? 0) > 0 ||
        phaseRate(entry, phase, recipe.id)
      )
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
  };
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
// parts settled at those totals (settledParts). A part made a share there is measured again while
// the settled plan moves its row's total, at most RATE_ROUNDS times. The plan before stands when
// a settled plan does not fit, or fits only by making the items centrally or by rounding a
// stopped search where the plan with the shares did not. A phase without parts is planned once,
// as before #984.
const RATE_ROUNDS = 2;
export function withinRates(
  config: CurrentSettings,
  phase: number,
  solve: (settings: CurrentSettings) => RunResult,
): RunResult {
  const parts = partsOf(config, phase);
  const first = solve(config);
  if (!parts.size) return first;
  if (first.feasible && !first.onSiteDropped && holdAll(config, phase, rowTotals(first.rows)))
    return first;
  const shared = solve(withParts(config, phase, parts, () => null));
  if (!shared.feasible) return first.feasible ? first : shared;
  let result: Solved = shared,
    totals = rowTotals(shared.rows);
  for (let round = 0; round < RATE_ROUNDS; round++) {
    const settings = settledParts(config, phase, parts, totals);
    const settled = solve(settings);
    if (!settled.feasible || fallsBack(settled, shared)) break;
    result = settled;
    totals = rowTotals(settled.rows);
    const again = settledParts(config, phase, parts, totals);
    if (JSON.stringify(again.onSite) === JSON.stringify(settings.onSite)) break;
  }
  return result;
}
// Whether every row with a part makes at least the fixed rates its parts come after, at `totals`.
const holdAll = (config: CurrentSettings, phase: number, totals: ReadonlyMap<string, number>) =>
  Object.values(config.onSite || {}).every(entry =>
    Object.entries(entry.rates?.[String(phase) as StageKey] || {}).every(([rowId, part]) =>
      holds(part, totals.get(rowId) ?? 0),
    ),
  );
// `config` with the parts in `parts` settled at the rows' `totals`: a part whose row makes its
// fixed rates there still follows the total, with the row held to at least those rates (`floor`);
// any other becomes the share rowShares gives it at that total, capped as rowShares caps it (none
// for a row the phase dropped).
const settledParts = (
  config: CurrentSettings,
  phase: number,
  parts: ReadonlySet<string>,
  totals: ReadonlyMap<string, number>,
) =>
  withParts(config, phase, parts, (rowId, part) => {
    const total = totals.get(rowId) ?? 0;
    if (holds(part, total)) return { ...part, floor: true };
    return total > 0 ? cappedPart(part, total) / total : 0;
  });
// Whether `plan` makes its groups' items centrally, or rounds a stopped search, where `shared`
// (the phase planned with the shares) does not.
const fallsBack = (plan: Solved, shared: Solved) =>
  (!!plan.onSiteDropped && !shared.onSiteDropped) ||
  (plan.roundedAfterStop !== undefined && shared.roundedAfterStop === undefined) ||
  (!!plan.fractionalAfterStop && !shared.fractionalAfterStop);
// Each row's total: its primary output per minute, or a generator's MW (rowTotal).
const rowTotals = (rows: CalcRow[]) =>
  new Map(rows.map(row => [row.id, Object.values(row.outputs)[0] || row.generationMW || 0]));
// The parts of `config`'s rates in `phase`, as `group|rowId`.
function partsOf(config: CurrentSettings, phase: number): Set<string> {
  const parts = new Set<string>();
  for (const [group, entry] of Object.entries(config.onSite || {}))
    for (const rowId of Object.keys(entry.rates?.[String(phase) as StageKey] || {}))
      parts.add(group + '|' + rowId);
  return parts;
}
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
// another part, by a share (a number, of which 0 drops the row's share) instead of the part, or
// (null) by the share it was calculated with.
function withParts(
  config: CurrentSettings,
  phase: number,
  parts: ReadonlySet<string>,
  change: (rowId: string, part: OnSiteRate) => OnSiteRate | number | null,
): CurrentSettings {
  const key = String(phase) as StageKey;
  const onSite: NonNullable<CurrentSettings['onSite']> = {};
  for (const [group, entry] of Object.entries(config.onSite || {})) {
    const shares: Record<string, number> = { ...entry.shares[key] },
      rates: Record<string, OnSiteRate> = { ...entry.rates?.[key] };
    for (const [rowId, part] of Object.entries(rates)) {
      if (!parts.has(group + '|' + rowId)) continue;
      const replaced = change(rowId, part);
      if (replaced !== null && typeof replaced === 'object') rates[rowId] = replaced;
      else delete rates[rowId];
      if (typeof replaced === 'number' && replaced > 1e-6) shares[rowId] = replaced;
      else if (typeof replaced === 'number') delete shares[rowId];
    }
    onSite[group] = {
      ...entry,
      shares: { ...entry.shares, [key]: shares },
      rates: { ...entry.rates, [key]: rates },
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
