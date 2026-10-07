// The build plan's focus (#1070). A playtest found Phase 1's first production line at step 29 of
// 36, behind nine MAM research steps only later phases need; the power plant after the machines
// it powers and the power steps before their unlocks; no step to build the Space Elevator or send
// the delivery; and a hard-drive step that never closed at "0 remain". Now research only a later
// phase needs is marked optional and listed last, power comes after its unlock and before the
// lines it powers, the elevator and the delivery are steps, and the hard-drive and delivery steps
// show as done by their own condition. Only the order and the new steps change: every key the
// build plan listed before is still listed (tests/fixtures/step-ids-before-1070.json, recorded on
// main before the change), so every saved tick still marks its step, and nothing is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate } from '../planner.ts';
import { deliveryKey, phaseSteps, powerFirst } from '../public/progression.ts';
import { groupedSteps } from '../public/app/group-order.ts';
import { initialState, planStepIds, profilePhases } from '../public/state.ts';
import type {
  CalcRow,
  CurrentCalculatedPlan,
  Progression,
  StageKey,
} from '../public/types/index.ts';

const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const recorded: Record<string, Record<string, string[]>> = JSON.parse(
  fs.readFileSync(new URL('./fixtures/step-ids-before-1070.json', import.meta.url), 'utf8'),
);
const PHASES = ['1', '2', '3', '4', '5', 'post'];
// A stage's Space Elevator parts.
const parts = (plan: CurrentCalculatedPlan, stage: StageKey) => plan.stages[stage]?.delivery ?? {};
const NEW_STEP = (id: string) => id.startsWith('deliver-') || id === 'space-elevator';

let phaseOne: CurrentCalculatedPlan | undefined, alternates: CurrentCalculatedPlan | undefined;
const plans = (): Record<string, CurrentCalculatedPlan> => ({
  'phase 1': (phaseOne ??= calculate({ phase: '1' })),
  'phase 1, all alternates': (alternates ??= calculate({ phase: '1', recipes: 'all' })),
});
const ids = (plan: CurrentCalculatedPlan, phase: string, state = { checks: {} }) =>
  phaseSteps(plan, state, data, phase).map(step => step.id);

test('Phase 1 builds its production lines before research only later phases need', () => {
  const steps = phaseSteps(plans()['phase 1']!, { checks: {} }, data, '1');
  const at = (id: string) => steps.findIndex(step => step.id === id);
  // The first production line moved up from step 29 to step 23 of 44 (the new delivery and
  // elevator steps included).
  assert.equal(at('calc-1-Recipe_IngotIron_C') + 1, 23);
  const optional = steps.filter(step => step.optional);
  assert.deepEqual(
    optional.map(step => step.title),
    [
      'MAM: SAM Reanimation (optional)',
      'MAM: Caterium (optional)',
      'MAM: Caterium Ingots (optional)',
      'MAM: Compacted Coal (optional)',
      'MAM: Quartz (optional)',
      'MAM: Quartz Crystals (optional)',
      'MAM: Silica (optional)',
    ],
  );
  // They come last, after the storage and delivery steps, and say which phase needs them.
  assert.deepEqual(
    steps.slice(-optional.length).map(step => step.id),
    optional.map(step => step.id),
  );
  assert.ok(at('calc-1-storage') < at(optional[0]!.id));
  assert.match(
    optional[1]!.body,
    /^Optional in this phase: none of its lines needs it; Phase 4’s lines do\. Research it now if the materials are at hand, or later\. Follow this MAM branch/,
  );
  // The research every phase asks for stays required, before the lines.
  for (const id of ['unlock-Research_PowerSlugs_1_C', 'unlock-Research_PowerSlugs_2_C']) {
    const step = steps[at(id)]!;
    assert.equal(step.optional, undefined, id);
    assert.ok(at(id) < at('calc-1-Recipe_IngotIron_C'), id);
  }
  // A HUB milestone is never optional.
  assert.ok(steps.every(step => !step.optional || step.id.startsWith('unlock-Research_')));
});

