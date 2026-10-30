// A factory's lines in the Satisfactory Tools production planner's file format (#1209, slice 6 of
// #1079), so an expert can open the plan on satisfactorytools.com and check or tweak it there.
// Export only: nothing is stored, sent or recalculated, and the file is made in the browser in
// both editions.
//
// The format, as the SatisfactoryTools source writes and reads it (commit fb43f81,
// src/Export/FileExporter.ts and src/Tools/Production/IProductionData.ts): `#` comment lines,
// then one line, `0` followed by the base64 of the zlib-deflated JSON
// `{"type":"tabs","tabs":[IProductionData, …]}`. One tab is `{ metadata, request }`; its request
// names items by class name (item-classes.ts) and recipes by theirs, which are the plan's recipe
// ids. Production → Import there reads the file; it keeps the file's `resourceMax` and puts its
// own `resourceWeight` in place of the file's.
//
// What a tab asks for (sftTab), from the factory's flow (groupFlow, the flow page's and the flow
// graph's figures):
// - `production`: what the factory's lines make for anywhere outside them, per minute: the other
//   factories, the ungrouped lines, storage, fuel and the Space Elevator, and the factory's own
//   generator lines (Satisfactory Tools plans no generators, so their fuel is asked for). What
//   goes to the AWESOME Sink is left out: it is surplus, not a product.
// - `input`: what comes into the lines from elsewhere, other factories and existing supply. Mined
//   raw resources are left to Satisfactory Tools' own miners, within `resourceMax`: the phase's
//   budgets.
// - `allowedAlternateRecipes`: the alternate recipes of the factory's lines.
import { ITEM_CLASSES } from './item-classes.ts';
import { LINK_DUST } from './group-order.ts';
import { OUTSIDE } from './group-links.ts';
import { recipeIdOf } from '../progression.ts';
import type { FlowLine, GroupFlow } from './group-flow.ts';
import type { CalcRow, ItemRates } from '../types/index.ts';

// IProductionData's shape, as far as the file fills it.
export interface SftProduction {
  item: string;
  type: 'perMinute';
  amount: number;
  ratio: number;
}
export interface SftInput {
  item: string;
  amount: number;
}
export interface SftTab {
  metadata: { name: string; icon: null; schemaVersion: 1; gameVersion: '0' };
  request: {
    allowedAlternateRecipes: string[];
    blockedRecipes: string[];
    blockedMachines: string[];
    blockedResources: string[];
    sinkableResources: string[];
    production: SftProduction[];
    input: SftInput[];
    resourceMax: Record<string, number>;
    resourceWeight: Record<string, number>;
  };
}
export interface SftFile {
  type: 'tabs';
  tabs: SftTab[];
}

// Rates in the file: to a thousandth per minute, as Satisfactory Tools' own fields take them.
const sftAmount = (rate: number) => Math.round(rate * 1000) / 1000;

// The class name of an item; an item without one (none in recipes.json, a test checks) is left
// out of the file rather than named wrongly.
const sftClass = (item: string): string | undefined => ITEM_CLASSES[item];

const sftIsGenerator = (row: Pick<CalcRow, 'power'> | undefined) => !!row && row.power < 0;

// Adds `rate` of `item` to `totals`.
const addRate = (totals: Map<string, number>, item: string, rate: number) =>
  totals.set(item, (totals.get(item) || 0) + rate);

// What the factory's lines other than its generators make for the generators and for places
// outside the factory but the sink (production), and take from places outside it that are not a
// mined raw resource (input), per item.
function sftCrossing(flow: GroupFlow, rows: ReadonlyMap<string, CalcRow>) {
  const generators = new Set(
    flow.lines.filter(line => sftIsGenerator(rows.get(line.id))).map(line => line.id),
  );
  const mined = new Set(flow.ins.filter(port => port.kind === 'raw').map(port => port.place));
  const production = new Map<string, number>(),
    input = new Map<string, number>();
  for (const line of flow.lines) {
    if (generators.has(line.id)) continue;
    for (const link of line.outputs.flatMap(row => row.links)) {
      const out =
        link.to.kind === 'line' ? generators.has(link.to.id) : link.to.id !== OUTSIDE.surplus;
      if (out) addRate(production, link.item, link.rate);
    }
    for (const link of line.inputs.flatMap(row => row.links))
      if (link.from.kind === 'place' && !mined.has(link.from.id))
        addRate(input, link.item, link.rate);
  }
  return { production, input };
}

