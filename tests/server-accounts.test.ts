// server/accounts.ts on its own (#524): password hashing, session tokens and cookies, the
// requesting user, the sign-in input check and the setup token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import {
  authCookie,
  authValues,
  digest,
  hashPassword,
  makeSession,
  passwordMatches,
  publicUser,
  readSetupToken,
  sessionToken,
  setupTokenMatches,
  userFor,
} from '../server/accounts.ts';
import type { Workspace } from '../server/persistence.ts';

// A request with only the cookie header, which is all these read.
const withCookie = (cookie?: string) => ({ headers: { cookie } }) as IncomingMessage;
const workspace = (accountsEnabled: boolean): Workspace => ({
  version: 2,
  revision: 0,
  accountsEnabled,
  registration: false,
  users: [
    { id: 'owner', username: 'boss', activeSave: null },
    { id: 'u2', username: 'pioneer', activeSave: null },
  ],
  saves: [],
  sessions: [],
});

test('a stored password is salt:scryptHex and matches only its own password', async () => {
  const stored = await hashPassword('correct horse battery');
  assert.match(stored, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.notEqual(await hashPassword('correct horse battery'), stored, 'a fresh salt each time');
  assert.equal(await passwordMatches('correct horse battery', stored), true);
  assert.equal(await passwordMatches('wrong horse battery', stored), false);
  assert.equal(await passwordMatches('correct horse battery', undefined), false, 'missing user');
});

test('the session cookie is read from the header and written HttpOnly and SameSite=Strict', () => {
  assert.equal(sessionToken(withCookie('a=1; planner_session=abc ; b=2')), 'abc');
  assert.equal(sessionToken(withCookie('a=1')), undefined);
  assert.equal(sessionToken(withCookie()), undefined);
  assert.equal(
    authCookie('abc'),
    'planner_session=abc; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000',
  );
  assert.match(authCookie(''), /^planner_session=; .*Max-Age=0$/);
});

test('the requesting user is the owner without accounts, else the unexpired session user', () => {
  assert.equal(userFor(workspace(false), withCookie())?.id, 'owner');
  const accounts = workspace(true);
  assert.equal(userFor(accounts, withCookie()), null, 'signed out');
  makeSession(accounts, 'u2', 'token-2');
  assert.equal(accounts.sessions[0]!.hash, digest('token-2'), 'only the hash is stored');
  assert.equal(userFor(accounts, withCookie('planner_session=token-2'))?.id, 'u2');
  assert.equal(userFor(accounts, withCookie('planner_session=other')), null);
  accounts.sessions[0]!.expires = Date.now() - 1;
  assert.equal(userFor(accounts, withCookie('planner_session=token-2')), null, 'expired');
});

test('a new session drops expired ones and keeps at most 5000', () => {
  const accounts = workspace(true);
  accounts.sessions = [{ hash: 'old', userId: 'u2', expires: Date.now() - 1 }];
  makeSession(accounts, 'u2', 'fresh');
  assert.deepEqual(
    accounts.sessions.map(s => s.hash),
    [digest('fresh')],
  );
  accounts.sessions = Array.from({ length: 5000 }, (_, i) => ({
    hash: 'h' + i,
    userId: 'u2',
    expires: Date.now() + 60000,
  }));
  makeSession(accounts, 'u2', 'newest');
  assert.equal(accounts.sessions.length, 5000);
  assert.equal(accounts.sessions[0]!.hash, 'h1', 'the oldest is signed out');
  assert.equal(accounts.sessions.at(-1)!.hash, digest('newest'));
});

test('sign-in input needs a 3-32 character username and a 12-128 character password', () => {
  assert.equal(authValues({ username: '  Pioneer_1 ', password: 'x'.repeat(12) }), 'pioneer_1');
  for (const input of [
    { username: 'ab', password: 'x'.repeat(12) },
    { username: 'has space', password: 'x'.repeat(12) },
    { username: 'pioneer', password: 'x'.repeat(11) },
    { username: 'pioneer', password: 'x'.repeat(129) },
    { username: 'pioneer', password: 12345678901234 },
  ])
    assert.throws(() => authValues(input), { status: 400, message: /3–32 character username/ });
  assert.equal(publicUser({ id: 'owner', username: 'boss', activeSave: null })?.owner, true);
  assert.equal(publicUser(null), null);
});

test('the setup token is created once, kept and compared by value', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-accounts-'));
  const token = await readSetupToken(dir);
  assert.match(token, /^[0-9a-f]{48}$/);
  assert.equal(await readSetupToken(dir), token);
  assert.equal(
    (await fs.readFile(path.join(dir, 'account-setup-token.txt'), 'utf8')).trim(),
    token,
  );
  assert.equal(setupTokenMatches(token, token), true);
  assert.equal(setupTokenMatches('nope', token), false);
  assert.equal(setupTokenMatches(undefined, token), false);
});
