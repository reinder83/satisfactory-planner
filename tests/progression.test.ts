import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  baseTasks,
  guideContext,
  hardDriveTasks,
  milestoneTasks,
  powerTasks,
  progression,
  requiredMilestones,
  retireTasks,
} from '../public/progression.ts';
import { calculate } from '../planner.ts';
import type { CalcRow, Progression, StageKey } from '../public/types/index.ts';
const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
test('Phase 1 has construction stock and biomass guidance, without later power instructions', () => {
  const plan = calculate({ recipes: 'all' }),
    g = progression(plan, { checks: {} }, data, '1');
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
    rows = plan.stages['1'].rows!;
  const iron = rows.find(r => r.outputs['Iron Plate'])!;
  const checks: Record<string, boolean> = { ['calc-1-' + iron.id]: true };
  let g = progression(plan, { checks }, data, '2');
  assert.ok(g.milestoneTasks.some(t => t.body.includes('Iron Plate: already producing')));
  assert.match(g.powerTasks[0]!.body, /Biomass/);
  checks['unlock-' + data.entries.find(s => s.name === 'Coal Power')!.id] = true;
  g = progression(plan, { checks }, data, '2');
  assert.match(g.powerTasks[0]!.body, /Coal Power is marked unlocked/);
  assert.ok(!g.powerTasks.some(t => t.id === 'startup-biomass'));
});

test('a phase says which of the previous phase’s lines it stops using', () => {
  const plan = calculate({ phase: '1', recipes: 'all', goal: 'timed', hours: 10, multiplier: 5 });
  const at = (ph: number) => progression(plan, { checks: {} }, data, String(ph)).retire;
  assert.deepEqual(at(1), [], 'the first phase of a plan has nothing behind it to retire');

  const dropped = (ph: number): CalcRow[] => {
    const now = new Set((plan.stages[String(ph) as StageKey].rows || []).map(r => r.id));
    const later = new Set(
      (['1', '2', '3', '4', '5'] as const)
        .filter(p => Number(p) > Number(ph))
        .flatMap(p => (plan.stages[p].rows || []).map(r => r.id)),
    );
    return (plan.stages[String(ph - 1) as StageKey].rows || []).filter(
      r => !now.has(r.id) && !later.has(r.id),
    );
  };
  for (const ph of [2, 3, 4, 5]) {
    const expected = dropped(ph),
      step = at(ph);
    if (!expected.length) {
      assert.deepEqual(step, [], 'phase ' + ph + ' keeps every line, so it says nothing');
      continue;
    }
    assert.equal(step.length, 1, 'phase ' + ph + ' raises one retirement step');
    assert.equal(step[0]!.id, 'retire-' + ph, 'the step keeps a stable checklist key');
    assert.match(
      step[0]!.body,
      new RegExp('last needed in Phase ' + (ph - 1)),
      'it says when the lines were last needed',
    );
    assert.match(
      step[0]!.body,
      /Commission and prove the replacement chain first/,
      'it warns against dismantling too early',
    );
    // exactly the dropped lines, largest first, at most ten spelled out:
    // anything the plan picks up again later must not appear
    const listed = [...step[0]!.body.matchAll(/× (.+?) [(]/g)].map(m => m[1]);
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
        step[0]!.body,
        new RegExp('and ' + (expected.length - 10) + ' more line'),
        'the rest are counted',
      );
  }

  // a profile that starts later never retires a line it was never told to build
  const late = calculate({ phase: '3', recipes: 'all', goal: 'timed', hours: 10, multiplier: 5 });
  assert.deepEqual(
    progression(late, { checks: {} }, data, '3').retire,
    [],
    'the starting phase retires nothing',
  );
  const p4 = progression(late, { checks: {} }, data, '4').retire;
  if (p4.length)
    assert.match(
      p4[0]!.body,
      /last needed in Phase 3/,
      'later phases still retire what the plan did build',
    );
});

