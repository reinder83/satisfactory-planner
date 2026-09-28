// The CI workflow (.github/workflows/docker.yml). The containers its `test` job starts keep their
// data in named volumes rather than bind-mounted runner paths, which the Docker daemon of a
// self-hosted runner resolves on its host instead of in the job, and a volume the job uses is
// removed at its end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/docker.yml', 'utf8');
// The volume arguments of every `docker run` / `docker create` line, e.g. "planner-smoke-data:/data".
const mounts = [...workflow.matchAll(/docker (?:run|create)\b[^\n]*/g)].flatMap(([line]) =>
  [...line.matchAll(/(?:-v|--volume|--mount)[ =]("[^"]*"|\S+)/g)].map(m => m[1]!.replace(/"/g, '')),
);

test('the smoke tests mount only named volumes, never a runner path (#399)', () => {
  assert.ok(mounts.length >= 4, 'found the mounts: ' + mounts.join(', '));
  for (const m of mounts) {
    const source = m.split(':')[0]!;
    assert.match(source, /^[a-z][a-z0-9_.-]*$/, `${m} mounts a path, not a named volume`);
  }
});

test('every named volume the job uses is removed when it ends (#399)', () => {
  const cleanup = workflow.slice(workflow.indexOf('- name: Clean up smoke test'));
  for (const volume of new Set(mounts.map(m => m.split(':')[0]!)))
    assert.ok(cleanup.includes(`docker volume rm ${volume}`), volume + ' is removed');
});
