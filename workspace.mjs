import { validateTransfer, transferFormat } from './public/transfer.ts';
import { shareState, newProfileState } from './public/state.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { calculate, catalog } from './planner.mjs';
const scrypt = promisify(scryptCallback),
  id = () => randomBytes(16).toString('hex'),
  digest = s => createHash('sha256').update(s).digest('hex');
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
// A save or profile name from a request, trimmed.
const name = value =>
  typeof value === 'string' && value.trim() && value.length <= 80
    ? value.trim()
    : fail('Enter a name with 1–80 characters.');
// The part of a user record the browser may see; never the password hash.
const publicUser = u => (u ? { id: u.id, username: u.username, owner: u.id === 'owner' } : null);
// The session cookie: HttpOnly so scripts cannot read it, SameSite=Strict so other sites
// cannot send it, 30 days (an empty token expires it). Secure only when COOKIE_SECURE=true
// (behind HTTPS), because browsers never send a Secure cookie back over plain http.
const authCookie = token =>
  `planner_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? 2592000 : 0}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
// Opens (or creates) the Docker edition's workspace in dataDir and returns route(req, url,
// body), which server.mjs calls for every /api/ request. The whole workspace lives in
// memory and in DATA_DIR/workspace.json:
//   { version: 2, revision, accountsEnabled, registration,
//     users:    [{ id ('owner' or random), username, password: 'salt:scryptHex', activeSave }],
//     saves:    [{ id, name, userId, activeProfile, profiles: [
//                 { id, name, kind: 'original' | 'calculated', plan, handbook?, state }] }],
//     sessions: [{ hash: sha256(token), userId, expires }] }
// state is the progress object from public/state.ts. The 'owner' user always exists; with
// accounts disabled every request acts as the owner.
//
// Routes (all JSON; POST checks happen in server.mjs first):
//   GET  /api/workspace          saves and profiles of the signed-in user
//   POST /api/setup, /login, /register, /logout   accounts and sessions
//   GET  /api/export-saves       full-save export, optionally one save/profile or a share
//   POST /api/import-saves       import a full-save export as new copies
//   POST /api/duplicate-profile, /api/profiles, /api/select, /api/remove-profile, /api/rename
//   POST /api/preview            calculate without saving
//   GET  /api/context, /api/state, /api/export   the scoped profile
//   POST /api/round-up           whole-machine copy of a calculated profile
//   POST /api/update, /api/import   change or restore the scoped profile's progress
export async function openWorkspace({ dataDir, initialState, validateState, mutate }) {
  const file = path.join(dataDir, 'workspace.json');
  let db;
  const original = state => ({
    id: 'original',
    name: 'Original · 50× complete automation',
    kind: 'original',
    state,
  });
  // Load workspace.json and validate every profile's progress. Any failure other than a
  // missing file (unreadable JSON, an unknown or newer db.version, a broken save, a state
  // validateState refuses) stops start-up and leaves the file untouched, so a damaged or
  // newer workspace never turns into an empty one. Normalised states are only held in
  // memory until the next write.
  try {
    db = JSON.parse(await fs.readFile(file, 'utf8'));
    if (
      db.version !== 2 ||
      !Array.isArray(db.users) ||
      !Array.isArray(db.saves) ||
      !Array.isArray(db.sessions) ||
      !db.users.some(u => u.id === 'owner')
    )
      throw Error();
    for (const save of db.saves) {
      if (
        !db.users.some(u => u.id === save.userId) ||
        !Array.isArray(save.profiles) ||
        !save.profiles.some(p => p.id === save.activeProfile)
      )
        throw Error();
      for (const p of save.profiles) p.state = validateState(p.state);
    }
  } catch (e) {
    if (e.code !== 'ENOENT')
      throw new Error('Workspace could not be read; existing data has not been overwritten.');
    // First start of this format: migrate the single-profile progress.json of earlier
    // releases into the Original profile of one save, or start from server.mjs's initial
    // state when neither file exists. progress.json is only read, never changed, so it
    // stays as the pre-migration copy; a corrupt one stops start-up. The 'wx' flag refuses
    // to overwrite a workspace.json that appeared in the meantime.
    let legacy;
    try {
      legacy = validateState(
        JSON.parse(await fs.readFile(path.join(dataDir, 'progress.json'), 'utf8')),
      );
    } catch (e) {
      if (e.code === 'ENOENT') legacy = initialState();
      else throw new Error('Progress could not be read; existing data has not been overwritten.');
    }
    db = {
      version: 2,
      revision: 0,
      accountsEnabled: false,
      registration: false,
      users: [{ id: 'owner', username: 'Local pioneer', activeSave: 'original-save' }],
      saves: [
        {
          id: 'original-save',
          name: 'My Satisfactory save',
          userId: 'owner',
          activeProfile: 'original',
          profiles: [original(legacy)],
        },
      ],
      sessions: [],
    };
    await fs.writeFile(file, JSON.stringify(db), { flag: 'wx', mode: 0o600 });
  }
  // The one-time token /api/setup asks for before it enables accounts, so only someone with
  // access to the data folder can claim the owner account. Created once and kept.
  const tokenFile = path.join(dataDir, 'account-setup-token.txt');
  let setupToken;
  try {
    setupToken = (await fs.readFile(tokenFile, 'utf8')).trim();
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    setupToken = randomBytes(24).toString('hex');
    await fs.writeFile(tokenFile, setupToken, { mode: 0o600, flag: 'wx' });
  }
  // Every write goes through commit, one at a time in queue order. fn changes a deep copy of
  // the workspace; if it throws, nothing is written and db stays as it was. Otherwise the
  // previous in-memory workspace is kept as workspace.json.bak, the new one goes to .tmp and
  // renamed over workspace.json, and only then does db become the copy. So a crash leaves
  // either the old or the new workspace, never a half-written one. Returns fn's result; a
  // failed commit does not block the ones queued after it.
  let queue = Promise.resolve();
  const commit = fn => {
    const run = queue.then(async () => {
      const next = structuredClone(db);
      const result = fn(next);
      next.revision = db.revision + 1;
      await fs.writeFile(file + '.bak', JSON.stringify(db), { mode: 0o600 });
      await fs.writeFile(file + '.tmp', JSON.stringify(next), { mode: 0o600 });
      await fs.rename(file + '.tmp', file);
      db = next;
      return result;
    });
    queue = run.catch(() => {});
    return run;
  };
  // The requesting user: the owner while accounts are off, otherwise the user of an
  // unexpired session whose token hash matches the cookie, or null when signed out.
  const userFor = req => {
    if (!db.accountsEnabled) return db.users.find(u => u.id === 'owner');
    const token = (req.headers.cookie || '')
      .split(';')
      .map(x => x.trim())
      .find(x => x.startsWith('planner_session='))
      ?.split('=')[1];
    const session =
      token && db.sessions.find(s => s.hash === digest(token) && s.expires > Date.now());
    return session ? db.users.find(u => u.id === session.userId) : null;
  };
  // What the interface needs to list saves: only this user's saves, and per profile its
  // settings and tick count rather than the full state.
  const summary = u => ({
    accountsEnabled: db.accountsEnabled,
    registration: db.registration,
    user: publicUser(u),
    activeSave: u?.activeSave,
    catalog: catalog(),
    saves: db.saves
      .filter(s => s.userId === u?.id)
      .map(s => ({
        id: s.id,
        name: s.name,
        activeProfile: s.activeProfile,
        profiles: s.profiles.map(p => ({
          id: p.id,
          name: p.name,
          kind: p.kind,
          settings: p.plan?.settings,
          completed: Object.values(p.state.checks).filter(Boolean).length,
          phase: p.state.settings.phase,
        })),
      })),
  });
  // Resolves which save and profile a request is about: the X-Save-Id / X-Profile-Id
  // headers, then ?save= / ?profile=, then the user's active save and its active profile.
  // Each browser tab sends its own headers, so tabs on different profiles never write into
  // each other. A save that belongs to another user is reported as not found.
  const scope = (req, url, u) => {
    const saveId = req.headers['x-save-id'] || url.searchParams.get('save') || u.activeSave;
    const save = db.saves.find(s => s.id === saveId && s.userId === u.id);
    if (!save) fail('Save not found.', 404);
    const profileId =
      req.headers['x-profile-id'] || url.searchParams.get('profile') || save.activeProfile;
    const profile = save.profiles.find(p => p.id === profileId);
    if (!profile) fail('Profile not found.', 404);
    return { save, profile };
  };
  // At most 20 sign-in attempts or calculations per client address per minute, held in
  // memory only. The map is pruned of expired entries once it passes 2000 addresses.
  const throttles = new Map();
  function throttle(req) {
    const key = req.socket.remoteAddress,
      now = Date.now();
    let v = throttles.get(key);
    if (!v || v.until < now) {
      v = { count: 0, until: now + 60000 };
      throttles.set(key, v);
    }
    if (++v.count > 20) fail('Too many attempts. Wait a minute and try again.', 429);
    if (throttles.size > 2000)
      for (const [k, v] of throttles) if (v.until < now) throttles.delete(k);
  }
  // Validates sign-in input and returns the lower-cased username.
  const authValues = b => {
    const username = String(b.username || '')
      .trim()
      .toLowerCase();
    if (
      !/^[a-z0-9_-]{3,32}$/.test(username) ||
      typeof b.password !== 'string' ||
      b.password.length < 12 ||
      b.password.length > 128
    )
      fail('Use a 3–32 character username and a password of 12–128 characters.');
    return username;
  };
  // Adds a 30-day session to a commit draft. Only the token's hash is stored, expired
  // sessions are dropped, and past 5000 the oldest is signed out.
  const makeSession = (d, userId, token) => {
    d.sessions = d.sessions.filter(s => s.expires > Date.now());
    d.sessions.push({ hash: digest(token), userId, expires: Date.now() + 2592000000 });
    if (d.sessions.length > 5000) d.sessions.shift();
  };
  // body(req) reads the JSON body (server.mjs enforces the size limit). Returns
  // { data, status, headers }; errors are thrown with a status for server.mjs to send.
  return async function route(req, url, body) {
    let u = userFor(req);
    const endpoint = url.pathname;
    const response = (data, status = 200, headers = {}) => ({ data, status, headers });
    // Answered even when signed out (user null, no saves), so the interface can show the
    // sign-in or setup screen.
    if (endpoint === '/api/workspace' && req.method === 'GET') return response(summary(u));
    // Setup turns accounts on: the owner record, which keeps all existing saves, gets the
    // chosen username and password, if the setup token matches. Register adds a user while
    // registration is open. Login checks a password. All three are throttled and start a
    // session. The username checks are repeated inside the commit so two concurrent
    // requests cannot both take a name. A missing user is hashed against a dummy salt so
    // it takes as long as a wrong password.
    if (req.method === 'POST' && ['/api/setup', '/api/login', '/api/register'].includes(endpoint)) {
      throttle(req);
      const b = await body(req),
        username = authValues(b),
        token = randomBytes(32).toString('hex');
      if (endpoint === '/api/login') {
        if (!db.accountsEnabled) fail('Accounts are not enabled.');
        const found = db.users.find(x => x.username === username);
        const [salt, hash] = (found?.password || 'missing:' + '0'.repeat(128)).split(':');
        const actual = Buffer.from(await scrypt(b.password, salt, 64));
        if (!timingSafeEqual(actual, Buffer.from(hash, 'hex')))
          fail('Incorrect username or password.', 401);
        await commit(d => makeSession(d, found.id, token));
        u = db.users.find(x => x.id === found.id);
      } else {
        if (endpoint === '/api/setup') {
          if (db.accountsEnabled) fail('Accounts are already enabled.', 409);
          if (typeof b.setupToken !== 'string' || digest(b.setupToken) !== digest(setupToken))
            fail('Enter the setup token from the server data folder.', 403);
        } else if (!db.accountsEnabled || !db.registration)
          fail('New accounts are not enabled on this server.', 403);
        const salt = id(),
          hash = Buffer.from(await scrypt(b.password, salt, 64)).toString('hex');
        let userId;
        await commit(d => {
          if (d.users.some(x => x.username === username))
            fail('That username is already in use.', 409);
          if (endpoint === '/api/setup') {
            if (d.accountsEnabled) fail('Accounts are already enabled.', 409);
            const owner = d.users.find(x => x.id === 'owner');
            owner.username = username;
            owner.password = salt + ':' + hash;
            userId = owner.id;
            d.accountsEnabled = true;
            d.registration = !!b.registration;
          } else {
            if (d.users.length >= 500) fail('This server has reached its account limit.');
            userId = id();
            d.users.push({ id: userId, username, password: salt + ':' + hash, activeSave: null });
          }
          makeSession(d, userId, token);
        });
        u = db.users.find(x => x.id === userId);
      }
      return response(summary(u), 200, { 'Set-Cookie': authCookie(token) });
    }
    // Everything below needs a user and only ever touches saves whose userId is theirs.
    if (!u) fail('Sign in to continue.', 401);
    // Deletes this browser's session and expires its cookie.
    if (endpoint === '/api/logout' && req.method === 'POST') {
      const token = (req.headers.cookie || '')
        .split(';')
        .map(x => x.trim())
        .find(x => x.startsWith('planner_session='))
        ?.split('=')[1];
      if (token)
        await commit(d => {
          d.sessions = d.sessions.filter(s => s.hash !== digest(token));
        });
      return response({ ok: true }, 200, { 'Set-Cookie': authCookie('') });
    }
    // Full-save export (public/transfer.ts format) of all the user's saves, or of one save
    // with ?save=, or one profile with ?profile=. share=1 strips progress with shareState.
    // An original profile without its own handbook is exported with the current plan.json,
    // so the export can be imported where that default differs. Read-only.
    if (endpoint === '/api/export-saves' && req.method === 'GET') {
      const handbook = JSON.parse(
        await fs.readFile(new URL('./public/plan.json', import.meta.url), 'utf8'),
      );
      const saveId = url.searchParams.get('save'),
        profileId = url.searchParams.get('profile'),
        share = url.searchParams.get('share') === '1';
      let saves = db.saves.filter(s => s.userId === u.id);
      if (saveId) {
        saves = saves.filter(s => s.id === saveId);
        if (!saves.length) fail('Save not found.', 404);
      }
      if (profileId) {
        saves = saves.filter(s => s.profiles.some(p => p.id === profileId));
        if (!saves.length) fail('Profile not found.', 404);
      }
      const exported = saves.map(s => {
        const profiles = profileId ? s.profiles.filter(p => p.id === profileId) : s.profiles;
        return {
          id: s.id,
          name: s.name,
          activeProfile: profiles.some(p => p.id === s.activeProfile)
            ? s.activeProfile
            : profiles[0].id,
          profiles: profiles.map(p => ({
            id: p.id,
            name: p.name,
            kind: p.kind,
            plan: p.plan || null,
            state: share ? shareState(p.state) : p.state,
            ...(p.kind === 'original' ? { handbook: p.handbook || handbook } : {}),
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
      const b = await body(req);
      if (!b.saveId || !b.profileId) fail('Choose a profile to copy.');
      const { save, profile } = scope(
        { headers: { 'x-save-id': b.saveId, 'x-profile-id': b.profileId } },
        url,
        u,
      );
      const profileId = id();
      await commit(d => {
        const sv = d.saves.find(s => s.id === save.id && s.userId === u.id);
        const source = sv?.profiles.find(p => p.id === profile.id);
        if (!source) fail('Profile not found.', 404);
        if (sv.profiles.length >= 30) fail('You can keep up to 30 profiles per save.');
        sv.profiles.push({
          ...structuredClone(source),
          id: profileId,
          name: (source.name + ' · copy').slice(0, 80),
        });
        sv.activeProfile = profileId;
        d.users.find(x => x.id === u.id).activeSave = sv.id;
      });
      return response(
        { saveId: save.id, profileId, workspace: summary(db.users.find(x => x.id === u.id)) },
        201,
      );
    }
    // Imports a full-save export as new saves owned by this user, with fresh save and
    // profile ids, so nothing existing is overwritten. Validated completely before the
    // single commit, so a bad file adds nothing. The last imported save becomes active.
    if (endpoint === '/api/import-saves' && req.method === 'POST') {
      const imported = validateTransfer(await body(req));
      await commit(d => {
        if (d.saves.filter(s => s.userId === u.id).length + imported.saves.length > 50)
          fail('Import would exceed the save limit.');
        for (const save of imported.saves) {
          const old = save.activeProfile;
          for (const p of save.profiles) {
            const previous = p.id;
            p.id = id();
            if (previous === old) save.activeProfile = p.id;
          }
          save.id = id();
          save.userId = u.id;
          d.saves.push(save);
          d.users.find(x => x.id === u.id).activeSave = save.id;
        }
      });
      return response(summary(db.users.find(x => x.id === u.id)));
    }
    // Runs the calculator for the wizard without storing anything; throttled because a
    // solve is expensive.
    if (endpoint === '/api/preview' && req.method === 'POST') {
      throttle(req);
      const b = await body(req);
      return response(calculate(b.settings));
    }
    // Creates a profile in one of the user's saves (saveId) or in a new save (saveName).
    // kind 'original' uses the preserved handbook; anything else is calculated now and the
    // snapshot stored. carryFrom names a sibling profile in the same save to start from
    // (copied, never moved) and built lists finished work; see newProfileState. The plan is
    // calculated before the commit; the save lookup and limits are checked inside it.
    if (endpoint === '/api/profiles' && req.method === 'POST') {
      throttle(req);
      const b = await body(req);
      const saveName = b.saveId ? null : name(b.saveName),
        profileName = name(b.name);
      const plan = b.kind === 'original' ? null : calculate(b.settings);
      const profileId = id();
      let saveId = b.saveId || id();
      const carried = await commit(d => {
        let save = d.saves.find(s => s.id === saveId && s.userId === u.id);
        if (b.saveId && !save) fail('Save not found.', 404);
        if (!save) {
          if (d.saves.filter(s => s.userId === u.id).length >= 50)
            fail('You can create up to 50 saves.');
          save = {
            id: saveId,
            name: saveName,
            userId: u.id,
            activeProfile: profileId,
            profiles: [],
          };
          d.saves.push(save);
        }
        if (save.profiles.length >= 30) fail('You can keep up to 30 profiles per save.');
        const source = b.carryFrom ? save.profiles.find(p => p.id === b.carryFrom) : null;
        if (b.carryFrom && !source) fail('The profile to carry progress from was not found.', 404);
        const started = newProfileState(
          plan,
          source?.state || null,
          source?.plan || null,
          b.carry,
          b.built,
        );
        save.profiles.push({
          id: profileId,
          name: profileName,
          kind: plan ? 'calculated' : 'original',
          plan,
          state: started.state,
        });
        save.activeProfile = profileId;
        d.users.find(x => x.id === u.id).activeSave = saveId;
        return started;
      });
      return response(
        {
          saveId,
          profileId,
          reviewCount: carried.reviewCount,
          carriedChecks: carried.carried,
          workspace: summary(db.users.find(x => x.id === u.id)),
        },
        201,
      );
    }
    // Remembers the save and profile the user last opened; scope() checks both are theirs.
    if (endpoint === '/api/select' && req.method === 'POST') {
      const b = await body(req);
      const { save, profile } = scope(
        { headers: { 'x-save-id': b.saveId, 'x-profile-id': b.profileId } },
        url,
        u,
      );
      await commit(d => {
        d.users.find(x => x.id === u.id).activeSave = save.id;
        d.saves.find(s => s.id === save.id).activeProfile = profile.id;
      });
      return response(summary(db.users.find(x => x.id === u.id)));
    }
    // Permanently deletes one profile and its progress; needs confirmed: true. Removing a
    // save's last profile deletes the save too. The active save and profile are moved to
    // one that still exists.
    if (endpoint === '/api/remove-profile' && req.method === 'POST') {
      const b = await body(req);
      if (b.confirmed !== true) fail('Confirm profile removal first.');
      if (!b.saveId || !b.profileId) fail('Choose a profile to remove.');
      const { save, profile } = scope(
        { headers: { 'x-save-id': b.saveId, 'x-profile-id': b.profileId } },
        url,
        u,
      );
      await commit(d => {
        const sv = d.saves.find(s => s.id === save.id && s.userId === u.id);
        if (!sv || !sv.profiles.some(p => p.id === profile.id)) fail('Profile not found.', 404);
        sv.profiles = sv.profiles.filter(p => p.id !== profile.id);
        if (!sv.profiles.length) d.saves = d.saves.filter(s => s.id !== sv.id);
        else if (sv.activeProfile === profile.id) sv.activeProfile = sv.profiles[0].id;
        const owner = d.users.find(x => x.id === u.id);
        if (!d.saves.some(s => s.id === owner.activeSave && s.userId === u.id))
          owner.activeSave = d.saves.find(s => s.userId === u.id)?.id || null;
      });
      return response(summary(db.users.find(x => x.id === u.id)));
    }
    // Renames the scoped save or profile (target 'save' or 'profile'). Only the display
    // name changes; ids, which progress hangs on, stay.
    if (endpoint === '/api/rename' && req.method === 'POST') {
      const b = await body(req);
      const title = name(b.name);
      const { save, profile } = scope(req, url, u);
      await commit(d => {
        const sv = d.saves.find(s => s.id === save.id);
        if (b.target === 'save') sv.name = title;
        else if (b.target === 'profile') sv.profiles.find(p => p.id === profile.id).name = title;
        else fail('Unknown rename target.');
      });
      return response(summary(db.users.find(x => x.id === u.id)));
    }
    // The remaining routes act on the scoped save and profile (see scope above).
    const { save, profile } = scope(req, url, u);
    // Adds a whole-machine version of a calculated profile as a new profile in the same
    // save; the original profile is untouched. Its progress is copied, and a ticked
    // 'calc-' row is unticked for review where the rounded plan needs more machines or more
    // of any input. The same rule newProfileState uses when carrying factory progress.
    if (endpoint === '/api/round-up' && req.method === 'POST') {
      if (profile.kind !== 'calculated')
        fail(
          'The preserved handbook is unchanged. Create a calculated profile to use whole-machine planning.',
        );
      if (profile.plan.settings.wholeMachines)
        fail('This profile already uses whole-machine planning.');
      throttle(req);
      const rounded = calculate({ ...profile.plan.settings, wholeMachines: true }),
        profileId = id();
      let reviewCount = 0;
      await commit(d => {
        const sv = d.saves.find(s => s.id === save.id && s.userId === u.id);
        if (sv.profiles.length >= 30) fail('Profile limit reached.');
        const previous = sv.profiles.find(p => p.id === profile.id);
        const state = structuredClone(previous.state);
        for (const [ph, stage] of Object.entries(rounded.stages))
          for (const row of stage.rows || []) {
            const old = previous.plan.stages[ph]?.rows?.find(r => r.id === row.id);
            if (
              !old ||
              Object.entries(row.inputs).some(([n, q]) => q > (old.inputs[n] || 0) + 0.001) ||
              row.machines > old.machines
            ) {
              const k = 'calc-' + ph + '-' + row.id;
              if (state.checks[k]) {
                state.checks[k] = false;
                reviewCount++;
              }
            }
          }
        sv.profiles.push({
          id: profileId,
          name: (previous.name + ' · whole machines').slice(0, 80),
          kind: 'calculated',
          plan: rounded,
          state,
        });
        sv.activeProfile = profileId;
        d.users.find(x => x.id === u.id).activeSave = sv.id;
      });
      return response(
        {
          saveId: save.id,
          profileId,
          reviewCount,
          workspace: summary(db.users.find(x => x.id === u.id)),
        },
        201,
      );
    }
    // Everything the interface needs to open the scoped profile. handbook is only present
    // on an original profile that carries its own (from an import, or a copy of one);
    // otherwise the client falls back to its default handbook.
    if (endpoint === '/api/context' && req.method === 'GET')
      return response({
        save: { id: save.id, name: save.name },
        profile: { id: profile.id, name: profile.name, kind: profile.kind },
        state: profile.state,
        plan: profile.plan || null,
        handbook: profile.handbook,
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
    // revision counts accepted writes; the client's revision is not compared. An original
    // profile cannot be moved before Phase 3, which its handbook does not cover.
    if (['/api/update', '/api/import'].includes(endpoint) && req.method === 'POST') {
      const b = await body(req);
      let imported;
      if (endpoint === '/api/import') {
        if (b.format && b.format !== 'satisfactory-planner-backup') fail('Wrong backup format.');
        if (b.profileId && b.profileId !== profile.id)
          fail('This backup belongs to another profile. Switch to that profile before restoring.');
        imported = validateState(b.format ? b.state : b);
      }
      const next = await commit(d => {
        const p = d.saves
          .find(s => s.id === save.id && s.userId === u.id)
          ?.profiles.find(p => p.id === profile.id);
        if (!p) fail('Profile not found.', 404);
        const state = imported || mutate(p.state, b);
        if (p.kind === 'original' && !['3', '4', '5', 'post'].includes(state.settings.phase))
          fail('The original handbook covers Phase 3 onward.');
        state.revision = p.state.revision + 1;
        p.state = state;
        return state;
      });
      return response(next);
    }
    return response({ error: 'Not found.' }, 404);
  };
}
