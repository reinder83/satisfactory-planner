// Small DOM and text helpers shared by every screen.

// The first element matching `s`, or null. `E` narrows the element type for TypeScript
// callers (`$<HTMLDialogElement>('#detail')`); it is not checked at run time.
export const $ = <E extends Element = HTMLElement>(s: string): E | null =>
  document.querySelector<E>(s);

// The element matching `s` that the page always has (#app, #detail, #toast in index.html, or
// one the caller just drew). Throws, naming the selector, if it is missing, where `$(s).x`
// would have thrown a vaguer TypeError.
export const required = <E extends Element = HTMLElement>(s: string): E => {
  const el = document.querySelector<E>(s);
  if (!el) throw Error('Missing element ' + s);
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
export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, c => ENTITIES[c] ?? c);

// Locale-formatted numbers with at most 2 (num) or 3 (num3) decimals. A missing value
// formats as 0.
export const num = (n: number | null | undefined): string =>
  Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
export const num3 = (n: number | null | undefined): string =>
  Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

// "Heavy Modular Frame" -> "heavy-modular-frame". Used for icon file names and for some
// saved keys (calculated delivery ids), so its output must stay the same.
export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const plural = (n: number, word: string): string =>
  num(n) + ' ' + word + (n === 1 ? '' : 's');

// The item searches (ui/form/ItemSearch.vue): up to `limit` of `items` for the typed text,
// case-insensitive, names that start with it first, then names that merely contain it.
export function itemMatches(items: readonly string[], query: unknown, limit = 8): string[] {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return [];
  const starts: string[] = [],
    contains: string[] = [];
  for (const n of items) {
    const l = n.toLowerCase();
    if (l.startsWith(q)) starts.push(n);
    else if (l.includes(q)) contains.push(n);
  }
  return [...starts, ...contains].slice(0, limit);
}

// The item of `items` the typed text names, ignoring case and surrounding spaces, spelled as
// the list spells it; undefined when it names none.
export function knownItem(items: readonly string[], typed: unknown): string | undefined {
  const q = String(typed ?? '')
    .trim()
    .toLowerCase();
  return q ? items.find(n => n.toLowerCase() === q) : undefined;
}
