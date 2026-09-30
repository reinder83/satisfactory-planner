import { validateTransfer, transferFormat } from './public/transfer.ts';
import { isTranscribed } from './public/handbook-migration.ts';
import {
  shareState,
  newProfileState,
  checkBase,
  carryGuide,
  currentPayoff,
  phaseProgress,
} from './public/state.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { calculate, catalog, rankAlternates } from './planner.ts';
import { migrateOriginalProfile } from './public/handbook-migration.ts';
import type { IncomingMessage } from 'node:http';
import type {
  Handbook,
  ProgressState,
  Recipe,
  StoredPayoff,
  StoredProfile,
  StoredSave,
  StageKey,
  StoredUser,
  UpdateOp,
  WorkspaceFile,
  WorkspaceSummary,
} from './public/types/index.ts';

// workspace.json as it is held in memory: every profile's progress has been through
// validateState, so it is the current ProgressState, whatever version the file stored.
type Profile = Omit<StoredProfile, 'state'> & { state: ProgressState };
type Save = Omit<StoredSave, 'profiles'> & { profiles: Profile[] };
type Workspace = Omit<WorkspaceFile, 'saves'> & { saves: Save[] };
// A request body: parsed JSON whose fields are not checked yet.
type Body = Record<string, unknown>;
// What route() returns for server.ts to send.
export interface RouteReply {
  data: unknown;
  status: number;
  headers: Record<string, string>;
}
export type Route = (
  req: IncomingMessage,
  url: URL,
  body: (req: IncomingMessage) => Promise<unknown>,
) => Promise<RouteReply>;
// The error code of a failed file read, if it has one.
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;

const scrypt = promisify(scryptCallback) as (
    password: string,
    salt: string,
    keylen: number,
  ) => Promise<Buffer>,
  randomId = () => randomBytes(16).toString('hex'),
  digest = (text: string) => createHash('sha256').update(text).digest('hex');
// A function declaration, so TypeScript knows the code after a failed check is unreachable.
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
// A save or profile name from a request, trimmed.
const name = (value: unknown): string =>
  typeof value === 'string' && value.trim() && value.length <= 80
    ? value.trim()
    : fail('Enter a name with 1–80 characters.');
// The part of a user record the browser may see; never the password hash.
const publicUser = (user: StoredUser | null | undefined) =>
  user ? { id: user.id, username: user.username, owner: user.id === 'owner' } : null;
