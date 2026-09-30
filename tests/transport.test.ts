import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate, settings } from '../planner.ts';
import { droneFuels } from '../public/preferences.ts';
import { progression } from '../public/progression.ts';
import type { Progression, StageKey } from '../public/types/index.ts';
test('utilities percentage affects actual power sizing with backward-compatible default', () => {
  assert.equal(settings({}).utilityPercent, 20);
  for (const utilityPercent of [0, 20, 50]) {
    const plan = calculate({ utilityPercent });
    const stage = plan.stages[3];
    assert.ok(stage.feasible);
    assert.ok(Math.abs(stage.requiredMW - stage.peakMW * (1 + utilityPercent / 100)) < 0.001);
    assert.ok(
      stage.generationMW + plan.settings.availablePowerGW * 1000 + stage.additionalHeadroomMW >=
        stage.requiredMW - 0.01,
    );
  }
  assert.throws(() => settings({ utilityPercent: -1 }));
});
test('drone contracts start at unlock phase, balance fuel and upgrade ionized fuel', () => {
  const data: Progression = JSON.parse(
    fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
  );
  for (const droneFuel of droneFuels.filter(x => x !== 'none')) {
    const plan = calculate({
      droneFuel,
      droneFuelRate: 0.1,
      droneBridgeRate: 5,
      nuclear: droneFuel === 'Plutonium Fuel Rod' ? 'sink' : 'none',
    });
    for (let phase = 1; phase <= 5; phase++) {
      const stage = plan.stages[String(phase) as StageKey];
      assert.ok(stage.feasible, droneFuel + ' phase ' + phase);
      if (phase < 4) {
        assert.deepEqual(stage.drone, {});
        continue;
      }
      const fuel = phase === 4 && droneFuel === 'Packaged Ionized Fuel' ? 'Battery' : droneFuel;
      assert.equal(stage.drone[fuel], fuel === 'Battery' && droneFuel !== 'Battery' ? 5 : 0.1);
      const made = stage.rows.reduce((total, r) => total + (r.outputs[fuel] || 0), 0),
        used = stage.rows.reduce((total, r) => total + (r.inputs[fuel] || 0), 0);
      assert.ok(made - used >= (stage.storage[fuel] || 0) + stage.drone[fuel] - 0.001);
      const guide = progression(plan, { checks: {} }, data, String(phase));
      assert.ok(guide.milestoneTasks.some(t => t.title.includes('Aeronautical Engineering')));
      assert.ok(guide.powerTasks.some(t => t.id === 'drone-fuel-' + phase));
    }
  }
  assert.throws(() => settings({ droneFuel: 'Plutonium Fuel Rod' }), /nuclear/);
});
