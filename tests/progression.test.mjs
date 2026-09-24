import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { progression } from '../public/progression.js';
import { calculate } from '../planner.mjs';
const data = JSON.parse(fs.readFileSync(new URL('../public/progression.json', import.meta.url)));
test('Phase 1 has construction stock and biomass guidance, without later power instructions', () => {
  const plan = calculate({ recipes: 'all' }),
    g = progression(plan, { checks: {} }, data, 1);
  const power = g.powerTasks.map(t => t.body).join(' ');
  assert.doesNotMatch(power, /nuclear|aluminum|packaging|rocket fuel/i);
  assert.match(power, /120 Leaves\/min/);
  assert.match(power, /60 Wood\/min/);
  assert.match(power, /120 Biomass\/min/);
  const base = g.baseTasks.map(t => t.body).join(' ');
  for (const name of ['Iron Plates', 'Iron Rods', 'Concrete', 'Wire', 'Cable'])
    assert.ok(base.includes(name));
  assert.ok(g.milestoneTasks.some(t => t.title.includes('Obstacle Clearing')));
  assert.ok(g.milestoneTasks.some(t => t.title.includes('Overclock Production')));
  assert.ok(g.hardDrives.some(t => t.body.includes('Choices are random')));
});
test('milestone material advice uses actual running checkmarks and unlocks change power advice', () => {
  const plan = calculate({}),
    rows = plan.stages[1].rows;
  const iron = rows.find(r => r.outputs['Iron Plate']);
  const checks = { ['calc-1-' + iron.id]: true };
  let g = progression(plan, { checks }, data, 2);
  assert.ok(g.milestoneTasks.some(t => t.body.includes('Iron Plate: already producing')));
  assert.match(g.powerTasks[0].body, /Biomass/);
  checks['unlock-' + data.entries.find(s => s.name === 'Coal Power').id] = true;
  g = progression(plan, { checks }, data, 2);
  assert.match(g.powerTasks[0].body, /Coal Power is marked unlocked/);
  assert.ok(!g.powerTasks.some(t => t.id === 'startup-biomass'));
});

test('a phase says which of the previous phase’s lines it stops using', () => {
  const plan = calculate({ phase: '1', recipes: 'all', goal: 'timed', hours: 10, multiplier: 5 });
  const at = ph => progression(plan, { checks: {} }, data, ph).retire;
  assert.deepEqual(at(1), [], 'the first phase of a plan has nothing behind it to retire');

  const dropped = ph => {
    const now = new Set((plan.stages[ph].rows || []).map(r => r.id));
    const later = new Set(
      ['1', '2', '3', '4', '5']
        .filter(p => Number(p) > Number(ph))
        .flatMap(p => (plan.stages[p].rows || []).map(r => r.id)),
    );
    return (plan.stages[ph - 1].rows || []).filter(r => !now.has(r.id) && !later.has(r.id));
  };
  for (const ph of [2, 3, 4, 5]) {
    const expected = dropped(ph),
      step = at(ph);
    if (!expected.length) {
      assert.deepEqual(step, [], 'phase ' + ph + ' keeps every line, so it says nothing');
      continue;
    }
    assert.equal(step.length, 1, 'phase ' + ph + ' raises one retirement step');
    assert.equal(step[0].id, 'retire-' + ph, 'the step keeps a stable checklist key');
    assert.match(
      step[0].body,
      new RegExp('last needed in Phase ' + (ph - 1)),
      'it says when the lines were last needed',
    );
    assert.match(
      step[0].body,
      /Commission and prove the replacement chain first/,
      'it warns against dismantling too early',
    );
    // exactly the dropped lines, largest first, at most ten spelled out:
    // anything the plan picks up again later must not appear
    const listed = [...step[0].body.matchAll(/× (.+?) [(]/g)].map(m => m[1]);
    const expectedNames = [...expected]
      .sort((a, b) => b.machines - a.machines)
      .slice(0, 10)
      .map(r => r.name);
    assert.deepEqual(
      listed,
      expectedNames,
      'phase ' + ph + ' lists the lines it drops, biggest first',
    );
    if (expected.length > 10)
      assert.match(
        step[0].body,
        new RegExp('and ' + (expected.length - 10) + ' more line'),
        'the rest are counted',
      );
  }

  // a profile that starts later never retires a line it was never told to build
  const late = calculate({ phase: '3', recipes: 'all', goal: 'timed', hours: 10, multiplier: 5 });
  assert.deepEqual(
    progression(late, { checks: {} }, data, 3).retire,
    [],
    'the starting phase retires nothing',
  );
  const p4 = progression(late, { checks: {} }, data, 4).retire;
  if (p4.length)
    assert.match(
      p4[0].body,
      /last needed in Phase 3/,
      'later phases still retire what the plan did build',
    );
});
