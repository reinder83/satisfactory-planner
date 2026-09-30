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
// POST /api/rank-alternates    hard-drive payoff ranking on the worker, stored on the profile
// GET  /api/context, /api/state, /api/export   read the scoped profile
// POST /api/select, /api/remove-profile, /api/rename, /api/update, /api/import
// Any other route (accounts, login...) throws "This feature needs a self-hosted server."
// Unlike the server, nothing here throttles calculations or checks request headers.
import { openBrowserStore, type BrowserStore } from './browser-store.ts';
import { isTranscribed, type MigrationData } from './handbook-migration.ts';
import {
  validateState,
  mutate,
  shareState,
  calculatedProfile,
  checkBase,
  currentPayoff,
  phaseProgress,
  wholeMachineProfile,
} from './state.ts';
import {
  importableTransfer,
  transferFormat,
  transferFileSize,
  transferImportLimit,
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
// Errors are thrown; app/api.ts shows them like a server { error }.
export function createBrowserApi(
  store: BrowserStore,
  calculator: Calculator,
  catalog: Catalog,
  ranker?: Ranker,
  loadMigration?: () => Promise<MigrationData>,
): BrowserRequest {
  const randomId = () => crypto.randomUUID();
  const cleanName = (name: unknown): string => {
    if (typeof name !== 'string' || !name.trim() || name.length > 80)
      throw Error('Enter a name with 1–80 characters.');
    return name.trim();
  };
  // Mirrors summary() in workspace.ts: profile lists without plans or progress. Adds
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
        phases: phaseProgress(profile.plan, profile.state.checks),
      })),
    })),
  });
  // Mirrors scope() in workspace.ts: body ids (only for routes that pass `body`), then the
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
  // from newProfileState, optionally carrying progress from body.carryFrom. Unlike the server,
  // it cannot create an 'original' (handbook) profile: every profile here is calculated.
  async function createProfile({ body, options }: RouteRequest) {
    if (body.kind === 'original')
      throw Error(
        'Handbook profiles can no longer be created. Create a calculated profile instead.',
      );
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
  // Mirrors GET /api/export-saves: all saves, the listed ones (?saves=), one save (?save=), or
  // one profile (?profile=, with ?share=1 stripping progress through shareState). Only an unscoped full export stamps
  // lastBackup, which is why this runs as a readwrite transaction. Unlike the server it adds no
  // default handbook to 'original' profiles; an imported one keeps its own.
  function exportSaves({ url }: RouteRequest) {
    const saveId = url.searchParams.get('save'),
      profileId = url.searchParams.get('profile'),
      share = url.searchParams.get('share') === '1',
      chosen = url.searchParams.get('saves')?.split(',').filter(Boolean);
    return store.transaction(data => {
      let saves = structuredClone(data.saves);
      if (chosen) {
        saves = saves.filter(s => chosen.includes(s.id));
        if (saves.length !== new Set(chosen).size) throw Error('Save not found.');
      }
      if (saveId) {
        saves = saves.filter(s => s.id === saveId);
        if (!saves.length) throw Error('Save not found.');
      }
      if (profileId) {
        saves = saves.filter(s => s.profiles.some(p => p.id === profileId));
        if (!saves.length) throw Error('Profile not found.');
      }
      for (const save of saves) {
        if (profileId) save.profiles = save.profiles.filter(p => p.id === profileId);
        // The filters above keep only saves with a matching profile.
        if (!save.profiles.some(p => p.id === save.activeProfile))
          save.activeProfile = save.profiles[0]!.id;
        if (share) for (const profile of save.profiles) profile.state = shareState(profile.state);
        // A payoff ranking is derived and can be run again; exports leave it out, as on the server.
        for (const profile of save.profiles) delete profile.payoff;
      }
      const exportedAt = new Date().toISOString();
      const exported = { format: transferFormat, version: 1, exportedAt, saves };
      // Only a full export counts as a backup, and not one past the import limit: the
      // Backup page refuses to download that (#118), so it must not reset the reminder.
      if (
        !chosen &&
        !saveId &&
        !profileId &&
        !share &&
        transferFileSize(exported) <= transferImportLimit
      )
        data.lastBackup = exportedAt;
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
      save.profiles.push({
        ...structuredClone(profile),
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
      for (const save of imported.saves) {
        const oldActive = save.activeProfile;
        for (const importedProfile of save.profiles) {
          const previous = importedProfile.id;
          importedProfile.id = randomId();
          if (previous === oldActive) save.activeProfile = importedProfile.id;
        }
        save.id = randomId();
        data.saves.push(save);
        data.activeSave = save.id;
      }
      return summary(data);
    });
  }
  // Mirrors POST /api/round-up: read, recalculate with wholeMachines outside any transaction,
  // then write a new profile. Its checks are copied, and a `calc-` check whose row now needs
  // more machines or more input is unticked for review (counted in reviewCount). The copy is
  // taken from the profile as it is at write time, so ticks made meanwhile in another tab carry.
  async function roundUp({ url, headers, options }: RouteRequest) {
    const before = scope(await store.transaction(), url, headers);
    // A calculated profile always carries its plan.
    if (before.profile.kind !== 'calculated' || before.profile.plan!.settings.wholeMachines)
      throw Error('Choose a calculated profile without whole-machine production.');
    const rounded = await calculator(
        { ...before.profile.plan!.settings, wholeMachines: true },
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
  // GET /api/context: what the UI loads when it opens a profile.
  function profileContext({ save, profile }: ScopedRequest) {
    return {
      save: { id: save.id, name: save.name },
      profile: { id: profile.id, name: profile.name, kind: profile.kind },
      state: profile.state,
      plan: profile.plan,
      handbook: profile.handbook,
      payoff: currentPayoff(profile),
    };
  }
  function progressState({ profile }: ScopedRequest) {
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
    checkBase(profile.state, body, headers['X-Planner-Revision']);
    // The body is the operation as sent; mutate checks it.
    return writeProgress(profile, mutate(structuredClone(profile.state), body as UpdateOp));
  }
  function importProgress({ body, profile }: ScopedRequest) {
    if (body.format && body.format !== 'satisfactory-planner-backup')
      throw Error('Wrong backup format.');
    if (body.profileId && body.profileId !== profile.id)
      throw Error('Switch to the matching profile before restoring progress.');
    return writeProgress(profile, validateState(body.format ? body.state : body));
  }
  // Stores `next` as the profile's progress with the revision after its current one. An
  // original profile cannot be moved before Phase 3, which its handbook does not cover.
  function writeProgress(profile: StoredProfile, next: ProgressState) {
    if (profile.kind === 'original' && !['3', '4', '5', 'post'].includes(next.settings.phase))
      throw Error('The imported handbook covers Phase 3 onward.');
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
// wrapper and the catalog. If that fails (no IndexedDB, the catalog did not load), the calls
// already waiting fail with that error and the next call tries again, so a passing network
// hiccup does not need a reload.
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
      );
    })());
    starting.catch(() => {
      if (instance === starting) instance = undefined;
    });
  }
  return (await instance)(route, options);
}