// The session cookie: HttpOnly so scripts cannot read it, SameSite=Strict so other sites
// cannot send it, 30 days (an empty token expires it). Secure only when COOKIE_SECURE=true
// (behind HTTPS), because browsers never send a Secure cookie back over plain http.
const authCookie = (token: string) =>
  `planner_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? 2592000 : 0}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
// Retiring the handbook profile type (#387, #495): every original profile becomes a calculated
// one with its progress re-keyed (migrateOriginalProfile). One that carries no handbook of its
// own was made with this handbook: a frozen, server-only copy of plan.json as it was released,
// so the migration never depends on the plan.json the release happens to ship. The Docker
// image copies migrations/; the Pages build never includes it. Read only when there is
// something to migrate.
const migrateOriginals = async (saves: Save[]) => {
  const read = async (file: string) =>
    JSON.parse(await fs.readFile(new URL(file, import.meta.url), 'utf8'));
  const handbook = (await read('./migrations/handbook-2026-09-13.json')) as Handbook;
  const { recipes } = (await read('./recipes.json')) as { recipes: Recipe[] };
  const { pureLimits } = catalog();
  for (const save of saves)
    save.profiles = save.profiles.map(profile =>
      migrateOriginalProfile(profile, handbook, recipes, pureLimits),
    );
};
// Opens (or creates) the Docker edition's workspace in dataDir and returns route(req, url,
// body), which server.ts calls for every /api/ request. The whole workspace lives in
// memory and in DATA_DIR/workspace.json:
//   { version: 2, revision, accountsEnabled, registration,
//     users:    [{ id ('owner' or random), username, password: 'salt:scryptHex', activeSave }],
//     saves:    [{ id, name, userId, activeProfile, profiles: [
//                 { id, name, kind: 'original' | 'calculated', plan, handbook?, state }] }],
//     sessions: [{ hash: sha256(token), userId, expires }] }
// state is the progress object from public/state.ts. The 'owner' user always exists; with
// accounts disabled every request acts as the owner.
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
  const file = path.join(dataDir, 'workspace.json');
  let workspace: Workspace;
  const original = (state: ProgressState): Profile => ({
    id: 'original',
    name: 'Original · 50× complete automation',
    kind: 'original',
    state,
  });
  // Load workspace.json and validate every profile's progress. Any failure other than a
  // missing file (unreadable JSON, an unknown or newer workspace.version, a broken save, a state
  // validateState refuses) stops start-up and leaves the file untouched, so a damaged or
  // newer workspace never turns into an empty one. Normalised states are only held in
  // memory until the next write.
  // A workspace, or a profile's progress, from a newer release is refused with this rather than
  // the generic message, so the owner knows an update is what is needed.
  const newer = () =>
    Object.assign(
      new Error(
        'workspace.json was written by a newer version of the planner. Update the app to open it; existing data has not been overwritten.',
      ),
      { newer: true },
    );
  // workspace.json exactly as it was read, kept as the pre-migration copy below.
  let raw: string | null = null;
  try {
    raw = await fs.readFile(file, 'utf8');
    workspace = JSON.parse(raw);
    if (typeof workspace.version === 'number' && workspace.version > 2) throw newer();
    if (
      workspace.version !== 2 ||
      !Array.isArray(workspace.users) ||
      !Array.isArray(workspace.saves) ||
      !Array.isArray(workspace.sessions) ||
      !workspace.users.some(u => u.id === 'owner')
    )
      throw Error();
    for (const save of workspace.saves) {
      if (
        !workspace.users.some(u => u.id === save.userId) ||
        !Array.isArray(save.profiles) ||
        !save.profiles.some(p => p.id === save.activeProfile)
      )
        throw Error();
      for (const profile of save.profiles)
        try {
          profile.state = validateState(profile.state);
        } catch (error) {
          throw /newer planner version/.test((error as Error).message) ? newer() : error;
        }
    }
  } catch (error) {
    if ((error as { newer?: boolean })?.newer) throw error;
    if (errorCode(error) !== 'ENOENT')
      throw new Error('Workspace could not be read; existing data has not been overwritten.');
    // workspace.json is missing but its backup is not: starting fresh would overwrite that
    // backup on the first save, so stop and say how to recover instead. Only a backup that is
    // certainly absent (ENOENT) lets start-up continue; any other stat error might hide one,
    // so it stops too, but says the backup could not be checked rather than that it exists.
    const backup = await fs.stat(file + '.bak').then(
      () => 'exists',
      error => (errorCode(error) === 'ENOENT' ? 'absent' : errorCode(error) || 'unknown error'),
    );
    if (backup === 'exists')
      throw new Error(
        'workspace.json is missing but workspace.json.bak exists. Rename the .bak file to ' +
          'workspace.json to recover it, or move it elsewhere to start fresh. Nothing has been changed.',
      );
    if (backup !== 'absent')
      throw new Error(
        `workspace.json is missing and workspace.json.bak could not be checked (${backup}). ` +
          "Check the data folder's permissions, then start again. Nothing has been changed.",
      );
    // First start of this format: migrate the single-profile progress.json of earlier
    // releases into the Original profile of one save. progress.json is only read, never
    // changed, so it stays as the pre-migration copy; a corrupt one stops start-up. With
    // neither file, the owner starts with no saves, and the interface opens the guided start
    // like the Pages edition (decision 5A on #387, #496). The 'wx' flag refuses to overwrite a
    // workspace.json that appeared in the meantime.
    let legacy: ProgressState | null;
    try {
      legacy = validateState(
        JSON.parse(await fs.readFile(path.join(dataDir, 'progress.json'), 'utf8')),
      );
    } catch (error) {
      if (errorCode(error) === 'ENOENT') legacy = null;
      else throw new Error('Progress could not be read; existing data has not been overwritten.');
    }
    workspace = {
      version: 2,
      revision: 0,
      accountsEnabled: false,
      registration: false,
      users: [{ id: 'owner', username: 'Local pioneer', activeSave: legacy && 'original-save' }],
      saves: legacy
        ? [
            {
              id: 'original-save',
              name: 'My Satisfactory save',
              userId: 'owner',
              activeProfile: 'original',
              profiles: [original(legacy)],
            },
          ]
        : [],
      sessions: [],
    };
    // Progress from progress.json is handbook progress: it migrates before it is first written
    // (#495), and progress.json itself is its pre-migration copy.
    await migrateOriginals(workspace.saves);
    await fs.writeFile(file, JSON.stringify(workspace), { flag: 'wx', mode: 0o600 });
  }
  // A workspace.json with original profiles (#495): first keep it as it was read in
  // workspace.json.pre-handbook, written once and never replaced, so a later start cannot
  // overwrite the copy with a partly migrated file. Then every original profile migrates in one
  // write, through .tmp and a rename like commit's, so a crash leaves the unmigrated file and the
  // next start finishes. A workspace without any is left as it is, so starting again changes
  // nothing.
  if (raw !== null && workspace.saves.some(s => s.profiles.some(p => p.kind === 'original'))) {
    await fs.writeFile(file + '.pre-handbook', raw, { flag: 'wx', mode: 0o600 }).catch(error => {
      if (errorCode(error) !== 'EEXIST') throw error;
    });
    const next = structuredClone(workspace);
    await migrateOriginals(next.saves);
    next.revision = workspace.revision + 1;
    await fs.writeFile(file + '.tmp', JSON.stringify(next), { mode: 0o600 });
    await fs.rename(file + '.tmp', file);
    workspace = next;
  }
  // The one-time token /api/setup asks for before it enables accounts, so only someone with
  // access to the data folder can claim the owner account. Created once and kept.
  const tokenFile = path.join(dataDir, 'account-setup-token.txt');
  let setupToken: string;
  try {
    setupToken = (await fs.readFile(tokenFile, 'utf8')).trim();
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
    setupToken = randomBytes(24).toString('hex');
    await fs.writeFile(tokenFile, setupToken, { mode: 0o600, flag: 'wx' });
  }
  // Every write goes through commit, one at a time in queue order. change edits a deep copy of
  // the workspace; if it throws, nothing is written and workspace stays as it was. Otherwise the
  // previous in-memory workspace is kept as workspace.json.bak, the new one goes to .tmp and
  // renamed over workspace.json, and only then does workspace become the copy. So a crash leaves
  // either the old or the new workspace, never a half-written one. Returns change's result; a
  // failed commit does not block the ones queued after it.
  let queue: Promise<unknown> = Promise.resolve();
  const commit = <T>(change: (draft: Workspace) => T): Promise<T> => {
    const run = queue.then(async () => {
      const next = structuredClone(workspace);
      const result = change(next);
      next.revision = workspace.revision + 1;
      await fs.writeFile(file + '.bak', JSON.stringify(workspace), { mode: 0o600 });
      await fs.writeFile(file + '.tmp', JSON.stringify(next), { mode: 0o600 });
      await fs.rename(file + '.tmp', file);
      workspace = next;
      return result;
    });
    queue = run.catch(() => {});
    return run;
  };
  // The requesting user: the owner while accounts are off, otherwise the user of an
  // unexpired session whose token hash matches the cookie, or null when signed out.
  const userFor = (req: IncomingMessage) => {
    if (!workspace.accountsEnabled) return workspace.users.find(u => u.id === 'owner');
    const token = (req.headers.cookie || '')
      .split(';')
      .map(part => part.trim())
      .find(part => part.startsWith('planner_session='))
      ?.split('=')[1];
    const session =
      token && workspace.sessions.find(s => s.hash === digest(token) && s.expires > Date.now());
    return session ? workspace.users.find(u => u.id === session.userId) : null;
  };
  // What the interface needs to list saves: only this user's saves, and per profile its
  // settings and tick count rather than the full state.
  const summary = (user: StoredUser | null | undefined): WorkspaceSummary => ({
    accountsEnabled: workspace.accountsEnabled,
    registration: workspace.registration,
    user: publicUser(user),
    activeSave: user?.activeSave,
    catalog: catalog(),
    saves: workspace.saves
      .filter(s => s.userId === user?.id)
      .map(save => ({
        id: save.id,
        name: save.name,
        activeProfile: save.activeProfile,
        profiles: save.profiles.map(profile => ({
          id: profile.id,
          name: profile.name,
          kind: profile.kind,
          settings: profile.plan?.settings,
          ...(isTranscribed(profile.plan) ? { transcribed: true as const } : {}),
          completed: Object.values(profile.state.checks).filter(Boolean).length,
          phase: profile.state.settings.phase,
          phases: phaseProgress(profile.plan, profile.state.checks),
        })),
      })),
  });
  // Resolves which save and profile a request is about: the X-Save-Id / X-Profile-Id
  // headers, then ?save= / ?profile=, then the user's active save and its active profile.
  // Each browser tab sends its own headers, so tabs on different profiles never write into
  // each other. A save that belongs to another user is reported as not found.
  const scope = (req: { headers: Record<string, unknown> }, url: URL, user: StoredUser) => {
    const saveId = req.headers['x-save-id'] || url.searchParams.get('save') || user.activeSave;
    const save = workspace.saves.find(s => s.id === saveId && s.userId === user.id);
    if (!save) fail('Save not found.', 404);
    const profileId =
      req.headers['x-profile-id'] || url.searchParams.get('profile') || save.activeProfile;
    const profile = save.profiles.find(p => p.id === profileId);
    if (!profile) fail('Profile not found.', 404);
    return { save, profile };
  };
  // At most 20 sign-in attempts or calculations per client address per minute, held in
  // memory only. The map is pruned of expired entries once it passes 2000 addresses. A
  // payoff ranking counts as `cost` of them, since it runs a calculation per candidate.
  // The wizard's live estimates (SP-33) have their own allowance, so estimating while editing
  // never uses up the calculations Calculate plan and Create profile need: 120 a minute, and
  // at most estimateBudgetMs of solving a minute (#413; 20 s by default). Any client can mark a preview as an
  // estimate, so it is the solving time that bounds what they cost the server: a third of it
  // per address, however heavy the plan. Typing with the debounced estimates stays well inside.
  type Throttles = Map<string | undefined, { count: number; until: number }>;
  const throttles: Throttles = new Map(),
    estimates: Throttles = new Map(),
    estimateTime: Throttles = new Map();
  // The address's estimate-time entry for this minute, refused once it is used up.
  function estimateBudget(req: IncomingMessage) {
    const key = req.socket.remoteAddress,
      now = Date.now();
    let entry = estimateTime.get(key);
    if (!entry || entry.until < now) {
      entry = { count: 0, until: now + 60000 };
      estimateTime.set(key, entry);
    }
    if (entry.count >= estimateBudgetMs)
      fail('Live estimates are paused for a minute. Calculate plan still works.', 429);
    if (estimateTime.size > 2000)
      for (const [address, { until }] of estimateTime)
        if (until < now) estimateTime.delete(address);
    return entry;
  }
  function throttle(req: IncomingMessage, cost = 1, bucket = throttles, limit = 20) {
    const key = req.socket.remoteAddress,
      now = Date.now();
    let entry = bucket.get(key);
    if (!entry || entry.until < now) {
      entry = { count: 0, until: now + 60000 };
      bucket.set(key, entry);
    }
    if ((entry.count += cost) > limit) fail('Too many attempts. Wait a minute and try again.', 429);
    if (bucket.size > 2000)
      for (const [address, { until }] of bucket) if (until < now) bucket.delete(address);
  }
  // Validates sign-in input and returns the lower-cased username.
  const authValues = (input: Body) => {
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
  // Adds a 30-day session to a commit draft. Only the token's hash is stored, expired
  // sessions are dropped, and past 5000 the oldest is signed out.
  const makeSession = (draft: Workspace, userId: string, token: string) => {
    draft.sessions = draft.sessions.filter(s => s.expires > Date.now());
    draft.sessions.push({ hash: digest(token), userId, expires: Date.now() + 2592000000 });
    if (draft.sessions.length > 5000) draft.sessions.shift();
  };
  // body(req) reads the JSON body (server.ts enforces the size limit). Returns
  // { data, status, headers }; errors are thrown with a status for server.ts to send.
  return async function route(req, url, readBody) {
    let user = userFor(req);
    const endpoint = url.pathname;
    const response = (
      data: unknown,
      status = 200,
      headers: Record<string, string> = {},
    ): RouteReply => ({ data, status, headers });
    // Every route that reads a body expects a JSON object; its fields are checked where used.
    const body = async (request: IncomingMessage) => (await readBody(request)) as Body;
    // Answered even when signed out (user null, no saves), so the interface can show the
    // sign-in or setup screen.
    if (endpoint === '/api/workspace' && req.method === 'GET') return response(summary(user));
    // Setup turns accounts on: the owner record, which keeps all existing saves, gets the
    // chosen username and password, if the setup token matches. Register adds a user while
    // registration is open. Login checks a password. All three are throttled and start a
    // session. The username checks are repeated inside the commit so two concurrent
    // requests cannot both take a name. A missing user is hashed against a dummy salt so
    // it takes as long as a wrong password.
    if (req.method === 'POST' && ['/api/setup', '/api/login', '/api/register'].includes(endpoint)) {
      throttle(req);
      const input = await body(req),
        username = authValues(input),
        password = input.password as string, // authValues checked it
        token = randomBytes(32).toString('hex');
      if (endpoint === '/api/login') {
        if (!workspace.accountsEnabled) fail('Accounts are not enabled.');
        const found = workspace.users.find(account => account.username === username);
        const [salt, hash] = (found?.password || 'missing:' + '0'.repeat(128)).split(':') as [
          string,
          string,
        ];
        const actual = Buffer.from(await scrypt(password, salt, 64));
        if (!timingSafeEqual(actual, Buffer.from(hash, 'hex')))
          fail('Incorrect username or password.', 401);
        // Only a found user can match: the dummy hash is all zeros.
        const userId = found!.id;
        await commit(draft => makeSession(draft, userId, token));
        user = workspace.users.find(account => account.id === userId);
      } else {
        if (endpoint === '/api/setup') {
          if (workspace.accountsEnabled) fail('Accounts are already enabled.', 409);
          if (
            typeof input.setupToken !== 'string' ||
            digest(input.setupToken) !== digest(setupToken)
          )
            fail('Enter the setup token from the server data folder.', 403);
        } else if (!workspace.accountsEnabled || !workspace.registration)
          fail('New accounts are not enabled on this server.', 403);
        const salt = randomId(),
          hash = Buffer.from(await scrypt(password, salt, 64)).toString('hex');
        let userId = '';
        await commit(draft => {
          if (draft.users.some(account => account.username === username))
            fail('That username is already in use.', 409);
          if (endpoint === '/api/setup') {
            if (draft.accountsEnabled) fail('Accounts are already enabled.', 409);
            const owner = draft.users.find(account => account.id === 'owner')!;
            owner.username = username;
            owner.password = salt + ':' + hash;
            userId = owner.id;
            draft.accountsEnabled = true;
            draft.registration = !!input.registration;
          } else {
            if (draft.users.length >= 500) fail('This server has reached its account limit.');
            userId = randomId();
            draft.users.push({
              id: userId,
              username,
              password: salt + ':' + hash,
              activeSave: null,
            });
          }
          makeSession(draft, userId, token);
        });
        user = workspace.users.find(account => account.id === userId);
      }
      return response(summary(user), 200, { 'Set-Cookie': authCookie(token) });
    }
    // Everything below needs a user and only ever touches saves whose userId is theirs.
    if (!user) fail('Sign in to continue.', 401);
    // Deletes this browser's session and expires its cookie.
    if (endpoint === '/api/logout' && req.method === 'POST') {
      const token = (req.headers.cookie || '')
        .split(';')
        .map(part => part.trim())
        .find(part => part.startsWith('planner_session='))
        ?.split('=')[1];
      if (token)
        await commit(draft => {
          draft.sessions = draft.sessions.filter(s => s.hash !== digest(token));
        });
      return response({ ok: true }, 200, { 'Set-Cookie': authCookie('') });
    }
    // Full-save export (public/transfer.ts format) of all the user's saves, of the saves listed
    // in ?saves=<id>,<id> (the Backup page's selection, #160), or of one save with ?save=, or
    // one profile with ?profile=. share=1 strips progress with shareState.
    // An original profile without its own handbook is exported with the current plan.json,
    // so the export can be imported where that default differs. Read-only.
    if (endpoint === '/api/export-saves' && req.method === 'GET') {
      const handbook = JSON.parse(
        await fs.readFile(new URL('./public/plan.json', import.meta.url), 'utf8'),
      );
      const saveId = url.searchParams.get('save'),
        profileId = url.searchParams.get('profile'),
        share = url.searchParams.get('share') === '1';
      let saves = workspace.saves.filter(s => s.userId === user.id);
      const chosen = url.searchParams.get('saves')?.split(',').filter(Boolean);
      if (chosen) {
        saves = saves.filter(s => chosen.includes(s.id));
        if (saves.length !== new Set(chosen).size) fail('Save not found.', 404);
      }
      if (saveId) {
        saves = saves.filter(s => s.id === saveId);
        if (!saves.length) fail('Save not found.', 404);
      }
      if (profileId) {
        saves = saves.filter(s => s.profiles.some(p => p.id === profileId));
        if (!saves.length) fail('Profile not found.', 404);
      }
      const exported = saves.map(save => {
        const profiles = profileId ? save.profiles.filter(p => p.id === profileId) : save.profiles;
        return {
          id: save.id,
          name: save.name,
          activeProfile: profiles.some(p => p.id === save.activeProfile)
            ? save.activeProfile
            : profiles[0]!.id,
          profiles: profiles.map(profile => ({
            id: profile.id,
            name: profile.name,
            kind: profile.kind,
            plan: profile.plan || null,
            state: share ? shareState(profile.state) : profile.state,
            ...(profile.kind === 'original' ? { handbook: profile.handbook || handbook } : {}),
          })),
        };
      });
      return response({
        format: transferFormat,
        version: 1,
        exportedAt: new Date().toISOString(),
        saves: exported,
      });
    }
    // Copies a profile of one of the user's saves, plan and progress included, into the same
    // save under a new id and makes the copy active. The source is not changed.
    if (endpoint === '/api/duplicate-profile' && req.method === 'POST') {
      const input = await body(req);
      if (!input.saveId || !input.profileId) fail('Choose a profile to copy.');
      const { save, profile } = scope(
        { headers: { 'x-save-id': input.saveId, 'x-profile-id': input.profileId } },
        url,
        user,
      );
      const profileId = randomId();
      await commit(draft => {
        const draftSave = draft.saves.find(s => s.id === save.id && s.userId === user.id);
        const source = draftSave?.profiles.find(p => p.id === profile.id);
        if (!draftSave || !source) fail('Profile not found.', 404);
        if (draftSave.profiles.length >= 30) fail('You can keep up to 30 profiles per save.');
        draftSave.profiles.push({
          ...structuredClone(source),
          id: profileId,
          name: (source.name + ' · copy').slice(0, 80),
        });
        draftSave.activeProfile = profileId;
        draft.users.find(account => account.id === user.id)!.activeSave = draftSave.id;
      });
      return response(
        {
          saveId: save.id,
          profileId,
          workspace: summary(workspace.users.find(account => account.id === user.id)),
        },
        201,
      );
    }
    // Imports a full-save export as new saves owned by this user, with fresh save and
    // profile ids, so nothing existing is overwritten. Validated completely before the
    // single commit, so a bad file adds nothing. The last imported save becomes active.
    if (endpoint === '/api/import-saves' && req.method === 'POST') {
      const imported = validateTransfer(await body(req));
      await commit(draft => {
        if (draft.saves.filter(s => s.userId === user.id).length + imported.saves.length > 50)
          fail('Import would exceed the save limit.');
        // validateTransfer ran every profile's progress through validateState; the owner is
        // added below.
        for (const save of imported.saves as Save[]) {
          const oldActive = save.activeProfile;
          for (const importedProfile of save.profiles) {
            const previous = importedProfile.id;
            importedProfile.id = randomId();
            if (previous === oldActive) save.activeProfile = importedProfile.id;
          }
          save.id = randomId();
          save.userId = user.id;
          draft.saves.push(save);
          draft.users.find(account => account.id === user.id)!.activeSave = save.id;
        }
      });
      return response(summary(workspace.users.find(account => account.id === user.id)));
    }
    // Runs the calculator for the wizard without storing anything; throttled because a
    // solve is expensive. A live estimate (`?estimate=1`) counts against its own allowance and
    // solving-time budget (above). Both checks run before the body is read.
    if (endpoint === '/api/preview' && req.method === 'POST') {
      const budget = url.searchParams.get('estimate') === '1' ? estimateBudget(req) : null;
      if (budget) throttle(req, 1, estimates, 120);
      else throttle(req);
      const input = await body(req);
      const start = performance.now();
      try {
        return response(calculate(input.settings));
      } finally {
        if (budget) budget.count += performance.now() - start;
      }
    }
    // Creates a profile in one of the user's saves (saveId) or in a new save (saveName). It is
    // calculated now and the snapshot stored; kind 'original' is refused, since the handbook
    // profile type is retired (#387, #496). carryFrom names a sibling profile in the same save to start from
    // (copied, never moved) and built lists finished work; see newProfileState. The plan is
    // calculated before the commit; the save lookup and limits are checked inside it.
    if (endpoint === '/api/profiles' && req.method === 'POST') {
      throttle(req);
      const input = await body(req);
      if (input.kind === 'original')
        fail('Handbook profiles can no longer be created. Create a calculated profile instead.');
      const saveName = input.saveId ? null : name(input.saveName),
        profileName = name(input.name);
      const plan = calculate(input.settings);
      const profileId = randomId();
      // A saveId that is not one of the user's save ids is refused inside the commit.
      let saveId = (input.saveId || randomId()) as string;
      const carried = await commit(draft => {
        let save = draft.saves.find(s => s.id === saveId && s.userId === user.id);
        if (input.saveId && !save) fail('Save not found.', 404);
        if (!save) {
          if (draft.saves.filter(s => s.userId === user.id).length >= 50)
            fail('You can create up to 50 saves.');
          save = {
            id: saveId,
            // Only null when saveId named an existing save.
            name: saveName as string,
            userId: user.id,
            activeProfile: profileId,
            profiles: [],
          };
          draft.saves.push(save);
        }
        if (save.profiles.length >= 30) fail('You can keep up to 30 profiles per save.');
        const source = input.carryFrom ? save.profiles.find(p => p.id === input.carryFrom) : null;
        if (input.carryFrom && !source)
          fail('The profile to carry progress from was not found.', 404);
        const started = newProfileState(
          plan,
          source?.state || null,
          source?.plan || null,
          input.carry,
          input.built,
        );
        save.profiles.push({
          id: profileId,
          name: profileName,
          kind: 'calculated',
          // A recalculation of a guided plan keeps its guide (#472).
          plan: carryGuide(plan, source?.plan),
          state: started.state,
        });
        save.activeProfile = profileId;
        draft.users.find(account => account.id === user.id)!.activeSave = saveId;
        return started;
      });
      return response(
        {
          saveId,
          profileId,
          reviewCount: carried.reviewCount,
          carriedChecks: carried.carried,
          workspace: summary(workspace.users.find(account => account.id === user.id)),
        },
        201,
      );
    }
    // Remembers the save and profile the user last opened; scope() checks both are theirs.
    if (endpoint === '/api/select' && req.method === 'POST') {
      const input = await body(req);
      const { save, profile } = scope(
        { headers: { 'x-save-id': input.saveId, 'x-profile-id': input.profileId } },
        url,
        user,
      );
      await commit(draft => {
        draft.users.find(account => account.id === user.id)!.activeSave = save.id;
        draft.saves.find(s => s.id === save.id)!.activeProfile = profile.id;
      });
      return response(summary(workspace.users.find(account => account.id === user.id)));
    }
    // Permanently deletes one profile and its progress; needs confirmed: true. Removing a
    // save's last profile deletes the save too. The active save and profile are moved to
    // one that still exists.
    if (endpoint === '/api/remove-profile' && req.method === 'POST') {
      const input = await body(req);
      if (input.confirmed !== true) fail('Confirm profile removal first.');
      if (!input.saveId || !input.profileId) fail('Choose a profile to remove.');
      const { save, profile } = scope(
        { headers: { 'x-save-id': input.saveId, 'x-profile-id': input.profileId } },
        url,
        user,
      );
      await commit(draft => {
        const draftSave = draft.saves.find(s => s.id === save.id && s.userId === user.id);
        if (!draftSave || !draftSave.profiles.some(p => p.id === profile.id))
          fail('Profile not found.', 404);
        draftSave.profiles = draftSave.profiles.filter(p => p.id !== profile.id);
        if (!draftSave.profiles.length)
          draft.saves = draft.saves.filter(s => s.id !== draftSave.id);
        else if (draftSave.activeProfile === profile.id)
          draftSave.activeProfile = draftSave.profiles[0]!.id;
        const owner = draft.users.find(account => account.id === user.id)!;
        if (!draft.saves.some(s => s.id === owner.activeSave && s.userId === user.id))
          owner.activeSave = draft.saves.find(s => s.userId === user.id)?.id || null;
      });
      return response(summary(workspace.users.find(account => account.id === user.id)));
    }
    // Renames the scoped save or profile (target 'save' or 'profile'). Only the display
    // name changes; ids, which progress hangs on, stay.
    if (endpoint === '/api/rename' && req.method === 'POST') {
      const input = await body(req);
      const title = name(input.name);
      const { save, profile } = scope(req, url, user);
      await commit(draft => {
        const draftSave = draft.saves.find(s => s.id === save.id)!;
        if (input.target === 'save') draftSave.name = title;
        else if (input.target === 'profile')
          draftSave.profiles.find(p => p.id === profile.id)!.name = title;
        else fail('Unknown rename target.');
      });
      return response(summary(workspace.users.find(account => account.id === user.id)));
    }
    // The remaining routes act on the scoped save and profile (see scope above).
    const { save, profile } = scope(req, url, user);
    // Adds a whole-machine version of a calculated profile as a new profile in the same
    // save; the original profile is untouched. Its progress is copied, and a ticked
    // 'calc-' row is unticked for review where the rounded plan needs more machines or more
    // of any input. The same rule newProfileState uses when carrying factory progress.
    if (endpoint === '/api/round-up' && req.method === 'POST') {
      if (profile.kind !== 'calculated')
        fail(
          'The preserved handbook is unchanged. Create a calculated profile to use whole-machine planning.',
        );
      // A calculated profile always carries its plan.
      const plan = profile.plan!;
      if (plan.settings.wholeMachines) fail('This profile already uses whole-machine planning.');
      throttle(req);
      const rounded = calculate({ ...plan.settings, wholeMachines: true }),
        profileId = randomId();
      let reviewCount = 0;
      await commit(draft => {
        const draftSave = draft.saves.find(s => s.id === save.id && s.userId === user.id)!;
        if (draftSave.profiles.length >= 30) fail('Profile limit reached.');
        const previous = draftSave.profiles.find(p => p.id === profile.id)!;
        const state = structuredClone(previous.state);
        for (const [phase, stage] of Object.entries(rounded.stages))
          for (const row of stage.rows || []) {
            const old = previous.plan!.stages[phase as StageKey]?.rows?.find(r => r.id === row.id);
            if (
              !old ||
              Object.entries(row.inputs).some(
                ([item, rate]) => rate > (old.inputs[item] || 0) + 0.001,
              ) ||
              row.machines > old.machines
            ) {
              const checkKey = 'calc-' + phase + '-' + row.id;
              if (state.checks[checkKey]) {
                state.checks[checkKey] = false;
                reviewCount++;
              }
            }
          }
        draftSave.profiles.push({
          id: profileId,
          name: (previous.name + ' · whole machines').slice(0, 80),
          kind: 'calculated',
          plan: carryGuide(rounded, previous.plan),
          state,
        });
        draftSave.activeProfile = profileId;
        draft.users.find(account => account.id === user.id)!.activeSave = draftSave.id;
      });
      return response(
        {
          saveId: save.id,
          profileId,
          reviewCount,
          workspace: summary(workspace.users.find(account => account.id === user.id)),
        },
        201,
      );
    }
    // Hard-drive payoff (#203): ranks the alternates the scoped calculated profile does not
    // allow yet for body.phase (rankAlternates in planner.ts) and stores the result on the
    // profile with the createdAt of its plan. Throttled at the cost of five calculations and
    // stopped after rankBudgetMs; progress is untouched.
    if (endpoint === '/api/rank-alternates' && req.method === 'POST') {
      const plan = profile.plan;
      if (profile.kind !== 'calculated' || !plan)
        fail('Hard-drive payoff needs a calculated profile.');
      const input = await body(req);
      const phase = String(input.phase) as StageKey;
      if (!['1', '2', '3', '4', '5'].includes(phase)) fail('Choose a phase from 1 to 5.');
      throttle(req, 5);
      const payoff: StoredPayoff = {
        planCreatedAt: plan.createdAt,
        rankedAt: new Date().toISOString(),
        ranking: rankAlternates(plan.settings, { phase, budgetMs: rankBudgetMs }),
      };
      await commit(draft => {
        const draftProfile = draft.saves
          .find(s => s.id === save.id && s.userId === user.id)
          ?.profiles.find(p => p.id === profile.id);
        if (!draftProfile) fail('Profile not found.', 404);
        draftProfile.payoff = payoff;
      });
      return response(payoff);
    }
    // Everything the interface needs to open the scoped profile. handbook is only present
    // on an original profile that carries its own (from an import, or a copy of one);
    // otherwise the client falls back to its default handbook. A stored payoff ranking is
    // only sent while it belongs to the profile's plan.
    if (endpoint === '/api/context' && req.method === 'GET')
      return response({
        save: { id: save.id, name: save.name },
        profile: { id: profile.id, name: profile.name, kind: profile.kind },
        state: profile.state,
        plan: profile.plan || null,
        handbook: profile.handbook,
        payoff: currentPayoff(profile),
      });
    if (endpoint === '/api/state' && req.method === 'GET') return response(profile.state);
    // Progress-only backup of the scoped profile, a separate format from the full-save
    // export: it restores into this same profile through /api/import.
    if (endpoint === '/api/export' && req.method === 'GET')
      return response(
        {
          format: 'satisfactory-planner-backup',
          exportedAt: new Date().toISOString(),
          saveName: save.name,
          profileName: profile.name,
          profileId: profile.id,
          state: profile.state,
        },
        200,
        { 'Content-Disposition': 'attachment; filename="satisfactory-progress.json"' },
      );
    // /api/update applies one mutate() operation to the scoped profile's progress;
    // /api/import replaces it with a progress backup (or a bare state), refusing a backup
    // that names another profile. Both are validated before the state is replaced and
    // written in one commit, so a rejected change leaves the saved state as it was. The
    // revision counts accepted writes. An update can carry the revision its tab last saw
    // (X-Planner-Revision); checkBase refuses a stale whole-value one (#165). An original
    // profile cannot be moved before Phase 3, which its handbook does not cover.
    if (['/api/update', '/api/import'].includes(endpoint) && req.method === 'POST') {
      const input = await body(req);
      let imported: ProgressState | undefined;
      if (endpoint === '/api/import') {
        if (input.format && input.format !== 'satisfactory-planner-backup')
          fail('Wrong backup format.');
        if (input.profileId && input.profileId !== profile.id)
          fail('This backup belongs to another profile. Switch to that profile before restoring.');
        imported = validateState(input.format ? input.state : input);
      }
      const next = await commit(draft => {
        const draftProfile = draft.saves
          .find(s => s.id === save.id && s.userId === user.id)
          ?.profiles.find(p => p.id === profile.id);
        if (!draftProfile) fail('Profile not found.', 404);
        // A whole-value write from a tab that has not seen the latest change is refused (409).
        if (!imported)
          checkBase(draftProfile.state, input, [req.headers['x-planner-revision']].flat()[0]);
        // mutate() checks the operation and throws for one it does not know.
        const state = imported || mutate(draftProfile.state, input as UpdateOp);
        if (
          draftProfile.kind === 'original' &&
          !['3', '4', '5', 'post'].includes(state.settings.phase)
        )
          fail('The original handbook covers Phase 3 onward.');
        state.revision = draftProfile.state.revision + 1;
        draftProfile.state = state;
        return state;
      });
      return response(next);
    }
    return response({ error: 'Not found.' }, 404);
  };
}
