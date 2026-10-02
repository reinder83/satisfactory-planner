// planner.ts is a facade over planner/ (#776): it only re-exports the names its importers use,
// and the Docker image and the Pages build carry the folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as planner from '../planner.ts';

test('planner.ts re-exports the names it exported before the split', () => {
  assert.deepEqual(Object.keys(planner).sort(), [
    'AMPLIFY_CANDIDATES',
    'AMPLIFY_SLOTS',
    'DATA',
    'DEFAULT_LIMITS',
    'DELIVERIES',
    'ENGINE',
    'PURE_LIMITS',
    'RAW',
    'SLOOP_USES',
    'calculate',
    'catalog',
    'listNames',
    'nuclearPeriod',
    'powerNeedsTurbofuel',
    'rankAlternates',
    'recipePool',
    'run',
    'settings',
    'warningDuration',
  ]);
});

test('planner.ts holds no code of its own, only re-exports', () => {
  const code = fs
    .readFileSync(new URL('../planner.ts', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.startsWith('//'))
    .join('\n');
  const statements = code.split(/;\n?/).filter(statement => statement.trim());
  for (const statement of statements)
    assert.match(statement, /^export \{[\w\s,]+\} from '\.\/(planner|public)\/[\w-]+\.ts'$/);
});

test('the Docker image copies planner/ next to planner.ts', () => {
  const docker = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(docker, /^COPY --chown=node:node planner \.\/planner\r?$/m);
});

test('the Pages build ships every module of planner/ (build.ts)', () => {
  const build = fs.readFileSync(new URL('../build.ts', import.meta.url), 'utf8');
  // Every .ts file of the folder is shipped, so a new module needs no list entry.
  assert.match(build, /fs\.readdir\(path\.join\(root, 'planner'\)\)/);
  // The exact-match edits build.ts makes for the browser still find their snippets.
  const data = fs.readFileSync(new URL('../planner/data.ts', import.meta.url), 'utf8');
  assert.ok(data.includes("import fs from 'node:fs';"));
  assert.ok(data.includes("fs.readFileSync(new URL('../recipes.json', import.meta.url), 'utf8')"));
});
