// The user documentation (README.md and docs/) must not mention the retired profile type (#833).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function markdownIn(dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return markdownIn(relative);
    return entry.name.endsWith('.md') ? [relative] : [];
  });
}

const userDocs = ['README.md', ...markdownIn('docs')];
const forbidden = [/handbook/i, /plan\.json/i, /original profile/i];

test('the user docs include README.md and the docs folder', () => {
  assert.ok(userDocs.includes('docs/USER-GUIDE.md'));
  assert.ok(userDocs.includes('docs/SELF-HOSTING.md'));
  assert.ok(userDocs.includes('docs/DEVELOPMENT.md'));
});

for (const file of userDocs) {
  test(`${file} does not mention the retired profile type`, () => {
    const lines = readFileSync(path.join(root, file), 'utf8').split(/\r?\n/);
    const found = lines.flatMap((line, index) =>
      forbidden.filter(term => term.test(line)).map(term => `${file}:${index + 1} ${term}`),
    );
    assert.deepEqual(found, []);
  });
}
