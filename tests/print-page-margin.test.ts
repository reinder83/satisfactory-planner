// Every printed page keeps a margin on each side (#1025). The print rules drop the workspace's
// padding, so without an @page margin a print with the browser's margins at nothing (as
// Playwright's PDF and some print dialogs make it) runs to the paper's edges, where most printers
// cannot print: the flow page's "Comes in" lost its first letter and the cards their borders.
// Media queries and @page are not evaluated in happy-dom, so this reads public/style.css; the
// printed result is in the PR's screenshots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs
  .readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// The margins of a `margin` shorthand in mm, as [top, right, bottom, left].
function marginsMm(value: string): number[] {
  const mm = value
    .trim()
    .split(/\s+/)
    .map(part => {
      const match = /^([\d.]+)(mm|cm|in|px)?$/.exec(part);
      assert.ok(match, `a length in mm, cm, in or px: ${part}`);
      const size = Number(match[1]);
      return { mm: 1, cm: 10, in: 25.4, px: 25.4 / 96 }[match[2] ?? 'px']! * size;
    });
  const [top, right = top, bottom = top, left = right] = mm;
  return [top!, right!, bottom!, left!];
}

test('every printed page has a margin of at least 10 mm on each side (#1025)', () => {
  const pages = [...css.matchAll(/@page\s*([^{]*)\{([^}]*)\}/g)];
  const unnamed = pages.filter(page => !page[1]!.trim());
  assert.equal(unnamed.length, 1, 'one @page rule for every printed page');
  const margin = /(?:^|;)\s*margin\s*:\s*([^;]+)/.exec(unnamed[0]![2]!);
  assert.ok(margin, 'the @page rule sets a margin');
  for (const [i, side] of ['top', 'right', 'bottom', 'left'].entries())
    assert.ok(marginsMm(margin[1]!)[i]! >= 10, `${side}: ${margin[1]}`);
  // No other page rule takes it away.
  for (const page of pages) assert.doesNotMatch(page[2]!, /margin(-\w+)?\s*:\s*0(\s|;|$)/, page[0]);
});
