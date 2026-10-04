// A user's name can be one word of up to 80 characters (`label()` in public/state/validate.ts). Where
// it heads a page or a dialog it breaks inside the heading rather than running past the page or the
// dialog's edge (#976): the page heading (a factory group's flow page), the subtitle under it (the
// build plan's profile name), the factory dialog's heading ("Wire for <group>") and the line names
// on the flow page and in the dialog's flow. On a phone the dialog's heading stays one line cut
// with an ellipsis (#318). Layout is not measurable in happy-dom, so this checks the rules in
// style.css; the browser measurements are in the pull request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const style = fs
  .readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// The phone breakpoint style.css uses.
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

const outsideRules = () =>
  rules(mediaBlocks(style).reduce((css, b) => css.replace(b.body, ''), style));
const mediaRules = () => mediaBlocks(style).flatMap(b => rules(b.body));
const phoneRules = () =>
  mediaBlocks(style)
    .filter(b => b.query === `(max-width: ${PHONE}px)`)
    .flatMap(b => rules(b.body));

// The declarations of every rule naming `selector` on its own, joined.
const declarations = (list: ReturnType<typeof rules>, selector: string) =>
  list
    .filter(r => r.selectors.includes(selector))
    .map(r => r.body)
    .join('\n');

const WRAPS = /(?:^|[;\s])overflow-wrap:\s*anywhere\s*;/;

// Where a long name is drawn as a heading or a line's name, at every width.
const headings = ['h1', '.subtitle', '.dialog-head h2', '.rail-link'];

test('a long word breaks inside the page and dialog headings (#976)', () => {
  for (const selector of headings) {
    const body = declarations(outsideRules(), selector);
    assert.ok(body, `style.css has a rule for ${selector} outside any media block`);
    assert.match(body, WRAPS, selector);
  }
});

test('no media block turns the breaking off again', () => {
  for (const rule of mediaRules())
    if (rule.selectors.some(s => headings.includes(s)))
      assert.doesNotMatch(
        rule.body,
        /(?:^|[;\s])(overflow-wrap|word-wrap):\s*normal\b/,
        rule.selectors.join(', '),
      );
});

test("on a phone the dialog's heading stays one line cut with an ellipsis (#318)", () => {
  const body = declarations(phoneRules(), '.dialog-head h2');
  assert.match(body, /(?:^|[;\s])white-space:\s*nowrap\s*;/);
  assert.match(body, /(?:^|[;\s])text-overflow:\s*ellipsis\s*;/);
  assert.match(body, /(?:^|[;\s])overflow:\s*hidden\s*;/);
});
