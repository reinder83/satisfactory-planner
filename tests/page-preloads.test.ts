// The modulepreload links build.ts writes into both editions' index.html (#1279). They name every
// script app.js imports, directly or through another script, so the browser asks for all of them
// at once instead of finding each level of imports only after the level above has arrived.
// build.ts finds them with a regex over the minified code; this test builds into a temporary
// folder (PLANNER_DIST, like map-image-build.test.ts) and compares the links with the import graph
// esbuild reads from the same files, so an import syntax the regex misses, a link to a script
// that is not imported (or only imported on demand) and a link to a missing file all fail here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as esbuild from 'esbuild';

// The scripts `file` imports with a static import or re-export (not import()), as esbuild
// reports them: every relative specifier stays external, so each file is read on its own.
async function staticImportsOf(file: string) {
  const result = await esbuild.build({
    entryPoints: [file],
    bundle: true,
    external: ['./*', '../*'],
    write: false,
    metafile: true,
    format: 'esm',
    outdir: 'unused',
    logLevel: 'silent',
  });
  const [input] = Object.values(result.metafile.inputs);
  return input!.imports.filter(i => i.kind === 'import-statement').map(i => i.path);
}

// Every script app.js reaches by static imports, as paths under `out` ('state/mutate.js').
async function importGraph(out: string) {
  const reached = new Set<string>();
  const visit = async (name: string) => {
    for (const spec of await staticImportsOf(path.join(out, name))) {
      const target = path.posix.join(path.posix.dirname(name), spec);
      if (reached.has(target)) continue;
      reached.add(target);
      await visit(target);
    }
  };
  await visit('app.js');
  return reached;
}

// The href of each modulepreload link of a page, in page order.
const preloadHrefs = (html: string) =>
  [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map(m => m[1]!);

test('both editions preload app.js and every script it imports, and only those', async t => {
  const dist = mkdtempSync(path.join(os.tmpdir(), 'planner-preload-build-'));
  t.after(() => rmSync(dist, { recursive: true, force: true }));
  const build = spawnSync(process.execPath, ['build.ts'], {
    encoding: 'utf8',
    env: { ...process.env, PLANNER_DIST: dist },
  });
  assert.equal(build.status, 0, build.stderr);
  // The Docker edition serves from the root, the Pages edition from a subpath: its links are
  // page-relative.
  for (const [edition, prefix] of [
    ['web', '/'],
    ['satisfactory-planner', './'],
  ] as const) {
    const out = path.join(dist, edition);
    const html = readFileSync(path.join(out, 'index.html'), 'utf8');
    const hrefs = preloadHrefs(html);
    assert.equal(
      hrefs.every(href => href.startsWith(prefix)),
      true,
      `${edition}: ${prefix} links`,
    );
    const names = hrefs.map(href => href.slice(prefix.length));
    assert.equal(names[0], 'app.js', `${edition}: app.js is preloaded first`);
    assert.equal(new Set(names).size, names.length, `${edition}: no link twice`);
    for (const name of names) assert.ok(existsSync(path.join(out, name)), `${edition}: ${name}`);

    const graph = await importGraph(out);
    assert.ok(graph.size > 20 && graph.has('state/validate.js'), `${edition}: the graph is read`);
    assert.deepEqual(
      names.slice(1).sort(),
      [...graph].sort(),
      `${edition}: the links are app.js and its static imports`,
    );

    // The module script comes after its preloads, and the Pages page's classic browser-mode.js
    // script, which sets the edition flag, still comes before the module script.
    const moduleScript = html.indexOf(`<script type="module" src="${prefix}app.js"></script>`);
    assert.ok(moduleScript > 0, `${edition}: the module script loads app.js`);
    assert.ok(html.lastIndexOf('rel="modulepreload"') < moduleScript, `${edition}: preloads first`);
    assert.equal(html.includes('src="/app.ts"') || html.includes('src="./app.ts"'), false);
    if (edition === 'satisfactory-planner')
      assert.ok(html.indexOf('./browser-mode.js') < moduleScript, 'the flag is set first');
  }
});
