// "Everything before Phase N is done" (#1068). A profile made for a later phase lists the
// milestones of the phases before its start phase as milestone-only phases (#759), 16 and more
// open steps for a mid-game start. stepsBeforeStart names them, the wizard sends them as the new
// profile's finished work (newProfileState's `built` keys) and the build plan ticks the open ones
// with one `checks` update. Nothing new is stored: they are the `unlock-<id>` ticks every release
// reads, so no state version changes, and a tick is only ever added, never removed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate } from '../planner.ts';
import { adaRemarks } from '../public/ada.ts';
import {
  earlierPhasesWords,
  milestoneOnlyPhases,
  phaseSteps,
  stepsBeforeStart,
} from '../public/progression.ts';
import { mutate, newProfileState, validateState } from '../public/state.ts';
import { states } from './types/fixtures.ts';
import type { Progression, SavedState, StoredCalculatedPlan } from '../public/types/index.ts';

const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const phaseThree = calculate({ phase: '3' });
const listedBefore = (plan: StoredCalculatedPlan, start: number) =>
  (['1', '2', '3', '4'] as const)
    .filter(phase => Number(phase) < start)
    .flatMap(phase => phaseSteps(plan, { checks: {} }, data, phase).map(step => step.id));

test('stepsBeforeStart names every step the milestone-only phases list, all unlock steps', () => {
  const keys = stepsBeforeStart(phaseThree, { checks: {} }, data);
  assert.ok(keys.length >= 16, `a Phase 3 start lists ${keys.length} earlier steps`);
  assert.deepEqual(keys, [...new Set(listedBefore(phaseThree, 3))]);
  assert.ok(
    keys.every(key => key.startsWith('unlock-')),
    'only milestone and MAM steps',
  );
  assert.equal(earlierPhasesWords(milestoneOnlyPhases(phaseThree)), 'Phases 1 and 2');
  assert.equal(earlierPhasesWords(['1']), 'Phase 1');
  assert.equal(earlierPhasesWords(['1', '2', '3']), 'Phases 1, 2 and 3');
  assert.deepEqual(stepsBeforeStart(calculate({ phase: '1' }), { checks: {} }, data), []);
  // A plan with a guide (a migrated handbook) has no milestone-only phases.
  const guided = { ...phaseThree, guide: { phases: {} } } as StoredCalculatedPlan;
  assert.deepEqual(stepsBeforeStart(guided, { checks: {} }, data), []);
});

test('a new profile told everything before its phase is done starts with those steps ticked', () => {
  const keys = stepsBeforeStart(phaseThree, { checks: {} }, data);
  const { state, carried } = newProfileState(phaseThree, null, null, undefined, keys);
  for (const key of keys) assert.equal(state.checks[key], true, key);
  assert.equal(carried, keys.length);
  for (const phase of ['1', '2'])
    assert.ok(
      phaseSteps(phaseThree, state, data, phase).every(step => state.checks[step.id]),
      `Phase ${phase} has no open step`,
    );
  assert.ok(
    phaseSteps(phaseThree, state, data, '3').some(step => !state.checks[step.id]),
    'the start phase is untouched',
  );
  // Nothing new is stored: the blank state's version, as without the answer.
  assert.equal(state.version, newProfileState(phaseThree, null, null, undefined, []).state.version);
});

test('records carried from another profile win, an untick included, and no tick is lost', () => {
  const keys = stepsBeforeStart(phaseThree, { checks: {} }, data);
  const [unticked, ticked] = keys as [string, string];
  const source = validateState({
    version: 1,
    settings: { phase: '3' },
    checks: { [unticked]: false, [ticked]: true, 'calc-3-storage': true, 'early-base-hub': true },
    notes: {},
    deliveries: {},
    customTasks: [],
  });
  const { state } = newProfileState(phaseThree, source, phaseThree, undefined, keys);
  assert.equal(state.checks[unticked], false, 'the source left it unticked on purpose');
  assert.equal(state.checks[ticked], true);
  assert.equal(state.checks['early-base-hub'], true, 'a carried tick stays');
  for (const key of keys.slice(2)) assert.equal(state.checks[key], true, key);
  // The source is only read.
  assert.equal(source.checks[unticked], false);
});

test('marking the earlier phases done later only adds ticks, in every released state version', () => {
  const keys = stepsBeforeStart(phaseThree, { checks: {} }, data);
  for (const [fixture, version] of states) {
    const before = validateState(structuredClone(fixture));
    // The build plan sends only the open steps (MilestoneOnlyNotice.vue).
    const open = keys.filter(key => !before.checks[key]);
    const after = mutate(structuredClone(fixture) as SavedState, {
      type: 'checks',
      keys: open,
      value: true,
    });
    assert.equal(after.version, version, `version ${version} stays version ${version}`);
    for (const [key, value] of Object.entries(before.checks))
      if (value) assert.equal(after.checks[key], true, `version ${version} keeps ${key}`);
      else if (!keys.includes(key)) assert.equal(after.checks[key], value, key);
    for (const key of keys) assert.equal(after.checks[key], true, key);
    assert.deepEqual(after.notes, before.notes);
    assert.deepEqual(after.deliveries, before.deliveries);
    assert.deepEqual(after.customTasks, before.customTasks);
    assert.deepEqual(after.taskEdits, before.taskEdits);
    assert.deepEqual(after.factoryGroups, before.factoryGroups);
  }
});

test('a stored plan names its earlier steps as it is, without a recalculation', () => {
  const saved = JSON.parse(
    fs.readFileSync(new URL('./fixtures/calculated-plan-2026-09-12.json', import.meta.url), 'utf8'),
  ) as StoredCalculatedPlan;
  const copy = structuredClone(saved);
  const keys = stepsBeforeStart(saved, { checks: {} }, data);
  assert.equal(saved.settings.phase, '3');
  assert.ok(keys.length >= 16, `the stored Phase 3 plan lists ${keys.length} earlier steps`);
  assert.deepEqual(keys, [...new Set(listedBefore(saved, 3))]);
  assert.deepEqual(saved, copy, 'the stored plan is only read');
  const { state } = newProfileState(saved, null, null, undefined, keys);
  for (const key of keys) assert.equal(state.checks[key], true, key);
});

test('ADA says the earlier steps start ticked, and that unticking brings one back', () => {
  const remark = adaRemarks({ view: 'wizard', earlierDone: 'Phase 3' }).find(
    line => line.id === 'earlier-done',
  );
  assert.ok(remark);
  assert.match(remark.text, /Everything before Phase 3 is recorded as done/);
  assert.match(remark.text, /untick one/);
  assert.ok(!adaRemarks({ view: 'wizard', earlierDone: '' }).some(r => r.id === 'earlier-done'));
  assert.ok(!adaRemarks({ view: 'wizard' }).some(r => r.id === 'earlier-done'));
});
