// AGENTS.md "TypeScript": no double cast outside the places it lists (#572). This reads the
// repository's TypeScript and Vue files, so a new one fails here and gets typed code instead,
// or an entry below and in AGENTS.md with the reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// Built from parts so this file does not match itself.
const U = 'unknown';
// A cast to unknown and on to another type: with the `as` operator, also with the first cast in
// brackets or broken over lines, and with angle brackets, the inner one bracketed or not. Each
// is matched on the whole source, so a line break does not hide one; the test cases below show
// every form.
const doubleCasts = [
  new RegExp('\\bas\\s+' + U + '(?:\\s*\\))*\\s*as\\b', 'g'),
  new RegExp('>\\s*\\(?\\s*<' + U + '>\\s*[\\w$([{\'"`]', 'g'),
];
const count = (source: string) =>
  doubleCasts.reduce((sum, cast) => sum + (source.match(cast)?.length ?? 0), 0);

// The allowed double casts per file, at most. See AGENTS.md for why each is needed.
const allowed: Record<string, number> = {
  // A JSON import widens string unions, so the first release's plan file never matches
  // StoredCalculatedPlan; data.types.ts checks that file against the type instead.
  'tests/types/fixtures.ts': 1,
};

// The TypeScript and Vue files git tracks, or would track (new ones not ignored), so ignored
// folders such as node_modules, dist or a local worktree under .claude/ are never read.
function sourceFiles(): string[] {
  const listed = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.ts', '*.vue'],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  return listed.split('\0').filter(Boolean);
}

test('the check catches every form of a double cast', () => {
  const caught = [
    `1 as ${U} as string`,
    `(1 as ${U}) as string`,
    `((1 as ${U})) as string`,
    `1 as ${U}\n  as string`,
    `1 as\n  ${U} as string`,
    `(1 as ${U})\n  as string`,
    `<string>(<${U}>1)`,
    `<string><${U}>value`,
    `<string>(\n  <${U}>value\n)`,
  ];
  for (const source of caught) assert.equal(count(source), 1, source);
  assert.equal(count(`a as ${U} as A;\nb as ${U} as B;`), 2);
});

test('the check leaves the allowed patterns alone', () => {
  const allowedPatterns = [
    `const value = input as ${U};`,
    `const list = input as ${U}[];`,
    `const value = input satisfies ${U};`,
    'const text = value as string;',
    '// @ts-expect-error: a wrong type, on purpose.\ncall(5);',
    `const reply: Promise<${U}> = fetch(url).then(r => r.json());`,
    `const map = new Map<string, ${U}>();`,
    `const pending = new Set<Promise<${U}>>();`,
    `const value = read<${U}>(key);`,
    `// Input arrives as ${U} and is narrowed by the checks below.`,
  ];
  for (const source of allowedPatterns) assert.equal(count(source), 0, source);
});

test('no double cast outside the allowed places', () => {
  const found: Record<string, number> = {};
  for (const file of sourceFiles()) {
    const casts = count(readFileSync(path.join(root, file), 'utf8'));
    if (casts) found[file] = casts;
  }
  const extra = Object.entries(found).filter(([file, casts]) => casts > (allowed[file] ?? 0));
  assert.deepEqual(extra, [], 'type these instead of casting through unknown');
});
