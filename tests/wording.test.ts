// The planner's warnings and the browser app word name lists and durations with the same
// functions, from public/wording.ts (#748, #763). The old names stay as aliases of them, so the
// two can never drift apart again (#740 was such a drift). calculated.ts's andList is checked in
// tests/ui/wording.test.ts, as that module imports components.
import test from 'node:test';
import assert from 'node:assert/strict';
import { duration, durationOfHours, listNames } from '../public/wording.ts';
import { listNames as plannerListNames, warningDuration } from '../planner.ts';
import * as format from '../public/app/format.ts';

test('the old list and duration names are the shared functions themselves', () => {
  assert.equal(plannerListNames, listNames);
  assert.equal(warningDuration, durationOfHours);
  assert.equal(format.durationOfHours, durationOfHours);
  assert.equal(format.duration, duration);
});

test('an empty name list is an empty string', () => {
  assert.equal(listNames([]), '');
});
