// Between the phone layout (720px) and 1100px the page scrolled sideways (#658): the page column
// of `.layout` was a bare `1fr` track, whose minimum is its content's, so the phase track in the
// top bar (six segments that do not shrink) and the resource tables made the column, and with it
// the page, wider than the window. Layout is not measurable in happy-dom, so this checks the
// rules in public/style.css that keep the column and the top bar inside the window.
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

// The widths just above the phone layout that overflowed.
const TABLET = [721, 760, 800, 860];
const covering = (width: number) =>
  narrowBlocks()
    .filter(b => b.width >= width && b.width > 720)
    .sort((a, b) => a.width - b.width);

// The declaration that applies at `width`: the narrowest max-width block covering it that sets
// it, else the rule outside any media block.
function applied(width: number, selector: string, prop: string) {
  for (const block of covering(width)) {
    const value = decl(rule(block.body, selector), prop);
    if (value) return value;
  }
  const wide = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  return decl(rule(wide, selector), prop);
}

test('the page column may shrink below its content between 721 and 1100px (#658)', () => {
  for (const width of [...TABLET, 1100]) {
    const columns = applied(width, '.layout', 'grid-template-columns');
    assert.ok(columns, `.layout sets its columns at ${width}px`);
    const tracks = columns.match(/minmax\([^)]*\)|\S+/g)!;
    assert.equal(tracks.length, 2, columns);
    assert.match(tracks[1]!, /^minmax\(0,/, `the page column at ${width}px is ${tracks[1]}`);
  }
});

test('the top bar and its phase track wrap rather than overflow between 721 and 1100px', () => {
  for (const width of [...TABLET, 1100]) {
    assert.equal(applied(width, '.topbar', 'flex-wrap'), 'wrap', `.topbar at ${width}px`);
    assert.equal(applied(width, '.phase-track', 'flex-wrap'), 'wrap', `.phase-track at ${width}px`);
  }
});
