// A toast still up when the user prints is left off the page like the rest of the chrome (#730).
// The print block hides #toast, but a screen rule such as #toast.show { display: block } is more
// specific than #toast and would win in print too. Media queries are not evaluated in
// happy-dom, so this checks the cascade in public/style.css: every screen rule that shows the
// toast is beaten by a print rule hiding it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs
  .readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// The body of the block opened at `start` (just after its `{`) and the index after its `}`.
function blockBody(start: number) {
  let depth = 1,
    end = start;
  for (; end < css.length && depth; end++)
    if (css[end] === '{') depth++;
    else if (css[end] === '}') depth--;
  return { body: css.slice(start, end - 1), end };
}

type Rule = { selectors: string[]; body: string; at: number; print: boolean };

// Every rule with its position in the file, and whether it sits in an @media print block.
function rules() {
  const out: Rule[] = [];
  const prints: { from: number; to: number }[] = [];
  for (const m of css.matchAll(/@media print\s*\{/g)) {
    const from = m.index + m[0].length;
    prints.push({ from, to: blockBody(from).end });
  }
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!
      .replace(/^[\s\S]*@media[^{]*$/, '')
      .split(',')
      .map(s => s.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    const at = m.index;
    out.push({ selectors, body: m[2]!, at, print: prints.some(p => at > p.from && at < p.to) });
  }
  return out;
}

const display = (body: string) => body.match(/(?:^|[;\s])display:\s*([^;]+)/)?.[1]!.trim();

// [ids, classes/attributes/pseudo-classes, elements] of a simple selector chain.
function specificity(selector: string): [number, number, number] {
  const ids = selector.match(/#[\w-]+/g)?.length ?? 0;
  const classes = selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g)?.length ?? 0;
  const elements =
    selector.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+/g, ' ').match(/[a-z][\w-]*/gi)
      ?.length ?? 0;
  return [ids, classes, elements];
}

const compare = (a: number[], b: number[]) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;

// A selector for the toast element itself (not a descendant of it).
const isToast = (s: string) => /^#toast(?![\w-])[^\s>+~]*$/.test(s);

test('a toast that is showing is not printed (#730)', () => {
  const all = rules();
  const shows = all.filter(
    r => !r.print && display(r.body) && display(r.body) !== 'none' && r.selectors.some(isToast),
  );
  assert.ok(shows.length, 'a screen rule shows the toast (#toast.show)');
  const hides = all.filter(r => r.print && display(r.body) === 'none');
  for (const show of shows)
    for (const selector of show.selectors.filter(isToast)) {
      const beaten = hides.some(hide =>
        hide.selectors.some(h => {
          if (!isToast(h)) return false;
          const order = compare(specificity(h), specificity(selector));
          return order > 0 || (order === 0 && hide.at > show.at);
        }),
      );
      assert.ok(beaten, `the print block hides the toast over ${selector}`);
    }
});
