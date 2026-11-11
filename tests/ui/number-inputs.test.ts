// Number fields take "," or "." and show the app's one number format (#1331, BUG-6 and ONB-4): a
// native <input type="number"> showed the browser's own separators ("0,5" in a Dutch browser,
// beside the "0.5×" the pages print) and no thousands separators ("92100" beside "92,100/min").
// Typing "0,5" and leaving the power consumption multiplier shows "0.5"; typing "92100" in a
// large-number field shows "92,100"; the value the field holds, reads and sends stays the plain
// number, so the saved settings do not change.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setWizard, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { plainNumbers } from '../../public/app/ui/form/number-input.ts';
import { carryOptions } from '../../public/state.ts';
import { $, catalog, generated, go, open, page } from './setup.ts';

const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const field = (name: string) => $<HTMLInputElement>(`#wizard-form input[name="${name}"]`)!;
// What the field shows, as the user reads it (its `value` is the plain number).
const shown = (input: HTMLInputElement) =>
  String(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.get!.call(input));
// Typing as a user does: the text goes in as typed, an input event follows, and leaving the field
// (blur) formats it.
function type(input: HTMLInputElement, text: string) {
  input.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
const leave = (input: HTMLInputElement) => {
  input.blur();
  input.dispatchEvent(new Event('focusout', { bubbles: true }));
};

function settingsStep() {
  page();
  open({ workspace: { catalog: catalog() } });
  setWizard({
    step: 1,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: structuredClone(generated().settings),
    preview: null,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  });
  go('wizard');
  render();
}

beforeEach(() => {
  // happy-dom counts some valid steps as mismatches (see wizard.test.ts).
  HTMLFormElement.prototype.reportValidity = () => true;
  settingsStep();
});

test('the power consumption multiplier takes "0,5" and shows "0.5"', () => {
  const power = field('powerFactor');
  type(power, '0,5');
  assert.equal(shown(power), '0,5', 'typed text stays while typing');
  assert.equal(power.value, '0.5', 'the field reads as the plain number meanwhile');
  leave(power);
  assert.equal(shown(power), '0.5');
  assert.equal(power.value, '0.5');
  assert.equal(power.validity.valid, true);
  type(power, '0.25');
  leave(power);
  assert.equal(shown(power), '0.25');
});

test('a large-number field shows "92,100" for 92100 and reads as the plain number', () => {
  const spare = field('availablePowerMW');
  type(spare, '92100');
  leave(spare);
  assert.equal(shown(spare), '92,100');
  assert.equal(spare.value, '92100');
  // Typed with the thousands separator, or with a dot in a field of decimals ("92.100").
  type(spare, '92,100');
  leave(spare);
  assert.equal(shown(spare), '92,100');
  assert.equal(spare.value, '92100');
});

test('the number fields are text boxes with a decimal keypad, not native number inputs', () => {
  const power = field('powerFactor'),
    seed = field('worldSeed');
  assert.equal(power.type, 'text');
  assert.equal(power.getAttribute('inputmode'), 'decimal');
  assert.equal(seed.type, 'text');
  assert.equal(seed.getAttribute('inputmode'), 'numeric');
  assert.equal(power.getAttribute('min'), '0');
  assert.equal(power.getAttribute('max'), '10');
});

test('the stored values are plain numbers: the draft gets 0.5 and 92100, never the display', async () => {
  const power = field('powerFactor'),
    spare = field('availablePowerMW');
  type(power, '0,5');
  leave(power);
  type(spare, '92.100');
  leave(spare);
  assert.equal(shown(spare), '92,100', 'a field of whole numbers reads "92.100" as 92100');
  const form = $<HTMLFormElement>('#wizard-form')!;
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  assert.equal(wizard!.settings.powerFactor, 0.5);
  assert.equal(wizard!.settings.availablePowerGW, 92.1);
  assert.equal(wizard!.settings.availablePowerGW * 1000, 92100);
  assert.equal(typeof wizard!.settings.powerFactor, 'number');
});

test('out-of-range and unreadable numbers are invalid, as the native field said', () => {
  const power = field('powerFactor');
  type(power, '11');
  assert.equal(power.validity.valid, false);
  assert.match(power.validationMessage, /10 or less/);
  type(power, 'abc');
  assert.equal(power.validity.valid, false);
  type(power, '1,5');
  assert.equal(power.validity.valid, true);
  type(power, '');
  assert.equal(power.validity.valueMissing || power.validity.valid, true);
});

test("the arrow keys step the value by the field's step, within its limits", () => {
  const power = field('powerFactor');
  power.focus();
  type(power, '0,5');
  const press = (key: string) =>
    power.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  press('ArrowUp');
  assert.equal(power.value, '0.6');
  press('ArrowDown');
  press('ArrowDown');
  assert.equal(power.value, '0.4');
  type(power, '10');
  press('ArrowUp');
  assert.equal(power.value, '10', 'the maximum holds');
  type(power, '0');
  press('ArrowDown');
  assert.equal(power.value, '0', 'the minimum holds');
});

test('a form sends the plain numbers of its number fields', () => {
  const form = $<HTMLFormElement>('#wizard-form')!,
    spare = field('availablePowerMW');
  type(spare, '92100');
  leave(spare);
  assert.equal(shown(spare), '92,100');
  // The browser's `formdata` event hands the entry list over; with the display in it, put the
  // plain number back.
  const data = new FormData(form);
  data.set('availablePowerMW', '92,100');
  plainNumbers(form, data);
  assert.equal(data.get('availablePowerMW'), '92100');
});
