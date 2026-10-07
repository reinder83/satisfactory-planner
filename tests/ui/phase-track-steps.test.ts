// The top bar's phase track (SP-44, views/phase-track.ts) fills a calculated profile's segments
// with the phase's build-plan steps ticked (#770), the steps its build plan counts
// (ui/plan/PlanProgress.vue) and the profile opens on (phaseToOpen, #570): not only its production
// lines, so a phase whose lines are all Running but whose other steps are open does not read
// "100% done". A phase with an open step reads at most 99%, as the profile card (#746).
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { phaseStepIds, phaseToOpen } from '../../public/app/opening-phase.ts';
import { render } from '../../public/app/shell.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { phaseTrack } from '../../public/app/views/phase-track.ts';
import { $, generated, generatedWith, handbook, open, page } from './setup.ts';
import type { CurrentCalculatedPlan, StageKey } from '../../public/types/index.ts';

// A calculated profile that starts in Phase 1, made once for the file.
let startsInOne: CurrentCalculatedPlan | undefined;
const phaseOnePlan = () => structuredClone((startsInOne ??= generatedWith({ phase: '1' })));

beforeEach(() => page());

const ticked = (ids: string[]) => Object.fromEntries(ids.map(id => [id, true]));
const segment = (phaseKey: string) => phaseTrack().find(entry => entry.phase === phaseKey)!;
// The segment's accessible name: its label and the visually hidden share.
const segmentName = (phaseKey: string) =>
  $(`[data-phase-seg="${phaseKey}"]`)!.textContent!.replace(/\s+/g, ' ').trim();

test('a phase with every production line Running but other steps open is not 100% done (#770)', () => {
  const plan = phaseOnePlan();
  // The issue's reproduction: every Phase 1 production line ticked, Phase 3 picked.
  const lines = (plan.stages['1']?.rows ?? []).map(row => 'calc-1-' + row.id);
  assert.ok(lines.length, 'Phase 1 plans production lines');
  open({ calculated: plan, phase: '3', state: { checks: ticked(lines) } });
  const steps = phaseStepIds('1');
  assert.ok(steps.length > lines.length, 'Phase 1 has steps besides its lines');
  // The lines, and the elevator and delivery, done since Phase 3 is worked on (#1070).
  const percent = Math.round(((lines.length + 2) / steps.length) * 100);
  assert.ok(percent < 100);
  assert.equal(segment('1').pct, percent, 'Phase 1 counts its build-plan steps');
  assert.equal(phaseToOpen(), '1', 'the profile opens on Phase 1, which the track shows open');
  render();
  assert.equal(segmentName('1'), `Phase 1, ${percent}% done`);
  // Phase 2's only done step is its delivery, done since Phase 3 is worked on (#1070).
  const two = Math.round((1 / phaseStepIds('2').length) * 100);
  assert.equal(segmentName('2'), `Phase 2, ${two}% done`);
  assert.equal(segmentName('post'), 'Post Phase 5', 'post-game has no progress');
  assert.equal(segment('post').pct, null);
});

test('the track counts the steps the build plan counts, edits and personal tasks included', () => {
  const plan = phaseOnePlan();
  // Enough personal tasks that one open step among them would round to 100%.
  const many = Array.from({ length: 300 }, (_, i) => ({
    id: 'custom-' + i,
    phase: '2' as StageKey,
    title: 'Task ' + i,
  }));
  const edits = {
    customTasks: [...many, { id: 'custom-mine', phase: '2' as StageKey, title: 'Mine' }],
    taskEdits: { order: {}, removed: ['calc-2-storage'], titles: {}, bodies: {}, links: {} },
  };
  open({ calculated: plan, phase: '2', state: structuredClone(edits) });
  const shown = planTasks().map(task => task.id);
  assert.ok(shown.includes('custom-mine') && !shown.includes('calc-2-storage'));
  // Every step the build plan shows ticked but the personal task, plus the removed step.
  const checks = ticked([...shown.filter(id => id !== 'custom-mine'), 'calc-2-storage']);
  open({ calculated: plan, phase: '4', state: { ...structuredClone(edits), checks } });
  assert.equal(segment('2').pct, 99, 'one open step of many reads 99%, not a rounded 100%');
  open({
    calculated: plan,
    phase: '4',
    state: { ...structuredClone(edits), checks: { ...checks, 'custom-mine': true } },
  });
  assert.equal(segment('2').pct, 100, 'every step ticked reads 100%');
  render();
  assert.equal(segmentName('2'), 'Phase 2, 100% done');
});

test('milestone-only phases before the start phase count their milestones', () => {
  const plan = generated();
  assert.equal(plan.settings.phase, '3');
  open({ calculated: plan, phase: '3' });
  const one = phaseStepIds('1'),
    two = phaseStepIds('2');
  open({ calculated: plan, phase: '3', state: { checks: ticked([...one, ...two.slice(1)]) } });
  assert.equal(segment('1').pct, 100, 'every Phase 1 milestone ticked');
  assert.equal(
    segment('2').pct,
    Math.min(99, Math.round(((two.length - 1) / two.length) * 100)),
    'Phase 2 has one open milestone',
  );
  assert.equal(segment('3').pct, 0);
});

test('the handbook still counts its phase steps', () => {
  const phase4 = handbook.phases['4']!;
  open({ phase: '4', state: { checks: ticked(phase4.map(step => step.id)) } });
  assert.equal(segment('4').pct, 100);
  assert.equal(segment('3').pct, 0);
  assert.equal(segment('post').pct, null);
});

test('alternate unlocks ticked while on Phase 3 do not start Phase 4 on the track (#870)', () => {
  const plan = generatedWith({ phase: '3', recipes: 'all' });
  open({ calculated: plan, phase: '3' });
  const unlocks = phaseStepIds('3').filter(id => id.startsWith('recipe-unlock-'));
  const reused = (plan.stages['4']?.rows ?? []).filter(
    row => row.alternate && unlocks.includes('recipe-unlock-' + row.id),
  );
  assert.ok(reused.length, 'Phase 4 uses an alternate Phase 3 lists');
  open({ calculated: plan, phase: '3', state: { checks: ticked(unlocks) } });
  assert.ok(segment('3').pct! > 0, 'the ticks count in Phase 3');
  assert.equal(segment('4').pct, 0, 'Phase 4 has not started');
  assert.ok(!phaseStepIds('4').some(id => unlocks.includes(id)), 'listed once, in Phase 3');
});

test('the biomass start-up ticked while on Phase 3 does not start Phase 4 on the track (#872)', () => {
  const plan = generated();
  plan.settings.phase = '3';
  const startup = ['startup-biomass', 'startup-solid-biofuel', 'startup-coal-unlock'];
  open({ calculated: plan, phase: '3' });
  assert.deepEqual(
    phaseStepIds('3').filter(id => startup.includes(id)),
    startup,
    'Phase 3 lists the start-up',
  );
  open({ calculated: plan, phase: '3', state: { checks: ticked(startup) } });
  assert.ok(segment('3').pct! > 0, 'the ticks count in Phase 3');
  for (const phase of ['4', '5'] as const) {
    assert.equal(segment(phase).pct, 0, 'Phase ' + phase + ' has not started');
    assert.ok(!phaseStepIds(phase).some(id => startup.includes(id)), 'listed once, in Phase 3');
  }
});
