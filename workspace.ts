import { loadWorkspace, createCommitQueue } from './server/persistence.ts';
import { readSetupToken, userFor } from './server/accounts.ts';
import { createLimits } from './server/limits.ts';
import { summary, scope } from './server/scope.ts';
import { fail } from './server/errors.ts';
import { response } from './server/routing.ts';
import { accountRoutes } from './server/account-routes.ts';
import { saveRoutes } from './server/save-routes.ts';
import { profileRoutes } from './server/profile-routes.ts';
import type {
  Body,
  Handler,
  Route,
  RouteRequest,
  ScopedRequest,
  UserRequest,
  WorkspaceContext,
} from './server/routing.ts';
import type { ProgressState, StoredUser, UpdateOp } from './public/types/index.ts';

export type { Route, RouteReply } from './server/routing.ts';

// Opens (or creates) the Docker edition's workspace in dataDir and returns route(req, url,
// body), which server.ts calls for every /api/ request. It wires the server/ modules together:
// persistence.ts loads and migrates workspace.json and queues every write, accounts.ts holds
// sessions and passwords, limits.ts the rate limits and scope.ts what a user sees; route looks
// up one named handler per endpoint in publicRoutes, userRoutes and scopedRoutes (at the end),
// from account-routes.ts, save-routes.ts and profile-routes.ts. With accounts disabled every
// request acts as the owner.
//
// Routes (all JSON; POST checks happen in server.ts first):
//   GET  /api/workspace          saves and profiles of the signed-in user
//   POST /api/setup, /login, /register, /logout   accounts and sessions
//   GET  /api/export-saves       full-save export, optionally one save/profile or a share
//   POST /api/import-saves       import a full-save export as new copies
//   POST /api/duplicate-profile, /api/profiles, /api/select, /api/remove-profile, /api/rename
//   POST /api/preview            calculate without saving
//   GET  /api/context, /api/state, /api/export   the scoped profile
//   POST /api/round-up           whole-machine copy of a calculated profile
//   POST /api/recalculate        Edit settings: recalculate the scoped profile in place, with a backup
//   POST /api/restore-version    swap the scoped kept version back into the profile it was kept for
//   POST /api/rank-alternates    hard-drive payoff ranking, stored on the scoped profile
//   POST /api/update, /api/import   change or restore the scoped profile's progress
export async function openWorkspace({
  dataDir,
  validateState,
  mutate,
  rankBudgetMs = 20000,
  estimateBudgetMs = 20000,
}: {
  dataDir: string;
  validateState: (state: unknown) => ProgressState;
  mutate: (state: ProgressState, update: UpdateOp) => ProgressState;
  // A ranking recalculates the plan once per candidate recipe on the request, holding up every
  // other request meanwhile, so it stops after this long and reports `stopped`.
  rankBudgetMs?: number | undefined;
  // Solving time one address's live estimates may use a minute (#413).
  estimateBudgetMs?: number | undefined;
}): Promise<Route> {
  const { current, commit } = createCommitQueue(
    dataDir,
    await loadWorkspace(dataDir, validateState),
  );
  const setupToken = await readSetupToken(dataDir);
  const userScope: WorkspaceContext['scope'] = (req, url, user) => scope(current(), req, url, user);
  const context: WorkspaceContext = {
    current,
    commit,
    limits: createLimits(estimateBudgetMs),
    setupToken,
    summary: user => summary(current(), user),
    currentSummary: (user: StoredUser) =>
      summary(
        current(),
        current().users.find(account => account.id === user.id),
      ),
    scope: userScope,
    scopeNamed: (input: Body, url: URL, user: StoredUser) =>
      userScope(
        { headers: { 'x-save-id': input.saveId, 'x-profile-id': input.profileId } },
        url,
        user,
      ),
    validateState,
    mutate,
    rankBudgetMs,
  };
  const accounts = accountRoutes(context),
    saves = saveRoutes(context),
    profiles = profileRoutes(context);

  // One handler per 'METHOD /path', in three tables by what the handler needs. The routes in
  // publicRoutes answer signed out too; the ones in userRoutes need a signed-in user; the ones
  // in scopedRoutes also get the save and profile scope() resolves.
  const publicRoutes: Record<string, Handler<RouteRequest>> = {
    'GET /api/workspace': accounts.workspaceSummary,
    'POST /api/setup': accounts.setup,
    'POST /api/login': accounts.login,
    'POST /api/register': accounts.register,
  };
  const userRoutes: Record<string, Handler<UserRequest>> = {
    'POST /api/logout': accounts.logout,
    'GET /api/export-saves': saves.exportSaves,
    'POST /api/duplicate-profile': saves.duplicateProfile,
    'POST /api/import-saves': saves.importSaves,
    'POST /api/preview': saves.preview,
    'POST /api/profiles': saves.createProfile,
    'POST /api/select': saves.selectProfile,
    'POST /api/remove-profile': saves.removeProfile,
    'POST /api/rename': saves.rename,
  };
  const scopedRoutes: Record<string, Handler<ScopedRequest>> = {
    'POST /api/round-up': profiles.roundUp,
    'POST /api/recalculate': profiles.recalculate,
    'POST /api/restore-version': profiles.restoreVersion,
    'POST /api/rank-alternates': profiles.rankPayoff,
    'GET /api/context': profiles.profileContext,
    'GET /api/state': profiles.progressState,
    'GET /api/export': profiles.exportProgress,
    'POST /api/update': profiles.updateProgress,
    'POST /api/import': profiles.importProgress,
  };
  // Looks up the request's handler and gives it what it needs. Returns { data, status,
  // headers }; errors are thrown with a status for server.ts to send. The checks run in this
  // order for every request, so a request no route matches is still refused as signed out
  // (401) or with a missing save or profile (404) before it is answered 'Not found.'.
  return async function route(req, url, readBody) {
    const endpoint = `${req.method} ${url.pathname}`;
    const request: RouteRequest = {
      req,
      url,
      // Every route that reads a body expects a JSON object, so any other JSON value (null, a
      // list, a string or a number) is refused here with 400 before a route reads a field of
      // it (#541); the fields themselves are checked where used.
      body: async () => {
        const input = await readBody(req);
        if (input === null || typeof input !== 'object' || Array.isArray(input))
          fail('Expected a JSON object.');
        return input as Body;
      },
      user: userFor(current(), req),
    };
    const publicRoute = publicRoutes[endpoint];
    if (publicRoute) return publicRoute(request);
    // Everything below needs a user and only ever touches saves whose userId is theirs.
    const { user } = request;
    if (!user) fail('Sign in to continue.', 401);
    const userRoute = userRoutes[endpoint];
    if (userRoute) return userRoute({ ...request, user });
    const { save, profile } = userScope(req, url, user);
    const scopedRoute = scopedRoutes[endpoint];
    if (scopedRoute) return scopedRoute({ ...request, user, save, profile });
    return response({ error: 'Not found.' }, 404);
  };
}
