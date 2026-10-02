// One phase can chain many integer searches (the two-step fit's fallbacks for amplification,
// existing supply and whole nuclear plants), and each may run up to the solver's 30-second clock
// backstop. On a slow device that took one phase past the browser worker's limit of 180 seconds
// per phase, and the whole calculation failed with "Calculation timed out" (#592). The searches of
// one phase now share a deadline, so a phase ends within that limit however slow the machine is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../planner.ts';

// The browser worker's limit per phase (workerJobs in public/browser-api.ts).
const WORKER_LIMIT_MS = 180000;
// Whole machines, amplification, whole nuclear plants and existing supply: Phase 4 runs the whole
// fallback chain, twelve searches that stop at the node limit even on a fast machine.
const settings = {
  phase: '1',
  recipes: 'all',
  goal: 'maximum',
  limitsConfirmed: true,
  sam: 'avoid',
  wholeMachines: true,
  somersloops: 106,
  amplifySloops: 106,
  nuclear: 'recycle',
  uraniumReactors: 50,
  existingSupply: { 'Circuit Board': 13.3 },
};
// The CPU time this thread has used, in milliseconds: the work it has done, which other
// processes do not stretch. Before Node 23.9 it is the whole process's, which also counts its
// helper threads and so only makes the machine seem slower still.
function cpuMs(): number {
  const usage = process.threadCpuUsage?.() ?? process.cpuUsage();
  return (usage.user + usage.system) / 1000;
}
// Runs `body` on a machine that seems `factor` times slower: the solver reads the time through
// performance.now and Date.now, so both advance by `factor` times the CPU time it uses. Wall
// time would also count the time the system gives to other processes, such as the test files
// `node --test` runs alongside this one, and under that load a phase seemed to pass the limit it
// keeps on a quiet machine (#709). CPU time advances in steps (about 16 ms on Windows, so 1.6 s
// here), which is fine-grained enough against the limit of 180 s.
function onSlowerMachine<T>(factor: number, body: () => T): T {
  const now = performance.now,
    dateNow = Date.now;
  const cpuStart = cpuMs(),
    start = now.call(performance),
    dateStart = dateNow();
  performance.now = () => start + (cpuMs() - cpuStart) * factor;
  Date.now = () => dateStart + (cpuMs() - cpuStart) * factor;
  try {
    return body();
  } finally {
    performance.now = now;
    Date.now = dateNow;
  }
}

test('every phase ends within the browser worker’s limit on a slow machine (#592)', () => {
  // On a machine 100 times slower every search of Phase 4 runs to the 30-second backstop; before
  // the deadline its twelve searches took over six minutes. The worker's timer restarts when a
  // phase starts, so measure from one phase's start to the next (and the last to the end).
  const starts: number[] = [];
  const { stages, ended } = onSlowerMachine(100, () => ({
    stages: calculate(settings, () => starts.push(Date.now())).stages,
    ended: Date.now(),
  }));
  assert.equal(starts.length, 5, 'every phase reports its start');
  starts.forEach((start, index) => {
    const seconds = ((starts[index + 1] ?? ended) - start) / 1000;
    assert.ok(
      seconds * 1000 < WORKER_LIMIT_MS,
      `Phase ${index + 1} took ${seconds.toFixed(0)} s on the slow machine`,
    );
  });
  // A phase cut off by the deadline is rounded from its exact plan (#693) or given easy clocks
  // (#694); one neither fits is a draft that says the search stopped, as at the backstop.
  const cut = Object.values(stages).filter(
    stage =>
      !stage.feasible ||
      stage.roundedAfterStop !== undefined ||
      stage.fractionalAfterStop !== undefined,
  );
  assert.ok(cut.length, 'the slow machine cuts at least one phase off');
  for (const stage of cut.filter(stage => !stage.feasible))
    assert.match(stage.reason || '', /search stopped/, 'no resource shortage is claimed');
});
