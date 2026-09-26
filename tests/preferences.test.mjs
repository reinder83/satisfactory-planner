import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, settings } from '../planner.ts';
import { resourceDefaults, wantsStorage, distributions, purities } from '../public/preferences.ts';
test('resource presets transform known purity counts and distinguish unknown seed totals', () => {
  assert.equal(distributions.length, 5);
  assert.equal(purities.length, 8);
  assert.equal(resourceDefaults('pure').limits['Iron Ore'], 152400);
  assert.equal(resourceDefaults('normal').limits['Nitrogen Gas'], 6750);
  assert.equal(resourceDefaults('pure').limits['Nitrogen Gas'], 13500);
  assert.equal(resourceDefaults('mostly-pure').limits['Iron Ore'], 129000);
  assert.equal(resourceDefaults('mostly-impure').limits['Iron Ore'], 51900);
  assert.equal(resourceDefaults('pure', 'randomized').limits['Iron Ore'], 152400);
  assert.equal(resourceDefaults('pure', 'advanced').limits['Iron Ore'], 0);
  assert.equal(resourceDefaults('pure', 'advanced').uncertain, true);
  assert.equal(settings({ purity: 'normal' }).limits['Nitrogen Gas'], 6750);
});
test('storage supply options protect only selected categories', () => {
  assert.equal(wantsStorage('Computer', 'construction'), true);
  assert.equal(wantsStorage('Supercomputer', 'construction'), false);
  assert.equal(wantsStorage('Supercomputer', 'electronics'), true);
  assert.equal(wantsStorage('Gas Filter', 'supplies'), true);
  assert.equal(wantsStorage('Packaged Fuel', 'packaged'), true);
  assert.equal(wantsStorage('Iron Plate', 'packaged'), false);
  const plan = calculate({ storage: 'packaged' });
  for (const stage of Object.values(plan.stages))
    for (const name of Object.keys(stage.storage || {})) assert.ok(name.startsWith('Packaged '));
});
test('preferred power actually constrains new generation and follows phase unlocks', () => {
  for (const mainPower of ['fuel', 'turbofuel', 'rocket']) {
    const plan = calculate({ mainPower });
    for (const [phase, stage] of Object.entries(plan.stages)) {
      assert.equal(stage.feasible, true, mainPower + ' phase ' + phase);
      for (const row of stage.rows.filter(r => r.generationMW)) {
        const expected =
          +phase === 2
            ? 'power-coal'
            : mainPower === 'fuel'
              ? 'power-fuel'
              : mainPower === 'rocket' && +phase >= 4
                ? 'power-rocket-fuel'
                : 'power-turbofuel';
        assert.equal(row.id, expected);
      }
    }
  }
  assert.throws(() => settings({ mainPower: 'rocket-nuclear', nuclear: 'none' }), /waste strategy/);
});
