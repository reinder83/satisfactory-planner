// The app's one number format (#1331, BUG-6 and ONB-4, public/numbers.ts): a comma for thousands,
// a dot for decimals, whatever the machine's language; and a number field that takes "," or "."
// as the decimal separator and a thousands separator either way.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatNumber, NUMBER_LOCALE, parseNumber } from '../public/numbers.ts';
import { localeNumber } from '../public/wording.ts';

test('numbers are shown with a comma for thousands and a dot for decimals, in any locale', () => {
  assert.equal(NUMBER_LOCALE, 'en-US');
  assert.equal(formatNumber(92100), '92,100');
  assert.equal(formatNumber(0.5), '0.5');
  assert.equal(formatNumber(1234567.891), '1,234,567.89');
  assert.equal(formatNumber(1234.56789, 10), '1,234.56789');
  assert.equal(formatNumber(-1500), '-1,500');
  assert.equal(formatNumber(0), '0');
  // The pages' own formatter is the same one: the same text on a Dutch machine and a US one.
  assert.equal(localeNumber(92100), '92,100');
  assert.equal(localeNumber(0.5), '0.5');
  assert.equal(localeNumber(null), '0');
});

test('a decimal comma and a decimal point both parse', () => {
  assert.equal(parseNumber('0,5'), 0.5);
  assert.equal(parseNumber('0.5'), 0.5);
  assert.equal(parseNumber('1,25'), 1.25);
  assert.equal(parseNumber('2.75'), 2.75);
  assert.equal(parseNumber('0,125'), 0.125, 'a leading zero is a decimal, not thousands');
  assert.equal(parseNumber('0.125'), 0.125);
  assert.equal(parseNumber('.5'), 0.5);
  assert.equal(parseNumber('5.'), 5);
  assert.equal(parseNumber(' 7 '), 7);
});

test('thousands separators parse, the one the pages print included', () => {
  assert.equal(parseNumber('92100'), 92100);
  assert.equal(parseNumber('92,100'), 92100, 'what the pages print reads back');
  assert.equal(parseNumber('1,234,567'), 1234567);
  assert.equal(parseNumber('1.234.567'), 1234567);
  assert.equal(parseNumber('1,234.5'), 1234.5);
  assert.equal(parseNumber('1.234,5'), 1234.5);
  assert.equal(parseNumber("92'100"), 92100);
  assert.equal(parseNumber('92 100'), 92100);
  assert.equal(parseNumber('92 100'), 92100);
});

test('"92.100" is 92100 in a field of whole numbers and 92.1 in one with decimals', () => {
  assert.equal(parseNumber('92.100', true), 92100);
  assert.equal(parseNumber('92.100'), 92.1);
  assert.equal(parseNumber('92.100', false), 92.1);
  assert.equal(parseNumber('0.500', true), 0.5, 'a leading zero stays a decimal');
  assert.equal(parseNumber('92.10', true), 92.1, 'only exactly three digits make thousands');
  assert.equal(parseNumber('1.5', true), 1.5);
});

test('negative numbers parse', () => {
  assert.equal(parseNumber('-3'), -3);
  assert.equal(parseNumber('-0,5'), -0.5);
  assert.equal(parseNumber('−2'), -2);
  assert.equal(parseNumber('-1,234'), -1234);
  assert.equal(parseNumber('-2147483648'), -2147483648);
});

test('blank and invalid text is not a number', () => {
  for (const text of [
    '',
    '   ',
    'abc',
    '-',
    ',',
    '.',
    '1,2,3',
    '1.2.3',
    '0,5,',
    '1e3',
    '12a',
    '--1',
    '1,5.2,3',
    '5%',
  ])
    assert.equal(parseNumber(text), null, JSON.stringify(text));
});

test('what the pages print parses back to the same number', () => {
  for (const value of [0, 0.5, 1, 12.25, 999, 1000, 92100, 1234567.5, -4200, 0.125, 300])
    for (const whole of [true, false])
      assert.equal(parseNumber(formatNumber(value, 10), whole), value, String(value));
});
