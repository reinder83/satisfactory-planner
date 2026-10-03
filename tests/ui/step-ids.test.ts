// The id-only step lists (#768): generatedStepIds and phaseStepIds in app/opening-phase.ts
// (generatedTaskIds and planTaskIds in app/tasks.ts) work out a phase's step ids without
// writing any step text. They must give exactly the ids, in exactly the order, of the full step
// lists the build plan draws (calcTasks in views/calculated.ts, generatedTasks and planTasks in
// tasks.ts), for every phase, asked from any open phase, with the user's edits: removed steps,
// personal tasks and a saved order, including the steps a saved order does not list yet
// (withNewSteps, #779) and ids it lists that the phase no longer has.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { generatedStepIds, phaseStepIds } from '../../public/app/opening-phase.ts';
import { milestoneOnly, phase, phaseOptions } from '../../public/app/session.ts';
import {
  generatedTaskIds,
  generatedTasks,
  planTaskIds,
  planTasks,
} from '../../public/app/tasks.ts';
import { calcTasks } from '../../public/app/views/calculated.ts';
import { generatedWith, open, page } from './setup.ts';
import type {
  CurrentCalculatedPlan,
  CustomTask,
  Phase,
  StoredCalculatedPlan,
  TaskEdits,
} from '../../public/types/index.ts';

// Calculated profiles that start in Phase 1 and in Phase 3 (phases 1 and 2 milestone-only,
// #759), made once for the file.
let startsInOne: CurrentCalculatedPlan | undefined,
  startsInThree: CurrentCalculatedPlan | undefined;
const phaseOnePlan = () => structuredClone((startsInOne ??= generatedWith({ phase: '1' })));
const phaseThreePlan = () => structuredClone((startsInThree ??= generatedWith({ phase: '3' })));

beforeEach(() => page());

const idsOf = (steps: { id: string }[]) => steps.map(step => step.id);

// Edits that touch every phase in `generated` (each phase's generated ids): two personal tasks a
// phase, the second and last generated steps removed, and a saved order that lists the second
// personal task first, every other generated step in reverse and an id no phase has, so the
// generated steps it leaves out and the first personal task are placed by withNewSteps.
function editsFor(generated: Map<Phase, string[]>): {
  customTasks: CustomTask[];
  taskEdits: TaskEdits;
} {
  const customTasks: CustomTask[] = [],
    order: TaskEdits['order'] = {},
    removed: string[] = [];
  for (const [shown, ids] of generated) {
    const a = 'custom-' + shown + '-a',
      b = 'custom-' + shown + '-b';
    customTasks.push(
      { id: a, phase: shown, title: 'First' },
      { id: b, phase: shown, title: 'Second' },
    );
    if (ids.length > 1) removed.push(ids[1]!, ids.at(-1)!);
    order[shown] = [b, ...ids.filter((_, i) => i % 2 === 0).reverse(), 'calc-9-gone'];
  }
  return { customTasks, taskEdits: { order, removed, titles: {}, bodies: {}, links: {} } };
}

