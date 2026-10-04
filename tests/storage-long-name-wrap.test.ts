// A storage floor's or bay's name can be one word of up to 80 characters (`label()` in
// public/state/validate.ts). On the Storage room page it breaks inside the floor's tab, the bay's
// heading, a search result naming its floor and a row of "Hidden bays and floors" rather than
// running past the page on a phone (#987). A word breaks only where it cannot fit its line, so a
// short name keeps its tab on one line, and on a phone the tab keeps its 44px height (#838).
// Layout is not measurable in happy-dom, so this checks the rules in style.css and that the
// templates still draw the elements they name; the browser measurements are in the pull request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file: string) =>
  fs.readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const style = read('../public/style.css').replace(/\/\*[\s\S]*?\*\//g, '');

// The phone breakpoint style.css uses.
const PHONE = 720;

// Every top-level @media block of style.css with its condition and body.
function mediaBlocks(css: string) {
  const blocks: { query: string; body: string }[] = [];
  const at = /@media([^{]*)\{/g;
  for (let match; (match = at.exec(css)); ) {
    let depth = 1;
    let i = at.lastIndex;
    for (; i < css.length && depth; i++) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0;
    // The pattern's one group always takes part in a match.
    blocks.push({ query: match[1]!.trim(), body: css.slice(at.lastIndex, i - 1) });
    at.lastIndex = i;
  }
  return blocks;
}

// The rules (selectors and declarations) in a stretch of CSS. Both groups always take part.
const rules = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({
    selectors: match[1]!.split(',').map(selector => selector.trim()),
    body: match[2]!,
  }));

const outsideRules = rules(mediaBlocks(style).reduce((css, b) => css.replace(b.body, ''), style));
const mediaRules = mediaBlocks(style).flatMap(b => rules(b.body));
const phoneRules = mediaBlocks(style)
  .filter(b => b.query === `(max-width: ${PHONE}px)`)
  .flatMap(b => rules(b.body));

// The declarations of every rule naming `selector` on its own, joined.
const declarations = (list: ReturnType<typeof rules>, selector: string) =>
  list
    .filter(rule => rule.selectors.includes(selector))
    .map(rule => rule.body)
    .join('\n');

const WRAPS = /(?:^|[;\s])overflow-wrap:\s*anywhere\s*;/;

// Where the Storage room page draws a floor's or a bay's name as text.
const names = [
  '.tab[data-floor]',
  '.bay-head h3',
  '.storage-result',
  '.hidden-bays .check-row > span:first-child',
];

test('a long word breaks inside the floor tab, the bay heading and the lists naming them (#987)', () => {
  for (const selector of names) {
    const body = declarations(outsideRules, selector);
    assert.ok(body, `style.css has a rule for ${selector} outside any media block`);
    assert.match(body, WRAPS, selector);
  }
});

test('no media block, print included, turns the breaking off again', () => {
  for (const rule of mediaRules)
    if (rule.selectors.some(selector => names.includes(selector) || selector === '.tab'))
      assert.doesNotMatch(
        rule.body,
        /(?:^|[;\s])(overflow-wrap|word-wrap):\s*normal\b|(?:^|[;\s])word-break:\s*keep-all\b/,
        rule.selectors.join(', '),
      );
});

test('a floor tab stays a tab: one line for a short name, 44px tall on a phone (#838)', () => {
  // Breaking anywhere, not at every letter: a short name never wraps.
  for (const list of [outsideRules, mediaRules])
    assert.doesNotMatch(
      declarations(list, '.tab[data-floor]') + declarations(list, '.tab'),
      /(?:^|[;\s])word-break:\s*break-all\b/,
    );
  assert.match(declarations(phoneRules, '.tab'), /(?:^|[;\s])min-height:\s*44px\s*;/);
});

test('the Restore beside a hidden bay keeps its word whole', () => {
  // Only the name breaks; a rule on the whole row would let the button shrink and split "Restore".
  assert.doesNotMatch(declarations(outsideRules, '.hidden-bays .check-row'), WRAPS);
});

test('the templates still draw the elements those rules name', () => {
  const page = read('../public/app/ui/pages/StoragePage.vue'),
    bay = read('../public/app/ui/storage/StorageBay.vue');
  // The floor tabs: buttons of class "tab" carrying data-floor, each showing the floor's label.
  assert.match(
    page,
    /<button\s[^>]*:class="\['tab',[^>]*:data-floor="storageFloor\.id"[^>]*>\s*\{\{ storageFloor\.label \}\}/,
  );
  // A search result names its floor inside its button.
  assert.match(page, /class="storage-result"[\s\S]*?\{\{ match\.floorLabel \}\}[\s\S]*?<\/button>/);
  // A hidden bay's or floor's row starts with the span naming it.
  assert.match(page, /data-hidden-bays[\s\S]*?class="check-row">\s*<span\s*>[\s\S]*?bay\.name/);
  assert.match(page, /class="check-row">\s*<span\s*><b>\{\{ hiddenFloor\.label \}\}/);
  // The bay's heading: an h3 in the bay's header showing its name.
  assert.match(bay, /<header class="bay-head">[\s\S]*?<h3 v-else>\{\{ bay\.name \}\}<\/h3>/);
});
