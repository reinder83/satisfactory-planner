// Text reaches 4.5:1 (#1355, A11Y-1, WCAG 1.4.3 Contrast Minimum). The small grey captions and
// every other text colour are tokens on :root (and literals in a few rules), so this computes the
// contrast of the colours the stylesheet names rather than listing the ones that failed: every
// token a `color:` declaration uses, and every light literal colour a rule gives text, against
// each surface the text sits on, on screen and in the print palette (dark text on white).
// Layout and colour are not measurable in happy-dom, which is why this reads the stylesheet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file: string) =>
  fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const css = read('public/style.css').replace(/\/\*[\s\S]*?\*\//g, '');

// WCAG 2's relative luminance and contrast ratio.
function luminance(hex: string) {
  const channel = (i: number) => {
    const value = parseInt(hex.slice(i, i + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

// Every top-level @media block with its condition and body.
function mediaBlocks(source: string) {
  const blocks: { query: string; body: string }[] = [];
  const at = /@media([^{]*)\{/g;
  for (let m; (m = at.exec(source)); ) {
    let depth = 1;
    let i = at.lastIndex;
    for (; i < source.length && depth; i++)
      depth += source[i] === '{' ? 1 : source[i] === '}' ? -1 : 0;
    blocks.push({ query: m[1]!.trim(), body: source.slice(at.lastIndex, i - 1) });
    at.lastIndex = i;
  }
  return blocks;
}
const printBlock = mediaBlocks(css).find(block => block.query === 'print')!.body;
const screen = css.replace(printBlock, '');

const tokensOf = (block: string) =>
  Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(m => [m[1], m[2]!.toLowerCase()]),
  );
const root = /:root\s*\{([^}]*)\}/.exec(screen)![1]!;
const tokens = tokensOf(root);
const printRoot = /:root\s*\{([^}]*)\}/.exec(printBlock)![1]!;
const printTokens = { ...tokens, ...tokensOf(printRoot) };

const stops = (names: string[]) =>
  names.flatMap(name =>
    [...new RegExp(`--${name}:([^;]*);`).exec(root)![1]!.matchAll(/#[0-9a-f]{6}/gi)].map(hex =>
      hex[0].toLowerCase(),
    ),
  );
// What screen text sits on: the page, panels and rows, the stops of the raised and bar gradients,
// and the three literal fills that carry text of their own: the top bar, a tooltip, a toast.
const surfaces = [
  ...['bg', 'bg2', 'panel', 'panel2', 'row'].map(name => tokens[name]!),
  ...stops(['raise', 'bar']),
  '#0f1214',
  '#22272b',
  '#1e2225',
  '#241a18',
];
const paper = ['#ffffff', '#f3f3f3', '#eeeeee'];

const rules = [...screen.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({
  selector: m[1]!.trim().replace(/\s+/g, ' '),
  body: m[2]!,
}));
const colorValues = rules.flatMap(rule =>
  [...rule.body.matchAll(/(?:^|[\s;])color:\s*([^;]+);?/g)].map(m => ({
    selector: rule.selector,
    value: m[1]!.trim(),
  })),
);

// The text tokens: every `var(--x)` a color declaration uses.
const textTokens = [
  ...new Set(
    colorValues.flatMap(({ value }) => [...value.matchAll(/var\(--([\w-]+)/g)].map(m => m[1]!)),
  ),
].filter(name => tokens[name]);

test('the stylesheet names its text tokens (the scan found them)', () => {
  for (const name of ['muted', 'dim', 'kicker', 'ink', 'accent', 'red', 'green'])
    assert.ok(textTokens.includes(name), `--${name} is used for text`);
});

test('every text token reaches 4.5:1 on every surface it sits on (A11Y-1)', () => {
  const failures: string[] = [];
  for (const name of textTokens)
    for (const surface of surfaces) {
      const ratio = contrast(tokens[name]!, surface);
      if (ratio < 4.5)
        failures.push(`--${name} ${tokens[name]} on ${surface}: ${ratio.toFixed(2)}:1`);
    }
  assert.deepEqual(failures, []);
});

test('the print palette reads on paper: every text token reaches 4.5:1 on white', () => {
  const failures: string[] = [];
  for (const name of textTokens)
    for (const surface of paper) {
      const ratio = contrast(printTokens[name]!, surface);
      if (ratio < 4.5)
        failures.push(`--${name} ${printTokens[name]} on ${surface}: ${ratio.toFixed(2)}:1`);
    }
  assert.deepEqual(failures, []);
});

// Icon glyphs and the like, not text: a completed step's icon is dimmed on purpose (its title,
// 4.5:1 above, carries the meaning). Everything else a rule colours with a literal is text.
const NOT_TEXT = new Set(['.task:has(input:checked) .task-icon', '.task.is-idle .task-icon']);

test('a literal text colour in a rule also reaches 4.5:1 (A11Y-1)', () => {
  const failures: string[] = [];
  for (const { selector, value } of colorValues) {
    const hex = /^#[0-9a-f]{6}$/i.exec(value)?.[0].toLowerCase();
    if (!hex || NOT_TEXT.has(selector)) continue;
    // Light text is read on the dark surfaces; dark text sits on a bright fill (the orange of a
    // primary button, a green, a gold) and is measured against the weakest of them.
    const against =
      luminance(hex) > 0.18 ? surfaces : [tokens.accent!, tokens.green!, tokens.gold!, '#ffffff'];
    for (const surface of against) {
      const ratio = contrast(hex, surface);
      if (ratio < 4.5)
        failures.push(`${selector}: ${hex} on ${surface}: ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, []);
});
