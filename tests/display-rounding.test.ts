// X-2 (#1335): the display helpers in public/numbers.ts round for the pages and keep the exact
// value for a title. They never change the number they are given.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayPercent, displayPower, displayRate, figureText } from '../public/numbers.ts';
import type { DisplayFigure } from '../public/numbers.ts';

const show = (figure: DisplayFigure) => figureText(figure);

test('rates: no decimals from 100 up, up to two below, exact kept', () => {
  assert.equal(show(displayRate(2921.89, 'm³/min')), '2,922 m³/min');
  assert.equal(displayRate(2921.89, 'm³/min').exact, '2,921.89 m³/min');
  assert.equal(displayRate(99.456, '/min').value, '99.46');
  assert.equal(displayRate(100.4).value, '100');
  assert.equal(displayRate(1234567.5).value, '1,234,568');
  assert.equal(displayRate(0).value, '0');
});

test('a nonzero shortfall never rounds to 0', () => {
  assert.equal(displayRate(0.004).value, '<0.01');
  assert.equal(displayRate(-0.004).value, '>-0.01');
  assert.equal(displayRate(0.01).value, '0.01');
  assert.equal(displayRate(0.004).exact, '0.004');
  assert.equal(displayPercent(0.04).value, '<0.1');
  assert.equal(displayPower(0.0000001).value, '<0.01');
});

test('power: kW below 1 MW, MW to 1,000, GW above', () => {
  assert.equal(show(displayPower(0.25)), '250 kW');
  assert.equal(displayPower(0.25).exact, '0.25 MW');
  assert.equal(show(displayPower(0.0005)), '0.5 kW');
  assert.equal(show(displayPower(1)), '1 MW');
  assert.equal(show(displayPower(643.9)), '644 MW');
  assert.equal(show(displayPower(1000)), '1,000 MW');
  assert.equal(show(displayPower(44430)), '44.43 GW');
  assert.equal(show(displayPower(0)), '0 MW');
});

test('percent: one decimal', () => {
  assert.equal(show(displayPercent(4.59)), '4.6%');
  assert.equal(displayPercent(4.59).exact, '4.59%');
  assert.equal(show(displayPercent(100)), '100%');
  assert.equal(show(displayPercent(0)), '0%');
  assert.equal(show(displayPercent(99.96)), '100%');
});
