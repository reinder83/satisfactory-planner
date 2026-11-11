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

// `value` the way a decimal field shows it: no thousands separator, so what is shown parses back
// to the same number ("1250.5", never "1,250.5", which another locale would read differently).
export function formatPlain(value: number, digits = 10): string {
  return formatNumber(value, digits).replaceAll(',', '');
}

// The number typed in a field, or null when the text is blank or not a number. Leniently:
// - spaces, no-break spaces and apostrophes (a thousands separator in some countries) are dropped,
//   and a typographic minus is a minus;
// - when both "," and "." occur, the last one is the decimal separator ("1.234,5" and "1,234.5"
//   are both 1234.5);
// - a separator that occurs more than once is a thousands separator ("1,234,567");
// - a single separator is the decimal mark in a field that takes decimals (the default): "1,250"
//   is 1.25 and "1.500" is 1.5, never 1250 or 1500, so a Dutch "1,250" is not read 1000x off;
// - in a whole-number field, or a grouped one that may hold decimals too (`whole`), a single "," or
//   "." followed by exactly three digits, after
//   1 to 3 digits that do not start with 0, is a thousands separator ("92,100" and "92.100" are
//   92100, as the pages print it); any other single separator is still the decimal mark.
export function parseNumber(text: string, whole = false): number | null {
  let value = text.replace(/[\s'’  ]/g, '').replace(/[−–]/g, '-');
  if (value === '') return null;
  const commas = value.split(',').length - 1,
    dots = value.split('.').length - 1;
  if (commas && dots) {
    const decimal = value.lastIndexOf(',') > value.lastIndexOf('.') ? ',' : '.',
      thousands = decimal === ',' ? '.' : ',';
    if (value.split(decimal).length !== 2) return null;
    // Every thousands separator is followed by exactly three digits ("1.250,5", "1,250.5"); "1.5,"
    // and "1,5." are mistakes, not numbers, and the decimals hold digits only.
    const [integer = '', fraction = ''] = value.split(decimal);
    if (!/^-?\d{1,3}(,\d{3})+$/.test(integer.replaceAll(thousands, ',')) || !/^\d*$/.test(fraction))
      return null;
    value = value.split(thousands).join('').replace(decimal, '.');
  } else if (commas || dots) {
    const mark = commas ? ',' : '.',
      [head = '', tail = ''] = value.split(mark);
    if (commas + dots > 1) {
      if (!GROUPED.test(value.replaceAll(mark, ','))) return null;
      value = value.split(mark).join('');
    } else if (whole && /^-?[1-9]\d{0,2}$/.test(head) && /^\d{3}$/.test(tail)) {
      value = head + tail;
    } else {
      value = value.replace(mark, '.');
    }
  }
  if (!PLAIN.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
