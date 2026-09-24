// HTML templating for the views: html`...` escapes every interpolated value unless it is
// already markup, so user text (names, notes, task text, imported values) is safe by
// default instead of relying on each call site remembering esc().
//
//   html`<h2>${profile.name}</h2>`          -> the name is escaped
//   html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>`
//                                           -> arrays are joined, no .join('') needed
//   html`${ok && html`<b>Done</b>`}`        -> null, undefined and false render nothing
//   html`<p>${raw(trustedMarkup)}</p>`      -> raw() marks a string as markup
//
// Numbers render, 0 included, so guard counts with a comparison: `${n > 0 && ...}`, not
// `${n && ...}`, which prints "0".
//
// The result is an Html value: a String object, so render functions can still be
// concatenated, assigned to innerHTML and searched with .includes() by the tests. Never
// build markup by concatenating strings and then interpolating the result: a plain string
// is text and is escaped. Put nested markup in its own html`` (or wrap it in raw()).
import { esc } from './format.js';

export class Html extends String {}

// Marks a string that already is markup (from a helper still built by concatenation, or a
// fixed literal) so html`` inserts it unescaped. Never pass user text to raw().
export const raw = s => (s instanceof Html ? s : new Html(s ?? ''));

// Prettier formats html`` templates like HTML files, spreading them over indented lines.
// Collapsing each line break and its indentation to one space keeps the rendered text as
// it was: between block elements the space is invisible, and inside text it is the space
// that was already there. Two of Prettier's breaks are removed instead. Where adding a
// space would change inline text, it breaks inside the tag (`<b\n  >text`, `</a\n>`);
// a break before `>` only ever occurs inside a tag. And it breaks straight after
// <textarea> and <pre>, which the HTML parser drops, so that break must not become a
// leading space in the field. Interpolated values are not touched, so a note keeps its
// line breaks, but static text inside a textarea or pre must stay on one line. The static
// parts are cached per template.
const statics = new WeakMap();
function strip(strings) {
  let parts = statics.get(strings);
  if (!parts) {
    // Joined with a placeholder so a tag with interpolated attributes is still matched.
    parts = strings
      .join('\0')
      .replace(/\s*\n\s*(\/?>)/g, '$1')
      .replace(/(<(?:textarea|pre)\b[^>]*>)[ \t]*\n/g, '$1')
      // A template that starts or ends on its own line loses that break; a plain space at
      // either end is deliberate (html` <span>…`) and stays.
      .replace(/^\s*\n\s*|\s*\n\s*$/g, '')
      .replace(/\s*\n\s*/g, ' ')
      .split('\0');
    statics.set(strings, parts);
  }
  return parts;
}

// One interpolated value as markup.
function part(v) {
  if (v == null || v === false) return '';
  if (v instanceof Html) return v.toString();
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

export function html(strings, ...values) {
  const parts = strip(strings);
  let out = parts[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + parts[i + 1];
  return new Html(out);
}
