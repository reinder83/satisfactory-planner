// The phone rules of #1354 (MOB-1 to MOB-5). Layout is not measurable in happy-dom, so this checks
// the rules in style.css; the same pages are measured in a real browser at 320, 360, 390 and
// 430px (no sideways page scroll, 44px targets, the top bar one row) in browser-check.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const style = fs
  .readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// The body of every block that starts with `head` (an @media or @container line), nesting kept.
function blocks(head: string): string[] {
  const found: string[] = [];
  for (let at = style.indexOf(head); at >= 0; at = style.indexOf(head, at + 1)) {
    let depth = 1;
    let i = style.indexOf('{', at) + 1;
    const start = i;
    for (; i < style.length && depth; i++)
      depth += style[i] === '{' ? 1 : style[i] === '}' ? -1 : 0;
    found.push(style.slice(start, i - 1));
  }
  return found;
}
// The declarations of the rule whose selector list is exactly `selector`, in any of `where`.
function rule(where: string[], selector: string): string {
  const bodies = where.flatMap(css =>
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(m => m[1]!.split(',').some(s => s.trim() === selector))
      .map(m => m[2]!),
  );
  assert.ok(bodies.length, `a rule for ${selector}`);
  return bodies.join(';');
}
const phone = blocks('@media (max-width: 720px)');

test('tab rows that scroll sideways have no visible scrollbar on a phone, and their tabs share the width (MOB-5)', () => {
  const tabs = rule(phone, '.phase-tabs');
  assert.match(tabs, /scrollbar-width:\s*none/);
  assert.match(rule(phone, '.phase-tabs::-webkit-scrollbar'), /display:\s*none/);
  assert.match(rule(phone, '.phase-tabs .tab'), /flex:\s*1 0 auto/);
  assert.match(rule(phone, '.jump-bar'), /scrollbar-width:\s*none/);
  assert.match(rule(phone, '.jump-bar::-webkit-scrollbar'), /display:\s*none/);
  // They still scroll: the overflow stays.
  assert.match(style, /\.phase-tabs \{[^}]*overflow-x:\s*auto/);
});

