// The directory the app is served from (/ in Docker, /satisfactory-planner/ on GitHub Pages).
// It lives beside index.html so it resolves the same whether the app/ modules are loaded
// one by one or bundled into app.js.
export const appRoot = new URL('.', import.meta.url);
