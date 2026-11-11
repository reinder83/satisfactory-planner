// v-number: a number field that takes "," or "." and shows the app's one number format (#1331,
// BUG-6 and ONB-4, public/numbers.ts). A native <input type="number"> shows the browser's own
// separators ("0,5" in a Dutch browser, beside the "0.5×" the pages print) and cannot group
// thousands, so the field is a text box with a decimal keypad; this directive gives it back what
// the native one did:
// - the field's `value` is always the plain number ("92100", "0.5"), whatever is shown, so the
//   handlers, v-model and :value bindings that read and write it keep working on plain numbers;
//   a text that is not a number yet ("0,", "abc") reads as typed;
// - the text is formatted when the field is left ("92100" shows as "92,100") and typed as is;
// - min, max, step and the arrow keys behave as they did (validity is set as a custom message, so
//   reportValidity() and :invalid still see it);
// - a form's FormData holds the plain numbers as well (the browser's own `formdata` event).
import type { Directive } from 'vue';
import { formatNumber, parseNumber } from '../../../numbers.ts';

type Field = HTMLInputElement;

// The browser's own `value` of an input, looked up when a field is made (the module is also read
// where there is no DOM, as the tests' app entry check does).
const valueOf = () => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
const read = (field: Field): string => String(valueOf()?.get?.call(field) ?? '');
const write = (field: Field, text: string) => valueOf()?.set?.call(field, text);

// A field of whole numbers: its step is a whole number (not "any", not 0.1).
const whole = (field: Field) => /^[1-9]\d*$/.test(field.getAttribute('step') ?? '');
const parse = (field: Field) => parseNumber(read(field), whole(field));
const attribute = (field: Field, name: string) => parseNumber(field.getAttribute(name) ?? '');

// What the field shows for `text`: the number grouped, or while the field is being typed in the
// plain number, or the text itself when it is not a number.
function shown(field: Field, text: string): string {
  const number = parseNumber(text, whole(field));
  if (number === null) return text;
  return field.ownerDocument.activeElement === field ? String(number) : formatNumber(number, 10);
}

// The message the native number field gave for a value out of range, off its step or not a number.
function problem(field: Field): string {
  const text = read(field);
  if (text.trim() === '') return '';
  const number = parse(field);
  if (number === null) return 'Enter a number.';
  const min = attribute(field, 'min'),
    max = attribute(field, 'max'),
    step = attribute(field, 'step');
  if (min !== null && number < min) return `Value must be ${formatNumber(min, 10)} or more.`;
  if (max !== null && number > max) return `Value must be ${formatNumber(max, 10)} or less.`;
  if (field.getAttribute('step') !== 'any' && step !== null && step > 0) {
    const steps = (number - (min ?? 0)) / step;
    if (Math.abs(steps - Math.round(steps)) > 1e-7) return 'Enter a value that fits the step.';
  }
  return '';
}
const check = (field: Field) => field.setCustomValidity(problem(field));

const decimals = (number: number) => (String(number).split('.')[1] ?? '').length;

// The arrow keys step the value by `step` ("any" and no step: by 1), within min and max, as the
// native field's did.
function step(field: Field, direction: 1 | -1) {
  const min = attribute(field, 'min'),
    max = attribute(field, 'max'),
    size = field.getAttribute('step') === 'any' ? 1 : (attribute(field, 'step') ?? 1),
    current = parse(field) ?? 0,
    places = Math.max(decimals(size), decimals(current));
  let next = Number((current + direction * size).toFixed(places));
  if (min !== null && next < min) next = min;
  if (max !== null && next > max) next = max;
  field.value = String(next);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

// FormData with the plain number in each number field (the `formdata` event gets the form's entry
// list before a script or a submission reads it); other entries stay where they are. Exported for
// the tests.
export function plainNumbers(form: HTMLFormElement, data: FormData) {
  const fields = [...form.elements].filter(
    (el): el is Field =>
      el instanceof HTMLInputElement && el.hasAttribute('data-number') && !!el.name && !el.disabled,
  );
  const plain = new Map<string, string[]>();
  for (const field of fields)
    plain.set(field.name, [...(plain.get(field.name) ?? []), field.value]);
  for (const [name, values] of plain)
    if (data.getAll(name).length !== values.length) plain.delete(name);
  if (!plain.size) return;
  const entries = [...data];
  for (const name of plain.keys()) data.delete(name);
  for (const [name, value] of entries) data.append(name, plain.get(name)?.shift() ?? value);
}

let installed = false;
function install(field: Field) {
  if (installed) return;
  installed = true;
  field.ownerDocument.addEventListener(
    'formdata',
    event => {
      if (event instanceof FormDataEvent && event.target instanceof HTMLFormElement)
        plainNumbers(event.target, event.formData);
    },
    true,
  );
}

export const vNumber: Directive<Field, boolean | undefined> = {
  created(field, { value }) {
    if (value === false) return;
    field.type = 'text';
    field.setAttribute('data-number', '');
    // `value` reads as the plain number and writes show the app's format; the browser's own
    // property underneath keeps the text.
    Object.defineProperty(field, 'value', {
      configurable: true,
      get: () => {
        const text = read(field),
          number = parse(field);
        return number === null ? text : String(number);
      },
      set: (text: unknown) => write(field, shown(field, String(text ?? ''))),
    });
    field.addEventListener('input', () => check(field));
    field.addEventListener('blur', () => {
      write(field, shown(field, read(field)));
      check(field);
    });
    field.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      step(field, event.key === 'ArrowUp' ? 1 : -1);
    });
    install(field);
  },
  mounted: field => {
    if (!field.hasAttribute('data-number')) return;
    if (!field.hasAttribute('inputmode'))
      field.setAttribute('inputmode', whole(field) ? 'numeric' : 'decimal');
    check(field);
  },
  updated: field => {
    if (field.hasAttribute('data-number')) check(field);
  },
};
