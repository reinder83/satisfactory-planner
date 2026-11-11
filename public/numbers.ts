// The app's one number format (#1331, BUG-6 and ONB-4). Everything the pages show goes through
// formatNumber or localeNumber (public/wording.ts), and everything a number field accepts goes
// through parseNumber, so a number reads the same whatever the browser's language: "92,100",
// "0.5", a comma for thousands and a dot for decimals. The format is fixed rather than the
// machine's: the app's words are English, and a Dutch browser used to show "0,5" in one field
// and "0.5×" in the next. Saved values stay plain numbers; only what is shown and typed differs.

export const NUMBER_LOCALE = 'en-US';

const formats = new Map<number, Intl.NumberFormat>();
// `value` as the pages show it: thousands separated, a dot before up to `digits` decimals.
export function formatNumber(value: number, digits = 2): string {
  let format = formats.get(digits);
  if (!format) {
    format = new Intl.NumberFormat(NUMBER_LOCALE, { maximumFractionDigits: digits });
    formats.set(digits, format);
  }
  return format.format(value);
}

const GROUPED = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
const PLAIN = /^-?(\d+\.?\d*|\.\d+)$/;

// The number typed in a field, or null when the text is blank or not a number. Leniently:
// - spaces, no-break spaces and apostrophes (a thousands separator in some countries) are dropped,
//   and a typographic minus is a minus;
// - when both "," and "." occur, the last one is the decimal separator ("1.234,5" and "1,234.5"
//   are both 1234.5);
// - a separator that occurs more than once is a thousands separator ("1,234,567");
// - a single "," is a thousands separator when exactly three digits follow it and the part before
//   is 1 to 3 digits that do not start with 0 ("92,100" is 92100, as the pages print it), and
//   a decimal comma otherwise ("0,5", "1,25", "0,125");
// - a single "." is a decimal point ("0.5", "92.1", "0.125"), except in a whole-number field
//   (`whole`), where exactly three digits after it make it a thousands separator: "92.100" is
//   92100 in a field of whole numbers, and 92.1 in one that takes decimals.
export function parseNumber(text: string, whole = false): number | null {
  let value = text.replace(/[\s'’  ]/g, '').replace(/[−–]/g, '-');
  if (value === '') return null;
  const commas = value.split(',').length - 1,
    dots = value.split('.').length - 1;
  if (commas && dots) {
    const decimal = value.lastIndexOf(',') > value.lastIndexOf('.') ? ',' : '.',
      thousands = decimal === ',' ? '.' : ',';
    if (value.split(decimal).length !== 2) return null;
    value = value.split(thousands).join('').replace(decimal, '.');
  } else if (commas) {
    const [head = '', tail = ''] = value.split(',');
    if (commas > 1 && !GROUPED.test(value)) return null;
    const grouped = commas > 1 || (/^-?[1-9]\d{0,2}$/.test(head) && /^\d{3}$/.test(tail));
    value = grouped ? value.split(',').join('') : value.replace(',', '.');
  } else if (dots > 1) {
    if (!GROUPED.test(value.replaceAll('.', ','))) return null;
    value = value.split('.').join('');
  } else if (dots && whole) {
    const [head = '', tail = ''] = value.split('.');
    if (/^-?[1-9]\d{0,2}$/.test(head) && /^\d{3}$/.test(tail)) value = head + tail;
  }
  if (!PLAIN.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
