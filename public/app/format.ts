// Small DOM and text helpers shared by every screen.

// The first element matching `selector`, or null. `E` narrows the element type for TypeScript
// callers (`$<HTMLDialogElement>('#detail')`); it is not checked at run time.
export const $ = <E extends Element = HTMLElement>(selector: string): E | null =>
  document.querySelector<E>(selector);

// The element matching `selector` that the page always has (#app, #detail, #toast in index.html, or
// one the caller just drew). Throws, naming the selector, if it is missing, where `$(selector).x`
// would have thrown a vaguer TypeError.
export const required = <E extends Element = HTMLElement>(selector: string): E => {
  const el = document.querySelector<E>(selector);
  if (!el) throw Error('Missing element ' + selector);
  return el;
};

// Escapes text for HTML text and quoted attributes: the few strings of markup built outside
// components (the timeout advice) must pass every user-provided or imported value through
// this.
const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, match => ENTITIES[match] ?? match);

// Locale-formatted numbers with at most 2 (num) or 3 (num3) decimals. A missing value
// formats as 0.
export const num = (value: number | null | undefined): string =>
  Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
export const num3 = (value: number | null | undefined): string =>
  Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

// "Heavy Modular Frame" -> "heavy-modular-frame". Used for icon file names and for some
// saved keys (calculated delivery ids), so its output must stay the same.
export const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const plural = (count: number, word: string): string =>
  num(count) + ' ' + word + (count === 1 ? '' : 's');

// A wait of `minutes` as a plain duration (#624): "less than a minute", "1 minute", "52 minutes",
// then hours and whole minutes from an hour on ("about 7 h 52 min", "about 8 h").
export function duration(minutes: number): string {
  if (minutes < 1) return 'less than a minute';
  const whole = Math.round(minutes);
  if (whole < 60) return plural(whole, 'minute');
  const rest = whole % 60;
  return `about ${num(Math.floor(whole / 60))} h` + (rest ? ` ${num(rest)} min` : '');
}

// The item searches (ui/form/ItemSearch.vue): up to `limit` of `items` for the typed text,
// case-insensitive, names that start with it first, then names that merely contain it.
export function itemMatches(items: readonly string[], query: unknown, limit = 8): string[] {
  const search = String(query || '')
    .trim()
    .toLowerCase();
  if (!search) return [];
  const starts: string[] = [],
    contains: string[] = [];
  for (const item of items) {
    const lower = item.toLowerCase();
    if (lower.startsWith(search)) starts.push(item);
    else if (lower.includes(search)) contains.push(item);
  }
  return [...starts, ...contains].slice(0, limit);
}

// The item of `items` the typed text names, ignoring case and surrounding spaces, spelled as
// the list spells it; undefined when it names none.
export function knownItem(items: readonly string[], typed: unknown): string | undefined {
  const search = String(typed ?? '')
    .trim()
    .toLowerCase();
  return search ? items.find(item => item.toLowerCase() === search) : undefined;
}
