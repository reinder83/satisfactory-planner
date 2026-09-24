import http from 'node:http';
import { openWorkspace } from './workspace.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
import { initialState as blankState, validateState, mutate } from './public/state.js';
export { validateState, mutate };
export const initialState = () => ({
  ...blankState(),
  checks: { 'storage-ground-shell': true },
  deliveries: { '3-versatile-framework': 125000 },
  settings: { phase: '3' },
});
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
export async function createApp({
  dataDir = process.env.DATA_DIR || path.join(root, 'data'),
  user = process.env.APP_USER || 'pioneer',
  password = process.env.APP_PASSWORD || '',
} = {}) {
  await fs.mkdir(dataDir, { recursive: true });
  const workspace = await openWorkspace({ dataDir, initialState, validateState, mutate });
  const hash = s => createHash('sha256').update(s).digest();
  const send = (res, status, value, headers = {}) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(JSON.stringify(value));
  };
  const body = async req => {
    let chunks = [],
      length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > (req.url?.split('?')[0] === '/api/import-saves' ? 50 : 2) * 1024 * 1024)
        fail('Backup or update exceeds 2 MB.', 413);
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      fail('Invalid JSON.');
    }
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health' && req.method === 'GET') return send(res, 200, { ok: true });
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
      if (!['GET', 'HEAD'].includes(req.method))
        return send(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD, POST' });
      if (url.pathname.startsWith('/api/')) {
        const r = await workspace(req, url, body);
        return send(res, r.status, r.data, r.headers);
      }
      const publicDir = path.join(root, 'public');
      const relative = decodeURIComponent(url.pathname);
      const file = path.resolve(publicDir, '.' + (relative === '/' ? '/index.html' : relative));
      if (!file.startsWith(publicDir + path.sep)) return send(res, 403, { error: 'Not allowed.' });
      let content;
      try {
        content = await fs.readFile(file);
      } catch (e) {
        if (['ENOENT', 'EISDIR'].includes(e.code)) return send(res, 404, { error: 'Not found.' });
        throw e;
      }
      const type =
        {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.pdf': 'application/pdf',
        }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (e) {
      if (!res.headersSent)
        send(res, e.status || 500, {
          error: e.status
            ? e.message
            : 'Could not save or load data. Please retry; your previous progress is retained.',
        });
      else res.end();
    }
  });
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createApp();
  const port = Number(process.env.PORT || 8080);
  server.listen(port, process.env.HOST || '0.0.0.0', () =>
    console.log('Planner ready at http://localhost:' + port),
  );
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => server.close(() => process.exit(0)));
}
