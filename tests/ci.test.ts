// The CI workflow (.github/workflows/docker.yml). Its `test` job may run on the NAS runner
// (ci/nas-runner/), whose jobs start containers through the NAS's Docker daemon; that daemon
// resolves a bind-mount path on the NAS, not in the runner container. So the containers the job
// starts keep their data in named volumes, and a volume the job uses is removed at its end.
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

// The `test` job's vitest run may be on the NAS runner, whose CPU is several times slower than a
// desktop's: a test that renders many pages crossed vitest's default 5 s there (#400).
test('vitest gives each test at least 20 s, for the NAS runner (#400)', () => {
  const config = fs.readFileSync('vite.config.ts', 'utf8');
  const limit = /\btestTimeout:\s*(\d+)/.exec(config);
  assert.ok(limit, 'vite.config.ts sets test.testTimeout');
  assert.ok(Number(limit[1]) >= 20000, `testTimeout is ${limit[1]} ms`);
});
