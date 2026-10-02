// The vehicle, round trip and fuel controls of a link on the Logistics page (#674,
// ui/factories/GroupLinks.vue) are 44px touch targets on a phone, and unchanged on wider screens.
// Layout is not measurable in happy-dom, so this checks the rule in style.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file: string) =>
  fs
    .readFileSync(new URL('../' + file, import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
const style = read('public/style.css');

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

// The rules (selectors and declarations) whose selector list names .link-transport.
const linkRules = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(m => ({ selectors: m[1]!.split(',').map(s => s.trim()), body: m[2]! }))
    .filter(r => r.selectors.some(s => s.includes('.link-transport')));

test("a link row's controls are 44px tall at phone widths (#674)", () => {
  const phone = mediaBlocks(style).filter(b => b.query === `(max-width: ${PHONE}px)`);
  const rules = phone.flatMap(b => linkRules(b.body));
  const target = rules.find(r => /(^|[;\s])min-height:\s*44px\s*;/.test(r.body));
  assert.ok(target, `a max-width: ${PHONE}px block gives the link controls a 44px min-height`);
  assert.deepEqual(target.selectors.sort(), ['.link-transport input', '.link-transport select']);
});

test('wider screens are unchanged: no min-height on the link controls outside the phone block', () => {
  const outside = mediaBlocks(style).reduce((css, b) => css.replace(b.body, ''), style);
  for (const rule of linkRules(outside)) assert.doesNotMatch(rule.body, /min-height/);
});
