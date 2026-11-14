// FG-5/6 polish (#1355, from the #1380 review): at 320px the flow graph's selection panel was 20px
// wider than its dialog (its columns had a 260px minimum even where less than that is left), and
// the "?" help was about 550px tall, so on a phone its last lines sat below the screen. Layout is
// not measurable here, so this checks the rules in style.css and the length of the text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { helpText } from '../public/preferences.ts';

const style = fs
  .readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector: string) =>
  style.match(
    new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`),
  )?.[1] ?? '';

test('the selection panel columns never ask for more than the dialog has (#1355)', () => {
  const columns = rule('.fgraph-panel-cols');
  assert.match(columns, /minmax\(min\(260px, 100%\), 1fr\)/, 'the 260px minimum gives way at 100%');
  assert.doesNotMatch(columns, /minmax\(260px/);
});

test('the flow graph help is short and its popup is capped, so a phone can read all of it (#1355)', () => {
  assert.ok(helpText.flowGraphHelp!.length < 700, 'about 5 lines at 300px, not 550px of text');
  const tip = rule('.help-tip');
  assert.match(tip, /max-height:/, 'a popup never runs off the bottom of the window');
  assert.match(tip, /overflow-y: auto/, 'and scrolls inside itself when it must');
});

// FG-8 polish (#1355): the dragged "New step" column (z-index 2) was drawn over the dialog's sticky
// header (z-index 1) while the dialog was scrolled. The drawing's wrapper is its own stacking
// context now, so the header covers whatever of the column has scrolled up behind it.
test('the New step column stays under the dialog header (#1355)', () => {
  assert.match(rule('.fgraph-wrap'), /isolation: isolate/);
  assert.match(rule('.fgraph-newstep'), /z-index: 2/);
  assert.match(rule('.dialog-head'), /z-index: 1/);
});
