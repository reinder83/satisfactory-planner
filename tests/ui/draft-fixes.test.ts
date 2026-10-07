// A draft's fixes name protected storage only where storage was a demand of its solve (#1100):
// storage fed from surplus (storageFromSurplus under whole machines) is left out of it, so
// lowering its rate does not help. A draft stored before #1100, whose solve still held storage,
// and every plan without the setting keep the advice.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { draftFixes } from '../../public/app/views/calculated.ts';
import type { CurrentSettings, StoredStage } from '../../public/types/index.ts';

const draft = (storage: Record<string, number>): StoredStage => ({
  feasible: false,
  shortfalls: [{ name: 'Iron Ore', needed: 5, budget: 0 }],
  storage,
});
const fixes = (stage: StoredStage, settings: Partial<CurrentSettings>) =>
  draftFixes(stage, { goal: 'timed', ...settings }).join(' ');
const whole = { wholeMachines: true, storageFromSurplus: true } as const;

test('a draft under storageFromSurplus does not advise lowering storage (#1100)', () => {
  assert.match(fixes(draft({}), whole), /More time alone will not fit: lower drone-fuel supply/);
  assert.doesNotMatch(fixes(draft({}), whole), /protected storage/);
  assert.match(
    fixes(draft({}), { ...whole, goal: 'maximum' }),
    /Lower drone-fuel supply or extra Singularity Cells/,
  );
});

test('other drafts keep the storage advice, as before (#1100)', () => {
  const stored = draft({ Concrete: 20 });
  const variants: Partial<CurrentSettings>[] = [
    {},
    { wholeMachines: true },
    { storageFromSurplus: true },
    whole,
  ];
  for (const settings of variants)
    assert.match(fixes(stored, settings), /lower the protected storage refill rate/);
  // Without whole machines the setting changes nothing, storage or not.
  assert.match(fixes(draft({}), { storageFromSurplus: true }), /protected storage refill/);
});
