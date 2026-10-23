// The export to Satisfactory Tools (#1209, public/app/sft-export.ts): the tab of a small fixed
// plan, exactly as it goes into the file, the file itself decoded the way Satisfactory Tools reads
// it (`#` lines, then `0` and the base64 of zlib-deflated JSON), and the item class names
// (public/app/item-classes.ts, copied from the dataset recipes.json records) for every item.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { groupFlow, type GroupFlow } from '../public/app/group-flow.ts';
import { ITEM_CLASSES } from '../public/app/item-classes.ts';
import { sftFileName, sftFileText, sftTab, type SftTab } from '../public/app/sft-export.ts';
import { recipes } from './helpers/data.ts';
import type { CalcRow, FactoryGroups, StoredStage } from '../public/types/index.ts';

const row = (
  id: string,
  inputs: CalcRow['inputs'],
  outputs: CalcRow['outputs'],
  extra: Partial<CalcRow> = {},
): CalcRow => ({
  id,
  name: id,
  phase: 2,
  machine: 'Constructor',
  power: 4,
  inputs,
  outputs,
  equivalent: 1,
  machines: 1,
  lastClock: 100,
  peakMW: 4,
  generationMW: 0,
  ...extra,
});

// The iron works makes plates, cast screws and reinforced plates from mined ore, and Compacted
// Coal for its own Coal Generators and the motor works. The motor works makes rotors from those
// screws and existing Iron Rod, and Turbofuel (an alternate by name that the planner plans as
// standard, a MAM recipe) for drones from existing Fuel and that coal. Plates go to storage and
// the sink, reinforced plates and rotors to the Space Elevator.
const stage: StoredStage = {
  feasible: true,
  rows: [
    row('Recipe_IngotIron_C', { 'Iron Ore': 60 }, { 'Iron Ingot': 60 }),
    row('Recipe_IronPlate_C', { 'Iron Ingot': 30 }, { 'Iron Plate': 20 }),
    row('Recipe_Alternate_Screw_C', { 'Iron Ingot': 30 }, { Screws: 50 }, { alternate: true }),
    row(
      'Recipe_IronPlateReinforced_C',
      { 'Iron Plate': 12, Screws: 24 },
      { 'Reinforced Iron Plate': 2 },
    ),
    row(
      'Recipe_Alternate_EnrichedCoal_C',
      { Coal: 30, Sulfur: 30 },
      { 'Compacted Coal': 30 },
      { alternate: true },
    ),
    row(
      'power:Coal Generator',
      { 'Compacted Coal': 25, Water: 45 },
      {},
      { machine: 'Coal Generator', power: -75, generationMW: 75 },
    ),
    row('Recipe_Rotor_C', { 'Iron Rod': 20, Screws: 26 }, { Rotor: 4 }),
    row('Recipe_Alternate_Turbofuel_C', { Fuel: 6, 'Compacted Coal': 5 }, { Turbofuel: 5 }),
  ],
  raw: { 'Iron Ore': 60, Coal: 30, Sulfur: 30, Water: 45 },
  supplied: { 'Iron Rod': 20, Fuel: 6 },
  storage: { 'Iron Plate': 3 },
  surplus: { 'Iron Plate': 5 },
  drone: { Turbofuel: 5 },
  delivery: {
    'Reinforced Iron Plate': { target: 100, rate: 2 },
    Rotor: { target: 100, rate: 4 },
  },
};
const ROWS = stage.rows ?? [];
const whole = (group: string) => [{ group, rate: null }];
const groups: FactoryGroups = {
  groups: [
    { id: 'fg-iron', name: 'Iron works' },
    { id: 'fg-motor', name: 'Motor works' },
  ],
  assignments: {
    Recipe_IngotIron_C: whole('fg-iron'),
    Recipe_IronPlate_C: whole('fg-iron'),
    Recipe_Alternate_Screw_C: whole('fg-iron'),
    Recipe_IronPlateReinforced_C: whole('fg-iron'),
    Recipe_Alternate_EnrichedCoal_C: whole('fg-iron'),
    'power:Coal Generator': whole('fg-iron'),
    Recipe_Rotor_C: whole('fg-motor'),
    Recipe_Alternate_Turbofuel_C: whole('fg-motor'),
  },
};
const budgets = { 'Iron Ore': 92100, Coal: 42300, Water: 1000000 };
const flowOf = (id: string, plan = stage): GroupFlow => {
  const flow = groupFlow(plan, groups, id, () => '');
  assert.ok(flow, id);
  return flow;
};
const resources = {
  resourceMax: { Desc_Coal_C: 42300, Desc_OreIron_C: 92100, Desc_Water_C: 1000000 },
  resourceWeight: { Desc_Coal_C: 2.177, Desc_OreIron_C: 1, Desc_Water_C: 0 },
};
const IRON_TAB: SftTab = {
  metadata: { name: 'Iron works, Phase 2', icon: null, schemaVersion: 1, gameVersion: '0' },
  request: {
    allowedAlternateRecipes: ['Recipe_Alternate_EnrichedCoal_C', 'Recipe_Alternate_Screw_C'],
    blockedRecipes: [],
    blockedMachines: [],
    blockedResources: [],
    sinkableResources: [],
    production: [
      // 25 for its own generators, 5 for the motor works.
      { item: 'Desc_CompactedCoal_C', type: 'perMinute', amount: 30, ratio: 100 },
      { item: 'Desc_IronScrew_C', type: 'perMinute', amount: 26, ratio: 100 },
      // Storage, not the 5 the sink takes.
      { item: 'Desc_IronPlate_C', type: 'perMinute', amount: 3, ratio: 100 },
      { item: 'Desc_IronPlateReinforced_C', type: 'perMinute', amount: 2, ratio: 100 },
    ],
    // Iron Ore, Coal, Sulfur and Water are mined: Satisfactory Tools' own miners give them.
    input: [],
    ...resources,
  },
};
const MOTOR_TAB: SftTab = {
  metadata: { name: 'Motor works, Phase 2', icon: null, schemaVersion: 1, gameVersion: '0' },
  request: {
    allowedAlternateRecipes: ['Recipe_Alternate_Turbofuel_C'],
    blockedRecipes: [],
    blockedMachines: [],
    blockedResources: [],
    sinkableResources: [],
    production: [
      { item: 'Desc_LiquidTurboFuel_C', type: 'perMinute', amount: 5, ratio: 100 },
      { item: 'Desc_Rotor_C', type: 'perMinute', amount: 4, ratio: 100 },
    ],
    input: [
      { item: 'Desc_IronScrew_C', amount: 26 },
      { item: 'Desc_IronRod_C', amount: 20 },
      { item: 'Desc_LiquidFuel_C', amount: 6 },
      { item: 'Desc_CompactedCoal_C', amount: 5 },
    ],
    ...resources,
  },
};