test('research the phase’s own lines need is required there, not optional', () => {
  // All alternates: Phase 2's lines use Quickwire, so its Caterium research is required there.
  const steps = phaseSteps(plans()['phase 1, all alternates']!, { checks: {} }, data, '2');
  const caterium = steps.filter(step => /^MAM: (Caterium|Quickwire)/.test(step.title));
  const rows = steps.filter(step => step.row);
  assert.ok(caterium.length > 0);
  for (const step of caterium) assert.equal(step.optional, undefined, step.title);
  const firstRow = steps.indexOf(rows[0]!);
  for (const step of caterium) assert.ok(steps.indexOf(step) < firstRow, step.title);
});

test('the power plant comes after its unlock and before the lines it powers', () => {
  const plan = plans()['phase 1']!;
  // Phase 1: HUB Upgrade 6 straight after the HUB tutorial, before the biomass steps ask for it.
  const one = ids(plan, '1');
  assert.deepEqual(one.slice(0, 4), [
    'early-base-hub',
    'unlock-Schematic_Tutorial5_C',
    'startup-1-power-review',
    'startup-biomass',
  ]);
  assert.ok(one.indexOf('unlock-Schematic_2-2_C') < one.indexOf('startup-solid-biofuel'));
  // Phase 2: the coal unlock step after the Coal Power milestone, the coal generators first.
  const two = phaseSteps(plan, { checks: {} }, data, '2');
  const twoIds = two.map(step => step.id);
  assert.ok(twoIds.indexOf('unlock-Schematic_3-1_C') < twoIds.indexOf('startup-coal-unlock'));
  assert.equal(two.find(step => step.row)!.id, 'calc-2-power-coal');
  // Phase 3: the fuel power step after Petroleum Power, the Fuel Generators straight after the
  // last line making their fuel and before the rest.
  const three = phaseSteps(plan, { checks: {} }, data, '3');
  const threeIds = three.map(step => step.id);
  assert.ok(threeIds.indexOf('unlock-Schematic_5-5_C') < threeIds.indexOf('startup-fuel-3'));
  const fuel = threeIds.indexOf('calc-3-power-fuel');
  assert.equal(threeIds[fuel - 1], 'calc-3-Recipe_ResidualFuel_C');
  const makers = three.filter(step => step.row?.outputs.Fuel).map(step => step.id);
  assert.ok(makers.every(id => threeIds.indexOf(id) < fuel));
  assert.ok(threeIds.indexOf('calc-3-Recipe_Computer_C') > fuel);
});

test('powerFirst moves only the generators, keeps their order and changes nothing twice', () => {
  const row = (id: string, inputs: string[], outputs: string[], generationMW = 0) =>
    ({
      id,
      inputs: Object.fromEntries(inputs.map(item => [item, 1])),
      outputs: Object.fromEntries(outputs.map(item => [item, 1])),
      generationMW,
    }) as Pick<CalcRow, 'id' | 'inputs' | 'outputs' | 'generationMW'>;
  const rows = [
    row('plate', ['Iron Ingot'], ['Iron Plate']),
    row('fuel', ['Crude Oil'], ['Fuel']),
    row('screw', ['Iron Rod'], ['Screw']),
    row('coal-power', ['Coal', 'Water'], [], 75),
    row('fuel-power', ['Fuel'], [], 250),
  ];
  const once = powerFirst(rows);
  assert.deepEqual(
    once.map(r => r.id),
    ['coal-power', 'plate', 'fuel', 'fuel-power', 'screw'],
  );
  assert.deepEqual(powerFirst(once), once);
  // A factory's order (groupedSteps) puts a generator listed in the last factory first too.
  const steps = rows.map(r => ({ id: r.id, row: r as CalcRow }));
  const groups = {
    groups: [
      { id: 'fg-a', name: 'A' },
      { id: 'fg-power', name: 'Power' },
    ],
    assignments: {
      plate: [{ group: 'fg-a', rate: null }],
      screw: [{ group: 'fg-a', rate: null }],
      fuel: [{ group: 'fg-power', rate: null }],
      'coal-power': [{ group: 'fg-power', rate: null }],
      'fuel-power': [{ group: 'fg-power', rate: null }],
    },
  };
  assert.equal(groupedSteps(steps, groups)[0]!.id, 'coal-power');
});

