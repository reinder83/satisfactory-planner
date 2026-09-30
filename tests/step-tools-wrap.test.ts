// Build plan edit mode on a phone (#613): the step tools (↑ ↓ Edit Remove, ui/plan/PlanStep.vue)
// take their own row under the title instead of a fourth column beside it, so the title is not
// squeezed into a narrow column, and the buttons are 44px touch targets. Layout is not
// measurable in happy-dom, so this checks the narrow-width rule in public/style.css.
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

test('at phone widths the step tools wrap under the title in edit mode (#613)', () => {
  const block = narrowBlocks().find(
    b => b.width >= 390 && rule(b.body, '.task.is-editing .task-tools'),
  );
  assert.ok(block, 'a max-width rule (covering 390px and 375px) for .task.is-editing .task-tools');
  // Three tracks (checkbox, icon, title): no column left for the tools beside the title.
  const columns = decl(rule(block.body, '.task.is-editing'), 'grid-template-columns');
  assert.ok(columns, '.task.is-editing sets its columns in the same block');
  assert.equal(columns.match(/minmax\([^)]*\)|\S+/g)!.length, 3, columns);
  // The tools start under the title, not under the checkbox.
  assert.equal(decl(rule(block.body, '.task.is-editing .task-tools'), 'grid-column'), '3');
  const tools = rule(block.body, '.task-tools .btn.quiet');
  assert.equal(decl(tools, 'min-width'), '44px');
  assert.equal(decl(tools, 'min-height'), '44px');
});

test('on wider screens the step tools stay in their own column beside the title', () => {
  const wide = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const columns = decl(rule(wide, '.task.is-editing'), 'grid-template-columns');
  assert.equal(columns, '20px 26px minmax(0, 1fr) auto');
});
