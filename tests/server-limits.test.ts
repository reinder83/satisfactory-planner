// server/limits.ts on its own (#524): the per-address allowances for sign-ins and
// calculations, live estimates and their solving-time budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { createLimits } from '../server/limits.ts';

// A request from one address, which is all the limits read.
const from = (remoteAddress: string) => ({ socket: { remoteAddress } }) as IncomingMessage;
const tooMany = { status: 429, message: 'Too many attempts. Wait a minute and try again.' };

test('20 calculations a minute per address, a ranking costing five', () => {
  const limits = createLimits();
  for (let i = 0; i < 20; i++) limits.throttle(from('1.1.1.1'));
  assert.throws(() => limits.throttle(from('1.1.1.1')), tooMany);
  limits.throttle(from('2.2.2.2'), 5);
  for (let i = 0; i < 15; i++) limits.throttle(from('2.2.2.2'));
  assert.throws(() => limits.throttle(from('2.2.2.2')), tooMany);
});

test('live estimates have their own allowance of 120 a minute', () => {
  const limits = createLimits();
  for (let i = 0; i < 120; i++) limits.throttleEstimate(from('1.1.1.1'));
  assert.throws(() => limits.throttleEstimate(from('1.1.1.1')), tooMany);
  limits.throttle(from('1.1.1.1')); // calculations are untouched
});

test('the estimate budget pauses estimates once the solving time is used up', () => {
  const limits = createLimits(100);
  const entry = limits.estimateBudget(from('1.1.1.1'));
  entry.count += 99;
  assert.equal(limits.estimateBudget(from('1.1.1.1')), entry, 'the same minute');
  entry.count += 1;
  assert.throws(() => limits.estimateBudget(from('1.1.1.1')), {
    status: 429,
    message: 'Live estimates are paused for a minute. Calculate plan still works.',
  });
  limits.estimateBudget(from('2.2.2.2')); // another address has its own
});
