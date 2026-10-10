// The GitHub Pages edition's stand-in for the server API. app/api.ts request() sends every
// /api/ path here when browserMode is on, and gets back the same JSON the matching route in
// workspace.ts returns, so the UI does not care which edition it runs in. Data lives in one
// IndexedDB record (browser-store.ts); calculation runs in calculator-worker.js, which
// build.ts generates around the shipped planner.mjs.
//
// Emulated routes:
// GET  /api/workspace          saves/profiles summary
// POST /api/preview            calculate without saving
// POST /api/profiles           calculate, then add a profile (and a new save if needed)
// GET  /api/export-saves       full transfer (all saves, one save, or a shared profile)
// POST /api/duplicate-profile  copy a profile within its save
// POST /api/import-saves       add transferred saves as new copies
// POST /api/round-up           recalculate as whole machines into a new profile
// POST /api/recalculate        Edit settings: recalculate a profile in place, with a backup
// POST /api/restore-version    swap a kept version back into the profile it was kept for
// POST /api/rank-alternates    hard-drive payoff ranking on the worker, stored on the profile
// GET  /api/context, /api/state, /api/export   read the scoped profile
// POST /api/select, /api/remove-profile, /api/rename, /api/update, /api/import
// Any other route (accounts, login...) throws "This feature needs a self-hosted server."
// Unlike the server, nothing here throttles calculations or checks request headers.
import { openBrowserStore, type BrowserStore } from './browser-store.ts';
import { isTranscribed, restoreProgress, type MigrationData } from './handbook-migration.ts';
import {
  validateState,
  mutate,
  calculatedProfile,
  checkBase,
  checkPlan,
  checkNewProfileKind,
  checkRecalculate,
  checkRestore,
  checkRoundUp,
  recalculatedProfile,
  restoredVersions,
  restoreFields,
  currentPayoff,
  phaseProgress,
  roundUpSettings,
  wholeMachineProfile,
} from './state.ts';
import {
  activeAfterImport,
  exportQuery,
  importableTransfer,
  remapImportedIds,
  selectForExport,
} from './transfer.ts';
import type {
  AlternateRanking,
  BrowserSave,
  BrowserWorkspace,
  Catalog,
  CurrentCalculatedPlan,
  ProgressState,
  Recipe,
  StageKey,
  StoredProfile,
  UpdateOp,
  WorkspaceSummary,
} from './types/index.ts';
import { profilePhasesCache } from './state.ts';
import type { Progression } from './types/index.ts';

// What app/api.ts passes: fetch's options (a JSON string body and a plain headers object) and
// the calculation progress callback.
export interface BrowserRequestOptions {
  body?: BodyInit | null;
  headers?: HeadersInit;
  onProgress?: (phase: number) => void;
  // A payoff ranking's progress: candidates done out of the total.
  onRankProgress?: (done: number, total: number) => void;
}
export type BrowserRequest = (route: string, options?: BrowserRequestOptions) => Promise<unknown>;
// Calculates a plan for the settings: the worker wrapper, or planner.ts's calculate in tests.
export type Calculator = (
  settings: unknown,
  onProgress?: (phase: number) => void,
) => Promise<CurrentCalculatedPlan> | CurrentCalculatedPlan;
// Ranks the alternates for one phase of the settings (planner.ts's rankAlternates): the worker
// wrapper, or a direct call in tests.
export type Ranker = (
  settings: unknown,
  phase: StageKey,
  onProgress?: (done: number, total: number) => void,
) => Promise<AlternateRanking> | AlternateRanking;
// A ranking in this edition runs on the worker, so the page stays usable; it still stops here.
const RANK_BUDGET_MS = 120000;
// What every route handler in createBrowserApi gets: the route as a URL, app/api.ts's plain
// headers object, the parsed JSON body ({} when there is none) and the request options, which
// carry the progress callbacks. A handler in readRoutes or writeRoutes also gets the workspace
// record and the save and profile scope() found in it.
interface RouteRequest {
  url: URL;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  options: BrowserRequestOptions;
}
type ScopedRequest = RouteRequest & {
  data: BrowserWorkspace;
  save: BrowserSave;
  profile: StoredProfile;
};
type Handler<Request> = (request: Request) => unknown;
// The refusal for a route only the self-hosted server answers (accounts, login...).
const NEEDS_SERVER = 'This feature needs a self-hosted server.';

