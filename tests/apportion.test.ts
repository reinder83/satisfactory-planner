// Rounding that still adds up (#1067, public/app/apportion.ts): largest-remainder rounding of a
// line's machines over its deliveries and of a byproduct pool's amounts, and the simple fractions
// the pool's parts are given.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nearestFraction,
  roundedParts,
  sensibleDecimals,
  wholeShares,
} from '../public/app/apportion.ts';

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

test('whole shares add up to the total, the largest remainders taking the units left', () => {
  // Rounding each of 2.5 and 1.5 machines up said 3 + 2 = 5 for a line of 4.
  assert.deepEqual(wholeShares(4, [2.5, 1.5]), [3, 1], 'a tie goes to the larger weight');
  assert.deepEqual(wholeShares(4, [1.5, 2.5]), [1, 3]);
  assert.deepEqual(wholeShares(3, [1, 1, 1]), [1, 1, 1]);
  assert.deepEqual(wholeShares(2, [1, 1, 1]), [1, 1, 0], 'the earlier part on a full tie');
  assert.deepEqual(wholeShares(10, [0.2, 9.8]), [0, 10]);
  assert.deepEqual(wholeShares(5, [0, 2, -1, 3]), [0, 2, 0, 3], 'no weight, no share');
  assert.deepEqual(wholeShares(5, [0, 0]), [0, 0], 'nothing to share by');
  assert.deepEqual(wholeShares(0, [1, 2]), [0, 0]);
});

test('whole shares add up for any weights (a property check)', () => {
  let seed = 1067;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let run = 0; run < 2000; run++) {
    const weights = Array.from({ length: 1 + Math.floor(random() * 12) }, () =>
      random() < 0.1 ? 0 : random() * 50,
    );
    const total = Math.floor(random() * 80);
    const shares = wholeShares(total, weights);
    if (sum(weights) > 0) assert.equal(sum(shares), total, JSON.stringify({ total, weights }));
    // Each part is its quota rounded down or up, never further.
    shares.forEach((share, i) => {
      const quota = sum(weights) > 0 ? (total * weights[i]!) / sum(weights) : 0;
      assert.ok(share >= Math.floor(quota + 1e-9) && share <= Math.ceil(quota - 1e-9) + 0, `${i}`);
    });
  }
});

test('rounded parts add up to their rounded total', () => {
  // 33.4 + 33.3 + 33.3 rounded one by one is 99, not 100.
  assert.deepEqual(roundedParts([33.4, 33.3, 33.3], 0), [34, 33, 33]);
  assert.deepEqual(roundedParts([1079.6, 450.2, 120.2], 0), [1080, 450, 120]);
  assert.deepEqual(roundedParts([0.004, 0.006], 2), [0, 0.01]);
  assert.equal(sum(roundedParts([12.345, 7.111, 0.01], 1)), 19.5);
});

test('a pool is written to sensible places for its size', () => {
  assert.equal(sensibleDecimals(1650), 0);
  assert.equal(sensibleDecimals(100), 0);
  assert.equal(sensibleDecimals(42.5), 1);
  assert.equal(sensibleDecimals(4.5), 2);
});

test('the nearest simple fraction, in lowest terms', () => {
  assert.deepEqual(nearestFraction(0.5), [1, 2]);
  assert.deepEqual(nearestFraction(7 / 15), [7, 15]);
  assert.deepEqual(nearestFraction(0.664), [2, 3]);
  assert.deepEqual(nearestFraction(0.654), [9, 14], 'the nearest, not the simplest');
  assert.deepEqual(nearestFraction(0.01), [0, 1], 'too small for a sixteenth');
  assert.deepEqual(nearestFraction(1), [1, 1]);
});
