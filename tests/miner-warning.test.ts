// The plan's warning on mining per phase (#1020 line 37, miningWarnings in planner/warnings.ts)
// says how the plan overclocks its miners and oil extractors since #1137: with "I can overclock"
// up to 250% in every phase; since #1169 up to 250% from Phase 2 in any case, after the Power
// Shards research the build plan schedules, and at 100% only in Phase 1 without it; never more
// than the belt or pipe carries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../planner.ts';

const warning = (settings: object) =>
  calculate({ phaseMining: true, ...settings }).warnings!.find(text =>
    text.startsWith("Each phase's resource budgets follow"),
  )!;

test('from Phase 2, with or without "I can overclock", the warning says every phase overclocks to the belt or pipe cap', () => {
  for (const settings of [{ phase: '3', overclock: true }, { phase: '3' }, { phase: '2' }]) {
    const text = warning(settings);
    assert.match(
      text,
      /Miners and oil extractors run overclocked with Power Shards, up to 250% and never more than their belt or pipe carries, so each node gives what its belt or pipe takes; the build plan has the Power Shards research in the MAM \(Blue Power Slugs, then Overclock Production\) before the first nodes it taps that way\./,
    );
    assert.doesNotMatch(text, /at 100%|Until you can overclock|counts on them/);
  }
});

test('a Phase 1 plan without it gives 100% in Phase 1 only, before the MAM (#1169)', () => {
  const text = warning({ phase: '1' });
  assert.match(text, /In Phase 1, before the MAM is usable, miners run at 100%/);
  assert.match(text, /From Phase 2 they run overclocked with Power Shards up to 250%/);
  assert.match(text, /Blue Power Slugs, then Overclock Production/);
  assert.doesNotMatch(text, /Phases 1–3|Until you can overclock/);
  assert.match(warning({ phase: '1', overclock: true }), /run overclocked with Power Shards/);
});
