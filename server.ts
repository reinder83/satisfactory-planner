import http from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { openWorkspace } from './workspace.ts';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
import { initialState as blankState, validateState, mutate } from './public/state.ts';
import type { ProgressState } from './public/types/index.ts';
export { validateState, mutate };
// Starting progress for the Original handbook profile of a brand-new server (no
// workspace.json and no legacy progress.json): the owner's handbook starts in Phase 3 with
// the storage ground floor built and 125,000 Versatile Frameworks delivered. Not used for
// any other profile; tests import it to compare against.
export const initialState = (): ProgressState => ({
  ...blankState(),
  checks: { 'storage-ground-shell': true },
  deliveries: { '3-versatile-framework': 125000 },
  settings: { phase: '3' },
});
// A function declaration, so TypeScript knows the code after a failed check is unreachable.
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
// A thrown error: one with a status carries a message for the user.
type Failure = { status?: number; message?: string; code?: string } | null | undefined;
// Builds the Docker edition's HTTP server (not yet listening) around the workspace in
// dataDir. APP_PASSWORD adds an optional HTTP Basic login in front of everything, separate
// from the in-app accounts in workspace.ts. Tests call this with a temporary dataDir.
// `dev` serves the frontend through Vite (see devFrontend below) instead of as plain files.
export async function createApp({
  dataDir = process.env.DATA_DIR || path.join(root, 'data'),
  user = process.env.APP_USER || 'pioneer',
  password = process.env.APP_PASSWORD || '',
  dev = false,
} = {}) {
  await fs.mkdir(dataDir, { recursive: true });
  const workspace = await openWorkspace({ dataDir, initialState, validateState, mutate });
  const hash = (s: string) => createHash('sha256').update(s).digest();
  // JSON replies are never cached, so a browser never shows stale progress.
  const send = (
    res: ServerResponse,
    status: number,
    value: unknown,
    headers: Record<string, string> = {},
  ) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(JSON.stringify(value));
  };
  // Reads a JSON request body, stopping at 2 MB (50 MB for a full-save import, which carries
  // whole plans and handbooks) so a huge upload cannot exhaust memory. The error names the
  // limit that applied. Passed to workspace routes, which call it only when they need a body.
  const body = async (req: IncomingMessage): Promise<unknown> => {
    let chunks: Buffer[] = [],
      length = 0;
    const limit = req.url?.split('?')[0] === '/api/import-saves' ? 50 : 2;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > limit * 1024 * 1024) fail(`Backup or update exceeds ${limit} MB.`, 413);
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      fail('Invalid JSON.');
    }
  };
  const server = http.createServer(async (req, res) => {
    // nosniff stops browsers treating a JSON or data file as script or HTML. The CSP allows
    // only this origin's own scripts and requests, so injected markup cannot load or send
    // anything elsewhere; inline styles and data: images are allowed because the interface
    // uses them. frame-ancestors 'none' prevents embedding the planner to trick clicks.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      // Open without a password so container health checks work.
      if (url.pathname === '/health' && req.method === 'GET') return send(res, 200, { ok: true });
      // Both sides are hashed first so timingSafeEqual compares equal lengths and the time
      // taken does not reveal how much of the credential matched.
      if (password) {
        let credential = '';
        if (req.headers.authorization?.startsWith('Basic '))
          credential = Buffer.from(req.headers.authorization.slice(6), 'base64').toString('utf8');
        if (!timingSafeEqual(hash(credential), hash(user + ':' + password)))
          return send(
            res,
            401,
            { error: 'Sign in to the planner.' },
            { 'WWW-Authenticate': 'Basic realm="Satisfactory Planner", charset="UTF-8"' },
          );
      }
      // Every write is a POST, and every POST must prove it came from the planner's own page.
      // Another site can submit a form or a simple fetch, but cannot add a custom header or
      // a JSON content type without a CORS preflight this server never approves; a browser's
      // Origin header, when sent, must also match the host. Together with the SameSite
      // cookie this blocks cross-site request forgery. GET routes only read.
      if (req.method === 'POST') {
        if (req.headers['x-planner-request'] !== '1') fail('Missing request verification.', 403);
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
          fail('Cross-origin updates are not allowed.', 403);
        if (!req.headers['content-type']?.startsWith('application/json'))
          fail('Expected JSON.', 415);
        if (url.pathname.startsWith('/api/')) {
          const r = await workspace(req, url, body);
          return send(res, r.status, r.data, r.headers);
        }
        return send(res, 404, { error: 'Not found.' });
      }
      if (!['GET', 'HEAD'].includes(req.method ?? ''))
        return send(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD, POST' });
      if (url.pathname.startsWith('/api/')) {
        const r = await workspace(req, url, body);
        return send(res, r.status, r.data, r.headers);
      }
      // In development Vite serves the page and its modules, compiling .vue files.
      if (vite && (await vite.handle(req, res, url))) return;
      // Static files come from public/ (built by build.ts in the Docker image). A path that
      // resolves outside it, such as one with ../, is refused, so data/ is never served.
      const publicDir = path.join(root, 'public');
      const relative = decodeURIComponent(url.pathname);
      const file = path.resolve(publicDir, '.' + (relative === '/' ? '/index.html' : relative));
      if (!file.startsWith(publicDir + path.sep)) return send(res, 403, { error: 'Not allowed.' });
      // The image keeps the shared TypeScript sources beside the build for this server to
      // import; browsers load the built .js files, so the sources are not served.
      if (file.endsWith('.ts')) return send(res, 404, { error: 'Not found.' });
      let content: Buffer;
      try {
        content = await fs.readFile(file);
      } catch (e) {
        if (['ENOENT', 'EISDIR'].includes((e as Failure)?.code ?? ''))
          return send(res, 404, { error: 'Not found.' });
        throw e;
      }
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.pdf': 'application/pdf',
      };
      const type = types[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (thrown) {
      // Errors thrown with a status are meant for the user; anything else is unexpected and
      // gets a generic message, since commit() never writes a half-applied change.
      const e = thrown as Failure;
      if (!res.headersSent)
        send(res, e?.status || 500, {
          error: e?.status
            ? e.message
            : 'Could not save or load data. Please retry; your previous progress is retained.',
        });
      else res.end();
    }
  });
  const vite = dev ? await devFrontend(server) : null;
  if (vite) server.on('close', () => vite.close());
  return server;
}

