// The production line dialog at 320px (#1305): the title may take two lines instead of being cut
// short, the Power cells of "Expansion by phase" keep "13.42 MW" on one line, and the Power Shard
// and somersloop fieldsets may shrink to the dialog instead of scrolling it sideways. Layout is not
// measurable in happy-dom, so this checks the rules in public/style.css; the browser check of the
// pull request measured them in Chrome at 320, 390 and 1440px.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs
  .readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// The bodies of every `@media (max-width: Npx)` block, with N.
function narrowBlocks() {
  const out: { width: number; body: string }[] = [];
  for (const m of css.matchAll(/@media \(max-width: (\d+)px\)\s*\{/g)) {
    let depth = 1,
      end = m.index + m[0].length;
    for (; end < css.length && depth; end++)
      if (css[end] === '{') depth++;
      else if (css[end] === '}') depth--;
    out.push({ width: Number(m[1]), body: css.slice(m.index + m[0].length, end - 1) });
  }
  return out;
}
function rule(body: string, selector: string) {
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    if (
      m[1]!
        .split(',')
        .map(s => s.trim().replace(/\s+/g, ' '))
        .includes(selector)
    )
      return m[2]!;
  return undefined;
}
const decl = (body: string | undefined, prop: string) =>
  body?.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`))?.[1]!.trim();
// The last rule for `selector` in a block that covers 320px (the widest such block first matches
// the cascade's order: later wins).
const at320 = (selector: string) =>
  narrowBlocks()
    .filter(block => block.width >= 320 && rule(block.body, selector))
    .map(block => rule(block.body, selector)!);

test('the dialog title takes two lines on a phone', () => {
  const rules = at320('.dialog-head h2');
  assert.ok(rules.length >= 2, 'the one-line rule and the two-line rule that follows it');
  const last = rules.at(-1);
  assert.equal(decl(last, 'white-space'), 'normal');
  assert.equal(decl(last, '-webkit-line-clamp'), '2');
  assert.equal(decl(last, 'overflow-wrap'), 'anywhere');
});

test('the Power cells of the expansion table never wrap', () => {
  const rules = at320('.expansion-table td[data-expansion-power]');
  assert.ok(rules.length, 'a rule for the Power cells at 320px');
  assert.equal(decl(rules.at(-1), 'white-space'), 'nowrap');
  // The cells are closer at 360px and below, so the table fits the dialog.
  const closer = narrowBlocks().find(block => block.width === 360);
  assert.ok(decl(rule(closer?.body ?? '', '.expansion-table td'), 'padding'));
});

test('the pin fieldsets may shrink to the dialog', () => {
  assert.equal(decl(rule(css, '.shard-pin'), 'min-width'), '0');
  assert.equal(decl(rule(css, '.sloop-pin'), 'min-width'), '0');
  assert.equal(decl(rule(css, '.shard-pin-row select'), 'min-width'), '0');
});
