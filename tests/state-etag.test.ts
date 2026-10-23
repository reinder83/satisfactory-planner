// #1210: GET /api/state carries an ETag of the progress it sends, and a request naming it while
// the progress is unchanged gets 304 without a body, so the Docker edition's live refresh
// (public/app/live-refresh.ts) costs a few bytes for a profile nobody changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { seedLegacy } from './helpers/seed.ts';

test('GET /api/state answers 304 while the progress is unchanged, and the new state after a write', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-etag-'));
  await seedLegacy(dir);
  const server = await createApp({ dataDir: dir });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  // Listening on a TCP port, so address() is an AddressInfo.
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const state = (headers: Record<string, string> = {}) => fetch(url + '/api/state', { headers });
  try {
    const first = await state();
    assert.equal(first.status, 200);
    const tag = first.headers.get('ETag');
    assert.match(tag ?? '', /^"[\w-]{32}"$/, 'a strong tag');
    const saved = await first.json();
    // Unchanged: 304, no body, the same tag; a weak form or a list naming it counts too.
    for (const named of [tag!, 'W/' + tag, '"other", ' + tag, '*']) {
      const again = await state({ 'If-None-Match': named });
      assert.equal(again.status, 304, named);
      assert.equal(again.headers.get('ETag'), tag);
      assert.equal(await again.text(), '');
    }
    // Another tag, or none: the whole state.
    const other = await state({ 'If-None-Match': '"other"' });
    assert.equal(other.status, 200);
    assert.deepEqual(await other.json(), saved);
    // Another device ticks a step: the old tag now gets the new state and a new tag.
    const write = await fetch(url + '/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      body: JSON.stringify({ type: 'check', key: 'elsewhere', value: true }),
    });
    assert.equal(write.status, 200);
    const changed = await state({ 'If-None-Match': tag! });
    assert.equal(changed.status, 200);
    const next = await changed.json();
    assert.equal(next.checks.elsewhere, true);
    assert.equal(next.revision, saved.revision + 1);
    const nextTag = changed.headers.get('ETag');
    assert.notEqual(nextTag, tag);
    assert.equal((await state({ 'If-None-Match': nextTag! })).status, 304);
    // A tab showing a plan the profile no longer has is still refused, tag or not (#1071).
    const stale = await state({ 'If-None-Match': nextTag!, 'X-Planner-Plan': 'not-this-plan' });
    assert.equal(stale.status, 409);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
