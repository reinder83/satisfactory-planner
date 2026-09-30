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

// The files docker-start.ts reaches through relative .ts imports (import, export, side-effect
// and dynamic import() forms), with the ones no COPY line puts in place (`missing`).
// `import type` and `export type` are erased when Node strips the types (verbatimModuleSyntax),
// so the image needs no file for them (public/types/).
// The data files those modules read at run time (`data`), with the ones no COPY line puts in
// place or the repository lacks (`missingData`):
// - a relative import of a file that is not a .ts module, in any module, e.g.
//   import x from '../foo.json' with { type: 'json' } or import('./foo.json', ...) (#637);
// - in a module that resolves paths against import.meta.url, every relative path literal that
//   is not a .ts module, e.g. new URL('./recipes.json', import.meta.url) or a helper that passes
//   '../recipes.json' to it (#620), and a path.join/path.resolve of a folder derived from
//   import.meta.url (path.dirname(fileURLToPath(import.meta.url))) with only string literals
//   that end in a file name, e.g. path.join(root, 'public', 'index.html') (#637).
// The build stage writes public/ into dist/web minus the module sources (build.ts), so for a
// data file the dist/web ./public line counts as a copy of public/.
// `sources` stands in for the repository's text of the files it names, for the fixture tests.
const serverImports = (docker: string, sources: Record<string, string> = {}) => {
  const copies = runtimeCopies(docker);
  const dataCopies = copies.map(
    ([src, dest]) => [src === 'dist/web' ? 'public' : src, dest] as const,
  );
  const seen = new Set<string>();
  const data = new Set<string>();
  const missing: string[] = [];
  const missingData: string[] = [];
  const addData = (target: string) => {
    if (data.has(target)) return;
    data.add(target);
    if (!fs.existsSync(target) || !copiedInPlace(dataCopies, target)) missingData.push(target);
  };
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!copiedInPlace(copies, file)) missing.push(file);
    const dir = path.posix.dirname(file);
    const resolve = (spec: string) => path.posix.normalize(path.posix.join(dir, spec));
    const source = sources[file] ?? fs.readFileSync(file, 'utf8');
    const modules: string[] = [];
    for (const [, clause, spec] of source.matchAll(
      /^(?:import|export)\b([^;]*?)['"](\.\.?\/[^'"]+)['"]/gm,
    )) {
      if (/^\s+type\b/.test(clause!)) continue;
      if (spec!.endsWith('.ts')) modules.push(spec!);
      else addData(resolve(spec!));
    }
    for (const [, spec] of source.matchAll(/\bimport\(\s*['"](\.\.?\/[^'"]+)['"]/g))
      if (spec!.endsWith('.ts')) modules.push(spec!);
      else addData(resolve(spec!));
    if (source.includes('import.meta.url')) {
      for (const [, spec] of source.matchAll(/['"`](\.\.?\/[^'"`\s$]+)['"`]/g))
        if (!spec!.endsWith('.ts')) addData(resolve(spec!));
      const roots = [
        ...source.matchAll(
          /\b(\w+)\s*=\s*path\.dirname\(\s*fileURLToPath\(\s*import\.meta\.url\s*\)\s*\)/g,
        ),
      ].map(m => m[1]!);
      for (const [, base, args] of source.matchAll(
        /\bpath\.(?:join|resolve)\(\s*(\w+)((?:\s*,\s*'[^']*')+)\s*,?\s*\)/g,
      )) {
        if (!roots.includes(base!)) continue;
        const spec = [...args!.matchAll(/'([^']*)'/g)].map(m => m[1]!).join('/');
        if (/\.\w+$/.test(spec) && !spec.endsWith('.ts')) addData(resolve(spec));
      }
    }
    for (const spec of modules) visit(resolve(spec));
  };
  visit('docker-start.ts');
  return { seen, data, missing, missingData };
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

test('the Docker image copies every data file the server reads (#620)', () => {
  const docker = fs.readFileSync('Dockerfile', 'utf8');
  const { data, missingData } = serverImports(docker);
  assert.deepEqual(missingData, [], 'files the server reads that the Dockerfile does not copy');
  for (const file of [
    'recipes.json',
    'migrations/handbook-2026-09-13.json',
    'public/plan.json',
    'public/index.html',
  ])
    assert.ok(data.has(file), 'found the read of ' + file + ' in ' + [...data].join(', '));
  // Each COPY line that places one of them is needed.
  assert.deepEqual(serverImports(docker.replace(' recipes.json ', ' ')).missingData, [
    'recipes.json',
  ]);
  const migrations = /^COPY \S+ migrations \.\/migrations\r?\n/m;
  assert.match(docker, migrations);
  assert.deepEqual(serverImports(docker.replace(migrations, '')).missingData, [
    'migrations/handbook-2026-09-13.json',
  ]);
  const web = /^COPY --from=build \S+ \/src\/dist\/web \.\/public\r?\n/m;
  assert.match(docker, web);
  assert.deepEqual(serverImports(docker.replace(web, '')).missingData.sort(), [
    'public/index.html',
    'public/plan.json',
  ]);
});

// Reads the scan must find in any module, including one without import.meta.url (#637):
// tsconfig.json is in the repository but no COPY line puts it in the image.
test('a JSON import or a path.join read of an uncopied file fails the data check (#637)', () => {
  const docker = fs.readFileSync('Dockerfile', 'utf8');
  const errors = fs.readFileSync('server/errors.ts', 'utf8');
  assert.ok(!errors.includes('import.meta.url'), 'server/errors.ts does not use import.meta.url');
  const withSource = (file: string, source: string) => serverImports(docker, { [file]: source });
  for (const line of [
    "import tsconfig from '../tsconfig.json' with { type: 'json' };",
    'import tsconfig from "../tsconfig.json" with { type: "json" };',
    "export { default as tsconfig } from '../tsconfig.json' with { type: 'json' };",
    "import '../tsconfig.json' with { type: 'json' };",
    "const tsconfig = await import('../tsconfig.json', { with: { type: 'json' } });",
  ]) {
    const { data, missing, missingData } = withSource('server/errors.ts', line + '\n' + errors);
    assert.ok(data.has('tsconfig.json'), 'found the read in: ' + line);
    assert.deepEqual(missingData, ['tsconfig.json'], line);
    assert.deepEqual(missing, [], 'the modules are all copied: ' + line);
  }
  // A dynamic import of a module is followed like a static one, and needs a COPY line too.
  const dynamic = withSource('server/errors.ts', "await import('../build.ts');\n" + errors);
  assert.ok(dynamic.seen.has('build.ts'), 'followed the dynamic import');
  assert.ok(dynamic.missing.includes('build.ts'), 'build.ts is not in the image');
  // A path.join or path.resolve of the folder server.ts resolves from import.meta.url.
  const server = fs.readFileSync('server.ts', 'utf8');
  for (const read of [
    "fs.readFile(path.join(root, 'tsconfig.json'))",
    "fs.readFile(path.resolve(root, 'tsconfig.json'))",
  ]) {
    const { missingData } = withSource('server.ts', server + '\n' + read + ';\n');
    assert.deepEqual(missingData, ['tsconfig.json'], read);
  }
  // A folder that is not derived from import.meta.url, such as the data volume, is not a read
  // of a repository file.
  const volume = withSource('server.ts', server + "\npath.join(dataDir, 'tsconfig.json');\n");
  assert.deepEqual(volume.missingData, []);
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
