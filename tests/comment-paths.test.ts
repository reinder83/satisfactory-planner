// Comments in the calculator and the shared modules point readers at other files by path
// (#539). When a file moves, such a comment keeps naming the old place; this fails on any
// `public/...` path or `server/` module in a comment of these files that does not exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tsIn = (dir: string) =>
  readdirSync(path.join(root, dir))
    .filter(name => name.endsWith('.ts'))
    .map(name => `${dir}/${name}`);
const checked = [
  'planner.ts',
  ...tsIn('planner'),
  'optimizer.ts',
  ...tsIn('public'),
  ...tsIn('public/state'),
];

// The comment text of `source`: whole-line comments, block comment lines and trailing `// `
// comments. A `//` inside a string such as a URL is not followed by a space, so it is skipped.
function comments(source: string): string[] {
  return source.split(/\r?\n/).flatMap(line => {
    const whole = line.match(/^\s*(?:\/\/|\/\*|\*)(.*)$/);
    if (whole) return [whole[1]!];
    const trailing = line.match(/\s\/\/ (.*)$/);
    return trailing ? [trailing[1]!] : [];
  });
}

// The repository paths a comment names: `public/` up to the first character that cannot be part
// of a path (a glob such as `public/app/views/*.ts` stops at its directory), and a `server/`
// module by its file name, so prose such as 'the server/browser store' is not a path.
function namedPaths(comment: string): string[] {
  return [...comment.matchAll(/\bpublic\/[\w./-]*|\bserver\/[\w-]+\.ts\b/g)].map(match =>
    match[0].replace(/[.]+$/, ''),
  );
}

test('the path scan reads comments only and stops at the end of a path', () => {
  const source = [
    '// See public/app/session.ts.',
    "const url = 'public/not-a-comment.ts';",
    'run(); // (public/app/ui/wizard/, #1)',
    ' * server/scope.ts, the server/browser store and app/views/*.ts',
  ].join('\r\n');
  assert.deepEqual(comments(source).flatMap(namedPaths), [
    'public/app/session.ts',
    'public/app/ui/wizard/',
    'server/scope.ts',
  ]);
});

test('every path a comment names in the calculator and the shared modules exists', () => {
  const missing = checked.flatMap(file =>
    comments(readFileSync(path.join(root, file), 'utf8'))
      .flatMap(namedPaths)
      .filter(named => !existsSync(path.join(root, named)))
      .map(named => `${file}: ${named}`),
  );
  assert.deepEqual(missing, []);
});
