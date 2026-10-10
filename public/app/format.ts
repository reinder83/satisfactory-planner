// Small DOM and text helpers shared by every screen.
import { duration, durationOfHours, localeNumber, slug } from '../wording.ts';

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
// formats as 0. One formatter per digit count (localeNumber in wording.ts, #1060).
export const num = (value: number | null | undefined): string => localeNumber(value, 2);
export const num3 = (value: number | null | undefined): string => localeNumber(value, 3);

export const plural = (count: number, word: string): string =>
  num(count) + ' ' + word + (count === 1 ? '' : 's');

// A wait of `minutes` as a plain duration (#624), and a phase's time given in hours in the same
// words (#643): "45 minutes", "about 7 h 52 min". They live in public/wording.ts, which the
// planner's warnings use too (#763).
export { duration, durationOfHours };
// "Heavy Modular Frame" -> "heavy-modular-frame" (slug in public/wording.ts, which the build
// plan's delivery step reads too): icon file names and calculated delivery ids.
export { slug };

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
