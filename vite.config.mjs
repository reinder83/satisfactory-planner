// Vite compiles the Vue components in public/app/ui/. It is used three ways:
//   - development: server.mjs runs it in middleware mode (npm start), so the source is
//     served as it is, with .vue files compiled on request;
//   - build.mjs bundles public/app.js with it for both published editions;
//   - Vitest runs the component tests in tests/ui/ with it.
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default {
  root: fileURLToPath(new URL('./public', import.meta.url)),
  // Asset URLs in templates (<img src="./favicon.svg">) are relative to the page, as in the
  // plain-HTML views, not to the component, so Vue must leave them alone.
  plugins: [vue({ template: { transformAssetUrls: { tags: {} } } })],
  // Keep Vite's cache out of public/, which the server edition serves as static files.
  cacheDir: fileURLToPath(new URL('./node_modules/.vite', import.meta.url)),
  logLevel: 'warn',
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['tests/ui/**/*.test.mjs'],
    environment: 'happy-dom',
  },
};
