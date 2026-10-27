// Overclocked production lines (#1239, slice 1 of 2): settings.lineClocks runs every machine of a
// line at a clock above 100% with Power Shards, an explicit solver input the interface does not
// set yet. The solve plans the line's machines at that clock (whole ones under whole machines),
// their power at clock^1.321929, the Power Shards they hold (lineShards) within the phase's
// lineShardBudget, and plans a phase without a clock it cannot keep, recording why
// (lineClocksDropped). A plan without the field calculates exactly as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, DATA, run, settings } from '../planner.ts';
import { fitClocks, lineShards } from '../planner/clocks.ts';
import { CLOCK_EXPONENT, lineLoad } from '../public/power.ts';
import type { CalcRow, CurrentSettings } from '../public/types/index.ts';
import type { RunResult, Solved } from '../planner/types.ts';

// A Phase 3 plan on whole machines, as tests/sloop-pins.test.ts plans it.
const BASE = {
  phase: '3',
  recipes: 'standard',
  wholeMachines: true,
  storageFromSurplus: true,
};
const PLATE = 'Recipe_IronPlate_C';
const recipe = (id: string) => DATA.recipes.find(entry => entry.id === id)!;
const solved = (result: RunResult): Solved => {
  assert.ok(result.feasible, 'the phase fits');
  return result;
};
const phase = (extra: object, number = 3) => run(settings({ ...BASE, ...extra }), number);
const row = (result: RunResult, id: string): CalcRow => {
  const found = solved(result).rows.find(line => line.id === id);
  assert.ok(found, `${id} is planned`);
  return found;
};
const shardsOf = (result: RunResult) =>
  solved(result).rows.reduce((total, line) => total + (line.shards ?? 0), 0);
let plainCache: RunResult | undefined;
const plain = () => (plainCache ??= phase({}));

test('settings keep line clocks sorted, drop an empty map and refuse anything else', () => {
  assert.equal('lineClocks' in settings({}), false, 'absent by default');
  assert.equal('lineShardBudget' in settings({}), false, 'absent by default');
  assert.equal('lineClocks' in settings({ lineClocks: {} }), false, 'an empty map is dropped');
  assert.equal('lineClocks' in settings({ lineClocks: { '3': {} } }), false);
  assert.deepEqual(
    settings({ lineClocks: { '4': { Recipe_IronRod_C: 250, [PLATE]: 150.5 }, '3': {} } })
      .lineClocks,
    { '4': { [PLATE]: 150.5, Recipe_IronRod_C: 250 } },
  );
  assert.equal(settings({ lineShardBudget: 0 }).lineShardBudget, 0);
  for (const bad of [
    [],
    { post: { [PLATE]: 200 } },
    { '3': [] },
    { '3': { Recipe_Nothing_C: 200 } },
    // A clock names the recipe, never its twin or a factory's own line of it.
    { '3': { ['amp:' + PLATE]: 200 } },
    { '3': { [PLATE]: 100 } },
    { '3': { [PLATE]: 99 } },
    { '3': { [PLATE]: 250.0001 } },
    { '3': { [PLATE]: 150.00001 } },
    { '3': { [PLATE]: '200' } },
    { '3': { [PLATE]: Infinity } },
  ])
    assert.throws(
      () => settings({ lineClocks: bad }),
      /^Error: Invalid line clocks\.$/,
      JSON.stringify(bad),
    );
  for (const bad of [-1, 1.5, '4', 100001])
    assert.throws(
      () => settings({ lineShardBudget: bad }),
      /^Error: Invalid Power Shard budget\.$/,
    );
});

test('no line clocks change nothing: the plan is byte for byte the plan without the field', () => {
  const plan = calculate(BASE),
    empty = calculate({ ...BASE, lineClocks: {} });
  assert.deepEqual({ ...empty, createdAt: '' }, { ...plan, createdAt: '' });
  assert.equal('lineClocks' in plan.settings, false);
  for (const stage of Object.values(plan.stages)) {
    assert.equal('lineClocksDropped' in stage, false);
    for (const line of stage.rows ?? []) assert.ok(!('clock' in line) && !('shards' in line));
  }
  // Clocks in another phase, or a budget alone, leave this one as it was.
  assert.deepEqual(phase({ lineClocks: { '5': { [PLATE]: 250 } } }), plain());
  assert.deepEqual(phase({ lineShardBudget: 0 }), plain());
});

