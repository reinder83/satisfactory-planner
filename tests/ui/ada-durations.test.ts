// ADA's delivery-time remarks (public/ada.ts, facts from adaFacts in public/app/ada-panel.ts)
// write a phase's time in hours and minutes, as the plan header and the elevator counter do
// (#643), never as a decimal number of hours.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { generated, go, open, page } from './setup.ts';
import type { CurrentStage } from '../../public/types/index.ts';

beforeEach(() => {
  page();
  setAdaIndex(0);
  adaClearFault();
});

// ADA's remark `id` on the Phase 3 build plan of a plan whose Phase 3 is `stage`.
function remark(id: string, stage: Partial<CurrentStage>) {
  const plan = generated();
  // The generated Phase 3 with a few figures changed: still a stage the planner returns.
  plan.stages['3'] = { ...plan.stages['3'], ...stage } as CurrentStage;
  open({ calculated: plan });
  go('plan');
  for (let i = 0; i < 60; i++) {
    setAdaIndex(i);
    const line = adaCurrent();
    if (line?.id === id) return line.text;
  }
  return undefined;
}

test('ADA gives the steady-state delivery time in hours and minutes', () => {
  assert.match(remark('hours', { hours: 7.86 }) ?? '', /: about 7 h 52 min\. /);
});

test('ADA compares a rounded phase with its target in the same words', () => {
  const text = remark('rounded-after-stop', { feasible: true, hours: 7.86, roundedAfterStop: 6 });
  assert.match(text ?? '', /it takes about 7 h 52 min instead of about 6 h\./);
});

test('ADA compares a phase on easy clocks with its target in the same words', () => {
  const text = remark('fractional-after-stop', {
    feasible: true,
    hours: 7.58,
    fractionalAfterStop: { target: 6.5, clocks: 'easy' },
  });
  assert.match(text ?? '', /it takes about 7 h 35 min instead of about 6 h 30 min\./);
});
