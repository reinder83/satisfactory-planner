// Loads the browser app as one script for the VM-based interface tests.
//
// The app is split into ES modules under public/app/, but the tests call its render
// functions and assign its state (`plan = fixture`) directly, so they need every top-level
// binding in one shared scope. This concatenates the modules in ES evaluation order
// (depth-first, dependencies before dependents) and strips the import/export syntax.
//
// Imports of the shared modules below are not followed: each test supplies their
// exports as VM globals, as it did when the app was a single file. Nor is the Vue layer
// (the vue package and public/app/ui/): these tests draw pages through the legacy render
// functions, so every name imported from it becomes a do-nothing function. Components are
// tested with Vitest in tests/ui/ instead.
//
// TypeScript modules (.ts) have their types stripped first with Node's own stripper, which
// replaces the type syntax with spaces and leaves everything else as written, so the
// import and export statements below still match.
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// stripTypeScriptTypes is marked experimental and warns on its first call; the warning is
// noise in the test output, so only that one is dropped.
const emitWarning = process.emitWarning;
const stripTypes = (code: string) => {
  process.emitWarning = ((warning: string | Error, ...rest: never[]) => {
    if (!String(warning).includes('stripTypeScriptTypes'))
      emitWarning.call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return stripTypeScriptTypes(code);
  } finally {
    process.emitWarning = emitWarning;
  }
};

const PUBLIC = new URL('../../public/', import.meta.url);
const UI = new URL('app/ui/', PUBLIC).href;
const SHARED = new Set([
  'browser-api.ts',
  'preferences.ts',
  'progression.ts',
  'state.ts',
  'ada.ts',
]);
const IMPORT = /^import\s(?:[^;]*?\sfrom\s)?'([^']+)';\r?\n/gm;

export function appSource() {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const stubs = new Set<string>();
  // A Vue-layer file is not included, but the plain modules it imports are, so that
  // module state the components read (ADA's, for one) is there for the tests.
  const visit = (url: URL) => {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    const source = fs.readFileSync(url, 'utf8');
    const text = url.pathname.endsWith('.ts') ? stripTypes(source) : source;
    const ui = url.href.startsWith(UI);
    for (const [statement, specifier] of text.matchAll(IMPORT)) {
      if (specifier === 'vue') continue;
      // The pattern's one group always matches.
      const dependency = new URL(specifier!, url);
      if (dependency.href.startsWith(UI) && !ui)
        for (const name of statement.match(/\{([^}]*)\}/)?.[1]?.split(',') || [])
          if (name.trim()) stubs.add(name.trim());
      if (!SHARED.has(dependency.href.slice(PUBLIC.href.length))) visit(dependency);
    }
    if (!ui) ordered.push(text.replace(IMPORT, '').replace(/^export /gm, ''));
  };
  visit(new URL('app.ts', PUBLIC));
  const source = [...[...stubs].map(name => `function ${name}() {}`), ...ordered]
    .join('\n')
    .replaceAll(
      'import.meta.url',
      JSON.stringify('https://example.com/satisfactory-planner/app.js'),
    );
  // The entry module ends by booting the app; the tests drive it themselves.
  if (!/\nboot\(\);\s*$/.test(source)) throw Error('app.ts no longer ends with boot();');
  return source.replace(/\nboot\(\);\s*$/, '');
}
