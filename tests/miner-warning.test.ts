// The plan's warning on mining per phase (#1020 line 37, miningWarnings in planner/warnings.ts)
// says how the plan overclocks its miners and oil extractors since #1137: with "I can overclock"
// up to 250% in every phase, else at 100% in Phases 1–3 with the build plan's research advice and
// up to 250% from Phase 4; never more than the belt or pipe carries. It no longer says the plan
// counts on Power Shards only from Phase 4 when the player can overclock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../planner.ts';

const warning = (settings: object) =>
  calculate({ phaseMining: true, ...settings }).warnings!.find(text =>
    text.startsWith("Each phase's resource budgets follow"),
  )!;

test('with "I can overclock" the warning says every phase overclocks to the belt or pipe cap', () => {
  const text = warning({ phase: '3', overclock: true });
  assert.match(
    text,
    /Miners and oil extractors run overclocked with Power Shards, up to 250% and never more than their belt or pipe carries\./,
  );
  assert.doesNotMatch(text, /at 100%|Until you can overclock|counts on them/);
});

test('without it the warning gives 100% in Phases 1–3 with the research advice', () => {
  const text = warning({ phase: '3' });
  assert.match(
    text,
    /Until you can overclock, miners and oil extractors run at 100% in Phases 1–3/,
  );
  assert.match(text, /Blue Power Slugs, then Overclock Production/);
  assert.match(text, /From Phase 4 they run overclocked up to 250%, never more than their belt/);
  assert.doesNotMatch(text, /counts on them from Phase 4/);
  // A plan starting in Phase 4 overclocks every phase it builds.
  assert.match(warning({ phase: '4' }), /run overclocked with Power Shards, up to 250%/);
});
