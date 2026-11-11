// The app's one number format (#1331, BUG-6 and ONB-4, public/numbers.ts): a comma for thousands,
// a dot for decimals, whatever the machine's language; and a number field that takes "," or "."
// as the decimal separator and a thousands separator either way.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatNumber, formatPlain, NUMBER_LOCALE, parseNumber } from '../public/numbers.ts';
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

test('both marks: the last one is the decimal mark, in either kind of field', () => {
  for (const whole of [false, true]) {
    assert.equal(parseNumber('1,234.5', whole), 1234.5);
    assert.equal(parseNumber('1.234,5', whole), 1234.5);
    assert.equal(parseNumber('1,250.5', whole), 1250.5);
    assert.equal(parseNumber('1.250,5', whole), 1250.5);
    assert.equal(parseNumber('1,250,000.25', whole), 1250000.25);
  }
});

test('several of the same separator are grouping, in either kind of field', () => {
  for (const whole of [false, true]) {
    assert.equal(parseNumber('1,250,000', whole), 1250000);
    assert.equal(parseNumber('1.250.000', whole), 1250000);
    assert.equal(parseNumber('1,234,567', whole), 1234567);
    assert.equal(parseNumber('1.234.567', whole), 1234567);
    assert.equal(parseNumber("92'100", whole), 92100);
    assert.equal(parseNumber('92 100', whole), 92100);
    assert.equal(parseNumber('92 100', whole), 92100);
  }
});

test('whole-number fields: a lone "," or "." and three digits is a thousands separator', () => {
  assert.equal(parseNumber('92,100', true), 92100, 'what the pages print reads back');
  assert.equal(parseNumber('92.100', true), 92100);
  assert.equal(parseNumber('1,250', true), 1250);
  assert.equal(parseNumber('1.500', true), 1500);
  assert.equal(parseNumber('0.500', true), 0.5, 'a leading zero stays a decimal');
  assert.equal(parseNumber('0,500', true), 0.5);
  assert.equal(parseNumber('92.10', true), 92.1, 'only exactly three digits make thousands');
  assert.equal(parseNumber('1,5', true), 1.5);
  assert.equal(parseNumber('92100', true), 92100);
});

test('decimal fields: a lone "," or "." is the decimal mark, never thousands (#1362 review)', () => {
  assert.equal(parseNumber('1,250'), 1.25, 'a Dutch 1,250 is not 1250');
  assert.equal(parseNumber('2,500'), 2.5);
  assert.equal(parseNumber('1.500'), 1.5);
  assert.equal(parseNumber('92.100'), 92.1);
  assert.equal(parseNumber('92,100'), 92.1);
  assert.equal(parseNumber('92.100', false), 92.1);
  assert.equal(parseNumber('-1,250'), -1.25);
  assert.equal(parseNumber('92100'), 92100);
});

test('grouped fields (budget limits, survey "used") read a lone mark and three digits as thousands', () => {
  // Those fields call parseNumber with whole = true and still take decimals.
  assert.equal(parseNumber('92,100', true), 92100);
  assert.equal(parseNumber('92.100', true), 92100);
  assert.equal(parseNumber('12,5', true), 12.5);
  assert.equal(parseNumber('12.5', true), 12.5);
  assert.equal(parseNumber('1,250.5', true), 1250.5);
  assert.equal(parseNumber('1.250,5', true), 1250.5);
  assert.equal(parseNumber('92,100'), 92.1, 'a plain decimal field still reads it as a decimal');
});

test('mixed marks need every grouping separator to be followed by three digits', () => {
  for (const whole of [false, true]) {
    for (const text of [
      '1.5,',
      '1,5.',
      '1,5.0',
      '.5,',
      ',5.',
      '1.5,0',
      '1,2345.5',
      '1.250,5.',
      '1,250.5,',
    ])
      assert.equal(parseNumber(text, whole), null, text);
    assert.equal(parseNumber('1.250,5', whole), 1250.5);
    assert.equal(parseNumber('1,250.5', whole), 1250.5);
    assert.equal(parseNumber('1,250.', whole), 1250);
    assert.equal(parseNumber('1.250.000,25', whole), 1250000.25);
    assert.equal(parseNumber('-1,250.5', whole), -1250.5);
  }
});

test('negative numbers parse', () => {
  assert.equal(parseNumber('-3'), -3);
  assert.equal(parseNumber('-0,5'), -0.5);
  assert.equal(parseNumber('−2'), -2);
  assert.equal(parseNumber('-1,234', true), -1234);
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

test('what a whole-number field shows parses back to the same number', () => {
  for (const value of [
    0, 1, 999, 1000, 1250, 92100, 1234567, 123456789012, -4200, 0.5, 12.25, 0.125, 1234.5,
  ])
    assert.equal(parseNumber(formatNumber(value, 10), true), value, String(value));
});

test('what a decimal field shows (no grouping) parses back to the same number', () => {
  for (const value of [
    0, 0.5, 1, 1.25, 12.25, 999, 1000, 1250, 1250.5, 92100, 1234567.5, 123456789012, 10000000,
    -4200, 0.125, 0.0000001, 300,
  ]) {
    const text = formatPlain(value);
    assert.ok(!/[,s]/.test(text), text);
    assert.equal(parseNumber(text), value, String(value));
    assert.equal(parseNumber(formatPlain(parseNumber(text)!)), value, 'stable twice over');
  }
});
