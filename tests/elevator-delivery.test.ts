// All of a Space Elevator part's output goes to the elevator (#1062). Whole machines round a
// part's line up past the rate the goal asks for; that excess used to go to the sink, and every
// delivery time was worked out from the smaller rate. Phase 3 built 10 Versatile Framework/min,
// delivered 5.3 and sank 4.7, so it said 7 h 52 min where the lines finish in 4 h 10 min. Now a
// part's delivery rate is everything its lines make beyond their other uses, the stage's hours
// follow from it, and no part the elevator still needs goes to the sink.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, DELIVERIES } from '../planner.ts';
import type { CurrentStage, StageKey } from '../public/types/index.ts';

const STAGES: StageKey[] = ['1', '2', '3', '4', '5'];
const near = (actual: number, expected: number, message: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} is not ${expected}`);

// What the stage's lines make of `item`, and what they use of it, per minute.
function itemTotals(stage: CurrentStage, item: string) {
  let made = 0,
    used = 0;
  for (const row of stage.rows || []) {
    made += row.outputs[item] || 0;
    used += row.inputs[item] || 0;
  }
  return { made, used };
}

test('Phases 1 and 3 with whole machines deliver all their lines make (#1062)', () => {
  const plan = calculate({ wholeMachines: true });
  const one = plan.stages['1'],
    three = plan.stages['3'];
  // Phase 1: one Assembler makes 2 Smart Plating/min, not the balanced goal's 0.2/min: 50 parts
  // take 25 minutes, not 4 h 10 min.
  near(itemTotals(one, 'Smart Plating').made, 2, 'Phase 1 makes 2 Smart Plating/min');
  near(one.delivery!['Smart Plating']!.rate, 2, 'Phase 1 delivers all of it');
  assert.equal(one.surplus!['Smart Plating'], undefined, 'no Smart Plating goes to the sink');
  near(one.hours!, 50 / 2 / 60, 'Phase 1 takes 25 minutes');
  // Phase 3: two Assemblers make 10 Versatile Framework/min; 2,500 take 4 h 10 min, as do 500
  // Modular Engines at 2/min, and the 100 Adaptive Control Units at 1/min take 1 h 40 min.
  const expected: Record<string, number> = {
    'Versatile Framework': 10,
    'Modular Engine': 2,
    'Adaptive Control Unit': 1,
  };
  for (const [item, rate] of Object.entries(expected)) {
    near(itemTotals(three, item).made, rate, `Phase 3 makes ${rate} ${item}/min`);
    near(three.delivery![item]!.rate, rate, `Phase 3 delivers all its ${item}`);
    assert.equal(three.surplus![item], undefined, `no ${item} goes to the sink`);
  }
  near(three.hours!, 2500 / 10 / 60, 'Phase 3 takes 4 h 10 min');
});

test('a plan without whole machines keeps the rates its goal asked for', () => {
  // The exact plan makes what the goal asks: 2,500 over 8 hours rounds to 5.3/min.
  const three = calculate({}).stages['3'];
  assert.equal(three.delivery!['Versatile Framework']!.rate, 5.3);
  assert.equal(three.delivery!['Modular Engine']!.rate, 1.1);
  near(three.hours!, 2500 / 5.3 / 60, 'Phase 3 takes 7 h 52 min');
});

// Every plan below rounds or amplifies lines. In each phase, no elevator part goes to the sink,
// each part's delivery is all its balance has left (what the lines make and the plan draws of
// existing supply, less what the lines use, protected storage and fuel take), and the phase
// takes as long as its slowest part at that rate.
const PROFILES: [string, object][] = [
  ['balanced, standard recipes', { wholeMachines: true }],
  ['minimal goal, all recipes', { wholeMachines: true, goal: 'minimal', recipes: 'all' }],
  [
    'timed 12 hours, unrounded rates',
    { wholeMachines: true, goal: 'timed', hours: 12, roundRates: false },
  ],
  ['maximum output', { wholeMachines: true, goal: 'maximum', limitsConfirmed: true }],
  ['double cost, from Phase 3', { wholeMachines: true, phase: '3', multiplier: 2 }],
  ['existing Smart Plating', { wholeMachines: true, existingSupply: { 'Smart Plating': 1.5 } }],
  ['amplified, from Phase 4', { phase: '4', amplifySloops: 40, recipes: 'all' }],
];
for (const [name, settings] of PROFILES)
  test(`no elevator part goes to the sink while the elevator needs it: ${name}`, () => {
    const plan = calculate(settings);
    for (const key of STAGES) {
      const stage = plan.stages[key];
      if (!stage.feasible || !stage.delivery) continue;
      let slowest = 0;
      for (const item of Object.keys(DELIVERIES[Number(key)]!)) {
        const part = stage.delivery[item]!;
        assert.equal(stage.surplus?.[item], undefined, `Phase ${key}: no ${item} to the sink`);
        const { made, used } = itemTotals(stage, item);
        const left =
          made +
          (stage.supplied?.[item] || 0) -
          used -
          (stage.storage?.[item] || 0) -
          (stage.drone?.[item] || 0) -
          (stage.transport?.[item] || 0);
        assert.ok(
          Math.abs(part.rate - left) < 0.003,
          `Phase ${key}: ${item} delivers ${part.rate}/min of the ${left}/min left`,
        );
        slowest = Math.max(slowest, part.target / part.rate / 60);
      }
      near(stage.hours!, slowest, `Phase ${key} takes as long as its slowest part`);
    }
  });