test('every step key listed before is still listed, so saved ticks mark the same steps', () => {
  for (const [label, plan] of Object.entries(plans()))
    for (const phase of PHASES) {
      const before = recorded[label]![phase]!;
      const now = ids(plan, phase);
      assert.deepEqual(
        now.filter(id => !NEW_STEP(id)).sort(),
        [...before].sort(),
        `${label}, Phase ${phase}`,
      );
      // Progress that ticked every step before: only the new steps are open now, apart from
      // the ones done by their own condition. The ticks are read, never changed.
      const checks = Object.fromEntries(before.map(id => [id, true]));
      const frozen = JSON.stringify(checks);
      const open = phaseSteps(plan, { checks }, data, phase).filter(
        step => !checks[step.id] && !step.satisfied,
      );
      assert.ok(
        open.every(step => NEW_STEP(step.id)),
        `${label}, Phase ${phase}`,
      );
      assert.equal(JSON.stringify(checks), frozen);
    }
  // A tick on research now marked optional still marks it.
  const plan = plans()['phase 1']!;
  const caterium = phaseSteps(
    plan,
    { checks: { 'unlock-Research_Caterium_0_C': true } },
    data,
    '1',
  ).find(step => step.id === 'unlock-Research_Caterium_0_C')!;
  assert.equal(caterium.title, 'MAM: Caterium (optional)');
});

test('the hard-drive step is done once every recipe it lists is unlocked, with no tick', () => {
  const plan = plans()['phase 1, all alternates']!;
  const hunt = (checks: Record<string, boolean>) =>
    phaseSteps(plan, { checks }, data, '1').find(step => step.id === 'hard-drives-1')!;
  const recipes = ids(plan, '1').filter(id => id.startsWith('recipe-unlock-'));
  assert.ok(recipes.length > 1);
  assert.equal(hunt({}).satisfied, undefined);
  const all = Object.fromEntries(recipes.map(id => [id, true]));
  assert.equal(hunt({ ...all, [recipes[0]!]: false }).satisfied, undefined);
  const done = hunt(all);
  assert.equal(done.satisfied, 'Done: every recipe it lists is unlocked.');
  assert.match(done.body, /^0 selected recipe unlocks remain unconfirmed/);
  assert.equal(all['hard-drives-1'], undefined, 'no tick written');
});

test('the Space Elevator and delivery steps; the delivery is done once every counter is full', () => {
  const plan = plans()['phase 1']!;
  const one = phaseSteps(plan, { checks: {} }, data, '1');
  const elevator = one.find(step => step.id === 'space-elevator')!;
  assert.equal(elevator.title, 'Build the Space Elevator');
  // Before the production lines that feed it; the delivery after the storage step.
  const at = (id: string) => one.findIndex(step => step.id === id);
  assert.ok(at('space-elevator') < at('calc-1-Recipe_IngotIron_C'));
  assert.equal(at('deliver-1'), at('calc-1-storage') + 1);
  const deliver = (deliveries: Record<string, number>, phase = '1') =>
    phaseSteps(plan, { checks: {}, deliveries }, data, phase).find(step =>
      step.id.startsWith('deliver-'),
    );
  const target = parts(plan, '1')['Smart Plating']!.target;
  const step = deliver({})!;
  assert.equal(step.title, 'Send the Phase 1 delivery');
  assert.match(step.body, new RegExp(`^Load the Space Elevator with ${target} Smart Plating`));
  assert.equal(step.satisfied, undefined);
  const key = deliveryKey('1', 'Smart Plating');
  assert.equal(key, '1-smart-plating');
  assert.equal(deliver({ [key]: target - 1 })!.satisfied, undefined);
  assert.equal(
    deliver({ [key]: target })!.satisfied,
    'Done: every delivery counter is at its target.',
  );
  // Every planned phase hands its parts in; all of them must be counted.
  const three = parts(plan, '3');
  const full = Object.fromEntries(
    Object.entries(three).map(([item, part]) => [deliveryKey('3', item), part.target]),
  );
  assert.ok(deliver(full, '3')!.satisfied);
  const [first] = Object.keys(full);
  assert.equal(deliver({ ...full, [first!]: 0 }, '3')!.satisfied, undefined);
  // Post Phase 5 hands nothing in; only Phase 1 builds the elevator.
  assert.equal(deliver({}, 'post'), undefined);
  for (const phase of ['2', '3', '4', '5', 'post'])
    assert.ok(!ids(plan, phase).includes('space-elevator'), phase);
  // A profile made for a later phase has delivered Phase 1: its elevator stands.
  const later = calculate({ phase: '3' });
  for (const phase of PHASES) assert.ok(!ids(later, phase).includes('space-elevator'), phase);
});

