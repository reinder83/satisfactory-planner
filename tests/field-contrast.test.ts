// A text field's border shows against what it sits on (#1256, WCAG 1.4.11 Non-text Contrast, 3:1):
// the border was --line, 1.4:1 against a panel, so empty fields were all but invisible. Every rule
// in style.css that draws a field's border uses a :root token (no new colours) with at least 3:1
// against the field's own background and every page surface. Layout and colour are not measurable
// in happy-dom, so this computes the contrast of the colours the stylesheet names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file: string) =>
  fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const style = read('public/style.css').replace(/\/\*[\s\S]*?\*\//g, '');

// The colour tokens of :root, and the surfaces a field sits on: the page, panels, rows, and the
// stops of the raised and bar gradients.
const root = /:root\s*\{([^}]*)\}/.exec(style)![1]!;
const tokens: Record<string, string> = Object.fromEntries(
  [...root.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(m => [m[1], m[2]!.toLowerCase()]),
);
const gradientStops = [...root.matchAll(/--(?:raise|bar):([^;]*);/g)].flatMap(m =>
  [...m[1]!.matchAll(/#[0-9a-f]{6}/gi)].map(hex => hex[0].toLowerCase()),
);
const surfaces = [
  ...['bg', 'bg2', 'panel', 'panel2', 'row'].map(name => tokens[name]!),
  ...gradientStops,
];

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

// A colour a declaration names: a token's value or a hex colour.
const colourOf = (value: string) => {
  const token = /var\(--([\w-]+)\)/.exec(value);
  return token ? tokens[token[1]!] : /#[0-9a-f]{6}\b/i.exec(value)?.[0].toLowerCase();
};

// Every top-level @media block of style.css with its condition and body.
function mediaBlocks(css: string) {
  const blocks: { query: string; body: string }[] = [];
  const at = /@media([^{]*)\{/g;
  for (let m; (m = at.exec(css));) {
    let depth = 1;
    let i = at.lastIndex;
    for (; i < css.length && depth; i++) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0;
    blocks.push({ query: m[1]!.trim(), body: css.slice(at.lastIndex, i - 1) });
    at.lastIndex = i;
  }
  return blocks;
}
// The screen rules: a printout draws fields on white with rules of its own.
const screen = mediaBlocks(style)
  .filter(block => block.query === 'print')
  .reduce((css, block) => css.replace(block.body, ''), style);
const rules = [...screen.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({
  selectors: m[1]!.split(',').map(s => s.trim().replace(/\s+/g, ' ')),
  body: m[2]!,
}));

// The classes and ids the templates give a text field (input, select, textarea; not a check box,
// radio, hidden or file input). The storage "Move to…" select is drawn as one of the bay buttons
// beside it (#852), a labelled box rather than a field to type in.
const NOT_FIELDS = new Set(['checkbox', 'radio', 'hidden', 'file']);
const fieldNames = new Set<string>();
for (const file of fs.readdirSync(new URL('../public/app/ui/', import.meta.url), {
  recursive: true,
}))
  if (String(file).endsWith('.vue'))
    for (const tag of read('public/app/ui/' + String(file).replace(/\\/g, '/')).matchAll(
      /<(?:input|select|textarea)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/g,
    )) {
      const type = /\stype="([^"]+)"/.exec(tag[1]!)?.[1];
      if (type && NOT_FIELDS.has(type)) continue;
      for (const name of /\sclass="([^"]+)"/.exec(tag[1]!)?.[1]!.split(/\s+/) ?? [])
        fieldNames.add('.' + name);
      const id = /\sid="([^"]+)"/.exec(tag[1]!)?.[1];
      if (id) fieldNames.add('#' + id);
    }
fieldNames.delete('.move-bay');

// Whether a selector draws a field: its last compound is a field element or a field's class/id.
function drawsField(selector: string) {
  const last = selector
    .replace(/:(?:not|has|where|is)\([^)]*\)/g, '')
    .split(/[\s>+~]+/)
    .pop()!;
  if (/::|:checked|\[type='(?:checkbox|radio|file|hidden)'\]/.test(last)) return false;
  if (/^(?:input|select|textarea)(?![\w-])/.test(last)) return true;
  return [...fieldNames].some(name =>
    new RegExp(`${name.replace(/[.#-]/g, '\\$&')}(?![\\w-])`).test(last),
  );
}

const fieldBorders = rules
  .filter(rule => rule.selectors.some(drawsField))
  .flatMap(rule =>
    [...rule.body.matchAll(/(?:^|[;\s])(border(?:-color)?):\s*([^;]+);/g)]
      .filter(m => !/^(?:0|none)\b/.test(m[2]!.trim()))
      .map(m => ({
        where: rule.selectors.join(', '),
        value: m[2]!.trim(),
        background: /(?:^|[;\s])background(?:-color)?:\s*([^;]+);/.exec(rule.body)?.[1],
      })),
  );

test('the templates name the field classes this test looks for', () => {
  for (const name of ['.search', '.notes', '.bay-rename', '.used-input', '#rate-filter'])
    assert.ok(fieldNames.has(name), name);
  assert.ok(fieldBorders.length >= 15, `${fieldBorders.length} field borders found`);
});

test('the old field border, --line, was below 3:1 against a panel (#1256)', () => {
  assert.ok(contrast(tokens.line!, tokens.panel!) < 3);
});

test("every field's border is a :root token with 3:1 against its background and every surface (#1256)", () => {
  for (const border of fieldBorders) {
    assert.match(
      border.value,
      /var\(--[\w-]+\)/,
      `${border.where}: a :root token, not a new colour`,
    );
    const colour = colourOf(border.value);
    assert.ok(colour, `${border.where}: ${border.value} is a plain colour token`);
    const backgrounds = [...surfaces];
    const own = border.background && colourOf(border.background);
    if (own) backgrounds.push(own);
    for (const background of backgrounds) {
      const ratio = contrast(colour, background);
      assert.ok(
        ratio >= 3,
        `${border.where}: ${border.value} on ${background} is ${ratio.toFixed(2)}:1, below 3:1`,
      );
    }
  }
});
