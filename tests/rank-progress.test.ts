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

// Runs `body` on a machine that seems `factor` times slower (as in phase-deadline.test.ts).
function onSlowerMachine<T>(factor: number, body: () => T): T {
  const now = performance.now,
    dateNow = Date.now;
  const start = now.call(performance),
    dateStart = dateNow();
  performance.now = () => start + (now.call(performance) - start) * factor;
  Date.now = () => dateStart + (dateNow() - dateStart) * factor;
  try {
    return body();
  } finally {
    performance.now = now;
    Date.now = dateNow;
  }
}

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
  // Slow the machine down so the ranking's two calculations take twice the limit in all. Its
  // longest phase is about a fifth of that, so every gap stays well inside the limit, where
  // before #633 the first message came only after both calculations.
  const warm = performance.now();
  rankAlternates(settings, { phase: '4' });
  const factor = (2 * WORKER_LIMIT_MS) / (performance.now() - warm);
  const times: number[] = [];
  const { started, ended } = onSlowerMachine(factor, () => {
    const started = Date.now();
    const mark = () => times.push(Date.now());
    rankAlternates(settings, { phase: '4', onPhase: mark, onProgress: mark });
    return { started, ended: Date.now() };
  });
  const marks = [started, ...times, ended];
  marks.slice(1).forEach((time, index) => {
    const seconds = (time - marks[index]!) / 1000;
    assert.ok(
      seconds * 1000 < WORKER_LIMIT_MS,
      `${seconds.toFixed(0)} s without progress after message ${index} on the slow machine`,
    );
  });
});
