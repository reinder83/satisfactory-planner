// Buttons (.btn) are 44px touch targets on a phone (#765), and unchanged on wider screens.
// Quiet buttons are left out: they are underlined text links with their own phone rules.
// Layout is not measurable in happy-dom, so this checks the rule in style.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const style = fs
  .readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// The phone breakpoint style.css uses for its own 44px targets.
const PHONE = 720;

// Every top-level @media block of style.css with its condition and body.
function mediaBlocks(css: string) {
  const blocks: { query: string; body: string }[] = [];
  const at = /@media([^{]*)\{/g;
  for (let m; (m = at.exec(css)); ) {
    let depth = 1;
    let i = at.lastIndex;
    for (; i < css.length && depth; i++) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0;
    blocks.push({ query: m[1]!.trim(), body: css.slice(at.lastIndex, i - 1) });
    at.lastIndex = i;
  }
  return blocks;
}

// The rules (selectors and declarations) in a stretch of CSS.
const rules = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({
    selectors: m[1]!.split(',').map(s => s.trim()),
    body: m[2]!,
  }));

test('every button but a quiet one is 44px tall at phone widths (#765)', () => {
  const phone = mediaBlocks(style).filter(b => b.query === `(max-width: ${PHONE}px)`);
  const target = phone
    .flatMap(b => rules(b.body))
    .find(r => r.selectors.includes('.btn:not(.quiet)'));
  assert.ok(target, `a max-width: ${PHONE}px block has a .btn:not(.quiet) rule`);
  assert.deepEqual(target.selectors, ['.btn:not(.quiet)']);
  assert.match(target.body, /(^|[;\s])min-height:\s*44px\s*;/);
  // Height only; a min-width shrank buttons elsewhere (#750).
  assert.doesNotMatch(target.body, /min-width/);
});

test('wider screens are unchanged: no min-height on plain .btn outside the media blocks', () => {
  const outside = mediaBlocks(style).reduce((css, b) => css.replace(b.body, ''), style);
  for (const rule of rules(outside))
    if (rule.selectors.some(s => /^\.btn(:not\(\.quiet\))?$/.test(s)))
      assert.doesNotMatch(rule.body, /min-height/);
});