test('a step table row is two lines on a phone: name and rate, then the other cells (MOB-4)', () => {
  const [narrow] = blocks('@container step-table (max-width: 480px)');
  assert.ok(narrow, 'the table container query');
  const where = [narrow!];
  assert.match(rule(where, '.step-table tr'), /display:\s*flex/);
  assert.match(rule(where, '.step-table tr'), /flex-wrap:\s*wrap/);
  assert.match(rule(where, '.step-table tr::after'), /flex:\s*0 0 100%/);
  assert.match(rule(where, '.step-table tr > :nth-child(2)'), /margin-left:\s*auto/);
  assert.match(rule(where, '.step-table tr > :nth-child(2)::before'), /content:\s*none/);
  // Not the old one-block-per-cell rule for the row.
  assert.doesNotMatch(
    narrow!.match(/\.step-table table,[^{]*\{/)![0],
    /\.step-table tr\b/,
    'the row is no longer display: block',
  );
});

test('the top bar is one row on a phone: a grid of menu, name and status, phase select (MOB-1)', () => {
  const bar = rule(phone, '.topbar');
  assert.match(bar, /display:\s*grid/);
  assert.match(bar, /grid-template-areas:\s*'lead name phase'\s*'lead save phase'/);
  assert.match(rule(phone, '.topbar-tools'), /display:\s*contents/);
  assert.match(rule(phone, '.topbar .jump-open'), /display:\s*none/);
  assert.match(rule(phone, '.topbar select'), /min-height:\s*44px/);
  assert.match(rule(phone, '.topbar .work-on-phase'), /min-height:\s*44px/);
});

test('the bottom bar is phone-only, 56px tall, clear of the home bar and the page (MOB-2)', () => {
  const outside = phone.reduce((css, body) => css.replace(body, ''), style);
  assert.match(outside, /\.bottom-bar \{\s*display:\s*none;/, 'hidden on wider screens');
  const bar = rule(phone, '.bottom-bar');
  assert.match(bar, /position:\s*fixed/);
  assert.match(bar, /padding-bottom:\s*env\(safe-area-inset-bottom\)/);
  assert.match(rule(phone, '.bottom-link'), /min-height:\s*56px/);
  assert.match(
    rule(phone, '.layout:has(.bottom-bar) .workspace'),
    /padding-bottom:\s*calc\(\d+px \+ env\(safe-area-inset-bottom\)\)/,
  );
  assert.match(rule(phone, 'html:has(.bottom-bar)'), /scroll-padding-bottom:\s*calc\(/);
  assert.match(
    rule(phone, "body:has(.bottom-bar) #toast:not([data-place='top'])"),
    /bottom:\s*calc\(/,
  );
  // Under the drawer (59) and above the page's sticky bars.
  assert.match(bar, /z-index:\s*18/);
  assert.match(rule(blocks('@media print'), '.bottom-bar'), /display:\s*none/);
});

test('the flow graph list and its toggle are phone-only, rows are 44px targets (MOB-3)', () => {
  const outside = phone.reduce((css, body) => css.replace(body, ''), style);
  assert.match(outside, /\.fgraph-mode,\s*\.fgraph-list \{\s*display:\s*none;/);
  assert.match(rule(phone, '.fgraph-list-line'), /min-height:\s*44px/);
  assert.match(rule(phone, '.fgraph-list'), /display:\s*block/);
});

test('the controls measured under 44px on a phone grow their target without growing their row (A11Y-1)', () => {
  // A step's title row is padded and pulled back by the same amount; the toggles and the map's
  // corner switch have a floor; the header's profile link pads an inline box.
  const row = rule(phone, '.task summary');
  assert.match(row, /padding-block:\s*9px/);
  assert.match(row, /margin-block:\s*-9px/);
  assert.match(rule(phone, '.collapse-toggle'), /min-width:\s*44px/);
  assert.match(rule(phone, '.map-layers.map-corner-tr .map-layer-toggle'), /min-height:\s*44px/);
  const link = rule(phone, '.topbar .breadcrumbs .crumb-profile');
  assert.match(link, /padding-block:\s*13px/);
  assert.match(link, /margin-block:\s*-13px/);
});

test('the survey budgets table is one block per resource on a narrow phone (ONB-6 polish)', () => {
  const narrow = blocks('@media (max-width: 560px)');
  assert.match(rule(narrow, '.budget-table tr'), /display:\s*grid/);
  assert.match(rule(narrow, '.budget-table td:last-child'), /grid-column:\s*1 \/ -1/);
  assert.match(
    rule(narrow, '.budget-table td[data-label]::before'),
    /content:\s*attr\(data-label\)/,
  );
});

test('the toast never takes a click from the controls under it; only its buttons are pressable (BUG-8, #1355)', () => {
  // At the bottom it sat over a row of cards for several seconds, hiding their Built and Running
  // controls from the pointer: the strip lets clicks through, and only a button on it answers.
  assert.match(rule([style], '#toast'), /pointer-events:\s*none/);
  assert.match(rule([style], '#toast .toast-action'), /pointer-events:\s*auto/);
  assert.match(rule([style], '#toast .toast-actions'), /pointer-events:\s*auto/);
});

test('a profile card’s ⋯ menu is a bottom sheet over a dimmed page on a phone (MOB-6, #1355)', () => {
  const sheet = rule(phone, '.profile-actions .action-menu-list');
  assert.match(sheet, /position:\s*fixed/);
  assert.match(sheet, /bottom:\s*0/);
  assert.match(sheet, /left:\s*0/);
  assert.match(sheet, /right:\s*0/);
  assert.match(sheet, /box-shadow:\s*0 0 0 100vmax/, 'the page behind is dimmed');
  assert.match(rule(phone, '.profile-actions .action-menu-list .btn'), /min-height:\s*44px/);
  // Wide screens keep the dropdown under the button.
  assert.match(rule([style], '.action-menu-list'), /position:\s*absolute/);
});

test('Expert All settings fields are wide enough for the longest label on one line (ONB-8, #1355)', () => {
  // "Elevator requirement multiplier" and its ⓘ wrapped to two lines in columns of 190px; measured
  // in a real browser, the label fits one line from about 262px (4 columns at 1440px).
  const grid = rule([style], '.wizard-panel.compact .form-grid');
  const min = Number(/minmax\(min\(100%, (\d+)px\), 1fr\)/.exec(grid)?.[1]);
  assert.ok(min >= 262, `the column minimum is ${min}px`);
  // A phone keeps its two fields a row.
  assert.match(rule(phone, '.wizard-panel.compact .form-grid'), /repeat\(2, minmax\(0, 1fr\)\)/);
});
