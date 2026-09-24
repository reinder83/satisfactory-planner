// Small DOM and text helpers shared by every screen.
export const $ = s => document.querySelector(s);

// Escapes text for HTML text and quoted attributes. Views build HTML strings, so every
// user-provided or imported value (names, notes, task text) must pass through this.
export const esc = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

// Locale-formatted numbers with at most 2 (num) or 3 (num3) decimals.
export const num = n => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
export const num3 = n => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

// "Heavy Modular Frame" -> "heavy-modular-frame". Used for icon file names and for some
// saved keys (calculated delivery ids), so its output must stay the same.
export const slug = s =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const plural = (n, word) => num(n) + ' ' + word + (n === 1 ? '' : 's');