test('a clocked line of whole machines runs every machine at its clock, at clock^1.321929', () => {
  const base = recipe(PLATE);
  const rate = base.outputs['Iron Plate']!;
  for (const clock of [125, 150, 200, 250]) {
    const line = row(phase({ lineClocks: { '3': { [PLATE]: clock } } }), PLATE);
    const factor = clock / 100;
    assert.equal(line.clock, clock);
    assert.equal(line.lastClock, clock, 'whole machines: the last one runs at the clock too');
    assert.equal(line.machines, line.equivalent, 'whole machines at the clock');
    assert.ok(Math.abs(line.outputs['Iron Plate']! - line.machines * rate * factor) < 1e-6);
    assert.ok(Math.abs(line.power - base.power * factor ** CLOCK_EXPONENT) < 1e-9);
    assert.ok(Math.abs(line.peakMW - line.machines * line.power) < 1e-9);
    // As few machines as make what the plain plan's line makes, give or take its rounding.
    const made = row(plain(), PLATE).outputs['Iron Plate']!;
    assert.ok(line.machines < row(plain(), PLATE).machines, `${clock}%: fewer machines`);
    assert.ok((line.machines - 1) * rate * factor < made, `${clock}%: not one machine too many`);
    assert.equal(line.shards, line.machines * Math.ceil((clock - 100) / 50));
  }
});

test('at exact clocks a clocked line underclocks its last machine, and its power follows', () => {
  const result = phase({ wholeMachines: false, lineClocks: { '3': { [PLATE]: 250 } } });
  const line = row(result, PLATE),
    base = recipe(PLATE);
  const made = line.outputs['Iron Plate']!,
    perMachine = base.outputs['Iron Plate']! * 2.5;
  assert.equal(line.machines, Math.ceil(made / perMachine - 1e-6));
  assert.ok(Math.abs(line.lastClock - (made / perMachine - line.machines + 1) * 250) < 1e-6);
  assert.ok(line.lastClock < 250, 'the last machine runs slower');
  // The real draw: every machine at 250% but the last, at its own clock.
  const draw =
    base.power * ((line.machines - 1) * 2.5 ** 1.321929 + (line.lastClock / 100) ** 1.321929);
  assert.ok(Math.abs(lineLoad(line).peak - draw) < 1e-6, 'lineLoad reads the clocked line');
  assert.ok(
    Math.abs(
      lineLoad({ ...line, clock: undefined, power: base.power, lastClock: 80 }).peak -
        base.power * (line.machines - 1 + 0.8 ** CLOCK_EXPONENT),
    ) < 1e-9,
    'a line at 100% is read as before',
  );
});

test('the exact-clock rule applies to a clocked line too (#1066, #1237)', () => {
  const clocks = { '3': { [PLATE]: 200 } };
  const whole = row(phase({ lineClocks: clocks }), PLATE);
  const exact = row(phase({ lineClocks: clocks, exactClocks: { '3': [PLATE] } }), PLATE);
  assert.equal(whole.lastClock, 200);
  assert.ok(exact.lastClock < 200, 'the line asked to run at exact clocks has its last one slower');
  assert.equal(exact.clock, 200);
  assert.ok(exact.machines <= whole.machines);
  // Every machine holds the shards for the clock, the last one's too.
  assert.equal(exact.shards, exact.machines * 2);
});

test('Power Shards: one per 50% started above 100%, on every machine of the line', () => {
  for (const [clock, each] of [
    [100.0001, 1],
    [150, 1],
    [150.0001, 2],
    [200, 2],
    [200.5, 3],
    [250, 3],
  ] as const)
    assert.equal(lineShards(clock, 4), 4 * each, `${clock}%`);
});

test('a clock needs the Power Shards research: Phase 1 only when the player can overclock', () => {
  const clocks = { '1': { [PLATE]: 200 } };
  const before = run(settings({ ...BASE, phase: '1', lineClocks: clocks }), 1);
  assert.deepEqual(solved(before).lineClocksDropped, [
    { recipe: PLATE, clock: 200, reason: 'research' },
  ]);
  const { lineClocksDropped: _dropped, ...rest } = solved(before);
  assert.deepEqual(rest, run(settings({ ...BASE, phase: '1' }), 1), 'planned exactly as without');
  const research = run(settings({ ...BASE, phase: '1', overclock: true, lineClocks: clocks }), 1);
  assert.equal(solved(research).lineClocksDropped, undefined);
  assert.equal(row(research, PLATE).clock, 200);
  // From Phase 2 the MAM is there.
  assert.equal(row(phase({ lineClocks: { '2': { [PLATE]: 200 } } }, 2), PLATE).clock, 200);
});

test('a clock on a recipe the phase cannot use is reported, the phase planned without it', () => {
  const result = phase({ lineClocks: { '3': { Recipe_Alternate_SteelRod_C: 200 } } });
  assert.deepEqual(solved(result).lineClocksDropped, [
    { recipe: 'Recipe_Alternate_SteelRod_C', clock: 200, reason: 'unavailable' },
  ]);
  const { lineClocksDropped: _dropped, ...rest } = solved(result);
  assert.deepEqual(rest, plain());
});

