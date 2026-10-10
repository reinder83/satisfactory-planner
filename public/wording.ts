// Plain-English wording shared by the planner (planner.ts, in both editions) and the browser app,
// so the plan's warnings and the pages it shows can never word the same thing differently (#748,
// #763). It is its own module, not part of preferences.ts, because the VM interface tests load
// public/app/ with the shared modules' exports supplied by hand (tests/helpers/app-source.ts),
// and this one is followed and loaded with the app instead.

// "Heavy Modular Frame" -> "heavy-modular-frame". Used for icon file names and for some
// saved keys (calculated delivery ids, deliveryKey in progression.ts), so its output must stay
// the same. public/app/format.ts passes it on to the app.
export const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// "A", "A and B", "A, B and C": names, phase numbers and items in prose (#611, #735). An empty
// list gives ''.
export const listNames = (names: readonly string[]): string =>
  names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names.at(-1) : names[0] || '';

// A number as the pages show one, locale-formatted with at most `digits` decimals (2 unless
// given), a missing value as 0: exactly what Number(value || 0).toLocaleString(undefined,
// { maximumFractionDigits: digits }) gives, but with one Intl.NumberFormat per digit count.
// toLocaleString with options builds a new formatter on every call, which made the build plan's
// step texts most of a tick's time on a phone (#1060, as in phaseSteps, #772). num in
// public/app/format.ts and the shared modules' numbers go through it.
const formatters = new Map<number, Intl.NumberFormat>();
export function localeNumber(value: number | null | undefined, digits = 2): string {
  let formatter = formatters.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: digits });
    formatters.set(digits, formatter);
  }
  return formatter.format(Number(value || 0));
}

// A whole count as the pages show numbers (num in public/app/format.ts): locale-formatted.
const count = (value: number) => localeNumber(value);

// A power figure as the pages show it: MW, or GW above 1,000 MW ("643.9 MW", "44.43 GW"). The
// pages' power() (public/app/wizard/fields.ts) and the build plan's power step (#1048) use it.
export const powerAmount = (mw: number): string =>
  mw > 1000 ? count(mw / 1000) + ' GW' : count(mw) + ' MW';

// A wait of `minutes` as a plain duration (#624): "less than a minute", "1 minute", "52 minutes",
// then hours and whole minutes from an hour on ("about 7 h 52 min", "about 8 h").
export function duration(minutes: number): string {
  if (minutes < 1) return 'less than a minute';
  const whole = Math.round(minutes);
  if (whole < 60) return `${count(whole)} minute${whole === 1 ? '' : 's'}`;
  const rest = whole % 60;
  return `about ${count(Math.floor(whole / 60))} h` + (rest ? ` ${count(rest)} min` : '');
}

// A phase's time, given in hours, in the same words (#643, #740): "about 7 h 52 min". The plan
// header, the Review step, ADA and the planner's warnings all use it.
export const durationOfHours = (hours: number): string => duration(hours * 60);
