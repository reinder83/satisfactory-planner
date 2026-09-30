// The Docker edition's in-app accounts: password hashing, sessions and their cookie, the
// sign-in input check and the account setup token. None of these read or write the workspace
// themselves; the account routes (account-routes.ts) put them together with commit.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { errorCode, fail } from './errors.ts';
import type { IncomingMessage } from 'node:http';
import type { StoredUser } from '../public/types/index.ts';
import type { Workspace } from './persistence.ts';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;
// A random id for a user, save or profile, and a password salt.
export const randomId = () => randomBytes(16).toString('hex');
// A new session token, which only the browser's cookie holds.
export const newToken = () => randomBytes(32).toString('hex');
export const digest = (text: string) => createHash('sha256').update(text).digest('hex');

// The session token in the request's planner_session cookie, if there is one.
export const sessionToken = (req: IncomingMessage) =>
  (req.headers.cookie || '')
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith('planner_session='))
    ?.split('=')[1];
// The session cookie: HttpOnly so scripts cannot read it, SameSite=Strict so other sites
// cannot send it, 30 days (an empty token expires it). Secure only when COOKIE_SECURE=true
// (behind HTTPS), because browsers never send a Secure cookie back over plain http.
export const authCookie = (token: string) =>
  `planner_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? 2592000 : 0}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
// The part of a user record the browser may see; never the password hash.
export const publicUser = (user: StoredUser | null | undefined) =>
  user ? { id: user.id, username: user.username, owner: user.id === 'owner' } : null;

// The requesting user: the owner while accounts are off, otherwise the user of an
// unexpired session whose token hash matches the cookie, or null when signed out.
export const userFor = (workspace: Workspace, req: IncomingMessage) => {
  if (!workspace.accountsEnabled) return workspace.users.find(u => u.id === 'owner');
  const token = sessionToken(req);
  const session =
    token && workspace.sessions.find(s => s.hash === digest(token) && s.expires > Date.now());
  return session ? workspace.users.find(u => u.id === session.userId) : null;
};
// Adds a 30-day session to a commit draft. Only the token's hash is stored, expired
// sessions are dropped, and past 5000 the oldest is signed out.
export const makeSession = (draft: Workspace, userId: string, token: string) => {
  draft.sessions = draft.sessions.filter(s => s.expires > Date.now());
  draft.sessions.push({ hash: digest(token), userId, expires: Date.now() + 2592000000 });
  if (draft.sessions.length > 5000) draft.sessions.shift();
};

// Validates sign-in input and returns the lower-cased username.
export const authValues = (input: Record<string, unknown>) => {
  const username = String(input.username || '')
    .trim()
    .toLowerCase();
  if (
    !/^[a-z0-9_-]{3,32}$/.test(username) ||
    typeof input.password !== 'string' ||
    input.password.length < 12 ||
    input.password.length > 128
  )
    fail('Use a 3–32 character username and a password of 12–128 characters.');
  return username;
};
// A stored password: a random salt and the scrypt hash, 'salt:scryptHex'.
export const hashPassword = async (password: string) => {
  const salt = randomId();
  return salt + ':' + Buffer.from(await scrypt(password, salt, 64)).toString('hex');
};
// Whether password matches a stored 'salt:scryptHex'. A missing user (stored undefined) is
// hashed against a dummy salt so it takes as long as a wrong password; its all-zero hash never
// matches.
export const passwordMatches = async (password: string, stored: string | undefined) => {
  const [salt, hash] = (stored || 'missing:' + '0'.repeat(128)).split(':') as [string, string];
  const actual = Buffer.from(await scrypt(password, salt, 64));
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
};

// The one-time token /api/setup asks for before it enables accounts, so only someone with
// access to the data folder can claim the owner account. Created once, in
// DATA_DIR/account-setup-token.txt, and kept.
export async function readSetupToken(dataDir: string) {
  const tokenFile = path.join(dataDir, 'account-setup-token.txt');
  try {
    return (await fs.readFile(tokenFile, 'utf8')).trim();
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
    const setupToken = randomBytes(24).toString('hex');
    await fs.writeFile(tokenFile, setupToken, { mode: 0o600, flag: 'wx' });
    return setupToken;
  }
}
// Whether a request's setup token is the server's; compared by hash, so the time it takes
// says nothing about the token.
export const setupTokenMatches = (given: unknown, setupToken: string) =>
  typeof given === 'string' && digest(given) === digest(setupToken);
