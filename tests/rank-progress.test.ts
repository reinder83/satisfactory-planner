// The browser worker's timer restarts on each progress message. A payoff ranking used to send
// its first one only after two whole calculations (the base plan and the first trial), so on a
// slow device heavy settings passed the worker's limit before the ranking reported anything and
// it failed with "Calculation timed out" (#633). Its onPhase now reports as each phase of those
// calculations starts, which the worker forwards like a calculation's phases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA, rankAlternates } from '../planner.ts';

// The browser worker's limit per progress message (workerJobs in public/browser-api.ts).
const WORKER_LIMIT_MS = 180000;
// Every alternate available by Phase 4 but one, so the ranking has a single trial.
const alternates = DATA.recipes
  .filter(recipe => recipe.alternate && recipe.phase <= 4)
  .map(recipe => recipe.id);
const settings = { phase: '1', recipes: 'custom', alternateRecipes: alternates.slice(1) };

// How many rankings the gap test times (see there).
const RUNS = 10;

test('a ranking reports as each phase of its calculations starts (#633)', () => {
  const calls: (number | string)[] = [];
  const ranking = rankAlternates(settings, {
    phase: '4',
    onPhase: phase => calls.push(phase),
    onProgress: done => calls.push('done ' + done),
  });
  assert.equal(ranking.total, 1);
  // The five phases of the base plan, the five of the trial, then the trial's progress as before.
  assert.deepEqual(calls, [1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 'done 1']);
  // Reporting changes nothing in the ranking.
  const quiet = rankAlternates(settings, { phase: '4' });
  assert.deepEqual(
    { ...ranking, elapsedMs: 0 },
    { ...quiet, elapsedMs: 0 },
    'the same ranking with or without progress',
  );
});

test('no gap between a ranking’s progress messages passes the worker’s limit on a slow machine (#633)', () => {
  // On a machine slow enough that the ranking's two calculations take twice the limit in all, its
  // longest phase is about a fifth of that, so every gap stays well inside the limit, where
  // before #633 the first message came only after both calculations. The whole ranking takes
  // about a tenth of a second here, so a moment the system gives to the test files `node --test`
  // runs alongside this one could make a gap look several times longer than its work (#709).
  // Other load only ever adds time, so each gap counts at its shortest over several rankings.
  const runs = Array.from({ length: RUNS }, () => {
    const times = [performance.now()];
    const mark = () => times.push(performance.now());
    rankAlternates(settings, { phase: '4', onPhase: mark, onProgress: mark });
    mark();
    return times.slice(1).map((time, index) => time - times[index]!);
  });
  // runs[0] is there: RUNS is above 0. Every ranking sends the same messages.
  const gaps = runs[0]!.map((_, index) => Math.min(...runs.map(run => run[index]!)));
  for (const run of runs) assert.equal(run.length, gaps.length, 'the same messages every time');
  // How many times slower the machine is: the ranking takes twice the limit there.
  const factor = (2 * WORKER_LIMIT_MS) / gaps.reduce((total, gap) => total + gap, 0);
  gaps.forEach((gap, index) => {
    const seconds = (gap * factor) / 1000;
    assert.ok(
      seconds * 1000 < WORKER_LIMIT_MS,
      `${seconds.toFixed(0)} s without progress after message ${index} on the slow machine`,
    );
  });
});