// Set by browser-mode.js, which build.ts writes only into the Pages build.
export const browserMode = (globalThis as { PLANNER_BROWSER?: unknown }).PLANNER_BROWSER === true;
// The API created on first use by browserRequest, shared by every later request in this tab.
let instance: Promise<BrowserRequest> | undefined;
// Builds the request handler. `store` is openBrowserStore()'s object, `calculator(settings,
// onProgress)` resolves to a plan and `catalog` is catalog.json; tests pass a stand-in store
// and planner.ts's calculate. `ranker` runs a payoff ranking; without one that route is refused.
// `loadMigration` loads what converting an imported original profile needs (importableTransfer
// in transfer.ts); without it (tests of other behaviour) an import stores one as it is.
// `progression` is progression.json, which the summary's per-phase step counts read (#746);
// without it (tests of other behaviour) the summary counts production lines only.
// Errors are thrown; app/api.ts shows them like a server { error }.
export function createBrowserApi(
  store: BrowserStore,
  calculator: Calculator,
  catalog: Catalog,
  ranker?: Ranker,
  loadMigration?: () => Promise<MigrationData>,
  progression?: Progression,
): BrowserRequest {
  const randomId = () => crypto.randomUUID();
  const cleanName = (name: unknown): string => {
    if (typeof name !== 'string' || !name.trim() || name.length > 80)
      throw Error('Enter a name with 1–80 characters.');
    return name.trim();
  };
  // Each profile's per-phase counts, kept until its plan or progress changes, as the server keeps
  // them (profilePhasesCache, #804).
  const cachedPhases = profilePhasesCache();
  // Mirrors summary() in server/scope.ts: profile lists without plans or progress. Adds
  // `browser: true` and `lastBackup`, the last full export, which the Backup page and ADA show.
  const summary = (workspace: BrowserWorkspace): WorkspaceSummary => ({
    browser: true,
    accountsEnabled: false,
    user: { id: 'browser', username: 'This browser' },
    activeSave: workspace.activeSave,
    catalog,
    lastBackup: workspace.lastBackup,
    saves: workspace.saves.map(save => ({
      ...save,
      profiles: save.profiles.map(profile => ({
        id: profile.id,
        name: profile.name,
        kind: profile.kind,
        settings: profile.plan?.settings,
        ...(isTranscribed(profile.plan) ? { transcribed: true as const } : {}),
        completed: Object.values(profile.state.checks).filter(Boolean).length,
        phase: profile.state.settings.phase,
        // The same per-phase counts the server sends (profilePhases, #746).
        phases: progression
          ? cachedPhases(profile.id, profile.plan, profile.state, progression)
          : phaseProgress(profile.plan, profile.state.checks),
        ...restoreFields(save.profiles, profile),
      })),
    })),
  });
  // Mirrors scope() in server/scope.ts: body ids (only for routes that pass `body`), then the
  // X-Save-Id/X-Profile-Id headers, then ?save=/?profile=, then the active save and profile.
  const scope = (
    workspace: BrowserWorkspace,
    url: URL,
    headers: Record<string, string> = {},
    body?: Record<string, unknown>,
  ): { save: BrowserSave; profile: StoredProfile } => {
    const saveId =
      body?.saveId || headers['X-Save-Id'] || url.searchParams.get('save') || workspace.activeSave;
    const save = workspace.saves.find(s => s.id === saveId);
    if (!save) throw Error('Save not found.');
    const profileId =
      body?.profileId ||
      headers['X-Profile-Id'] ||
      url.searchParams.get('profile') ||
      save.activeProfile;
    const profile = save.profiles.find(p => p.id === profileId);
    if (!profile) throw Error('Profile not found.');
    return { save, profile };
  };
  // Unscoped routes, in routes below. Each opens its own transactions.
  async function workspaceSummary() {
    return summary(await store.transaction());
  }
  // Wizard preview: calculate only, nothing stored.
  function preview({ body, options }: RouteRequest) {
    return calculator(body.settings, options.onProgress);
  }
  // Mirrors POST /api/profiles. Names are checked and the plan calculated first; the write
  // then re-finds the target save, applies the 50-save/30-profile limits and starts the state
  // from newProfileState, optionally carrying progress from body.carryFrom. Like the server,
  // it refuses kind 'original' (checkNewProfileKind): every new profile is calculated.
  async function createProfile({ body, options }: RouteRequest) {
    checkNewProfileKind(body.kind);
    const profileName = cleanName(body.name),
      saveName = body.saveId ? null : cleanName(body.saveName),
      plan = await calculator(body.settings, options.onProgress),
      profileId = randomId();
    return store.transaction(data => {
      let save = data.saves.find(s => s.id === body.saveId);
      if (body.saveId && !save) throw Error('Save not found.');
      if (!save) {
        if (data.saves.length >= 50) throw Error('Save limit reached.');
        // saveName is set whenever no saveId was given; activeProfile is set below.
        save = { id: randomId(), name: saveName as string, activeProfile: '', profiles: [] };
        data.saves.push(save);
      }
      if (save.profiles.length >= 30) throw Error('Profile limit reached.');
      const source = body.carryFrom ? save.profiles.find(p => p.id === body.carryFrom) : null;
      if (body.carryFrom && !source)
        throw Error('The profile to carry progress from was not found.');
      // A recalculation of a guided plan keeps its guide (#472).
      const started = calculatedProfile(
        profileId,
        profileName,
        plan,
        source,
        body.carry,
        body.built,
      );
      save.profiles.push(started.profile);
      save.activeProfile = profileId;
      data.activeSave = save.id;
      return {
        saveId: save.id,
        profileId,
        reviewCount: started.reviewCount,
        carriedChecks: started.carried,
        workspace: summary(data),
      };
    });
  }
  // Mirrors GET /api/export-saves: the saves the query selects (selectForExport in
  // transfer.ts), kept as they are stored, without a payoff ranking. Only an export that counts
  // as a backup stamps lastBackup, which is why this runs as a readwrite transaction.
  function exportSaves({ url }: RouteRequest) {
    const query = exportQuery(url.searchParams);
    return store.transaction(data => {
      const { exported, countsAsBackup } = selectForExport(data.saves, query, message => {
        throw Error(message);
      });
      if (countsAsBackup()) data.lastBackup = exported.exportedAt;
      return exported;
    });
  }
  // Mirrors POST /api/duplicate-profile: a deep copy with a new id, selected afterwards. The
  // profile is named by the body's ids, then the headers, like select and remove-profile.
  function duplicateProfile({ url, headers, body }: RouteRequest) {
    return store.transaction(data => {
      const { save, profile } = scope(data, url, headers, body);
      if (save.profiles.length >= 30) throw Error('Profile limit reached.');
      const profileId = randomId();
      // As on the server, a copy leaves the kept-version link behind (#1071).
      const { backupOf: _link, ...copy } = structuredClone(profile);
      save.profiles.push({
        ...copy,
        id: profileId,
        name: (profile.name + ' · copy').slice(0, 80),
      });
      save.activeProfile = profileId;
      data.activeSave = save.id;
      return { saveId: save.id, profileId, workspace: summary(data) };
    });
  }
  // Mirrors POST /api/import-saves: importableTransfer checks the file and each state first and
  // converts an original profile, outside any transaction, then each save and profile gets a new
  // id so an import never overwrites what is here. A throw aborts the transaction, so a failed
  // import leaves the workspace unchanged.
  async function importSaves({ body }: RouteRequest) {
    const imported = await importableTransfer(body, loadMigration);
    return store.transaction(data => {
      if (data.saves.length + imported.saves.length > 50)
        throw Error('Import would exceed the save limit.');
      // The active save stays (#1052): an import never moves this browser's tabs into the copy.
      const added = remapImportedIds(imported, randomId);
      data.activeSave = activeAfterImport(data.activeSave, data.saves, added);
      data.saves.push(...added);
      return summary(data);
    });
  }
  // Mirrors POST /api/round-up: read, recalculate with wholeMachines outside any transaction,
  // then write a new profile. Its checks are copied, and a `calc-` check whose row now needs
  // more machines or more input is unticked for review (counted in reviewCount). The copy is
  // taken from the profile as it is at write time, so ticks made meanwhile in another tab carry.
  async function roundUp({ url, headers, options }: RouteRequest) {
    const before = scope(await store.transaction(), url, headers);
    checkRoundUp(before.profile);
    const rounded = await calculator(
        roundUpSettings(before.profile.plan!.settings),
        options.onProgress,
      ),
      profileId = randomId();
    return store.transaction(data => {
      const { save, profile } = scope(data, url, headers);
      if (save.profiles.length >= 30) throw Error('Profile limit reached.');
      const { profile: copy, reviewCount } = wholeMachineProfile(profileId, profile, rounded);
      save.profiles.push(copy);
      save.activeProfile = profileId;
      data.activeSave = save.id;
      return { saveId: save.id, profileId, reviewCount, workspace: summary(data) };
    });
  }
  // Mirrors POST /api/recalculate (#1071): read, calculate body.settings outside any transaction,
  // then replace the scoped profile's plan, name and progress (recalculatedProfile, shared with
  // the server) and keep its previous version whole as a profile of its own right after it. The
  // previous version is read again inside the transaction, so ticks made meanwhile in another tab
  // are carried and kept in the backup; one recalculated meanwhile is refused (checkRecalculate).
  async function recalculate({ url, headers, body, options }: RouteRequest) {
    const before = scope(await store.transaction(), url, headers);
    checkRecalculate(before.profile, body.planCreatedAt, 0);
    const name = cleanName(body.name),
      backupName = cleanName(body.backupName),
      plan = await calculator(body.settings, options.onProgress),
      backupId = randomId();
    return store.transaction(data => {
      const { save, profile } = scope(data, url, headers);
      checkRecalculate(profile, body.planCreatedAt, save.profiles.length);
      const next = recalculatedProfile(
        profile,
        plan,
        name,
        body.carry,
        body.built,
        backupId,
        backupName,
        progression,
      );
      save.profiles.splice(save.profiles.indexOf(profile), 1, next.profile, next.backup);
      save.activeProfile = profile.id;
      data.activeSave = save.id;
      return {
        saveId: save.id,
        profileId: profile.id,
        backupId,
        reviewCount: next.reviewCount,
        carriedChecks: next.carried,
        workspace: summary(data),
      };
    });
  }
  // Mirrors POST /api/rank-alternates: read the profile, rank on the worker outside any
  // transaction, then store the result on the profile if its plan is still the one ranked.
  async function rankPayoff({ url, headers, body, options }: RouteRequest) {
    if (!ranker) throw Error(NEEDS_SERVER);
    const { profile: before } = scope(await store.transaction(), url, headers);
    const plan = before.plan;
    if (before.kind !== 'calculated' || !plan)
      throw Error('Hard-drive payoff needs a calculated profile.');
    const phase = String(body.phase) as StageKey;
    if (!['1', '2', '3', '4', '5'].includes(phase)) throw Error('Choose a phase from 1 to 5.');
    const ranking = await ranker(plan.settings, phase, options.onRankProgress);
    return store.transaction(data => {
      const { profile } = scope(data, url, headers);
      if (profile.plan?.createdAt !== plan.createdAt)
        throw Error('The profile changed while ranking. Rank again.');
      profile.payoff = {
        planCreatedAt: plan.createdAt,
        rankedAt: new Date().toISOString(),
        ranking,
      };
      return profile.payoff;
    });
  }

  // Scoped routes, in readRoutes and writeRoutes below: request() has already found the save
  // and profile in the transaction's record.
  // GET /api/context: what the UI loads when it opens a profile. Like the server's, it never
  // sends a profile's own handbook (#820), which only the IndexedDB migration reads.
  function profileContext({ save, profile }: ScopedRequest) {
    return {
      save: { id: save.id, name: save.name },
      profile: { id: profile.id, name: profile.name, kind: profile.kind },
      state: profile.state,
      plan: profile.plan,
      payoff: currentPayoff(profile),
    };
  }
  // As on the server: a tab showing a plan this profile no longer has is refused (checkPlan).
  function progressState({ headers, profile }: ScopedRequest) {
    checkPlan(profile, headers['X-Planner-Plan']);
    return profile.state;
  }
  // GET /api/export: the progress-only backup format for one profile.
  function exportProgress({ save, profile }: ScopedRequest) {
    return {
      format: 'satisfactory-planner-backup',
      profileId: profile.id,
      saveName: save.name,
      profileName: profile.name,
      state: profile.state,
    };
  }
  // POST /api/select, remove-profile and rename mirror the server routes of the same name.
  // Removing a save's last profile removes the save.
  function selectProfile({ data, save, profile }: ScopedRequest) {
    data.activeSave = save.id;
    save.activeProfile = profile.id;
    return summary(data);
  }
  function removeProfile({ data, save, profile, body }: ScopedRequest) {
    if (body.confirmed !== true) throw Error('Confirm profile removal first.');
    save.profiles = save.profiles.filter(p => p.id !== profile.id);
    if (!save.profiles.length) data.saves = data.saves.filter(s => s.id !== save.id);
    // The save still has profiles here.
    else if (save.activeProfile === profile.id) save.activeProfile = save.profiles[0]!.id;
    if (!data.saves.some(s => s.id === data.activeSave))
      data.activeSave = data.saves[0]?.id || null;
    return summary(data);
  }
  function rename({ data, save, profile, body }: ScopedRequest) {
    if (body.target === 'save') save.name = cleanName(body.name);
    else if (body.target === 'profile') profile.name = cleanName(body.name);
    else throw Error('Invalid rename target.');
    return summary(data);
  }
  // /api/update applies one save-queue operation through mutate() (state.ts); /api/import
  // restores a progress backup through validateState. Either way writeProgress bumps the
  // revision. As on the server, a backup with a different `format` is rejected before
  // validateState.
  function updateProgress({ headers, body, profile }: ScopedRequest) {
    // As on the server: a stale whole-value write is refused (checkBase, #165).
    checkPlan(profile, headers['X-Planner-Plan'], body);
    checkBase(profile.state, body, headers['X-Planner-Revision']);
    // The body is the operation as sent; mutate checks it.
    return writeProgress(profile, mutate(structuredClone(profile.state), body as UpdateOp));
  }
  function importProgress({ body, profile }: ScopedRequest) {
    if (body.format && body.format !== 'satisfactory-planner-backup')
      throw Error('Wrong backup format.');
    if (body.profileId && body.profileId !== profile.id)
      throw Error('Switch to the matching profile before restoring progress.');
    // A backup made before the profile's handbook migration is re-keyed for it (#606). This
    // edition has no handbook: a profile migrated before its mapping was recorded keeps such a
    // backup's handbook-keyed records for review.
    return writeProgress(
      profile,
      restoreProgress(profile.state, validateState(body.format ? body.state : body)),
    );
  }
  // Mirrors POST /api/restore-version (#1071): the scoped profile is a kept version; it swaps
  // places with the profile its link names (checkRestore and restoredVersions, shared with the
  // server), inside this transaction, so ticks made meanwhile in another tab move with their
  // version. A stale request is refused (409) and changes nothing.
  function restoreVersion({ data, save, profile, body }: ScopedRequest) {
    const target = checkRestore(save.profiles, profile, body);
    const { restored, kept } = restoredVersions(target, profile, cleanName(body.backupName));
    save.profiles = save.profiles.map(p =>
      p.id === target.id ? restored : p.id === profile.id ? kept : p,
    );
    return {
      saveId: save.id,
      profileId: target.id,
      backupId: profile.id,
      workspace: summary(data),
    };
  }
  // Stores `next` as the profile's progress with the revision after its current one.
  function writeProgress(profile: StoredProfile, next: ProgressState) {
    // Every state this store wrote carries a revision (newProfileState, validateState).
    next.revision = (profile.state.revision as number) + 1;
    profile.state = next;
    return next;
  }

  // One handler per /api/ path, in three tables by what the handler needs. routes run on their
  // own; readRoutes get the scoped save and profile from a readonly transaction, writeRoutes
  // from inside a readwrite one, whose changes their handler makes.
  const routes: Record<string, Handler<RouteRequest>> = {
    '/api/workspace': workspaceSummary,
    '/api/preview': preview,
    '/api/profiles': createProfile,
    '/api/export-saves': exportSaves,
    '/api/duplicate-profile': duplicateProfile,
    '/api/import-saves': importSaves,
    '/api/round-up': roundUp,
    '/api/recalculate': recalculate,
    '/api/rank-alternates': rankPayoff,
  };
  const readRoutes: Record<string, Handler<ScopedRequest>> = {
    '/api/context': profileContext,
    '/api/state': progressState,
    '/api/export': exportProgress,
  };
  const writeRoutes: Record<string, Handler<ScopedRequest>> = {
    '/api/select': selectProfile,
    '/api/remove-profile': removeProfile,
    '/api/rename': rename,
    '/api/restore-version': restoreVersion,
    '/api/update': updateProgress,
    '/api/import': importProgress,
  };
  // The scoped routes whose body names the save and profile (saveId, profileId) ahead of the
  // headers; the others ignore body ids.
  const scopedByBody = new Set(['/api/select', '/api/remove-profile']);
  // The parsed JSON body, {} when there is none. Every route that reads a body expects a JSON
  // object, so any other JSON value (null, a list, a string or a number) is refused here before
  // a route reads a field of it, with the server's message (workspace.ts, #541, #573).
  const readBody = (raw: BrowserRequestOptions['body']): Record<string, unknown> => {
    if (!raw) return {};
    const input: unknown = JSON.parse(raw as string);
    if (input === null || typeof input !== 'object' || Array.isArray(input))
      throw Error('Expected a JSON object.');
    return input as Record<string, unknown>;
  };
  // Takes the same (path, fetch options) app/api.ts would give fetch(); `options.onProgress`
  // is extra and receives the phase number the worker is calculating.
  // Concurrency: every change happens inside one store.transaction(), and IndexedDB serializes
  // readwrite transactions, so two tabs cannot lose each other's writes. Routes that calculate
  // do so before their transaction opens, then look the save and profile up again inside it.
  return async function request(route, options = {}) {
    // app/api.ts sends a JSON string and a plain headers object.
    const url = new URL(route, 'https://planner.invalid'),
      path = url.pathname,
      body = readBody(options.body),
      headers = (options.headers || {}) as Record<string, string>,
      routeRequest: RouteRequest = { url, headers, body, options };
    const unscoped = routes[path];
    if (unscoped) return unscoped(routeRequest);
    // Any other route (accounts, logout) is refused before the scope lookup, so it does not
    // report "Save not found." when no save is open.
    const read = readRoutes[path],
      write = writeRoutes[path];
    if (!read && !write) throw Error(NEEDS_SERVER);
    const scoped = (data: BrowserWorkspace): ScopedRequest => ({
      ...routeRequest,
      data,
      ...scope(data, url, headers, scopedByBody.has(path) ? body : undefined),
    });
    if (read) return read(scoped(await store.transaction()));
    // write is set: one of the two tables had the route.
    return store.transaction(data => write!(scoped(data)));
  };
}
// The part of a Worker the calculator wrapper uses; tests pass a stand-in.
export interface CalculatorWorker {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}
// Runs calculations on a worker from `spawn`, created on first use and reused. Each request posts
// { id, settings }; the worker replies { id, phase } as each of the five phases starts, then
// { id, result } or { id, error }. The worker runs one calculation at a time in the order posted,
// so the oldest pending request is the running one and only it has a timer: it starts when the
// request reaches the front and restarts on each progress message, so the limit applies per phase
// and never includes time spent waiting. The worker cannot be interrupted mid-solve, so a timeout
// terminates it and fails only the running request; the ones queued behind it are posted again
// to a fresh worker (#158).
// A payoff ranking (#203) is a job on the same worker: it posts { id, settings, rank: { phase,
// budgetMs } } and gets { id, done, total } after each candidate and { id, phase } as each phase
// of its calculations starts (#633); both restart the timer, and only the first is progress.
export function workerCalculator(spawn: () => CalculatorWorker, limit = 180000): Calculator {
  return workerJobs(spawn, limit).calculate;
}
export function workerJobs(
  spawn: () => CalculatorWorker,
  limit = 180000,
): { calculate: Calculator; rank: Ranker } {
  // What the worker is sent, apart from the id.
  type Job = { settings: unknown; rank?: { phase: StageKey; budgetMs: number } };
  // A progress message: { phase } from a calculation, { done, total } from a ranking.
  type Progress = { phase?: number; done?: number; total?: number };
  type Entry = {
    id: number;
    job: Job;
    // A plan or a ranking, depending on the job.
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
    onProgress?: ((data: Progress) => void) | undefined;
  };
  let worker: CalculatorWorker | null = null;
  let serial = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // In the order posted; the first entry is the one the worker is running.
  const pending = new Map<number, Entry>();
  const front = () => pending.values().next().value;
  const restartTimer = () => {
    clearTimeout(timer);
    timer = pending.size ? setTimeout(expire, limit) : undefined;
  };
  const expire = () => {
    const running = front();
    if (!running) return;
    worker?.terminate();
    worker = null;
    pending.delete(running.id);
    running.reject(Error('Calculation timed out. Try fewer alternate recipes or a smaller goal.'));
    const queued = [...pending.values()];
    if (queued.length) {
      const next = start();
      for (const entry of queued) next.postMessage({ id: entry.id, ...entry.job });
    }
    restartTimer();
  };
  const start = () => {
    const created = spawn();
    worker = created;
    created.onmessage = event => {
      if (worker !== created) return;
      const entry = pending.get(event.data.id);
      if (!entry) return;
      if (event.data.phase || event.data.done !== undefined) {
        if (entry === front()) restartTimer();
        try {
          entry.onProgress?.(event.data);
        } catch {}
        return;
      }
      const wasRunning = entry === front();
      pending.delete(event.data.id);
      if (wasRunning) restartTimer();
      event.data.error ? entry.reject(Error(event.data.error)) : entry.resolve(event.data.result);
    };
    // Script or WASM load failure: fail everything pending and let the next request retry.
    created.onerror = () => {
      if (worker !== created) return;
      clearTimeout(timer);
      timer = undefined;
      for (const entry of pending.values())
        entry.reject(Error('The calculator could not load. Refresh and try again.'));
      pending.clear();
      created.terminate();
      worker = null;
    };
    return created;
  };
  const run = <T>(job: Job, onProgress?: (data: Progress) => void) =>
    new Promise<T>((resolve, reject) => {
      const target = worker || start();
      const id = ++serial;
      pending.set(id, {
        id,
        job,
        resolve: resolve as (result: unknown) => void,
        reject,
        onProgress,
      });
      if (pending.size === 1) restartTimer();
      target.postMessage({ id, ...job });
    });
  return {
    calculate: (settings, onProgress) =>
      run<CurrentCalculatedPlan>(
        { settings },
        onProgress && (progress => progress.phase !== undefined && onProgress(progress.phase)),
      ),
    rank: (settings, phase, onProgress) =>
      run<AlternateRanking>(
        { settings, rank: { phase, budgetMs: RANK_BUDGET_MS } },
        onProgress &&
          (progress =>
            progress.done !== undefined && onProgress(progress.done, progress.total ?? 0)),
      ),
  };
}
// Entry point app/api.ts calls in browser mode. The first call creates the store, the worker
// wrapper, the catalog and progression.json. If that fails (no IndexedDB, the catalog or
// progression.json did not load), the calls already waiting fail with that error and the next
// call tries again, so a passing network hiccup does not need a reload.
export async function browserRequest(route: string, options?: BrowserRequestOptions) {
  if (!instance) {
    const starting = (instance = (async () => {
      if (!globalThis.indexedDB)
        throw Error(
          'Browser storage is unavailable. Use a regular browser window with site storage enabled.',
        );
      const jobs = workerJobs(
        () => new Worker(new URL('./calculator-worker.js', import.meta.url), { type: 'module' }),
      );
      const response = await fetch(new URL('./catalog.json', import.meta.url));
      if (!response.ok) throw Error('Could not load recipe catalog.');
      const catalog = (await response.json()) as Catalog;
      // progression.json, for the summary's step counts (#746). The interface loads it at boot
      // too, and cannot start without it.
      const steps = await fetch(new URL('./progression.json', import.meta.url));
      if (!steps.ok) throw Error('Could not load the milestone data.');
      const progression = (await steps.json()) as Progression;
      // The handbook migration's recipes (#497), fetched only when the record or an import (#605)
      // holds an original profile. A failed fetch fails that request and changes nothing; the
      // next one tries again.
      const loadMigration = async () => {
        const recipes = await fetch(new URL('./recipes.json', import.meta.url));
        if (!recipes.ok)
          throw Error(
            'Could not load the recipes needed to update the saves in this browser. Nothing has been changed; reload to try again.',
          );
        return {
          recipes: ((await recipes.json()) as { recipes: Recipe[] }).recipes,
          pureLimits: catalog.pureLimits,
        };
      };
      return createBrowserApi(
        openBrowserStore(indexedDB, undefined, loadMigration),
        jobs.calculate,
        catalog,
        jobs.rank,
        loadMigration,
        progression,
      );
    })());
    starting.catch(() => {
      if (instance === starting) instance = undefined;
    });
  }
  return (await instance)(route, options);
}
