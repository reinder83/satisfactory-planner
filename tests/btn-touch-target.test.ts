// Buttons (.btn) are 44px touch targets on a phone (#765), and unchanged on wider screens.
// Quiet buttons have their own phone rules: the text links keep their underline on the text
// (#832). Tabs and the wizard's step tabs grow to 44px too, the storage slot ⠿/✕ to 24px (#838).
// The storage "Move to…" select grows to 44px and a factory's ✕ per group to 24px wide (#842).
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

// The phone blocks' rules, and the rules outside any media block.
const phoneRules = () =>
  mediaBlocks(style)
    .filter(b => b.query === `(max-width: ${PHONE}px)`)
    .flatMap(b => rules(b.body));
const outsideRules = () =>
  rules(mediaBlocks(style).reduce((css, b) => css.replace(b.body, ''), style));
const phoneRule = (selector: string) => {
  const found = phoneRules().filter(r => r.selectors.includes(selector));
  assert.ok(found.length, `a max-width: ${PHONE}px block has a rule for ${selector}`);
  return found.map(r => r.body).join('\n');
};

// The quiet buttons of #832 that are underlined text links.
const quietLinks = [
  '.guided-escape .btn.quiet',
  '.assign-row .btn.quiet',
  '.ada-tools .btn.quiet',
  '.ada.is-muted .btn.quiet',
  '.alt-tools .btn.quiet',
];
// The other controls of #832 and #838 that grow to 44px on a phone.
const otherTargets = ['.bay-actions .btn.quiet', '.tab', '.wizard-progress button'];

test('quiet buttons and tabs are 44px tall at phone widths, height only (#832, #838)', () => {
  for (const selector of [...quietLinks, ...otherTargets]) {
    const body = phoneRule(selector);
    assert.match(body, /(^|[;\s])min-height:\s*44px\s*;/, selector);
    assert.doesNotMatch(body, /min-width/, selector);
  }
});

test('a quiet link keeps its underline on the text in the taller box (#832)', () => {
  for (const selector of quietLinks) {
    const body = phoneRule(selector);
    assert.match(body, /border-bottom:\s*0\s*;/, selector);
    assert.match(body, /text-decoration:\s*underline\b/, selector);
  }
  // The red ✕ keeps a red underline.
  assert.match(phoneRule('.assign-row .btn.quiet.danger'), /text-decoration-color:/);
});

test('the storage slot ⠿ and ✕ are 24px targets with space between them on a phone (#838)', () => {
  const both = phoneRules().find(
    r => r.selectors.includes('.slot-remove') && r.selectors.includes('.slot-drag'),
  );
  assert.ok(both, 'one phone rule sizes both');
  assert.match(both.body, /width:\s*24px/);
  assert.match(both.body, /height:\s*24px/);
  // ✕ sits at right: a, ⠿ at right: b; b - a - 24 is the gap between them.
  const right = (selector: string) => Number(/right:\s*(\d+)px/.exec(phoneRule(selector))?.[1]);
  assert.ok(right('.slot-drag') - right('.slot-remove') - 24 >= 4, 'at least 4px apart');
});

test('wider screens are unchanged: none of these controls has a min-height outside a media block', () => {
  for (const rule of outsideRules())
    if (rule.selectors.some(s => [...quietLinks, ...otherTargets].includes(s)))
      assert.doesNotMatch(rule.body, /min-height/, rule.selectors.join(', '));
});

test('the storage "Move to…" select is 44px tall on a phone, height only (#842)', () => {
  const body = phoneRule('.bay-actions .move-bay');
  assert.match(body, /(^|[;\s])min-height:\s*44px\s*;/);
  assert.doesNotMatch(body, /min-width/);
  for (const rule of outsideRules())
    if (rule.selectors.includes('.bay-actions .move-bay'))
      assert.doesNotMatch(rule.body, /min-height/);
});

test("a factory's ✕ per group is at least 24px wide on a phone, and unchanged on wider screens (#842)", () => {
  const body = phoneRule('.assign-row .btn.quiet.danger');
  const width = Number(/(?:^|[;\s])min-width:\s*(\d+)px\s*;/.exec(body)?.[1]);
  assert.ok(width >= 24, `min-width ${width}px is at least WCAG 2.5.8's 24px`);
  for (const rule of outsideRules())
    if (rule.selectors.includes('.assign-row .btn.quiet.danger'))
      assert.doesNotMatch(rule.body, /min-width/);
});
