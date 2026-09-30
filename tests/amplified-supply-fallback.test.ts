// With amplification on, a phase whose amplified fits all stop at the solver's limit falls back to
// the unamplified fit. With existing supply that fallback must still widen the network and, if
// need be, drop the credit, exactly as the same settings without amplification do (#597).
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../planner.ts';

// Whole machines and 13.3 Circuit Boards a minute already running: the credit narrows Phase 3's
// network so far that it no longer rounds to whole machines, and only the widened network fits.
const settings = {
  phase: '3',
  goal: 'balanced',
  wholeMachines: true,
  limitsConfirmed: true,
  somersloops: 106,
  existingSupply: { 'Circuit Board': 13.3 },
};
// Runs `body` on a clock that moves `step` milliseconds every time it is read, whatever the real
// time. The solver's clock backstop (30 seconds) then stops every search that reads the clock more
// than 30000 / `step` times: with 100, the amplified searches over the widened network, never the
// unamplified ones. It counts reads, not time, so it stops the same searches on every machine.
function onTickingClock<T>(step: number, body: () => T): T {
  const now = performance.now,
    dateNow = Date.now;
  const start = now.call(performance),
    dateStart = dateNow();
  let reads = 0;
  performance.now = () => start + ++reads * step;
  Date.now = () => dateStart + ++reads * step;
  try {
    return body();
  } finally {
    performance.now = now;
    Date.now = dateNow;
  }
}
const phase3 = (amplifySloops: number) =>
  onTickingClock(100, () => calculate({ ...settings, amplifySloops })).stages[3];

test('amplification with existing supply never costs a phase that fits without it (#597)', () => {
  const plain = phase3(0);
  assert.equal(plain.feasible, true, 'without amplification Phase 3 fits the widened network');
  const amplified = phase3(106);
  assert.equal(amplified.feasible, true, 'with amplification Phase 3 is still planned');
  assert.equal(amplified.amplificationDropped, true, 'and says it dropped the amplification');
  assert.equal(amplified.supplyDropped, undefined, 'the credit is kept, as without amplification');
  if (!plain.feasible || !amplified.feasible) return;
  assert.deepEqual(
    amplified.rows.map(row => [row.id, row.machines]),
    plain.rows.map(row => [row.id, row.machines]),
    'the same plan as without amplification',
  );
});

test('on an ordinary clock the same settings keep their amplification', () => {
  const stage = calculate({ ...settings, amplifySloops: 106 }).stages[3];
  assert.equal(stage.feasible, true);
  assert.equal(stage.amplificationDropped, undefined);
});
