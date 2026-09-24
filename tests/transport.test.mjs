import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate, settings } from '../planner.mjs';
import { droneFuels } from '../public/preferences.js';
import { progression } from '../public/progression.js';
test('utilities percentage affects actual power sizing with backward-compatible default', () => {
  assert.equal(settings({}).utilityPercent, 20);
  for (const utilityPercent of [0, 20, 50]) {
    const p = calculate({ utilityPercent });
    const x = p.stages[3];
    assert.ok(x.feasible);
    assert.ok(Math.abs(x.requiredMW - x.peakMW * (1 + utilityPercent / 100)) < 0.001);
    assert.ok(
      x.generationMW + p.settings.availablePowerGW * 1000 + x.additionalHeadroomMW >=
        x.requiredMW - 0.01,
    );
  }
  assert.throws(() => settings({ utilityPercent: -1 }));
});
test('drone contracts start at unlock phase, balance fuel and upgrade ionized fuel', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../public/progression.json', import.meta.url)));
  for (const droneFuel of droneFuels.filter(x => x !== 'none')) {
    const p = calculate({
      droneFuel,
      droneFuelRate: 0.1,
      droneBridgeRate: 5,
      nuclear: droneFuel === 'Plutonium Fuel Rod' ? 'sink' : 'none',
    });
    for (let phase = 1; phase <= 5; phase++) {
      const x = p.stages[phase];
      assert.ok(x.feasible, droneFuel + ' phase ' + phase);
      if (phase < 4) {
        assert.deepEqual(x.drone, {});
        continue;
      }
      const fuel = phase === 4 && droneFuel === 'Packaged Ionized Fuel' ? 'Battery' : droneFuel;
      assert.equal(x.drone[fuel], fuel === 'Battery' && droneFuel !== 'Battery' ? 5 : 0.1);
      const made = x.rows.reduce((a, r) => a + (r.outputs[fuel] || 0), 0),
        used = x.rows.reduce((a, r) => a + (r.inputs[fuel] || 0), 0);
      assert.ok(made - used >= (x.storage[fuel] || 0) + x.drone[fuel] - 0.001);
      const g = progression(p, { checks: {} }, data, String(phase));
      assert.ok(g.milestoneTasks.some(t => t.title.includes('Aeronautical Engineering')));
      assert.ok(g.powerTasks.some(t => t.id === 'drone-fuel-' + phase));
    }
  }
  assert.throws(() => settings({ droneFuel: 'Plutonium Fuel Rod' }), /nuclear/);
});
