// The biomass start-up steps that are one thing in the game ("Turn leaves and wood into Biomass",
// "Unlock Obstacle Clearing, then automate Solid Biofuel" and "Unlock Coal Power before switching
// to coal") are listed once, in the first planned phase that lists them (biomassStartupTasks and
// generationTasks in public/progression.ts, #872), as each milestone (#758) and alternate unlock
// (#870) is listed once. Before, every phase from the start phase on listed them with the same
// check keys until a power unlock was ticked, so a tick made in Phase 3 made Phases 4 and 5 look
// started. The check keys are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { phaseSteps } from '../public/progression.ts';
import { initialState, planStepIds, profilePhases } from '../public/state.ts';
import { calculate } from '../planner.ts';
import type { CurrentCalculatedPlan, Progression, StageKey } from '../public/types/index.ts';

const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const ONCE = ['startup-biomass', 'startup-solid-biofuel', 'startup-coal-unlock'];
const PHASES = ['1', '2', '3', '4', '5', 'post'] as const;
const COAL_POWER = 'unlock-' + data.entries.find(entry => entry.name === 'Coal Power')!.id;

let made: CurrentCalculatedPlan | undefined;
// One solved plan for the file; a profile made for another phase is the same plan with that
// start phase, since the planner solves every phase (#759).
const planFor = (start: StageKey) => {
  const plan = structuredClone((made ??= calculate({ phase: '1' })));
  plan.settings.phase = start;
  return plan;
};
// Where each of the start-up steps is listed, by phase.
const listed = (plan: CurrentCalculatedPlan, checks: Record<string, boolean> = {}) =>
  Object.fromEntries(
    PHASES.map(phase => [
      phase,
      phaseSteps(plan, { checks }, data, phase)
        .map(step => step.id)
        .filter(id => ONCE.includes(id)),
    ]),
  );

test('a profile made for Phase 3 lists the start-up steps in Phase 3 only', () => {
  assert.deepEqual(listed(planFor('3')), {
    1: [],
    2: [],
    3: ONCE,
    4: [],
    5: [],
    post: [],
  });
});

test('a profile made for Phase 1 lists the biomass steps in Phase 1 and Coal Power in Phase 2', () => {
  assert.deepEqual(listed(planFor('1')), {
    1: ['startup-biomass', 'startup-solid-biofuel'],
    2: ['startup-coal-unlock'],
    3: [],
    4: [],
    5: [],
    post: [],
  });
});

test('a profile made for Phase 5 lists them in Phase 5 and post-game, which plans its stage', () => {
  const plan = planFor('5');
  assert.deepEqual(listed(plan)['5'], ONCE);
  assert.deepEqual(listed(plan).post, ONCE);
});

test('ticking a power unlock still takes the start-up steps away', () => {
  for (const start of ['2', '3'] as const)
    for (const ids of Object.values(listed(planFor(start), { [COAL_POWER]: true })))
      assert.deepEqual(ids, [], 'a profile made for Phase ' + start);
  // Phase 1 always lists its biomass start-up.
  assert.deepEqual(listed(planFor('1'), { [COAL_POWER]: true })['1'], [
    'startup-biomass',
    'startup-solid-biofuel',
  ]);
});

test('each phase with the start-up keeps its own burner bank step', () => {
  const plan = planFor('3');
  for (const phase of ['3', '4', '5'])
    assert.ok(
      phaseSteps(plan, { checks: {} }, data, phase).some(
        step => step.id === 'startup-burner-bank-' + phase,
      ),
      'Phase ' + phase,
    );
});

test('ticking the Phase 3 start-up does not start Phase 4 or 5 (#872)', () => {
  const plan = planFor('3');
  const state = initialState();
  state.settings.phase = '3';
  for (const id of ONCE) state.checks[id] = true;
  for (const phase of ['4', '5'] as const)
    assert.deepEqual(
      planStepIds(plan, state, data, phase).filter(id => state.checks[id]),
      [],
      'no ' + phase + ' step is ticked',
    );
  assert.equal(
    planStepIds(plan, state, data, '3').filter(id => state.checks[id]).length,
    ONCE.length,
    'the ticks count in Phase 3',
  );
  // The save list's counts, with Phase 5 worked on.
  state.settings.phase = '5';
  const phases = profilePhases(plan, state, data)!;
  assert.equal(phases.find(entry => entry.phase === '3')!.steps!.done, ONCE.length);
  for (const phase of ['4', '5'])
    assert.equal(phases.find(entry => entry.phase === phase)!.steps!.done, 0, 'Phase ' + phase);
});