test('the Power Shard budget holds: a phase over it is planned without its clocks', () => {
  const clocks = { '3': { [PLATE]: 250, Recipe_IronRod_C: 150 } };
  const free = phase({ lineClocks: clocks });
  const needed = shardsOf(free);
  assert.ok(needed > 0);
  assert.deepEqual(phase({ lineClocks: clocks, lineShardBudget: needed }), free, 'at the budget');
  assert.equal(phase({ lineClocks: clocks, lineShardBudget: needed - 1 }).feasible, false);
  const plan = calculate({ ...BASE, lineClocks: clocks, lineShardBudget: needed - 1 });
  const stage = plan.stages['3'];
  assert.deepEqual(stage.lineClocksDropped, [
    { recipe: PLATE, clock: 250, reason: 'budget' },
    { recipe: 'Recipe_IronRod_C', clock: 150, reason: 'budget' },
  ]);
  const { lineClocksDropped: _dropped, ...rest } = stage;
  assert.deepEqual(rest, calculate(BASE).stages['3'], 'planned exactly as without the clocks');
});

test('minimal construction and the final-phase target keep every phase within the budget', () => {
  const clocks = { '2': { [PLATE]: 250 }, '3': { [PLATE]: 250 }, '4': { [PLATE]: 200 } };
  for (const goal of [{ goal: 'minimal' }, { goal: 'timed', hours: 4, phaseTime: 'final' }]) {
    const unbudgeted = calculate({ ...BASE, phase: '2', ...goal, lineClocks: clocks });
    const least = Math.min(
      ...Object.values(unbudgeted.stages)
        .map(stage => (stage.rows ?? []).reduce((sum, line) => sum + (line.shards ?? 0), 0))
        .filter(shards => shards > 0),
    );
    const budget = Math.max(0, least - 1);
    const plan = calculate({
      ...BASE,
      phase: '2',
      ...goal,
      lineClocks: clocks,
      lineShardBudget: budget,
    });
    for (const [key, stage] of Object.entries(plan.stages)) {
      assert.ok(stage.feasible, `Phase ${key} fits`);
      const shards = (stage.rows ?? []).reduce((sum, line) => sum + (line.shards ?? 0), 0);
      assert.ok(shards <= budget, `Phase ${key}: ${shards} Power Shards within ${budget}`);
      for (const drop of stage.lineClocksDropped ?? []) {
        assert.equal(drop.reason, 'budget');
        assert.ok(!(stage.rows ?? []).some(line => line.id === drop.recipe && line.clock));
      }
    }
    assert.ok(
      Object.values(plan.stages).some(stage => stage.lineClocksDropped?.length),
      'some phase gave its clocks up',
    );
  }
});

test('a clocked line amplified with somersloops runs its twin at the clock too', () => {
  const result = phase({
    somersloops: 40,
    amplifySloops: 20,
    sloopPins: { '3': { Recipe_IronRod_C: 4 } },
    lineClocks: { '3': { Recipe_IronRod_C: 200 } },
  });
  const twin = row(result, 'amp:Recipe_IronRod_C'),
    base = recipe('Recipe_IronRod_C');
  assert.equal(twin.clock, 200);
  assert.equal(twin.sloops, 4);
  assert.equal(twin.shards, twin.machines * 2);
  assert.ok(Math.abs(twin.power - base.power * 4 * 2 ** CLOCK_EXPONENT) < 1e-9);
  assert.ok(
    Math.abs(twin.outputs['Iron Rod']! - twin.machines * base.outputs['Iron Rod']! * 4) < 1e-6,
  );
});

test('a phase that does not fit with its clocks is planned without them (fitClocks)', () => {
  const config: CurrentSettings = settings({ ...BASE, lineClocks: { '3': { [PLATE]: 250 } } });
  const fits = plain();
  const solves: boolean[] = [];
  const without = fitClocks(config, 3, settings => {
    solves.push(!!settings.lineClocks);
    return settings.lineClocks ? { feasible: false } : fits;
  });
  assert.deepEqual(solves, [true, false], 'with the clocks, then without');
  assert.deepEqual(solved(without).lineClocksDropped, [
    { recipe: PLATE, clock: 250, reason: 'fit' },
  ]);
  // A search that only stopped keeps the clocks, and so does a phase that fits without neither.
  const stopped = { feasible: false as const, solverStatus: 'Unknown' };
  assert.equal(
    fitClocks(config, 3, () => stopped),
    stopped,
  );
  const none = { feasible: false as const };
  assert.equal(
    fitClocks(config, 3, () => none),
    none,
  );
});