test("a factory's tab asks for what leaves its lines and takes what comes in, as the file holds it", () => {
  const iron = sftTab('Iron works, Phase 2', flowOf('fg-iron'), ROWS, budgets);
  const motor = sftTab('Motor works, Phase 2', flowOf('fg-motor'), ROWS, budgets);
  // The exact JSON, key order included, that goes into the file before compression.
  assert.equal(JSON.stringify(iron), JSON.stringify(IRON_TAB));
  assert.equal(JSON.stringify(motor), JSON.stringify(MOTOR_TAB));
});

test('an amplified twin and a storage-only line name their recipe; a factory sending all to the sink asks for nothing', () => {
  const plan: StoredStage = {
    feasible: true,
    rows: [
      row('amp:Recipe_Alternate_Screw_C', { 'Iron Rod': 10 }, { Screws: 80 }, { alternate: true }),
      row(
        'Recipe_IronPlate_C:stock',
        { 'Iron Ingot': 15 },
        { 'Iron Plate': 10 },
        {
          stock: { recipe: 'Recipe_IronPlate_C' },
        },
      ),
    ],
    supplied: { 'Iron Rod': 10, 'Iron Ingot': 15 },
    surplus: { Screws: 80, 'Iron Plate': 10 },
  };
  const sinking: FactoryGroups = {
    groups: [{ id: 'fg-iron', name: 'Iron works' }],
    assignments: {
      'amp:Recipe_Alternate_Screw_C': whole('fg-iron'),
      'Recipe_IronPlate_C:stock': whole('fg-iron'),
    },
  };
  const flow = groupFlow(plan, sinking, 'fg-iron', () => '');
  assert.ok(flow);
  const tab = sftTab('Iron works', flow, plan.rows ?? [], {});
  assert.deepEqual(tab.request.allowedAlternateRecipes, ['Recipe_Alternate_Screw_C']);
  assert.deepEqual(tab.request.production, []);
  // Existing supply is an input, by class name.
  assert.deepEqual(tab.request.input, [
    { item: 'Desc_IronIngot_C', amount: 15 },
    { item: 'Desc_IronRod_C', amount: 10 },
  ]);
  assert.deepEqual(tab.request.resourceMax, {});
});