test('the save list counts a step done by its own condition as done (both editions)', () => {
  const plan = plans()['phase 1']!;
  const target = parts(plan, '1')['Smart Plating']!.target;
  const state = { ...initialState(), settings: { phase: '1' } };
  const counted = (deliveries: Record<string, number>) =>
    profilePhases(plan, { ...state, deliveries }, data)!.find(entry => entry.phase === '1')!.steps!;
  const stepIds = planStepIds(plan, state, data, '1' as StageKey);
  assert.ok(stepIds.includes('deliver-1'));
  assert.deepEqual(counted({}), { done: 0, total: stepIds.length });
  assert.deepEqual(counted({ '1-smart-plating': target }), { done: 1, total: stepIds.length });
});

// A profile saved before #1070 has no tick for the new elevator and delivery steps. Working in a
// later phase proves phase N's delivery was sent and the elevator stands, so they count as done
// by their own condition: its finished phases stay finished and it opens where it did.
test('a profile saved before these steps, working in Phase 4, keeps Phases 1-3 finished', () => {
  const plan = plans()['phase 1']!;
  const checks = Object.fromEntries(
    ['1', '2', '3'].flatMap(phase => recorded['phase 1']![phase]!).map(id => [id, true]),
  );
  const state = { ...initialState(), checks, settings: { phase: '4' } };
  const phases = profilePhases(plan, state, data)!;
  for (const phase of ['1', '2', '3']) {
    const steps = phases.find(entry => entry.phase === phase)!.steps!;
    assert.equal(steps.done, steps.total, 'Phase ' + phase);
  }
  const step = (phase: string, id: string, working: string) =>
    phaseSteps(plan, { checks: {}, settings: { phase: working } }, data, phase).find(
      found => found.id === id,
    )!;
  const LATER = 'Done: you are working in a later phase.';
  for (const id of ['space-elevator', 'deliver-1'])
    assert.equal(step('1', id, '4').satisfied, LATER);
  assert.equal(step('3', 'deliver-3', '4').satisfied, LATER);
  // The phase worked on and later ones still wait for their delivery; Post Phase 5 is after 5.
  assert.equal(step('4', 'deliver-4', '4').satisfied, undefined);
  assert.equal(step('1', 'space-elevator', '1').satisfied, undefined);
  assert.equal(step('5', 'deliver-5', '5').satisfied, undefined);
  assert.equal(step('5', 'deliver-5', 'post').satisfied, LATER);
  // Full counters keep their own reason.
  const target = parts(plan, '1')['Smart Plating']!.target;
  const counted = phaseSteps(
    plan,
    { checks: {}, deliveries: { '1-smart-plating': target }, settings: { phase: '4' } },
    data,
    '1',
  ).find(found => found.id === 'deliver-1')!;
  assert.equal(counted.satisfied, 'Done: every delivery counter is at its target.');
});
