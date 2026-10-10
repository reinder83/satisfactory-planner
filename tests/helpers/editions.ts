// A new profile created the way each edition creates it, for tests that check both editions make
// the same profile from the same wizard answers (tests/guided-have.test.ts,
// tests/guided-max-output.test.ts): the Docker server through its HTTP API in a temporary data
// directory, and the browser edition's API over an in-memory store.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server.ts';
import { createBrowserApi } from '../../public/browser-api.ts';
import { calculate } from '../../planner.ts';
import type { BrowserWorkspace, Catalog, ContextReply } from '../../public/types/index.ts';

// The /api/profiles body the wizard's Create profile sends for a new save.
export const newSaveRequest = (settings: object, built: string[] = []) => ({
  saveId: null,
  saveName: 'World',
  name: 'Guided',
  settings,
  carryFrom: null,
  carry: {},
  built,
});

// The profile the Docker server creates from `body`, as /api/context returns it.
export async function dockerProfile(body: object): Promise<ContextReply> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-editions-'));
  const server: Server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  try {
    const created = await fetch(url + '/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      body: JSON.stringify(body),
    });
    assert.ok(created.ok, await created.clone().text());
    const { saveId, profileId } = (await created.json()) as { saveId: string; profileId: string };
    const context = await fetch(url + '/api/context', {
      headers: { 'X-Save-Id': saveId, 'X-Profile-Id': profileId },
    });
    assert.ok(context.ok);
    return (await context.json()) as ContextReply;
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

// The profile the browser edition creates from `body`.
export async function browserProfile(body: object): Promise<ContextReply> {
  let stored: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  const store = {
    async transaction<T>(change?: (workspace: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(stored);
      if (!change) return copy as T;
      const result = change(copy);
      stored = copy;
      return structuredClone(result);
    },
  };
  // The Catalog is not read by these routes.
  const api = createBrowserApi(store, calculate, {} as Catalog);
  await api('/api/profiles', { body: JSON.stringify(body) });
  return (await api('/api/context')) as ContextReply;
}

// The parts of a new profile both editions must agree on: the plan's settings and the progress.
export const createdProfile = (context: ContextReply) => ({
  settings: context.plan!.settings,
  checks: context.state.checks,
});
