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
// Usage: node build.mjs [web] [pages]    (no argument builds both)
import * as esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const dist = path.join(root, 'dist');
const targets = process.argv.length > 2 ? process.argv.slice(2) : ['web', 'pages'];
for (const target of targets)
  if (!['web', 'pages'].includes(target)) throw Error('Unknown target ' + target);

// Scripts at the root of public/ ship as separate files, as they are in development: the
// server imports some of them, browser-check.mjs imports browser-api.js into the page, and
// each must stay one module instance. Only public/app/ (and app-root.ts) is bundled. Each
// public/<name>.ts ships as <name>.js.
const SHARED = [
  'ada.ts',
  'browser-api.ts',
  'browser-store.ts',
  'preferences.ts',
  'progression.ts',
  'state.ts',
  'transfer.ts',
];
const BUNDLED = ['app.ts', 'app-root.ts'];
const shipped = name => name.replace(/\.ts$/, '.js');

// Source edits for the browser edition must all apply, or the build would ship server-only code.
const replaceOnce = (text, from, to) => {
  if (!text.includes(from)) throw Error('Browser build: source no longer contains ' + from);
  return text.replace(from, to);
};
const read = file => fs.readFile(path.join(root, file), 'utf8');
const minifyJs = async (code, loader = 'js') =>
  (await esbuild.transform(code, { loader, format: 'esm', minify: true, charset: 'utf8' })).code;
// A shared script as it ships: types stripped, minified, and its imports of the other shared
// scripts renamed to the .js files they ship as (esbuild keeps the specifiers as written).
const sharedJs = async name => {
  const code = await minifyJs(await read('public/' + name), 'ts');
  return code.replace(/(from\s*|import\s*\(\s*)(["'])(\.\/[\w-]+)\.ts\2/g, '$1$2$3.js$2');
};
// The page loads app.ts in development; the editions ship the bundle as app.js.
const shippedPage = html => replaceOnce(html, 'src="/app.ts"', 'src="/app.js"');
const minifyCss = async code =>
  (await esbuild.transform(code, { loader: 'css', minify: true, charset: 'utf8' })).code;

// public/app.ts with public/app/ (including the Vue components) and Vue itself, as one
// minified module, built by Vite. The shared root scripts stay imports of their own files.
async function bundleApp() {
  const result = await viteBuild({
    configFile: path.join(root, 'vite.config.mjs'),
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
          return path.dirname(file) === publicDir && SHARED.includes(path.basename(file));
        },
        output: {
          format: 'es',
          entryFileNames: 'app.js',

          paths: id => './' + shipped(path.basename(id)),
        },
      },
    },
  });
  const chunks = (Array.isArray(result) ? result[0] : result).output;
  const app = chunks.filter(c => c.type === 'chunk');
  if (app.length !== 1 || chunks.some(c => c.type === 'asset'))
    throw Error(
      'build.mjs: expected app.js as the only output, got ' + chunks.map(c => c.fileName),
    );
  return app[0].code;
}

// Every script at the root of public/ must be classified above, so a new one is never
// shipped unminified or bundled twice by accident.
const rootScripts = (await fs.readdir(publicDir)).filter(name => /\.(js|ts)$/.test(name));
for (const name of rootScripts)
  if (!SHARED.includes(name) && !BUNDLED.includes(name))
    throw Error(`build.mjs: add public/${name} to SHARED or BUNDLED`);

async function writeScripts(out) {
  await fs.writeFile(path.join(out, 'app.js'), await bundleApp());
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
    ...[...BUNDLED, ...SHARED].map(name => path.join(publicDir, name)),
  ]);
  await fs.cp(publicDir, out, {
    recursive: true,
    filter: src => !skip.has(src) && !src.endsWith('.md'),
  });
  await writeScripts(out);
  const page = path.join(out, 'index.html');
  await fs.writeFile(page, shippedPage(await fs.readFile(page, 'utf8')));
  console.log('Docker edition built in dist/web');
}

async function buildPages() {
  const { catalog } = await import('./planner.mjs');
  const out = path.join(dist, 'satisfactory-planner');
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  await writeScripts(out);
  // Explicit allowlist: server data, credentials and private handbook targets never enter the public build.
  for (const file of ['index.html', 'favicon.svg', 'progression.json'])
    await fs.copyFile(path.join(publicDir, file), path.join(out, file));
  await fs.cp(path.join(publicDir, 'icons'), path.join(out, 'icons'), { recursive: true });
  await fs.cp(path.join(publicDir, 'fonts'), path.join(out, 'fonts'), { recursive: true });
  let html = shippedPage(await fs.readFile(path.join(out, 'index.html'), 'utf8'));
  html = replaceOnce(
    html.replaceAll('href="/', 'href="./').replaceAll('src="/', 'src="./'),
    '<script type="module"',
    '<script src="./browser-mode.js"></script><script type="module"',
  );
  await fs.writeFile(path.join(out, 'index.html'), html);
  await fs.writeFile(path.join(out, 'browser-mode.js'), 'globalThis.PLANNER_BROWSER=true;\n');
  const handbook = JSON.parse(await read('public/plan.json'));
  await fs.writeFile(
    path.join(out, 'plan.json'),
    JSON.stringify({
      version: 'public-template-v1',
      storage: handbook.storage,
      storageTasks: [],
      phases: { 3: [], 4: [], 5: [], post: [] },
      factories: [],
      completion: [],
      deliveries: [],
      resources: {},
      capacities: {},
      plans: {},
      power: {},
      knownChecks: {},
      sources: [],
    }),
  );
  await fs.copyFile(path.join(root, 'recipes.json'), path.join(out, 'recipes.json'));
  await fs.writeFile(path.join(out, 'catalog.json'), JSON.stringify(catalog()));
  let planner = await read('planner.mjs');
  planner = replaceOnce(planner, "import fs from 'node:fs';", '');
  planner = replaceOnce(planner, "from './public/preferences.ts'", "from './preferences.js'");
  planner = replaceOnce(
    planner,
    "JSON.parse(fs.readFileSync(new URL('./recipes.json', import.meta.url)))",
    "await (await fetch(new URL('./recipes.json',import.meta.url))).json()",
  );
  await fs.writeFile(path.join(out, 'planner.mjs'), await minifyJs(planner));
  let optimizer = await read('optimizer.mjs');
  optimizer = replaceOnce(optimizer, "'./vendor/highs.cjs'", "'./highs.mjs'");
  optimizer = replaceOnce(
    optimizer,
    'await loadHighs()',
    'await loadHighs({locateFile:name=>new URL(name,import.meta.url).href})',
  );
  await fs.writeFile(path.join(out, 'optimizer.mjs'), await minifyJs(optimizer));
  // The vendored HiGHS build is already minified; it only gains an ES module export.
  await fs.writeFile(
    path.join(out, 'highs.mjs'),
    (await read('vendor/highs.cjs')) + '\nexport default Module;\n',
  );
  await fs.copyFile(path.join(root, 'vendor/highs.wasm'), path.join(out, 'highs.wasm'));
  await fs.copyFile(path.join(root, 'vendor/HIGHS-LICENSE'), path.join(out, 'HIGHS-LICENSE'));
  await fs.writeFile(
    path.join(out, 'calculator-worker.js'),
    await minifyJs(`const ready = import('./planner.mjs');
self.onmessage = async ({ data }) => {
  try {
    const { calculate } = await ready;
    self.postMessage({
      id: data.id,
      result: calculate(data.settings, phase => self.postMessage({ id: data.id, phase })),
    });
  } catch (e) {
    self.postMessage({ id: data.id, error: e.message });
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
