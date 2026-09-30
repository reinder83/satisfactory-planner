// The account routes: the workspace summary, and setup, register, login and logout. The summary
// is answered even when signed out (user null, no saves), so the interface can show the sign-in
// or setup screen.
import {
  authCookie,
  authValues,
  digest,
  hashPassword,
  makeSession,
  newToken,
  passwordMatches,
  randomId,
  sessionToken,
  setupTokenMatches,
} from './accounts.ts';
import { fail } from './errors.ts';
import type { Workspace } from './persistence.ts';
import { response } from './routing.ts';
import type { RouteRequest, UserRequest, WorkspaceContext } from './routing.ts';

export function accountRoutes({ current, commit, limits, setupToken, summary }: WorkspaceContext) {
  function workspaceSummary({ user }: RouteRequest) {
    return response(summary(user));
  }
  // Setup, register and login are all throttled, before the body is read, check the username
  // and password with authValues and start a session with a new token.
  const credentials = async ({ req, body }: RouteRequest) => {
    limits.throttle(req);
    const input = await body(),
      username = authValues(input),
      password = input.password as string, // authValues checked it
      token = newToken();
    return { input, username, password, token };
  };
  // The username checks are repeated inside the commit so two concurrent requests cannot both
  // take a name.
  const claimUsername = (draft: Workspace, username: string) => {
    if (draft.users.some(account => account.username === username))
      fail('That username is already in use.', 409);
  };
  // The reply that signs a user in: their summary and the session cookie.
  const signedIn = (userId: string, token: string) =>
    response(summary(current().users.find(account => account.id === userId)), 200, {
      'Set-Cookie': authCookie(token),
    });
  // Setup turns accounts on: the owner record, which keeps all existing saves, gets the
  // chosen username and password, if the setup token matches.
  async function setup(request: RouteRequest) {
    const { input, username, password, token } = await credentials(request);
    if (current().accountsEnabled) fail('Accounts are already enabled.', 409);
    if (!setupTokenMatches(input.setupToken, setupToken))
      fail('Enter the setup token from the server data folder.', 403);
    const stored = await hashPassword(password);
    await commit(draft => {
      claimUsername(draft, username);
      if (draft.accountsEnabled) fail('Accounts are already enabled.', 409);
      const owner = draft.users.find(account => account.id === 'owner')!;
      owner.username = username;
      owner.password = stored;
      draft.accountsEnabled = true;
      draft.registration = !!input.registration;
      makeSession(draft, owner.id, token);
    });
    return signedIn('owner', token);
  }
  // Register adds a user while registration is open.
  async function register(request: RouteRequest) {
    const { username, password, token } = await credentials(request);
    if (!current().accountsEnabled || !current().registration)
      fail('New accounts are not enabled on this server.', 403);
    const stored = await hashPassword(password);
    const userId = randomId();
    await commit(draft => {
      claimUsername(draft, username);
      if (draft.users.length >= 500) fail('This server has reached its account limit.');
      draft.users.push({ id: userId, username, password: stored, activeSave: null });
      makeSession(draft, userId, token);
    });
    return signedIn(userId, token);
  }
  // Login checks a password (passwordMatches takes as long for a missing user).
  async function login(request: RouteRequest) {
    const { username, password, token } = await credentials(request);
    if (!current().accountsEnabled) fail('Accounts are not enabled.');
    const found = current().users.find(account => account.username === username);
    if (!(await passwordMatches(password, found?.password)))
      fail('Incorrect username or password.', 401);
    // Only a found user can match: the dummy hash is all zeros.
    const userId = found!.id;
    await commit(draft => makeSession(draft, userId, token));
    return signedIn(userId, token);
  }
  // Deletes this browser's session and expires its cookie.
  async function logout({ req }: UserRequest) {
    const token = sessionToken(req);
    if (token)
      await commit(draft => {
        draft.sessions = draft.sessions.filter(s => s.hash !== digest(token));
      });
    return response({ ok: true }, 200, { 'Set-Cookie': authCookie('') });
  }
  return { workspaceSummary, setup, register, login, logout };
}