// For a profile, every phase the picker offers is worked out from every other open phase: the
// id-only lists must equal the ids of the full lists, and the build plan of that phase once it
// is open. Returns how many phases had a saved order that changed their order.
function compareAllPhases(openWith: (shown: Phase, extra?: object) => void, label: string): number {
  openWith('post');
  const phases = phaseOptions();
  const generated = new Map(phases.map(shown => [shown, idsOf(generatedTasks(shown))]));
  let reordered = 0;
  for (const edits of [{}, editsFor(generated)]) {
    const edited = 'taskEdits' in edits ? ' with edits' : '';
    // What the build plan shows with each phase open.
    const shownOpen = new Map<Phase, string[]>();
    for (const shown of phases) {
      openWith(shown, structuredClone(edits));
      assert.equal(phase(), shown, `${label}: ${shown} opens`);
      shownOpen.set(shown, idsOf(planTasks()));
      assert.deepEqual(planTaskIds(), shownOpen.get(shown), `${label} ${shown}${edited}: open`);
    }
    for (const from of phases) {
      openWith(from, structuredClone(edits));
      for (const shown of phases) {
        const where = `${label} ${shown}${edited}, from ${from}`;
        const full = idsOf(generatedTasks(shown));
        assert.deepEqual(generatedStepIds(shown), full, where + ': generated ids');
        assert.deepEqual(generatedTaskIds(shown), full, where + ': generatedTaskIds');
        if (label !== 'handbook')
          assert.deepEqual(idsOf(calcTasks(shown)), full, where + ': calcTasks ids');
        // phaseStepIds takes the five planned phases; post-game is asked through planTaskIds.
        const ids = shown === 'post' ? planTaskIds(shown) : phaseStepIds(shown);
        assert.deepEqual(ids, idsOf(planTasks(shown)), where + ': step ids');
        assert.deepEqual(ids, shownOpen.get(shown), where + ': as the build plan shows it');
      }
    }
    if (edited)
      for (const shown of phases) {
        const ids = shownOpen.get(shown)!,
          base = generated.get(shown)!;
        assert.ok(!ids.includes(base[1] ?? '-'), `${label} ${shown}: a removed step is left out`);
        assert.ok(
          ids.includes('custom-' + shown + '-a'),
          `${label} ${shown}: personal tasks count`,
        );
        assert.ok(!ids.includes('calc-9-gone'), `${label} ${shown}: a stale id is skipped`);
        const plain = [...base, 'custom-' + shown + '-a', 'custom-' + shown + '-b'].filter(id =>
          ids.includes(id),
        );
        if (ids.join() !== plain.join()) reordered++;
      }
  }
  return reordered;
}

test('a calculated profile: every phase and post-game, with and without edits', () => {
  const plan = phaseOnePlan();
  const reordered = compareAllPhases(
    (shown, extra = {}) => open({ calculated: plan, phase: shown, state: extra }),
    'calculated',
  );
  assert.equal(phaseOptions().length, 6, 'Phase 1 to Post Phase 5');
  assert.equal(reordered, 6, 'every phase is reordered by its saved order');
});

test('post-game steps carry Phase 5 ids', () => {
  open({ calculated: phaseOnePlan(), phase: '2' });
  const ids = generatedStepIds('post');
  assert.ok(ids.includes('calc-5-storage'));
  assert.ok(!ids.some(id => id.startsWith('calc-post-')));
});

test('a profile that starts in Phase 3: milestone-only phases 1 and 2 (#784)', () => {
  const plan = phaseThreePlan();
  const reordered = compareAllPhases(
    (shown, extra = {}) => open({ calculated: plan, phase: shown, state: extra }),
    'starts in Phase 3',
  );
  assert.ok(reordered > 0);
  open({ calculated: plan, phase: '4' });
  for (const shown of ['1', '2'] as const) {
    assert.ok(milestoneOnly(shown), 'Phase ' + shown + ' is milestone-only');
    const ids = generatedStepIds(shown);
    assert.ok(ids.length, 'Phase ' + shown + ' lists milestones');
    assert.ok(
      ids.every(id => id.startsWith('unlock-')),
      'Phase ' + shown + ' lists only milestones',
    );
  }
});

test("a guided plan: the guide's own ids, and none for a phase it leaves out", () => {
  const guided = {
    ...phaseOnePlan(),
    guide: {
      phases: {
        '3': [
          { id: 'phase-3-survey', title: 'Survey', body: 'Look around.' },
          { id: 'phase-3-iron', title: 'Iron', body: 'Hall one first.' },
          { id: 'phase-3-steel', title: 'Steel', body: 'Then steel.' },
        ],
        post: [
          { id: 'phase-post-storage-first', title: 'Storage first', body: 'Then the rest.' },
          { id: 'phase-post-rest', title: 'The rest', body: 'All of it.' },
        ],
      },
    },
  } as StoredCalculatedPlan as CurrentCalculatedPlan;
  compareAllPhases(
    (shown, extra = {}) => open({ calculated: guided, phase: shown, state: extra }),
    'guided',
  );
  open({ calculated: guided, phase: '1' });
  assert.deepEqual(generatedStepIds('3'), ['phase-3-survey', 'phase-3-iron', 'phase-3-steel']);
  assert.deepEqual(generatedStepIds('4'), []);
});

test('the handbook: phases 3 to 5 and post-game, with and without edits', () => {
  const reordered = compareAllPhases(
    (shown, extra = {}) => open({ phase: shown, state: extra }),
    'handbook',
  );
  assert.equal(reordered, 4);
});
