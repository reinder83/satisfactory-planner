// A step missing from a phase's saved step order (new in a later release, or moved in from
// another phase as #773 moved milestones) is placed beside its generated neighbours rather than
// after every ordered step (#779): withNewSteps and planTasks in public/app/tasks.ts.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setHideDone, setQuery, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { generatedTasks, planTasks, withNewSteps } from '../../public/app/tasks.ts';
import { $, $$, generated, go, open, page, stubFetch } from './setup.ts';
import type { TaskEdits } from '../../public/types/index.ts';

// The handbook's Phase 3 steps in their generated order.
const [survey, retire, iron, construction, steel, oil, mechanical, project, delivery] = [
  'phase-3-survey',
  'phase-3-retire-power',
  'phase-3-iron',
  'phase-3-construction',
  'phase-3-steel',
  'phase-3-oil',
  'phase-3-mechanical',
  'phase-3-project',
  'phase-3-delivery',
];

const ids = () => planTasks().map(t => t.id);
const shown = () => $$('#main .checklist [data-check]').map(e => e.dataset.check);
const withEdits = (edits: Partial<TaskEdits>, extra: object = {}) =>
  open({ state: { taskEdits: edits as TaskEdits, ...extra } });

beforeEach(() => {
  page();
  open();
  setQuery('');
  setHideDone(false);
  go('plan');
});

test('the handbook phase 3 steps are the ones these tests name', () => {
  assert.deepEqual(
    generatedTasks('3').map(t => t.id),
    [survey, retire, iron, construction, steel, oil, mechanical, project, delivery],
  );
});

test('a new step goes right after its generated neighbour, not at the end (#779)', () => {
  // The user reversed the phase before the steel step existed in it.
  const saved = [delivery, project, mechanical, oil, construction, iron, retire, survey];
  withEdits({ order: { '3': saved } });
  render();
  const expected = [delivery, project, mechanical, oil, construction, steel, iron, retire, survey];
  assert.deepEqual(ids(), expected);
  assert.deepEqual(shown(), expected, 'the checklist draws that order');
});

test('a milestone new to a reordered calculated phase sits where it is generated', () => {
  // The issue's case: the phase was reordered once (here: kept in generated order) before the
  // milestone was listed in it.
  open({ calculated: generated() });
  const all = generatedTasks().map(t => t.id);
  const milestone = all.find((id, i) => id.startsWith('unlock-') && i > 0 && i < all.length - 1);
  assert.ok(milestone, 'the plan lists a milestone between other steps');
  const saved = all.filter(id => id !== milestone);
  open({ calculated: generated(), state: { taskEdits: { order: { '3': saved } } as TaskEdits } });
  render();
  assert.deepEqual(ids(), all, 'the milestone keeps its generated place');
  assert.notEqual(ids().at(-1), milestone);
});

test('several new steps in a row keep their generated order', () => {
  // iron, construction and steel are new; they follow retire-power, generated before them.
  withEdits({ order: { '3': [delivery, retire, oil, survey, mechanical, project] } });
  assert.deepEqual(ids(), [
    delivery,
    retire,
    iron,
    construction,
    steel,
    oil,
    survey,
    mechanical,
    project,
  ]);
});

test('a new step generated before every ordered step goes first', () => {
  withEdits({ order: { '3': [delivery, project, mechanical, oil, steel, construction, iron] } });
  // survey and retire-power precede every listed step, so they go before the first listed one
  // (here the top), in generated order.
  assert.deepEqual(ids(), [
    survey,
    retire,
    delivery,
    project,
    mechanical,
    oil,
    steel,
    construction,
    iron,
  ]);
});

test('ids the phase no longer has are skipped, and removed steps stay out', () => {
  withEdits({
    order: { '3': ['gone-1', delivery, 'gone-2', iron, survey, 'gone-3'] },
    removed: [retire, 'gone-2'],
  });
  // retire-power is removed; construction..project follow iron, the last listed step before them.
  assert.deepEqual(ids(), [delivery, iron, construction, steel, oil, mechanical, project, survey]);
});

test('a new step anchors on a removed step’s place too', () => {
  // construction follows iron in the generated order; iron is removed but keeps its place.
  withEdits({
    order: { '3': [delivery, iron, survey, retire, steel, oil, mechanical, project] },
    removed: [iron],
  });
  assert.deepEqual(ids(), [
    delivery,
    construction,
    survey,
    retire,
    steel,
    oil,
    mechanical,
    project,
  ]);
});

test('a personal task missing from the saved order goes last; a listed one keeps its place', () => {
  const customTasks = [
    { id: 'custom-1', phase: '3', title: 'Listed' },
    { id: 'custom-2', phase: '3', title: 'Added later' },
  ];
  withEdits(
    { order: { '3': [delivery, 'custom-1', project, mechanical, oil, construction, survey] } },
    { customTasks },
  );
  assert.deepEqual(ids(), [
    delivery,
    'custom-1',
    project,
    mechanical,
    oil,
    construction,
    steel,
    survey,
    retire,
    iron,
    'custom-2',
  ]);
});

test('without a saved order the generated order is kept', () => {
  withEdits({ order: {} }, { customTasks: [{ id: 'custom-1', phase: '3', title: 'Mine' }] });
  assert.deepEqual(ids(), [...generatedTasks('3').map(t => t.id), 'custom-1']);
});

test('withNewSteps places new generated ids by their neighbours and personal ones last', () => {
  assert.deepEqual(withNewSteps(['c', 'a'], ['a', 'b', 'c', 'd'], ['p']), [
    'c',
    'd',
    'a',
    'b',
    'p',
  ]);
  assert.deepEqual(withNewSteps(['x', 'b'], ['a', 'b'], []), ['x', 'a', 'b'], 'unknown ids kept');
  assert.deepEqual(withNewSteps([], ['a', 'b'], ['p']), ['a', 'b', 'p']);
  // Leading new steps go just before the first listed generated step, or after the saved ids.
  assert.deepEqual(withNewSteps(['p', 'b'], ['a', 'b'], ['p', 'q']), ['p', 'a', 'b', 'q']);
  assert.deepEqual(withNewSteps(['p'], ['a', 'b'], ['p', 'q']), ['p', 'a', 'b', 'q']);
});

test('a personal task the user put on top stays above steps new to the phase', () => {
  withEdits(
    { order: { '3': ['custom-1', delivery, project, mechanical, oil, steel, construction, iron] } },
    { customTasks: [{ id: 'custom-1', phase: '3', title: 'First' }] },
  );
  assert.deepEqual(ids(), [
    'custom-1',
    survey,
    retire,
    delivery,
    project,
    mechanical,
    oil,
    steel,
    construction,
    iron,
  ]);
});

test('the next reorder saves the new step where it is shown', async () => {
  const calls = stubFetch({ '/api/update': () => state });
  const saved = [delivery, project, mechanical, oil, construction, iron, retire, survey];
  withEdits({ order: { '3': ['gone-1', ...saved] } });
  render();
  $('[data-toggle-plan-edit]')!.click();
  await nextTick();
  $(`[data-move-task="${survey}"][data-dir="-1"]`)!.click();
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
  assert.deepEqual(calls.at(-1)![1], {
    type: 'taskOrder',
    phase: '3',
    ids: ['gone-1', delivery, project, mechanical, oil, construction, steel, iron, survey, retire],
  });
});
