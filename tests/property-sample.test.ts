// The sample the heavy property tests check on pull requests, and the full set they check with
// PLANNER_FULL_PROPERTIES=1 (tests/helpers/properties.ts, #1274). This file passes in both modes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FULL_PROPERTIES, propertyCases, propertyCount } from './helpers/properties.ts';

const CASES = Array.from({ length: 20 }, (_, i) => i + 1);

test('the switch is PLANNER_FULL_PROPERTIES=1 exactly', () => {
  assert.equal(FULL_PROPERTIES, process.env.PLANNER_FULL_PROPERTIES === '1');
});

test('the sample is every n-th case and the kept ones, in order; the full set is every case', () => {
  const cases = propertyCases(CASES, { keep: [18, 4], every: 5 });
  assert.deepEqual(cases, FULL_PROPERTIES ? CASES : [1, 4, 6, 11, 16, 18]);
  assert.deepEqual(
    propertyCases(CASES, { every: 5, offset: 2 }),
    FULL_PROPERTIES ? CASES : [3, 8, 13, 18],
  );
  assert.deepEqual(propertyCases(CASES, { keep: [7] }), FULL_PROPERTIES ? CASES : [7]);
  assert.equal(propertyCount(24, 12), FULL_PROPERTIES ? 24 : 12);
});

test('a kept case that is not a case fails at once, in either mode', () => {
  assert.throws(() => propertyCases(CASES, { keep: [21] }), /the kept case 21 is not a case/);
});
