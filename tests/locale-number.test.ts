// The pages' numbers keep one Intl.NumberFormat per digit count (#1060, localeNumber in
// public/wording.ts): each must give exactly the text toLocaleString gave, for every kind of
// value the pages format.
import assert from 'node:assert/strict';
import test from 'node:test';
import { num, num3 } from '../public/app/format.ts';
import { localeNumber } from '../public/wording.ts';

// What the pages called before: a new formatter on every call.
const before = (value: number | null | undefined, digits: number) =>
  Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });

// Fixed edge cases, then a seeded spread of magnitudes, signs and fractions.
const EDGES = [
  0,
  -0,
  1,
  -1,
  0.5,
  0.005,
  0.0049,
  0.015,
  1.005,
  2.675,
  99.995,
  99.9949,
  1e-7,
  -1e-7,
  123456.789,
  1234567.891,
  1e21,
  -1e21,
  1.7976931348623157e308,
  Number.MIN_VALUE,
  Number.EPSILON,
  NaN,
  Infinity,
  -Infinity,
  null,
  undefined,
];
function spread(count: number): number[] {
  let seed = 1060;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: count }, () => {
    const magnitude = 10 ** Math.floor(random() * 14 - 6);
    return (random() < 0.3 ? -1 : 1) * random() * magnitude;
  });
}

test('the shared formatter gives what toLocaleString gave, for 0 to 3 decimals', () => {
  for (const digits of [0, 1, 2, 3])
    for (const value of [...EDGES, ...spread(5000)])
      assert.equal(localeNumber(value, digits), before(value, digits), `${value} at ${digits}`);
});

test('num and num3 format as before', () => {
  for (const value of [...EDGES, ...spread(5000)]) {
    assert.equal(num(value), before(value, 2), String(value));
    assert.equal(num3(value), before(value, 3), String(value));
  }
});

test('2 decimals unless given, and each digit count keeps its own formatter', () => {
  assert.equal(localeNumber(1234.5678), before(1234.5678, 2));
  // Asking for another digit count in between changes nothing for the first.
  assert.equal(localeNumber(1.23456, 3), before(1.23456, 3));
  assert.equal(localeNumber(1.23456, 1), before(1.23456, 1));
  assert.equal(localeNumber(1.23456, 3), before(1.23456, 3));
});
