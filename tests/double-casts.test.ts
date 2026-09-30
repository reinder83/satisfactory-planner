// AGENTS.md "TypeScript": no double cast outside the places it lists (#572). This walks the
// repository's TypeScript and Vue files, so a new one fails here and gets typed code instead,
// or an entry below and in AGENTS.md with the reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const skipped = new Set(['node_modules', 'dist', 'data', '.git', '.sites-runtime']);
// Built from parts so this file does not match itself.
const doubleCast = new RegExp('\\bas ' + 'unknown as\\b', 'g');

// The allowed double casts per file, at most. See AGENTS.md for why each is needed.
const allowed: Record<string, number> = {
  // A JSON import widens string unions, so the first release's plan file never matches
  // StoredCalculatedPlan; data.types.ts checks that file against the type instead.
  'tests/types/fixtures.ts': 1,
  // The recipes and handbook JSON imports, left for a follow-up of #572 (another change owns
  // the file); tests/helpers/data.ts gives both typed.
  'tests/browser-api.test.ts': 2,
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (skipped.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|vue)$/.test(entry.name) ? [full] : [];
  });
}

test('no double cast outside the allowed places', () => {
  const found: Record<string, number> = {};
  for (const file of sourceFiles(root)) {
    const count = readFileSync(file, 'utf8').match(doubleCast)?.length ?? 0;
    if (count) found[path.relative(root, file).split(path.sep).join('/')] = count;
  }
  const extra = Object.entries(found).filter(([file, count]) => count > (allowed[file] ?? 0));
  assert.deepEqual(extra, [], 'type these instead of casting through unknown');
});