// Development only: Vite in middleware mode on the planner's own server and port, so
// `npm start` still serves the source as it is, with the Vue components compiled on
// request and edits reloaded in the browser. Its file access is limited to public/ and the
// installed packages, so data/ stays out of reach. Needs the dev dependencies (npm ci).
async function devFrontend(server: Server) {
  let vite: import('vite').ViteDevServer;
  try {
    vite = await (
      await import('vite')
    ).createServer({
      configFile: path.join(root, 'vite.config.ts'),
      appType: 'custom',
      server: {
        middlewareMode: true,
        hmr: { server },
        fs: { strict: true, allow: [path.join(root, 'public'), path.join(root, 'node_modules')] },
      },
    });
  } catch (e) {
    if ((e as Failure)?.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    throw Error(
      'Development mode needs the dev dependencies: run npm ci (or set NODE_ENV=production to serve a build).',
    );
  }
  return {
    close: () => vite.close(),
    // Answers the request if it is Vite's to answer; false leaves it to the static files.
    async handle(req: IncomingMessage, res: ServerResponse, url: URL) {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const page = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        res.end(await vite.transformIndexHtml(url.pathname, page));
        return true;
      }
      await new Promise<void>(done => {
        res.once('finish', done);
        vite.middlewares(req, res, () => done());
      });
      return res.headersSent;
    },
  };
}
// Listen only when run directly (node server.ts), not when imported by tests.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createApp({ dev: process.env.NODE_ENV !== 'production' });
  const port = Number(process.env.PORT || 8080);
  server.listen(port, process.env.HOST || '0.0.0.0', () =>
    console.log('Planner ready at http://localhost:' + port),
  );
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => server.close(() => process.exit(0)));
}
