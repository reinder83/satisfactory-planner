// The CI workflow (.github/workflows/docker.yml). The containers its `test` job starts keep their
// data in named volumes rather than bind-mounted runner paths, which the Docker daemon of a
// self-hosted runner resolves on its host instead of in the job, and a volume the job uses is
// removed at its end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const workflow = fs.readFileSync('.github/workflows/docker.yml', 'utf8');
// The volume arguments of every `docker run` / `docker create` line, e.g. "planner-smoke-data:/data".
const mounts = [...workflow.matchAll(/docker (?:run|create)\b[^\n]*/g)].flatMap(([line]) =>
  [...line.matchAll(/(?:-v|--volume|--mount)[ =]("[^"]*"|\S+)/g)].map(m => m[1]!.replace(/"/g, '')),
);

test('the smoke tests mount only named volumes, never a runner path (#399)', () => {
  assert.ok(mounts.length >= 4, 'found the mounts: ' + mounts.join(', '));
  for (const mount of mounts) {
    const source = mount.split(':')[0]!;
    assert.match(source, /^[a-z][a-z0-9_.-]*$/, `${mount} mounts a path, not a named volume`);
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

// The runtime image lists the server files by name, so a server module it lacks only fails the
// Docker smoke test in CI (#524). Every module docker-start.ts reaches, including the shared
// public/ sources and their subfolders such as public/state/ (#585), must land at the same path
// in /app through a COPY line. A glob such as /src/public/*.ts does not match subfolders.

// Where each COPY line of the runtime stage puts a repository file: [source, destination], with
// the build stage's /src/ prefix and the leading ./ of the destination removed.
const runtimeCopies = (docker: string) => {
  const runtime = docker.slice(docker.lastIndexOf('\nFROM '));
  return [...runtime.matchAll(/^COPY ((?:--\S+ )*)(.+) (\S+)\r?$/gm)].flatMap(
    ([, flags, srcs, dest]) => {
      const fromBuild = flags!.includes('--from=build');
      const to = dest!.replace(/^\.\/?/, '').replace(/\/$/, '');
      return srcs!
        .split(' ')
        .filter(src => !fromBuild || src.startsWith('/src/'))
        .map(src => [fromBuild ? src.slice('/src/'.length) : src, to] as const);
    },
  );
};

// Whether a COPY line puts `file` at the same relative path in the image: a single file or a
// glob (whose * stops at a slash) into its own folder, or a whole folder under the same name.
const copiedInPlace = (copies: ReturnType<typeof runtimeCopies>, file: string) =>
  copies.some(([src, dest]) => {
    const glob = new RegExp(
      '^' +
        src
          .split('*')
          .map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^/]*') +
        '$',
    );
    if (glob.test(file)) return path.posix.join(dest, path.posix.basename(file)) === file;
    return file.startsWith(src + '/') && path.posix.join(dest, file.slice(src.length)) === file;
  });

// The files docker-start.ts reaches through relative .ts imports (import, export and
// side-effect forms), with the ones no COPY line puts in place. `import type` and `export type`
// are erased when Node strips the types (verbatimModuleSyntax), so the image needs no file for
// them (public/types/).
const serverImports = (docker: string) => {
  const copies = runtimeCopies(docker);
  const seen = new Set<string>();
  const missing: string[] = [];
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!copiedInPlace(copies, file)) missing.push(file);
    const dir = path.posix.dirname(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const [, clause, spec] of source.matchAll(/^(?:import|export)\b([^;]*?)'(\.[^']+\.ts)'/gm))
      if (!/^\s+type\b/.test(clause!)) visit(path.posix.normalize(path.posix.join(dir, spec!)));
  };
  visit('docker-start.ts');
  return { seen, missing };
};

test('the Docker image copies every server module server.ts imports (#524, #585)', () => {
  const { seen, missing } = serverImports(fs.readFileSync('Dockerfile', 'utf8'));
  assert.deepEqual(missing, [], 'modules the server imports that the Dockerfile does not copy');
  assert.ok(seen.has('server.ts'), 'followed docker-start.ts into server.ts');
  assert.ok(seen.has('server/persistence.ts'), 'followed workspace.ts into server/');
  assert.ok(seen.has('public/state.ts'), 'followed the server into public/');
  assert.ok(
    [...seen].some(f => f.startsWith('public/state/')),
    'followed state.ts into public/state/',
  );
});

test('a Dockerfile without the public/state/ COPY line fails the import check (#585)', () => {
  const docker = fs.readFileSync('Dockerfile', 'utf8');
  const line = /^COPY --from=build \S+ \/src\/public\/state\/\*\.ts \.\/public\/state\/\r?\n/m;
  assert.match(docker, line);
  const { missing } = serverImports(docker.replace(line, ''));
  assert.ok(missing.length > 0, 'something is missing');
  assert.ok(
    missing.every(f => f.startsWith('public/state/')),
    'only public/state/ is missing: ' + missing.join(', '),
  );
  // The root public/*.ts line does not stand in for the subfolder, and without it the root
  // modules go missing too.
  const root = /^COPY --from=build \S+ \/src\/public\/\*\.ts \.\/public\/\r?\n/m;
  assert.ok(serverImports(docker.replace(root, '')).missing.includes('public/state.ts'));
  // A root module left off the list of names is still caught (#524).
  assert.deepEqual(serverImports(docker.replace(' planner.ts ', ' ')).missing, ['planner.ts']);
});
