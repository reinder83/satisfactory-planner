// Small DOM and text helpers shared by every screen.

export const $ = s => document.querySelector(s);

export const esc = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export const num = n => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
export const num3 = n => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

export const slug = s =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const plural = (n, word) => num(n) + ' ' + word + (n === 1 ? '' : 's');

export function stat(label, value, caption) {
  return `<div class="stat"><span class="eyebrow">${label}</span><strong>${value}</strong><small>${caption}</small></div>`;
}

export const itemIcon = name =>
  name
    ? `<img class="item-icon" src="./icons/${slug(String(name).replace(/\s*\([^)]*\)\s*$/, ''))}.png" width="42" height="42" loading="lazy" alt="">`
    : '';