// The rates as the file lists them: by class name, the largest first, dust and items without a
// class name left out.
const sftListed = (rates: Map<string, number>): [string, number][] =>
  [...rates]
    .filter(([item, rate]) => rate > LINK_DUST && sftAmount(rate) > 0 && sftClass(item))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    // The filter above keeps only items with a class name.
    .map(([item, rate]) => [sftClass(item)!, sftAmount(rate)]);

// The alternate recipes the factory's lines use, by class name: a row the plan marks alternate,
// or whose recipe Satisfactory Tools names an alternate (a MAM recipe such as Turbofuel, which the
// planner plans as standard, #1044). Generator lines have no recipe there.
function sftAlternates(lines: readonly FlowLine[], rows: ReadonlyMap<string, CalcRow>): string[] {
  const recipes = new Set<string>();
  for (const line of lines) {
    const row = rows.get(line.id);
    if (!row || sftIsGenerator(row)) continue;
    const recipe = recipeIdOf(row);
    if (row.alternate || recipe.includes('_Alternate_')) recipes.add(recipe);
  }
  return [...recipes].sort();
}

// The phase's budgets by class name (`resourceMax`), and a weight per resource that makes the
// scarcer ones dearer (`resourceWeight`, which Satisfactory Tools replaces with its own on import;
// Water, which never runs out, weighs nothing).
function sftResources(budgets: ItemRates) {
  const resourceMax: Record<string, number> = {},
    resourceWeight: Record<string, number> = {};
  const entries = Object.entries(budgets)
    .filter(([item, budget]) => sftClass(item) && Number.isFinite(budget))
    .sort((a, b) => a[0].localeCompare(b[0]));
  const largest = Math.max(
    0,
    ...entries.filter(([item]) => item !== 'Water').map(([, budget]) => budget),
  );
  for (const [item, budget] of entries) {
    // `entries` holds only resources with a class name.
    const key = sftClass(item)!;
    resourceMax[key] = sftAmount(budget);
    resourceWeight[key] =
      item === 'Water' || budget <= 0 ? 0 : Math.round((largest / budget) * 1000) / 1000;
  }
  return { resourceMax, resourceWeight };
}

// One factory's tab: `name` is the tab's name in Satisfactory Tools, `rows` the phase's plan
// rows, `budgets` the phase's raw-resource budgets (stageBudgets in mining.ts).
export function sftTab(
  name: string,
  flow: GroupFlow,
  rows: readonly CalcRow[],
  budgets: ItemRates,
): SftTab {
  const byId = new Map(rows.map(row => [row.id, row]));
  const { production, input } = sftCrossing(flow, byId);
  return {
    metadata: { name, icon: null, schemaVersion: 1, gameVersion: '0' },
    request: {
      allowedAlternateRecipes: sftAlternates(flow.lines, byId),
      blockedRecipes: [],
      blockedMachines: [],
      blockedResources: [],
      sinkableResources: [],
      production: sftListed(production).map(([item, rate]) => ({
        item,
        type: 'perMinute',
        amount: rate,
        ratio: 100,
      })),
      input: sftListed(input).map(([item, rate]) => ({ item, amount: rate })),
      ...sftResources(budgets),
    },
  };
}

// zlib-deflates `text` (as UTF-8) with the browser's (and Node's) CompressionStream: 'deflate' is the zlib
// format the file's reader inflates, so no library is needed.
async function sftDeflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Base64 of `bytes`, in chunks so a large plan does not overflow the call stack.
function sftBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// The text of a .sft file holding `tabs`.
export async function sftFileText(tabs: SftTab[], exportedAt: Date): Promise<string> {
  const file: SftFile = { type: 'tabs', tabs };
  const packed = await sftDeflate(JSON.stringify(file));
  return [
    '# Satisfactory Tools production plan, exported by Satisfactory Planner',
    '# ' + exportedAt.toISOString(),
    '# Open it at https://satisfactorytools.com: Production planner, then Import.',
    '0' + sftBase64(packed),
    '',
  ].join('\n');
}

// A file name from the factory's name and the phase, accents dropped: "Iron & steel, Phase 3" is
// "iron-steel-phase-3.sft".
export const sftFileName = (name: string): string =>
  (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'factory'
  ).slice(0, 80) + '.sft';
