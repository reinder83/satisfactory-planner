import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  baseTasks,
  guideContext,
  hardDriveTasks,
  milestonePhase,
  milestonesListedIn,
  milestoneTasks,
  phaseSteps,
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
  const plan = calculate({ phase: '1', recipes: 'all' }),
    guidance = progression(plan, { checks: {} }, data, '1');
  const power = guidance.powerTasks.map(t => t.body).join(' ');
  assert.doesNotMatch(power, /nuclear|aluminum|packaging|rocket fuel/i);
  assert.match(power, /120 Leaves\/min/);
  assert.match(power, /60 Wood\/min/);
  assert.match(power, /120 Biomass\/min/);
  const base = guidance.baseTasks.map(t => t.body).join(' ');
  for (const name of ['Iron Plates', 'Iron Rods', 'Concrete', 'Wire', 'Cable'])
    assert.ok(base.includes(name));
  assert.ok(guidance.milestoneTasks.some(t => t.title.includes('Obstacle Clearing')));
  assert.ok(guidance.milestoneTasks.some(t => t.title.includes('Overclock Production')));
  assert.ok(guidance.hardDrives.some(t => t.body.includes('Choices are random')));
});
test('milestone material advice uses actual running checkmarks and unlocks change power advice', () => {
  const plan = calculate({ phase: '1' }),
    rows = plan.stages['1'].rows!;
  const iron = rows.find(r => r.outputs['Iron Plate'])!;
  const checks: Record<string, boolean> = { ['calc-1-' + iron.id]: true };
  // The Tier 1-2 milestones that cost Iron Plate are Phase 1 steps (#758).
  const phaseOne = progression(plan, { checks }, data, '1');
  assert.ok(phaseOne.milestoneTasks.some(t => t.body.includes('Iron Plate: already producing')));
  let guidance = progression(plan, { checks }, data, '2');
  assert.match(guidance.powerTasks[0]!.body, /Biomass/);
  checks['unlock-' + data.entries.find(s => s.name === 'Coal Power')!.id] = true;
  guidance = progression(plan, { checks }, data, '2');
  assert.match(guidance.powerTasks[0]!.body, /Coal Power is marked unlocked/);
  assert.ok(!guidance.powerTasks.some(t => t.id === 'startup-biomass'));
});

