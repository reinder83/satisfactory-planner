// Builds the two published editions from the readable sources in public/:
//
//   dist/web/                    Docker edition. The image serves this directory as public/.
//   dist/satisfactory-planner/   GitHub Pages edition: allowlisted, browser-only, with the
//                                calculator running in a worker.
//
// Both are minified: the modules in public/app/ are bundled into app.js by Vite, the other scripts
// and the stylesheet are minified file by file. The sources are TypeScript; both steps strip the
// types, and every script ships as .js. Development needs no build; `npm start` serves public/
// as it is, with Vite compiling the TypeScript on request.
//
// Usage: node build.ts [web] [pages]    (no argument builds both)
import * as esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';
import { fontFile, fontNames } from './fonts.ts';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const dist = path.join(root, 'dist');
const targets = process.argv.length > 2 ? process.argv.slice(2) : ['web', 'pages'];
for (const target of targets)
  if (!['web', 'pages'].includes(target)) throw Error('Unknown target ' + target);

// Scripts at the root of public/ ship as separate files, as they are in development: the
// server imports some of them, browser-check.ts imports browser-api.js into the page, and
// each must stay one module instance. Only public/app/ (and app-root.ts) is bundled. Each
// public/<name>.ts ships as <name>.js. The modules state.ts re-exports, in public/state/, ship
// the same way, as state/<name>.js (#532), and so do the ones preferences.ts re-exports, in
// public/preferences/, as preferences/<name>.js (#777).
const SHARED = [
  'ada.ts',
  'browser-api.ts',
  'browser-store.ts',
  'handbook-migration.ts',
  'mining.ts',
  'power.ts',
  'preferences.ts',
  'progression.ts',
  'reviewed-plans.ts',
  'state.ts',
  'storage-room.ts',
  'transfer.ts',
  'wording.ts',
  'preferences/extraction.ts',
  'preferences/fuels.ts',
  'preferences/guided.ts',
  'preferences/help.ts',
  'preferences/mining.ts',
  'preferences/presets.ts',
  'preferences/storage.ts',
  'preferences/world.ts',
  'state/alternates.ts',
  'state/carry.ts',
  'state/factory-groups.ts',
  'state/items.ts',
  'state/mutate.ts',
  'state/rename-offer.ts',
  'state/restore.ts',
  'state/summary.ts',
  'state/validate.ts',
];
// The folders of public/ that hold shared scripts.
const SHARED_DIRS = ['state', 'preferences'];
const BUNDLED = ['app.ts', 'app-root.ts'];
const shipped = (name: string) => name.replace(/\.ts$/, '.js');
// A file's path under public/ as SHARED lists it ('state/mutate.ts').
const publicPath = (file: string) => path.relative(publicDir, file).split(path.sep).join('/');

// Source edits for the browser edition must all apply, or the build would ship server-only code.
const replaceOnce = (text: string, from: string, to: string) => {
  if (!text.includes(from)) throw Error('Browser build: source no longer contains ' + from);
  return text.replace(from, to);
};
const read = (file: string) => fs.readFile(path.join(root, file), 'utf8');
const minifyJs = async (code: string, loader: 'js' | 'ts' = 'js') =>
  (await esbuild.transform(code, { loader, format: 'esm', minify: true, charset: 'utf8' })).code;
