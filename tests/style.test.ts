// Guards for the type floor and text contrast in public/style.css (SP-11, #246): no text
// smaller than 10.5px, and every text colour readable at WCAG AA (4.5:1) on the page
// backgrounds it is drawn on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const FLOOR_PX = 10.5;
const ROOT_PX = 13; // :root font-size, for rem values
const MIN_CONTRAST = 4.5;

// The stylesheet without comments and without the print block, which reverts to dark text on
// paper and has its own colours.
function screenCss(): string {
  let css = fs
    .readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const start = css.indexOf('@media print');
  if (start >= 0) {
    let depth = 0,
      end = css.indexOf('{', start);
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}' && --depth === 0) break;
    }
    css = css.slice(0, start) + css.slice(end + 1);
  }
  return css;
}

// Innermost rules: selector and declarations, with the line they start on.
function rules(css: string) {
  const out: { selector: string; body: string; line: number }[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    out.push({
      selector: m[1]!.trim().replace(/\s+/g, ' '),
      body: m[2]!,
      line: css.slice(0, m.index).split('\n').length,
    });
  return out;
}

const decls = (body: string, prop: string) =>
  [...body.matchAll(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`, 'g'))].map(m => m[1]!.trim());

// Every length in a font-size value, in px (clamp() and similar are checked argument by argument).
function sizesPx(value: string): number[] {
  return [...value.matchAll(/(\d*\.?\d+)(px|rem)\b/g)].map(m =>
    m[2] === 'rem' ? Number(m[1]) * ROOT_PX : Number(m[1]),
  );
}

test(`no font-size in style.css is below ${FLOOR_PX}px`, () => {
  const small: string[] = [];
  for (const r of rules(screenCss()))
    for (const v of decls(r.body, 'font-size')) {
      assert.ok(!/\d(em|%)\b|smaller|x-small|xx-small/.test(v), `${r.selector}: use px, not ${v}`);
      // font-size: 0 hides a text node whose label a pseudo-element draws (.navicon).
      for (const px of sizesPx(v)) if (px > 0 && px < FLOOR_PX) small.push(`${r.selector}: ${v}`);
    }
  assert.deepEqual(small, []);
});

const hex = (h: string): [number, number, number] => {
  let s = h.slice(1);
  if (s.length === 3) s = [...s].map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
};
const luminance = (h: string) => {
  const [r, g, b] = hex(h).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

function tokens(css: string): Record<string, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(css)![1]!; // style.css always opens with :root
  return Object.fromEntries(
    [...root.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)].map(m => [m[1]!, m[2]!]),
  );
}
// A colour value as a hex string, or null for inherit, currentColor, gradients and the like.
const resolve = (value: string, tok: Record<string, string>): string | null => {
  const v = /^var\(--([\w-]+)/.exec(value);
  const h = v ? tok[v[1]!] : value;
  return h && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(h) ? h : null;
};

const TEXT_TOKENS = [
  'ink',
  'bright',
  'muted',
  'dim',
  'kicker',
  'accent',
  'accent-hi',
  'green',
  'red',
  'blue',
  'gold',
];
const BACKGROUNDS = ['bg', 'bg2', 'panel', 'panel2'];

test(`text colour tokens reach ${MIN_CONTRAST}:1 on every page background`, () => {
  const tok = tokens(screenCss());
  const low: string[] = [];
  for (const t of TEXT_TOKENS)
    for (const b of BACKGROUNDS) {
      const r = contrast(tok[t]!, tok[b]!);
      if (r < MIN_CONTRAST) low.push(`--${t} on --${b}: ${r.toFixed(2)}`);
    }
  assert.deepEqual(low, []);
});

test(`every text colour in style.css reaches ${MIN_CONTRAST}:1 on its background`, () => {
  const css = screenCss(),
    tok = tokens(css);
  const low: string[] = [];
  for (const r of rules(css)) {
    // The step icons are aria-hidden decoration beside the step's own title.
    if (/\.task-icon\b/.test(r.selector)) continue;
    for (const value of decls(r.body, 'color')) {
      const fg = resolve(value, tok);
      if (!fg) continue;
      // A rule that paints its own solid background is read against that one.
      const own = decls(r.body, 'background(?:-color)?')
        .map(v => resolve(v, tok))
        .find(Boolean);
      const backs = own ? [own] : BACKGROUNDS.map(b => tok[b]!);
      for (const bg of backs) {
        const ratio = contrast(fg, bg);
        if (ratio < MIN_CONTRAST)
          low.push(`${r.selector} (line ${r.line}): ${value} on ${bg} is ${ratio.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(low, []);
});
