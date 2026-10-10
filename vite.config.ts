// Vite compiles the Vue components in public/app/ui/. It is used three ways:
//   - development: server.ts runs it in middleware mode (npm start), so the source is
//     served as it is, with .vue files compiled on request;
//   - build.ts bundles public/app.ts with it for both published editions;
//   - Vitest runs the component tests in tests/ui/ with it.
import vue from '@vitejs/plugin-vue';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { fontFile, isFontName } from './fonts.ts';

// Development only: /fonts/<name> from the @fontsource packages (fonts.ts), where the builds
// put the copies build.ts makes. Any other path under /fonts/ is left to the static files.
const fonts: Plugin = {
  name: 'planner-fonts',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/fonts', (req, res, next) => {
      const name = decodeURIComponent((req.url ?? '').split('?')[0]!.slice(1));
      if (!isFontName(name)) return next();
      res.setHeader('Content-Type', 'font/woff2');
      fs.createReadStream(fontFile(name)).pipe(res);
    });
  },
};

export default {
  root: fileURLToPath(new URL('./public', import.meta.url)),
  // Asset URLs in templates (<img src="./favicon.svg">) are relative to the page, as in the
  // plain-HTML views, not to the component, so Vue must leave them alone. Whitespace is kept
  // as written: between two inline elements (a row of buttons) it is the gap the old markup
  // had, and Vue's default would remove it wherever a line break sits between the tags.
  plugins: [
    vue({
      template: { transformAssetUrls: { tags: {} }, compilerOptions: { whitespace: 'preserve' } },
    }),
    fonts,
  ],
  // Keep Vite's cache out of public/, which the server edition serves as static files.
  cacheDir: fileURLToPath(new URL('./node_modules/.vite', import.meta.url)),
  logLevel: 'warn',
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['tests/ui/**/*.test.ts'],
    environment: 'happy-dom',
    // happy-dom fires a hashchange on history.replaceState() and pushState(); browsers never do
    // (#991). This drops those events before any listener sees them; see the file. Numbers read
    // as in en-US, as on the CI runners, whatever this machine's locale is (#1060).
    setupFiles: ['tests/ui/browser-history.ts', 'tests/helpers/en-us-numbers.ts'],
    // A test that renders many pages (the headroom notice on every phase: 18 pages, ~1.6 s here)
    // takes over 5 s on the NAS runner's CPU (#400), vitest's default. The limit only matters
    // for a test that hangs, so it is generous.
    testTimeout: 30000,
    // node:assert/strict with identity checks that print a page element by a short name
    // when they fail, rather than hanging on the whole document (#287); see the file.
    alias: [
      {
        find: /^node:assert\/strict$/,
        replacement: fileURLToPath(new URL('./tests/ui/assert.ts', import.meta.url)),
      },
    ],
  },
};
