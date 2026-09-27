// The component tests' node:assert/strict (tests/ui/assert.ts, #287): a failed check on page
// elements reports them by a short name instead of hanging on the whole document.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { $, page } from './setup.ts';

beforeEach(() => {
  page();
  document.body.insertAdjacentHTML(
    'beforeend',
    '<button id="go" class="btn primary" data-confirm-ok>Go</button><input name="supplyRate">',
  );
});

test('equal() on two different elements fails at once and names both', () => {
  $('#go')!.focus();
  const started = Date.now();
  assert.throws(() => assert.equal(document.activeElement, $('input'), 'moves to the rate'), {
    name: 'AssertionError',
    message: /^moves to the rate/,
    actual: '<button#go.btn.primary[data-confirm-ok]>',
    expected: '<input[name="supplyRate"]>',
  });
  assert.ok(Date.now() - started < 1000, 'without printing the whole document');
  // Without a message of its own, node:assert's usual one, with the two names in it.
  assert.throws(
    () => assert.strictEqual($('#go'), $('input')),
    (e: Error) =>
      e.message.startsWith('Expected values to be strictly equal:') &&
      e.message.includes("'<button#go.btn.primary[data-confirm-ok]>'") &&
      e.message.includes(`'<input[name="supplyRate"]>'`),
  );
});

test('an element against null, a detached element and two that print alike', () => {
  assert.throws(() => assert.equal($('#go'), null), {
    actual: '<button#go.btn.primary[data-confirm-ok]>',
    expected: 'null',
  });
  assert.throws(() => assert.equal(null, $('#go')), { actual: 'null' });
  const loose = document.createElement('p');
  assert.throws(() => assert.equal(loose, $('#go')), { actual: '<p> (not in the page)' });
  assert.throws(() => assert.equal(loose, document.createElement('p')), {
    message: /^Expected the same node: two different <p> \(not in the page\) nodes/,
  });
  assert.throws(() => assert.notEqual($('#go'), $('#go')), {
    message:
      /^Expected "actual" to be strictly unequal to:\n\n'<button#go\.btn\.primary\[data-confirm-ok\]>'/,
  });
});

test('passing checks and checks without nodes behave as node:assert', () => {
  assert.equal($('#go'), $('button'));
  assert.equal($('#missing'), null);
  assert.notEqual($('#go'), $('input'));
  assert.throws(() => assert.equal(1, 2), { operator: 'strictEqual', actual: 1, expected: 2 });
  assert.throws(() => assert.equal($('#go'), null, new TypeError('own error')), TypeError);
  assert.throws(() => assert(false), { name: 'AssertionError' });
});
