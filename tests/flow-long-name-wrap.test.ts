// A factory group's name can be one word of up to 80 characters (`label()` in
// public/state/validate.ts). Where the flow and the build plan name a group in running text, the
// word breaks inside its box rather than running past it: the "Comes in" / "Goes out" boxes of a
// group's flow page, headed by the other place's name (#997); the cells of the flow page's
// "The diagram as a table" that name a line or a place, and the notes under "Delivers" in a factory
// dialog (#988); the build plan's side column, whose "Profile assumptions" names the groups that
// make items on site (#996). The table breaks only those cells, each keeping room for an ordinary
// word, so a short word is never split letter by letter. Layout is not measurable in happy-dom, so
// this checks the rules in style.css and that the templates still draw the elements they name; the
// browser measurements are in the pull request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file: string) =>
  fs.readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const style = read('../public/style.css').replace(/\/\*[\s\S]*?\*\//g, '');

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

// The declarations of every rule naming `selector` on its own, joined.
const declarations = (list: ReturnType<typeof rules>, selector: string) =>
  list
    .filter(rule => rule.selectors.includes(selector))
    .map(rule => rule.body)
    .join('\n');

const WRAPS = /(?:^|[;\s])overflow-wrap:\s*anywhere\s*;/;

// Where the flow page, the factory dialog's flow and the build plan's side column draw a group's
// name in running text.
const names = [
  '.gf-port h3',
  '.gf-port h4',
  '.gf-text td.gf-cell-name',
  '.rail-rows ~ p',
  '.split > aside .panel p',
  '.split > aside .panel li',
];

test('a long word breaks in the flow ports, the flow table, the dialog notes and the plan aside', () => {
  for (const selector of names) {
    const body = declarations(outsideRules, selector);
    assert.ok(body, `style.css has a rule for ${selector} outside any media block`);
    assert.match(body, WRAPS, selector);
  }
});

test('no media block, print included, turns the breaking off again', () => {
  for (const rule of mediaRules)
    if (rule.selectors.some(selector => names.includes(selector)))
      assert.doesNotMatch(
        rule.body,
        /(?:^|[;\s])(overflow-wrap|word-wrap):\s*normal\b|(?:^|[;\s])word-break:\s*keep-all\b/,
        rule.selectors.join(', '),
      );
});

test('the flow table breaks only the cells naming a line or a place, each wide enough for a word', () => {
  // Breaking anywhere lets a cell shrink to one letter, so the cell keeps a minimum width.
  const cell = declarations(outsideRules, '.gf-text td.gf-cell-name');
  assert.match(cell, /(?:^|[;\s])min-width:\s*\d+(?:\.\d+)?(?:ch|em)\s*;/);
  for (const list of [outsideRules, mediaRules]) {
    assert.doesNotMatch(
      declarations(list, '.gf-text td.gf-cell-name'),
      /(?:^|[;\s])word-break:\s*break-all\b/,
    );
    // The number, machines, item, rate and belts columns keep their words whole.
    for (const selector of ['.gf-text td', '.gf-text table', '.gf-text', 'td', 'table'])
      assert.doesNotMatch(declarations(list, selector), WRAPS, selector);
  }
});

test('the templates still draw the elements those rules name', () => {
  const ports = read('../public/app/ui/group-flow/FlowPorts.vue'),
    table = read('../public/app/ui/group-flow/FlowTable.vue'),
    diagram = read('../public/app/ui/detail/FlowDiagram.vue'),
    plan = read('../public/app/ui/pages/CalculatedPlanPage.vue'),
    warnings = read('../planner/warnings.ts');
  // A port's box is headed by the place's name; in the folded "Sink & storage", by an h4.
  assert.match(
    ports,
    /<section v-for="place in places"[^>]*class="gf-port">\s*<h3>\{\{ place\.label \}\}<\/h3>/,
  );
  assert.match(ports, /class="gf-port gf-fold"[\s\S]*?<h4>\{\{ place\.label \}\}<\/h4>/);
  // The table's cells naming a line, where a link comes from and where it goes.
  assert.match(table, /<details class="gf-text"/);
  assert.match(table, /<td class="gf-cell-name">\{\{ line\.name \}\}<\/td>/);
  assert.match(table, /<td class="gf-cell-name">\{\{ connection\.from \}\}<\/td>/);
  assert.match(table, /<td class="gf-cell-name">\{\{ connection\.to \}\}<\/td>/);
  assert.equal(table.match(/class="gf-cell-name"/g)?.length, 3);
  // The notes naming a group follow the "Delivers" rows as their siblings.
  assert.match(
    diagram,
    /<div class="rail-rows">[\s\S]*?<\/div>\s*<p v-if="[^"]*ownLine[^"]*" class="small muted">\s*Made on site for \{\{ flow\.model\.bankNote\.ownLine \}\}/,
  );
  assert.match(
    diagram,
    /<p v-else-if="flow\.model\.bankNote\?\.ownLine" class="small muted">\s*Demand of \{\{ flow\.model\.bankNote\.ownLine \}\}/,
  );
  // The build plan's side column: "Profile assumptions" in a panel of the aside in .split.
  assert.match(
    plan,
    /<div :class="[^"]*'split'[^"]*">[\s\S]*?<aside[^>]*>[\s\S]*?<section class="panel">\s*<h2>Profile assumptions<\/h2>\s*<p v-for="\(warning, i\) in page\.warnings" :key="i" class="small">\{\{ warning \}\}<\/p>/,
  );
  // …which names the groups that make items on site.
  assert.match(
    warnings,
    /`Factory groups make items on site: \$\{makers\s*\.map\(\(\[group, items\]\) => `\$\{groupName\(group\)\}/,
  );
});