// The file as Satisfactory Tools' Production → Import reads it: the `#` lines skipped, then the
// line starting with the format digit 0, its base64 a zlib stream of the JSON.
function decode(text: string): unknown {
  const lines = text.split('\n').filter(line => line && !line.startsWith('#'));
  assert.equal(lines.length, 1, 'one data line');
  const data = lines[0] ?? '';
  assert.ok(data.startsWith('0'), 'format 0');
  const bytes = Buffer.from(data.slice(1), 'base64');
  assert.equal(bytes[0], 0x78, 'a zlib header, as pako.inflate expects');
  return JSON.parse(inflateSync(bytes).toString('utf8'));
}

test('the .sft file round-trips: comment lines, then 0 and base64 of zlib-deflated tabs', async () => {
  const tabs = [
    sftTab('Iron works, Phase 2', flowOf('fg-iron'), ROWS, budgets),
    sftTab('Motor works, Phase 2', flowOf('fg-motor'), ROWS, budgets),
  ];
  const text = await sftFileText(tabs, new Date('2026-10-23T12:00:00Z'));
  const lines = text.split('\n');
  assert.equal(lines[0], '# Satisfactory Tools production plan, exported by Satisfactory Planner');
  assert.equal(lines[1], '# 2026-10-23T12:00:00.000Z');
  assert.deepEqual(decode(text), { type: 'tabs', tabs: [IRON_TAB, MOTOR_TAB] });
  // A hostile name stays data inside the JSON.
  const hostile = sftTab('<x-evil>"\n# 0', flowOf('fg-iron'), ROWS, budgets);
  const decoded = decode(await sftFileText([hostile], new Date(0)));
  assert.deepEqual(decoded, { type: 'tabs', tabs: [hostile] });
});

test('the file name follows the tab name', () => {
  assert.equal(sftFileName('Iron & steel, Phase 3'), 'iron-steel-phase-3.sft');
  assert.equal(sftFileName('Ünïcode!!, Post Phase 5'), 'unicode-post-phase-5.sft');
  assert.equal(sftFileName('***'), 'factory.sft');
});

// Every item recipes.json names: its item list and every recipe's inputs and outputs.
function recipeItems(): Set<string> {
  const file: unknown = JSON.parse(
    readFileSync(new URL('../recipes.json', import.meta.url), 'utf8'),
  );
  assert.ok(typeof file === 'object' && file !== null && 'items' in file);
  const items = file.items;
  assert.ok(typeof items === 'object' && items !== null);
  const names = new Set(Object.keys(items));
  for (const recipe of recipes)
    for (const item of [...Object.keys(recipe.inputs), ...Object.keys(recipe.outputs)])
      names.add(item);
  return names;
}

test('every item recipes.json names has its Satisfactory Tools class name', () => {
  const names = recipeItems();
  assert.ok(names.size > 150, 'the whole item list');
  for (const name of names) {
    const className = ITEM_CLASSES[name];
    assert.ok(className, name + ' has a class name');
    assert.match(className, /^(Desc|BP)_\w+_C$|^special__\w+$/, name);
  }
  // No two items share one, and the well-known irregular ones are right.
  const classes = Object.values(ITEM_CLASSES);
  assert.equal(new Set(classes).size, classes.length);
  assert.equal(ITEM_CLASSES.Limestone, 'Desc_Stone_C');
  assert.equal(ITEM_CLASSES.Concrete, 'Desc_Cement_C');
  assert.equal(ITEM_CLASSES['Reinforced Iron Plate'], 'Desc_IronPlateReinforced_C');
  assert.equal(ITEM_CLASSES['Iron Ore'], 'Desc_OreIron_C');
});