test('guideContext plans the post-game as Phase 5 and reads only ticked checks', () => {
  const plan = calculate({}),
    coal = data.entries.find(entry => entry.name === 'Coal Power')!;
  const ctx = guideContext(plan, { checks: { ['unlock-' + coal.id]: true } }, data, 'post');
  assert.equal(ctx.stage, 5);
  assert.deepEqual(ctx.rows, plan.stages['5'].rows || []);
  assert.equal(ctx.byName('Coal Power'), coal);
  assert.ok(ctx.unlocked(coal));
  assert.ok(!ctx.unlocked(ctx.byName('Nuclear Power')!));
  assert.match(ctx.funding(coal), /production planned|gather, handcraft/);
});

test('requiredMilestones brings every prerequisite, and milestoneTasks lists it first', () => {
  const plan = calculate({ recipes: 'all' });
  for (const phase of ['1', '2', '3', '4', '5']) {
    const ctx = guideContext(plan, { checks: {} }, data, phase),
      required = requiredMilestones(ctx),
      ids = new Set(required.map(entry => entry.id));
    // A prerequisite progression.json does not list (the HUB tutorial) cannot be added.
    for (const entry of required)
      for (const id of entry.requires.filter(id => data.entries.some(x => x.id === id)))
        assert.ok(ids.has(id), `phase ${phase}: ${entry.name} needs ${id}`);
    const tasks = milestoneTasks(ctx, required),
      position = new Map(tasks.map((task, i) => [task.id, i]));
    for (const entry of required) {
      const at = position.get('unlock-' + entry.id);
      if (at === undefined) continue;
      assert.ok(!entry.alternate, 'alternates come from hard drives, not milestone steps');
      for (const id of entry.requires) {
        const before = position.get('unlock-' + id);
        if (before !== undefined)
          assert.ok(before < at, `phase ${phase}: ${id} before ${entry.name}`);
      }
    }
  }
});

test('milestoneTasks leaves out what cannot be researched yet', () => {
  const ctx = guideContext(calculate({}), { checks: {} }, data, '1');
  const late = data.entries.filter(entry => !entry.mam && !entry.alternate && entry.tier >= 3);
  const tasks = milestoneTasks(ctx, late);
  assert.deepEqual(tasks, [], 'Phase 1 only researches tiers 1 and 2');
});

test('hardDriveTasks counts the alternates not yet confirmed', () => {
  const plan = calculate({ recipes: 'all' }),
    empty = guideContext(plan, { checks: {} }, data, '2'),
    alternates = empty.rows.filter(r => r.alternate);
  assert.ok(alternates.length > 1, 'the fixture plan uses alternates');
  const confirmed = guideContext(
    plan,
    { checks: { ['recipe-unlock-' + alternates[0]!.id]: true } },
    data,
    '2',
  );
  const tasks = hardDriveTasks(confirmed);
  assert.equal(tasks.length, alternates.length + 1);
  assert.equal(tasks[0]!.id, 'hard-drives-2');
  assert.match(tasks[0]!.body, new RegExp('^' + (alternates.length - 1) + ' selected'));
  assert.deepEqual(
    tasks.slice(1).map(task => task.id),
    alternates.map(r => 'recipe-unlock-' + r.id),
  );
  const plain = guideContext(calculate({}), { checks: {} }, data, '1');
  if (!plain.rows.some(r => r.alternate)) assert.deepEqual(hardDriveTasks(plain), []);
});

test('powerTasks keeps the Phase 1 start-up order calcTasks interleaves', () => {
  const ctx = guideContext(calculate({}), { checks: {} }, data, '1');
  assert.deepEqual(
    powerTasks(ctx)
      .slice(0, 4)
      .map(task => task.id),
    ['startup-1-power-review', 'startup-biomass', 'startup-solid-biofuel', 'startup-burner-bank-1'],
  );
});

test('baseTasks and retireTasks are empty where they do not apply', () => {
  const plan = calculate({});
  assert.equal(baseTasks(guideContext(plan, { checks: {} }, data, '1')).length, 7);
  assert.deepEqual(baseTasks(guideContext(plan, { checks: {} }, data, '2')), []);
  assert.deepEqual(retireTasks(guideContext(plan, { checks: {} }, data, '1')), []);
});
