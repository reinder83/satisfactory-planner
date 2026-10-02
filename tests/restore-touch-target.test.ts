// Build plan edit mode on a phone (#717): Restore under "Removed steps in this phase"
// (ui/plan/RemovedSteps.vue, `btn quiet`) is a 44px touch target, like the step tools beside
// it (#613). Layout is not measurable in happy-dom, so this checks the narrow-width rule in
// public/style.css, and that wider screens keep the quiet button's own height.
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

// Every rule in `body` whose selector list contains a selector starting with `prefix`.
function rules(body: string, prefix: string) {
  return [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(m =>
      m[1]!
        .split(',')
        .map(s => s.trim().replace(/\s+/g, ' '))
        .some(s => s.startsWith(prefix)),
    )
    .map(m => m[2]!);
}

const decl = (body: string, prop: string) =>
  body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`))?.[1]!.trim();

test('at phone widths Restore in Removed steps is a 44px touch target (#717)', () => {
  const bodies = narrowBlocks()
    .filter(b => b.width >= 390 && b.width <= 720)
    .flatMap(b => rules(b.body, '.removed-step .btn'));
  const heights = bodies.map(body => decl(body, 'min-height')).filter(Boolean);
  assert.deepEqual(heights, ['44px'], 'one max-width rule (covering 375px) for .removed-step .btn');
  // A min-width would let the row's flex layout shrink Restore below its text's width.
  for (const body of bodies) assert.equal(decl(body, 'min-width'), undefined);
});

test('on wider screens Restore keeps the quiet button height', () => {
  const wide = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  for (const body of rules(wide, '.removed-step .btn'))
    assert.equal(decl(body, 'min-height'), undefined);
});
