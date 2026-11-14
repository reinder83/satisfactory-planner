// What a restored progress backup changed (X-6, #1352, public/app/restore-changes.ts): worked out
// from the progress before and after against the profile's stored plan, so the same words come
// out in both editions and nothing is stored. The plan is the frozen first-release one the
// saveExport fixture carries.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  restoreAdaWords,
  restoreChangeLines,
  restoreChanges,
  restoreUnchanged,
  restoreWentBack,
} from '../public/app/restore-changes.ts';
import { deliveryKey } from '../public/progression.ts';
import { saveExport, version21 } from './types/fixtures.ts';
import type {
  Progression,
  SavedState,
  StageKey,
  StoredCalculatedPlan,
} from '../public/types/index.ts';

const progression: Progression = JSON.parse(
  readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const plan = saveExport.saves[0]!.profiles[0]!.plan as StoredCalculatedPlan;
const phaseLabel = (phase: string) => 'Phase ' + phase;
const context = { plan, progression };

// The first phase of the plan with at least three lines and a delivery.
const phase = (Object.keys(plan.stages) as StageKey[]).find(key => {
  const stage = plan.stages[key];
  return (stage?.rows?.length ?? 0) >= 3 && Object.keys(stage?.delivery ?? {}).length > 0;
})!;
const rows = plan.stages[phase]!.rows!;
const part = Object.keys(plan.stages[phase]!.delivery!)[0]!;
const target = plan.stages[phase]!.delivery![part]!.target;
const running = (...ids: string[]): Record<string, boolean> =>
  Object.fromEntries(ids.map(id => [`calc-${phase}-${id}`, true]));
const base = (): SavedState => ({
  ...structuredClone(version21),
  checks: {},
  deliveries: {},
  notes: {},
  tickedBy: {},
  settings: { phase },
});

test('lines now running and parts delivered are counted from before and after', () => {
  const before = {
    ...base(),
    checks: running(rows[0]!.id),
    deliveries: { [deliveryKey(phase, part)]: 4200 },
  };
  const after = {
    ...base(),
    checks: running(rows[0]!.id, rows[1]!.id, rows[2]!.id),
    deliveries: { [deliveryKey(phase, part)]: 9800 },
  };
  const changes = restoreChanges(before, after, context);
  assert.equal(changes.started, 2);
  assert.equal(changes.stopped, 0);
  assert.equal(changes.running, 3);
  assert.ok(changes.lines >= 3);
  assert.deepEqual(changes.deliveries, [{ part, phase, from: 4200, to: 9800, target }]);
  assert.equal(restoreWentBack(changes), false);
  const lines = restoreChangeLines(changes, phaseLabel);
  assert.match(lines[0]!, /^2 lines now running \(3 of \d+ in the plan\)$/);
  assert.equal(lines.length, 2, 'the running boxes are not counted again as ticks');
  assert.equal(
    lines[1],
    `${part}, Phase ${phase}: 4,200 → 9,800 of ${target.toLocaleString('en-US')} delivered`,
  );
  assert.match(restoreAdaWords(changes), /^2 lines now running\. .* went from 4,200 to 9,800\./);
  assert.match(restoreAdaWords(changes), /I will allow it\.$/);
});

test('a restore that takes something back says so, and ADA only reports it', () => {
  const before = { ...base(), checks: running(rows[0]!.id, rows[1]!.id) };
  const after = { ...base(), checks: running(rows[0]!.id) };
  const changes = restoreChanges(before, after, context);
  assert.equal(changes.stopped, 1);
  assert.ok(restoreWentBack(changes));
  assert.match(restoreChangeLines(changes, phaseLabel)[0]!, /^1 line no longer marked running$/);
  assert.match(restoreAdaWords(changes), /1 line no longer marked running\. .*backwards/);
  assert.doesNotMatch(restoreAdaWords(changes), /allow/);
});

test('the phase, notes and ticks outside the plan are listed; an identical restore is restoreUnchanged', () => {
  const same = restoreChanges(base(), base(), context);
  assert.ok(restoreUnchanged(same));
  assert.deepEqual(restoreChangeLines(same, phaseLabel), []);
  assert.match(restoreAdaWords(same), /^The backup matched this profile, so nothing changed\./);

  const other: SavedState = {
    ...base(),
    settings: { phase: '5' },
    notes: { global: 'new' },
    checks: { 'storage-x': true },
  };
  const changes = restoreChanges(base(), other, context);
  assert.ok(!restoreUnchanged(changes));
  assert.deepEqual(changes.phase, { before: phase, after: '5' });
  assert.equal(changes.notes, 1);
  const lines = restoreChangeLines(changes, phaseLabel);
  assert.ok(lines.includes('1 note now read differently'));
  assert.ok(lines.includes(`Works on Phase 5, was Phase ${phase}`));
  assert.ok(lines.some(line => /^(Steps done|Other ticks): /.test(line)));
});

test('an empty note and an unset one are the same, and a profile without a plan counts ticks', () => {
  const emptied = { ...base(), notes: { global: '' } };
  assert.ok(restoreUnchanged(restoreChanges(base(), emptied, context)));
  const changes = restoreChanges(
    { ...base(), checks: { a: true } },
    { ...base(), checks: { a: true, b: true, c: true } },
    { plan: null, progression },
  );
  assert.equal(changes.lines, 0);
  assert.equal(changes.steps, null);
  assert.deepEqual(restoreChangeLines(changes, phaseLabel), ['Other ticks: 1 → 3']);
});

test('ticks that move without changing the count are still a change', () => {
  const changes = restoreChanges(
    { ...base(), checks: { 'storage-a': true } },
    { ...base(), checks: { 'storage-b': true } },
    context,
  );
  assert.ok(!restoreUnchanged(changes));
  assert.deepEqual(restoreChangeLines(changes, phaseLabel), ['2 other ticks changed']);
});
