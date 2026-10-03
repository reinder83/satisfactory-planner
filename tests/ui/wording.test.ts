// calculated.ts's andList (the wizard's supply notice, the power note) is the planner's own name
// list, from public/wording.ts (#748), so the two can never word a list differently. The other
// aliases are checked in tests/wording.test.ts.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { andList } from '../../public/app/views/calculated.ts';
import { listNames } from '../../public/wording.ts';

test('andList is the shared listNames itself', () => {
  assert.equal(andList, listNames);
});