test('a phase says which of the previous phase’s lines it stops using', () => {
  const plan = calculate({ phase: '1', recipes: 'all', goal: 'timed', hours: 10, multiplier: 5 });
  const retiredAt = (phase: number) =>
    progression(plan, { checks: {} }, data, String(phase)).retire;
  assert.deepEqual(retiredAt(1), [], 'the first phase of a plan has nothing behind it to retire');

  const dropped = (phase: number): CalcRow[] => {
    const now = new Set((plan.stages[String(phase) as StageKey].rows || []).map(r => r.id));
    const later = new Set(
      (['1', '2', '3', '4', '5'] as const)
        .filter(p => Number(p) > Number(phase))
        .flatMap(p => (plan.stages[p].rows || []).map(r => r.id)),
    );
    return (plan.stages[String(phase - 1) as StageKey].rows || []).filter(
      r => !now.has(r.id) && !later.has(r.id),
    );
  };
  for (const phase of [2, 3, 4, 5]) {
    const expected = dropped(phase),
      step = retiredAt(phase);
    if (!expected.length) {
      assert.deepEqual(step, [], 'phase ' + phase + ' keeps every line, so it says nothing');
      continue;
    }
    assert.equal(step.length, 1, 'phase ' + phase + ' raises one retirement step');
    assert.equal(step[0]!.id, 'retire-' + phase, 'the step keeps a stable checklist key');
    assert.match(
      step[0]!.body,
      new RegExp('last needed in Phase ' + (phase - 1)),
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
      'phase ' + phase + ' lists the lines it drops, biggest first',
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
  const phase4Retired = progression(late, { checks: {} }, data, '4').retire;
  if (phase4Retired.length)
    assert.match(
      phase4Retired[0]!.body,
      /last needed in Phase 3/,
      'later phases still retire what the plan did build',
    );
});

test('guideContext plans the post-game as Phase 5 and reads only ticked checks', () => {
  const plan = calculate({}),
    coal = data.entries.find(entry => entry.name === 'Coal Power')!;
  const context = guideContext(plan, { checks: { ['unlock-' + coal.id]: true } }, data, 'post');
  assert.equal(context.stage, 5);
  assert.deepEqual(context.rows, plan.stages['5'].rows || []);
  assert.equal(context.byName('Coal Power'), coal);
  assert.ok(context.unlocked(coal));
  assert.ok(!context.unlocked(context.byName('Nuclear Power')!));
  assert.match(context.funding(coal), /production planned|gather, handcraft/);
});

test('requiredMilestones brings every prerequisite, and milestoneTasks lists it first', () => {
  const plan = calculate({ recipes: 'all' });
  for (const phase of ['1', '2', '3', '4', '5']) {
    const context = guideContext(plan, { checks: {} }, data, phase),
      required = requiredMilestones(context),
      ids = new Set(required.map(entry => entry.id));
    // A prerequisite progression.json does not list (the HUB tutorial) cannot be added.
    for (const entry of required)
      for (const id of entry.requires.filter(id => data.entries.some(x => x.id === id)))
        assert.ok(ids.has(id), `phase ${phase}: ${entry.name} needs ${id}`);
    const tasks = milestoneTasks(context, required),
      position = new Map(tasks.map((task, i) => [task.id, i]));
    for (const entry of required) {
      const stepIndex = position.get('unlock-' + entry.id);
      if (stepIndex === undefined) continue;
      assert.ok(!entry.alternate, 'alternates come from hard drives, not milestone steps');
      for (const id of entry.requires) {
        const before = position.get('unlock-' + id);
        if (before !== undefined)
          assert.ok(before < stepIndex, `phase ${phase}: ${id} before ${entry.name}`);
      }
    }
  }
});

test('milestoneTasks leaves out what cannot be researched yet', () => {
  const context = guideContext(calculate({}), { checks: {} }, data, '1');
  const late = data.entries.filter(entry => !entry.mam && !entry.alternate && entry.tier >= 3);
  const tasks = milestoneTasks(context, late);
  assert.deepEqual(tasks, [], 'Phase 1 only researches tiers 1 and 2');
});

// Each milestone is listed once, under its own phase (#758, the owner's answer on #570): a HUB
// milestone under its tier's phase, a MAM node under the phase its costs first become available.
const PHASES = ['1', '2', '3', '4', '5', 'post'] as const;
const milestonePhases = (plan: ReturnType<typeof calculate>, checks: Record<string, boolean>) => {
  const listedIn = new Map<string, string[]>();
  for (const phase of PHASES)
    for (const task of progression(plan, { checks }, data, phase).milestoneTasks)
      listedIn.set(task.id, [...(listedIn.get(task.id) || []), phase]);
  return listedIn;
};
// What the profile listed before #758: in each planned phase, every milestone that phase needs
// and can research by then.
const neededSomewhere = (plan: ReturnType<typeof calculate>) =>
  new Set(
    (['1', '2', '3', '4', '5'] as const)
      .filter(phase => Number(phase) >= Number(plan.settings.phase))
      .flatMap(phase => {
        const context = guideContext(plan, { checks: {} }, data, phase);
        return milestoneTasks(context, requiredMilestones(context)).map(task => task.id);
      }),
  );
const entryOf = (stepId: string) => data.entries.find(entry => 'unlock-' + entry.id === stepId)!;

test('each milestone a profile needs is listed once, in its own phase', () => {
  const plan = calculate({ phase: '1', recipes: 'all' }),
    listedIn = milestonePhases(plan, {});
  assert.deepEqual(
    new Set(listedIn.keys()),
    neededSomewhere(plan),
    'the same milestones as before, only the phase listing them moved',
  );
  for (const [id, phases] of listedIn) {
    assert.deepEqual(phases, [String(milestonePhase(entryOf(id), data))], id + ' once, own phase');
  }
  // Tier 1: Base Building is needed by every phase and was listed in each.
  assert.deepEqual(listedIn.get('unlock-Schematic_1-1_C'), ['1']);
  assert.deepEqual(progression(plan, { checks: {} }, data, 'post').milestoneTasks, []);
});

test('a Tier 2 unlock only a later phase needs is a Phase 1 step', () => {
  const plan = calculate({ phase: '1' }),
    partAssembly = data.entries.find(entry => entry.name === 'Part Assembly')!;
  // Phases 1 and 2 build nothing, so only Phase 3's rows need Part Assembly's assemblers.
  plan.stages['1'] = { ...plan.stages['1'], rows: [] };
  plan.stages['2'] = { ...plan.stages['2'], rows: [] };
  const neededBy = (phase: StageKey) =>
    requiredMilestones(guideContext(plan, { checks: {} }, data, phase)).includes(partAssembly);
  assert.ok(!neededBy('1') && !neededBy('2') && neededBy('3'), 'only Phase 3 needs it');
  assert.equal(partAssembly.tier, 2);
  assert.deepEqual(milestonePhases(plan, {}).get('unlock-' + partAssembly.id), ['1']);
  const phaseOne = phaseSteps(plan, { checks: {} }, data, '1').map(step => step.id);
  assert.ok(phaseOne.includes('unlock-' + partAssembly.id), 'in the Phase 1 build plan');
});

test('a milestone of a phase before the start phase is listed in the start phase', () => {
  const plan = calculate({ phase: '3' }),
    listedIn = milestonePhases(plan, {});
  assert.deepEqual(new Set(listedIn.keys()), neededSomewhere(plan));
  for (const [id, phases] of listedIn)
    assert.deepEqual(phases, [String(Math.max(3, milestonePhase(entryOf(id), data)))], id);
  for (const tier of [1, 2, 3, 4])
    assert.ok(
      [...listedIn.keys()].some(id => entryOf(id).tier === tier && !entryOf(id).mam),
      'a Phase 3 profile keeps showing a Tier ' + tier + ' milestone',
    );
  for (const phase of ['1', '2'])
    assert.deepEqual(progression(plan, { checks: {} }, data, phase).milestoneTasks, []);
  assert.deepEqual(milestonesListedIn(plan, { checks: {} }, data, 2), []);
});

test('a MAM node is listed in the phase its costs first become available', () => {
  const plan = calculate({ phase: '1', recipes: 'all' }),
    listedIn = milestonePhases(plan, {});
  const mam = [...listedIn.keys()].map(entryOf).filter(entry => entry.mam);
  assert.ok(mam.length, 'the plan needs MAM research');
  for (const entry of mam) {
    const costs = Object.keys(entry.cost).filter(
      item => !/Hard Drive|Slug|Somersloop|Mercer|Power Shard/.test(item),
    );
    const available = Math.max(1, ...costs.map(item => data.availability[item] || 1));
    assert.deepEqual(listedIn.get('unlock-' + entry.id), [String(available)], entry.name);
  }
  // Rocket Fuel's costs are a Phase 4 product's, and Caterium, which only Phase 4's rows need
  // in this plan, can be researched from Phase 1 on.
  const rocket = data.entries.find(entry => entry.mam && entry.name === 'Rocket Fuel')!;
  assert.equal(milestonePhase(rocket, data), 4);
  const caterium = data.entries.find(entry => entry.mam && entry.name === 'Caterium')!;
  assert.deepEqual(listedIn.get('unlock-' + caterium.id), [String(milestonePhase(caterium, data))]);
  assert.ok(milestonePhase(caterium, data) < 4);
});

test('a ticked milestone counts in the phase that lists it now', () => {
  const plan = calculate({ phase: '1' }),
    coal = data.entries.find(entry => entry.name === 'Coal Power')!,
    checks = { ['unlock-' + coal.id]: true };
  // Coal Power was a step of Phases 2-5; its key is the same in Phase 2 alone.
  assert.deepEqual(milestonePhases(plan, checks).get('unlock-' + coal.id), ['2']);
  const phaseTwo = phaseSteps(plan, { checks }, data, '2').map(step => step.id);
  assert.ok(phaseTwo.includes('unlock-' + coal.id));
  for (const phase of ['3', '4', '5', 'post'])
    assert.ok(!phaseSteps(plan, { checks }, data, phase).some(s => s.id === 'unlock-' + coal.id));
});

test('no milestone needs a prerequisite of a later phase', () => {
  // So listing each in its own phase never puts a prerequisite after what needs it.
  for (const entry of data.entries.filter(candidate => !candidate.alternate))
    for (const id of entry.requires) {
      const prerequisite = data.entries.find(candidate => candidate.id === id);
      if (prerequisite)
        assert.ok(
          milestonePhase(prerequisite, data) <= milestonePhase(entry, data),
          entry.name + ' needs ' + prerequisite.name,
        );
    }
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

test('powerTasks keeps the Phase 1 start-up order phaseSteps interleaves', () => {
  const context = guideContext(calculate({}), { checks: {} }, data, '1');
  assert.deepEqual(
    powerTasks(context)
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

// phaseSteps is the build plan's generated step list (calcTasks in app/views/calculated.ts
// describes its rows). It reads only a stored plan and its checks, so any phase of any profile
// can be listed without opening it (#757, for the profile summaries of #746).
test('phaseSteps lists a phase of a stored plan in build-plan order', () => {
  const plan = calculate({ phase: '1' }),
    checks = { checks: {} };
  for (const phase of ['1', '2', '3', '4', '5', 'post']) {
    const stage = (phase === 'post' ? '5' : phase) as StageKey,
      steps = phaseSteps(plan, checks, data, phase),
      guide = progression(plan, checks, data, phase),
      ids = steps.map(step => step.id);
    const rows = plan.stages[stage].rows || [];
    const rowSteps = steps.filter(step => step.row);
    assert.deepEqual(
      rowSteps.map(step => step.id),
      rows.map(row => 'calc-' + stage + '-' + row.id),
      'one step per row, keyed by the stage',
    );
    assert.ok(rowSteps.every(step => step.body === '' && step.title === step.row!.name));
    const startup =
      phase === '1'
        ? [guide.baseTasks[0]!, ...guide.powerTasks.slice(0, 2)]
        : [...guide.powerTasks, ...guide.milestoneTasks];
    assert.deepEqual(steps.slice(0, startup.length), startup, 'startup first');
    const storage = ids.indexOf('calc-' + stage + '-storage');
    assert.equal(storage, ids.length - guide.retire.length - 1, 'storage, then the retirements');
    assert.deepEqual(steps.slice(storage + 1), guide.retire);
    assert.deepEqual(
      [...ids].sort(),
      [
        ...[
          ...guide.baseTasks,
          ...guide.powerTasks,
          ...guide.milestoneTasks,
          ...guide.hardDrives,
          ...guide.retire,
        ].map(task => task.id),
        ...rows.map(row => 'calc-' + stage + '-' + row.id),
        'calc-' + stage + '-storage',
      ].sort(),
      'every generated step of the phase, once',
    );
  }
});

test('phaseSteps gives a guide plan its guide steps, as copies, and none for a phase it skips', () => {
  const plan = calculate({}),
    step = { id: 'early-hub', title: 'Build the HUB', body: 'Place it.' },
    guided = { ...plan, guide: { phases: { '3': [step] } } };
  const listed = phaseSteps(guided, { checks: {} }, data, '3');
  assert.deepEqual(listed, [step]);
  assert.notEqual(listed[0], step);
  assert.deepEqual(phaseSteps(guided, { checks: {} }, data, '4'), []);
});