// A shared script as it ships: types stripped, minified, and its imports of the other shared
// scripts renamed to the .js files they ship as (esbuild keeps the specifiers as written).
const sharedJs = async (name: string) => {
  const code = await minifyJs(await read('public/' + name), 'ts');
  return code.replace(/(from\s*|import\s*\(\s*)(["'])(\.\.?\/[\w/-]+)\.ts\2/g, '$1$2$3.js$2');
};
// A planner import as the Pages edition lays the files out: a shared script of public/ ships as
// .js next to planner.mjs ('./public/wording.ts' -> './wording.js', '../public/preferences.ts'
// -> '../preferences.js'), the optimizer and the planner's own modules as .mjs.
const plannerImport = (spec: string) => {
  const shared = /^(\.\/|(?:\.\.\/)+)public\/([\w/-]+)\.ts$/;
  if (shared.test(spec)) return spec.replace(shared, '$1$2.js');
  if (spec.endsWith('.ts')) return spec.replace(/\.ts$/, '.mjs');
  throw Error('Browser build: unexpected planner import ' + spec);
};
// planner.ts or a module of planner/ as the Pages edition ships it: types stripped, minified,
// planner/data.ts reading recipes.json with fetch instead of node:fs (by exact match, so keep
// those snippets unchanged), and the relative imports renamed by plannerImport.
async function plannerJs(file: string) {
  let code = await read(file);
  if (file === 'planner/data.ts') {
    code = replaceOnce(code, "import fs from 'node:fs';", '');
    code = replaceOnce(
      code,
      "fs.readFileSync(new URL('../recipes.json', import.meta.url), 'utf8')",
      "await (await fetch(new URL('../recipes.json',import.meta.url))).text()",
    );
  }
  return (await minifyJs(code, 'ts')).replace(
    /(from\s*|import\s*\(\s*)(["'])(\.\.?\/[^"']+)\2/g,
    (_, lead: string, quote: string, spec: string) => lead + quote + plannerImport(spec) + quote,
  );
}
// The page loads app.ts in development; the editions ship the bundle as app.js.
const shippedPage = (html: string) => replaceOnce(html, 'src="/app.ts"', 'src="/app.js"');
// The typefaces, from their npm packages, as style.css names them (fonts.ts).
async function writeFonts(out: string) {
  await fs.mkdir(path.join(out, 'fonts'), { recursive: true });
  for (const name of fontNames) await fs.copyFile(fontFile(name), path.join(out, 'fonts', name));
}
// An installed package's file, by its package path ('highs/runtime').
const packageFile = (specifier: string) => fileURLToPath(import.meta.resolve(specifier));
const minifyCss = async (code: string) =>
  (await esbuild.transform(code, { loader: 'css', minify: true, charset: 'utf8' })).code;

// public/app.ts with public/app/ (including the Vue components) and Vue itself, as one
// minified module, built by Vite. The shared root scripts stay imports of their own files.
async function bundleApp() {
  const result = await viteBuild({
    configFile: path.join(root, 'vite.config.ts'),
    build: {
      write: false,
      minify: true,
      modulePreload: false,
      rollupOptions: {
        input: path.join(publicDir, 'app.ts'),
        preserveEntrySignatures: 'strict',
        // Called with the import as written, so relative ones are resolved against the importer.
        external: (id, importer, resolved) => {
          const file = resolved || !importer ? id : path.resolve(path.dirname(importer), id);
          return SHARED.includes(publicPath(file));
        },
        output: {
          format: 'es',
          entryFileNames: 'app.js',

          paths: id => './' + shipped(publicPath(id)),
        },
      },
    },
  });
  // With write: false and no watch option Vite returns the bundle itself.
  const bundle = Array.isArray(result) ? result[0] : result;
  if (!bundle || !('output' in bundle)) throw Error('build.ts: Vite returned no bundle');
  const chunks = bundle.output;
  const app = chunks.flatMap(c => (c.type === 'chunk' ? [c] : []));
  if (app.length !== 1 || chunks.some(c => c.type === 'asset'))
    throw Error('build.ts: expected app.js as the only output, got ' + chunks.map(c => c.fileName));
  return app[0]!.code;
}

// Every script at the root of public/ and in SHARED_DIRS must be classified above, so a new one
// is never shipped unminified or bundled twice by accident.
for (const dir of ['', ...SHARED_DIRS])
  for (const name of await fs.readdir(path.join(publicDir, dir))) {
    const file = dir ? dir + '/' + name : name;
    if (/\.(js|ts)$/.test(name) && !SHARED.includes(file) && !BUNDLED.includes(file))
      throw Error(`build.ts: add public/${file} to SHARED or BUNDLED`);
  }

async function writeScripts(out: string) {
  await fs.writeFile(path.join(out, 'app.js'), await bundleApp());
  for (const dir of SHARED_DIRS) await fs.mkdir(path.join(out, dir), { recursive: true });
  for (const name of SHARED)
    await fs.writeFile(path.join(out, shipped(name)), await sharedJs(name));
  await fs.writeFile(path.join(out, 'style.css'), await minifyCss(await read('public/style.css')));
}

// Docker edition: everything the server serves from public/, minus the module sources and docs.
// The Dockerfile adds the shared .ts sources next to it for the server, which imports them.
async function buildWeb() {
  const out = path.join(dist, 'web');
  await fs.rm(out, { recursive: true, force: true });
  const skip = new Set([
    path.join(publicDir, 'app'),
    path.join(publicDir, 'types'),
    ...[...BUNDLED, ...SHARED, ...SHARED_DIRS].map(name => path.join(publicDir, name)),
  ]);
  await fs.cp(publicDir, out, {
    recursive: true,
    filter: src => !skip.has(src) && !src.endsWith('.md'),
  });
  await writeScripts(out);
  await writeFonts(out);
  const page = path.join(out, 'index.html');
  await fs.writeFile(page, shippedPage(await fs.readFile(page, 'utf8')));
  console.log('Docker edition built in dist/web');
}

async function buildPages() {
  const { catalog } = await import('./planner.ts');
  const out = path.join(dist, 'satisfactory-planner');
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  await writeScripts(out);
  // Explicit allowlist: server data, credentials and the server's frozen handbook (migrations/)
  // never enter the public build.
  for (const file of ['index.html', 'favicon.svg', 'progression.json'])
    await fs.copyFile(path.join(publicDir, file), path.join(out, file));
  await fs.cp(path.join(publicDir, 'icons'), path.join(out, 'icons'), { recursive: true });
  await writeFonts(out);
  let html = shippedPage(await fs.readFile(path.join(out, 'index.html'), 'utf8'));
  html = replaceOnce(
    html.replaceAll('href="/', 'href="./').replaceAll('src="/', 'src="./'),
    '<script type="module"',
    '<script src="./browser-mode.js"></script><script type="module"',
  );
  await fs.writeFile(path.join(out, 'index.html'), html);
  await fs.writeFile(path.join(out, 'browser-mode.js'), 'globalThis.PLANNER_BROWSER=true;\n');
  await fs.copyFile(path.join(root, 'recipes.json'), path.join(out, 'recipes.json'));
  await fs.writeFile(path.join(out, 'catalog.json'), JSON.stringify(catalog()));
  // The planner and optimizer are TypeScript: stripped here, and shipped as .mjs files that
  // import each other by those names. planner.ts re-exports the modules in planner/ (#776),
  // which ship as planner/<name>.mjs.
  await fs.writeFile(path.join(out, 'planner.mjs'), await plannerJs('planner.ts'));
  await fs.mkdir(path.join(out, 'planner'), { recursive: true });
  for (const name of await fs.readdir(path.join(root, 'planner')))
    if (name.endsWith('.ts'))
      await fs.writeFile(
        path.join(out, 'planner', name.replace(/\.ts$/, '.mjs')),
        await plannerJs('planner/' + name),
      );
  let optimizer = await read('optimizer.ts');
  optimizer = replaceOnce(optimizer, "from 'highs'", "from './highs.mjs'");
  await fs.writeFile(path.join(out, 'optimizer.mjs'), await minifyJs(optimizer, 'ts'));
  // The highs package's own ES module build, already minified, which loads highs.wasm from
  // next to itself.
  await fs.copyFile(packageFile('highs'), path.join(out, 'highs.mjs'));
  await fs.copyFile(packageFile('highs/runtime'), path.join(out, 'highs.wasm'));
  await fs.copyFile(
    path.join(root, 'node_modules', 'highs', 'LICENSE'),
    path.join(out, 'HIGHS-LICENSE'),
  );
  await fs.writeFile(
    path.join(out, 'calculator-worker.js'),
    await minifyJs(`const ready = import('./planner.mjs');
self.onmessage = async ({ data }) => {
  try {
    const { calculate, rankAlternates } = await ready;
    self.postMessage({
      id: data.id,
      result: data.rank
        ? rankAlternates(data.settings, {
            phase: data.rank.phase,
            budgetMs: data.rank.budgetMs,
            onProgress: (done, total) => self.postMessage({ id: data.id, done, total }),
            onPhase: phase => self.postMessage({ id: data.id, phase }),
          })
        : calculate(data.settings, phase => self.postMessage({ id: data.id, phase })),
    });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};`),
  );
  await fs.writeFile(path.join(dist, '.nojekyll'), '');
  await fs.writeFile(
    path.join(dist, 'index.html'),
    '<!doctype html><meta charset="utf-8"><title>Satisfactory Planner</title><a href="./satisfactory-planner/">Open Satisfactory Planner</a>',
  );
  console.log('Browser edition built in dist/satisfactory-planner');
}

if (targets.includes('web')) await buildWeb();
if (targets.includes('pages')) await buildPages();
