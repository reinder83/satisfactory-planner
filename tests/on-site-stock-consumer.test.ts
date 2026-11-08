// Made on site (#1314): a group that marks an item whose only consumer in that group is a
// storage-only line (`<recipe>:stock`, planner/stock.ts, #1061) gets its own line of the item too.
// The storage-only lines are added after the phase's solve, so the group's copy was never offered
// for them and the line kept drawing the item from the plan's surplus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../planner.ts';
import { onSiteSettings } from '../public/app/on-site.ts';
import type { CalcRow, FactoryGroups } from '../public/types/index.ts';

const BASE = {
  phase: '3',
  wholeMachines: true,
  storage: 'all',
  collectables: true,
  storageFromSurplus: true,
};
const GROUP = 'fg-store11';
const groups: FactoryGroups = {
  groups: [{ id: GROUP, name: 'Store' }],
  assignments: { 'Recipe_Cable_C:stock': [{ group: GROUP, rate: null }] },
  local: { [GROUP]: ['Wire'] },
};

test('a group whose only consumer is a storage-only line gets its own line', () => {
  const plan = calculate(BASE);
  const onSite = onSiteSettings(plan, groups)!;
  assert.equal(onSite[GROUP]!.shares['3']!['Recipe_Cable_C:stock'], 1, 'the share is asked for');
  const marked = calculate({ ...BASE, onSite });
  const rows = marked.stages['3'].rows as CalcRow[];
  const stock = rows.find(row => row.id === 'Recipe_Cable_C:stock')!;
  const own = rows.find(row => row.id === `Recipe_Wire_C:${GROUP}`);
  assert.ok(own, 'the group has its own Wire line');
  assert.deepEqual(own.onSite, { group: GROUP, recipe: 'Recipe_Wire_C' });
  assert.ok(
    Math.abs(own.outputs.Wire! - stock.inputs.Wire!) < 1e-6,
    'the storage-only Cable line takes all its Wire from it',
  );
});

test('a plan whose groups hold no storage-only line is as it was', () => {
  const plan = calculate(BASE);
  const other: FactoryGroups = {
    ...groups,
    assignments: { Recipe_Cable_C: [{ group: GROUP, rate: null }] },
  };
  const onSite = onSiteSettings(plan, other)!;
  const marked = calculate({ ...BASE, onSite });
  const ids = (marked.stages['3'].rows as CalcRow[]).map(row => row.id);
  assert.ok(ids.includes(`Recipe_Wire_C:${GROUP}`), 'the group still has its line');
  assert.ok(ids.includes('Recipe_Wire_C:stock'), 'central storage line unchanged');
});
