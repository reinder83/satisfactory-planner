// Loads the browser app as one script for the VM-based interface tests.
//
// The app is split into ES modules under public/app/, but the tests call its render
// functions and assign its state (`plan = fixture`) directly, so they need every top-level
// binding in one shared scope. This concatenates the modules in ES evaluation order
// (depth-first, dependencies before dependents) and strips the import/export syntax.
//
// Imports of the shared modules below are not followed: each test supplies their
// exports as VM globals, as it did when the app was a single file.
import fs from 'node:fs';

const PUBLIC = new URL('../../public/', import.meta.url);
const SHARED = new Set([
  'browser-api.js',
  'preferences.js',
  'progression.js',
  'state.js',
  'ada.js',
]);
const IMPORT = /^import\s(?:[^;]*?\sfrom\s)?'([^']+)';\r?\n/gm;

export function appSource() {
  const seen = new Set();
  const ordered = [];
  const visit = url => {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    const text = fs.readFileSync(url, 'utf8');
    for (const [, specifier] of text.matchAll(IMPORT)) {
      const dependency = new URL(specifier, url);
      if (!SHARED.has(dependency.href.slice(PUBLIC.href.length))) visit(dependency);
    }
    ordered.push(text.replace(IMPORT, '').replace(/^export /gm, ''));
  };
  visit(new URL('app.js', PUBLIC));
  const source = ordered
    .join('\n')
    .replaceAll(
      'import.meta.url',
      JSON.stringify('https://example.com/satisfactory-planner/app.js'),
    );
  // The entry module ends by booting the app; the tests drive it themselves.
  if (!/\nboot\(\);\s*$/.test(source)) throw Error('app.js no longer ends with boot();');
  return source.replace(/\nboot\(\);\s*$/, '');
}
