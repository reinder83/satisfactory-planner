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

// HTML for a summary tile. Arguments are inserted as HTML; esc() user text first.
export function stat(label, value, caption) {
  return `<div class="stat"><span class="eyebrow">${label}</span><strong>${value}</strong><small>${caption}</small></div>`;
}

// HTML <img> for an item's bundled icon in icons/, or '' without a name. A trailing
// "(...)" qualifier is dropped first. Missing icons are hidden by an error listener in
// events/views.js.
export const itemIcon = name =>
  name
    ? `<img class="item-icon" src="./icons/${slug(String(name).replace(/\s*\([^)]*\)\s*$/, ''))}.png" width="42" height="42" loading="lazy" alt="">`
    : '';
