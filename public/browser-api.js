// The GitHub Pages edition's stand-in for the server API. app/api.js request() sends every
// /api/ path here when browserMode is on, and gets back the same JSON the matching route in
// workspace.mjs returns, so the UI does not care which edition it runs in. Data lives in one
// IndexedDB record (browser-store.js); calculation runs in calculator-worker.js, which
// build.mjs generates around planner.mjs.
//
// Emulated routes:
// GET  /api/workspace          saves/profiles summary
// POST /api/preview            calculate without saving
// POST /api/profiles           calculate, then add a profile (and a new save if needed)
// GET  /api/export-saves       full transfer (all saves, one save, or a shared profile)
// POST /api/duplicate-profile  copy a profile within its save
// POST /api/import-saves       add transferred saves as new copies
// POST /api/round-up           recalculate as whole machines into a new profile
// GET  /api/context, /api/state, /api/export   read the scoped profile
// POST /api/select, /api/remove-profile, /api/rename, /api/update, /api/import
// Any other route (accounts, login...) throws "This feature needs a self-hosted server."
// Unlike the server, nothing here throttles calculations or checks request headers.
import { openBrowserStore } from './browser-store.js';
import { validateState, mutate, shareState, newProfileState } from './state.js';
import { validateTransfer, transferFormat } from './transfer.js';
// Set by browser-mode.js, which build.mjs writes only into the Pages build.
export const browserMode = globalThis.PLANNER_BROWSER === true;
// The API created on first use by browserRequest, shared by every later request in this tab.
let instance;
// Builds the request handler. `store` is openBrowserStore()'s object, `calculator(settings,
// onProgress)` resolves to a plan and `catalog` is catalog.json; tests pass a stand-in store
// and planner.mjs's calculate. Errors are thrown; app/api.js shows them like a server { error }.
export function createBrowserApi(store, calculator, catalog) {
  const uid = () => crypto.randomUUID();
  const cleanName = n => {
    if (typeof n !== 'string' || !n.trim() || n.length > 80)
      throw Error('Enter a name with 1–80 characters.');
    return n.trim();
  };
  // Mirrors summary() in workspace.mjs: profile lists without plans or progress. Adds
  // `browser: true` and `lastBackup`, the last full export, which the Backup page and ADA show.
  const summary = d => ({
    browser: true,
    accountsEnabled: false,
    user: { id: 'browser', username: 'This browser' },
    activeSave: d.activeSave,
    catalog,
    lastBackup: d.lastBackup,
    saves: d.saves.map(s => ({
      ...s,
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
  // Mirrors scope() in workspace.mjs: body ids (only for routes that pass `body`), then the
  // X-Save-Id/X-Profile-Id headers, then ?save=/?profile=, then the active save and profile.
  const scope = (d, url, headers = {}, body) => {
    const saveId =
      body?.saveId || headers['X-Save-Id'] || url.searchParams.get('save') || d.activeSave;
    const save = d.saves.find(s => s.id === saveId);
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
  // Takes the same (path, fetch options) app/api.js would give fetch(); `options.onProgress`
  // is extra and receives the phase number the worker is calculating.
  // Concurrency: every change happens inside one store.transaction(), and IndexedDB serializes
  // readwrite transactions, so two tabs cannot lose each other's writes. Routes that calculate
  // do so before their transaction opens, then look the save and profile up again inside it.
  return async function request(route, options = {}) {
    const url = new URL(route, 'https://planner.invalid'),
      ep = url.pathname,
      body = options.body ? JSON.parse(options.body) : {},
      headers = options.headers || {};
    if (ep === '/api/workspace') return summary(await store.transaction());
    // Wizard preview: calculate only, nothing stored.
    if (ep === '/api/preview') return calculator(body.settings, options.onProgress);
    // Mirrors POST /api/profiles. Names are checked and the plan calculated first; the write
    // then re-finds the target save, applies the 50-save/30-profile limits and starts the state
    // from newProfileState, optionally carrying progress from body.carryFrom. Unlike the server,
    // it cannot create an 'original' (handbook) profile: every profile here is calculated.
    if (ep === '/api/profiles') {
      const profileName = cleanName(body.name),
        saveName = body.saveId ? null : cleanName(body.saveName),
        plan = await calculator(body.settings, options.onProgress),
        profileId = uid();
      return store.transaction(d => {
        let save = d.saves.find(s => s.id === body.saveId);
        if (body.saveId && !save) throw Error('Save not found.');
        if (!save) {
          if (d.saves.length >= 50) throw Error('Save limit reached.');
          save = { id: uid(), name: saveName, profiles: [] };
          d.saves.push(save);
        }
        if (save.profiles.length >= 30) throw Error('Profile limit reached.');
        const source = body.carryFrom ? save.profiles.find(p => p.id === body.carryFrom) : null;
        if (body.carryFrom && !source)
          throw Error('The profile to carry progress from was not found.');
        const started = newProfileState(
          plan,
          source?.state || null,
          source?.plan || null,
          body.carry,
          body.built,
        );
        save.profiles.push({
          id: profileId,
          name: profileName,
          kind: 'calculated',
          plan,
          state: started.state,
        });
        save.activeProfile = profileId;
        d.activeSave = save.id;
        return {
          saveId: save.id,
          profileId,
          reviewCount: started.reviewCount,
          carriedChecks: started.carried,
          workspace: summary(d),
        };
      });
    }
    // Mirrors GET /api/export-saves: all saves, one save (?save=), or one profile (?profile=, with
    // ?share=1 stripping progress through shareState). Only an unscoped full export stamps
    // lastBackup, which is why this runs as a readwrite transaction. Unlike the server it adds no
    // default handbook to 'original' profiles; an imported one keeps its own.
    if (ep === '/api/export-saves') {
      const saveId = url.searchParams.get('save'),
        profileId = url.searchParams.get('profile'),
        share = url.searchParams.get('share') === '1';
      return store.transaction(d => {
        let saves = structuredClone(d.saves);
        if (saveId) {
          saves = saves.filter(s => s.id === saveId);
          if (!saves.length) throw Error('Save not found.');
        }
        if (profileId) {
          saves = saves.filter(s => s.profiles.some(p => p.id === profileId));
          if (!saves.length) throw Error('Profile not found.');
        }
        for (const s of saves) {
          if (profileId) s.profiles = s.profiles.filter(p => p.id === profileId);
          if (!s.profiles.some(p => p.id === s.activeProfile)) s.activeProfile = s.profiles[0].id;
          if (share) for (const p of s.profiles) p.state = shareState(p.state);
        }
        const exportedAt = new Date().toISOString();
        if (!saveId && !profileId && !share) d.lastBackup = exportedAt;
        return { format: transferFormat, version: 1, exportedAt, saves };
      });
    }
    // Mirrors POST /api/duplicate-profile: a deep copy with a new id, selected afterwards.
    if (ep === '/api/duplicate-profile') {
      return store.transaction(d => {
        const { save, profile } = scope(d, url, headers, body);
        if (save.profiles.length >= 30) throw Error('Profile limit reached.');
        const profileId = uid();
        save.profiles.push({
          ...structuredClone(profile),
          id: profileId,
          name: (profile.name + ' · copy').slice(0, 80),
        });
        save.activeProfile = profileId;
        d.activeSave = save.id;
        return { saveId: save.id, profileId, workspace: summary(d) };
      });
    }
    // Mirrors POST /api/import-saves: validateTransfer checks the file and each state first, then
    // each save and profile gets a new id so an import never overwrites what is here. A throw
    // aborts the transaction, so a failed import leaves the workspace unchanged.
    if (ep === '/api/import-saves') {
      const imported = validateTransfer(body);
      return store.transaction(d => {
        if (d.saves.length + imported.saves.length > 50)
          throw Error('Import would exceed the save limit.');
        for (const s of imported.saves) {
          const old = s.activeProfile;
          for (const p of s.profiles) {
            const previous = p.id;
            p.id = uid();
            if (previous === old) s.activeProfile = p.id;
          }
          s.id = uid();
          d.saves.push(s);
          d.activeSave = s.id;
        }
        return summary(d);
      });
    }
    // Mirrors POST /api/round-up: read, recalculate with wholeMachines outside any transaction,
    // then write a new profile. Its checks are copied, and a `calc-` check whose row now needs
    // more machines or more input is unticked for review (counted in reviewCount). The copy is
    // taken from the profile as it is at write time, so ticks made meanwhile in another tab carry.
    if (ep === '/api/round-up') {
      const before = scope(await store.transaction(), url, headers);
      if (before.profile.kind !== 'calculated' || before.profile.plan.settings.wholeMachines)
        throw Error('Choose a calculated profile without whole-machine production.');
      const rounded = await calculator(
          { ...before.profile.plan.settings, wholeMachines: true },
          options.onProgress,
        ),
        profileId = uid();
      return store.transaction(d => {
        const { save, profile } = scope(d, url, headers);
        if (save.profiles.length >= 30) throw Error('Profile limit reached.');
        const state = structuredClone(profile.state);
        let reviewCount = 0;
        for (const [ph, stage] of Object.entries(rounded.stages))
          for (const row of stage.rows || []) {
            const old = profile.plan.stages[ph]?.rows?.find(r => r.id === row.id);
            if (
              !old ||
              row.machines > old.machines ||
              Object.entries(row.inputs).some(([n, q]) => q > (old.inputs[n] || 0) + 0.001)
            ) {
              const key = 'calc-' + ph + '-' + row.id;
              if (state.checks[key]) {
                state.checks[key] = false;
                reviewCount++;
              }
            }
          }
        save.profiles.push({
          id: profileId,
          name: (profile.name + ' · whole machines').slice(0, 80),
          kind: 'calculated',
          plan: rounded,
          state,
        });
        save.activeProfile = profileId;
        d.activeSave = save.id;
        return { saveId: save.id, profileId, reviewCount, workspace: summary(d) };
      });
    }
    // The remaining routes all act on one scoped save/profile. Reads use a readonly transaction;
    // everything else runs `operation` inside a readwrite one.
    const read = ['/api/context', '/api/state', '/api/export'].includes(ep);
    const operation = d => {
      const { save, profile } = scope(
        d,
        url,
        headers,
        ['/api/select', '/api/remove-profile'].includes(ep) ? body : undefined,
      );
      // GET /api/context: what the UI loads when it opens a profile.
      if (ep === '/api/context')
        return {
          save: { id: save.id, name: save.name },
          profile: { id: profile.id, name: profile.name, kind: profile.kind },
          state: profile.state,
          plan: profile.plan,
          handbook: profile.handbook,
        };
      if (ep === '/api/state') return profile.state;
      // GET /api/export: the progress-only backup format for one profile.
      if (ep === '/api/export')
        return {
          format: 'satisfactory-planner-backup',
          profileId: profile.id,
          saveName: save.name,
          profileName: profile.name,
          state: profile.state,
        };
      // POST /api/select, remove-profile and rename mirror the server routes of the same name.
      // Removing a save's last profile removes the save.
      if (ep === '/api/select') {
        d.activeSave = save.id;
        save.activeProfile = profile.id;
        return summary(d);
      }
      if (ep === '/api/remove-profile') {
        if (body.confirmed !== true) throw Error('Confirm profile removal first.');
        save.profiles = save.profiles.filter(p => p.id !== profile.id);
        if (!save.profiles.length) d.saves = d.saves.filter(s => s.id !== save.id);
        else if (save.activeProfile === profile.id) save.activeProfile = save.profiles[0].id;
        if (!d.saves.some(s => s.id === d.activeSave)) d.activeSave = d.saves[0]?.id || null;
        return summary(d);
      }
      if (ep === '/api/rename') {
        if (body.target === 'save') save.name = cleanName(body.name);
        else if (body.target === 'profile') profile.name = cleanName(body.name);
        else throw Error('Invalid rename target.');
        return summary(d);
      }
      // /api/update applies one save-queue operation through mutate() (state.js); /api/import
      // restores a progress backup through validateState. Either way the revision is bumped. Unlike
      // the server, a backup with a different `format` is not rejected here before validateState.
      if (ep === '/api/update' || ep === '/api/import') {
        if (ep === '/api/import' && body.profileId && body.profileId !== profile.id)
          throw Error('Switch to the matching profile before restoring progress.');
        const next =
          ep === '/api/update'
            ? mutate(structuredClone(profile.state), body)
            : validateState(body.format ? body.state : body);
        if (profile.kind === 'original' && !['3', '4', '5', 'post'].includes(next.settings.phase))
          throw Error('The imported handbook covers Phase 3 onward.');
        next.revision = profile.state.revision + 1;
        profile.state = next;
        return next;
      }
      throw Error('This feature needs a self-hosted server.');
    };
    return read ? operation(await store.transaction()) : store.transaction(operation);
  };
}
// Entry point app/api.js calls in browser mode. The first call creates the store, the worker
// wrapper and the catalog; if that fails, the rejected promise stays cached and every later
// call fails with the same error until the page is reloaded.
export async function browserRequest(route, options) {
  if (!instance)
    instance = (async () => {
      if (!globalThis.indexedDB)
        throw Error(
          'Browser storage is unavailable. Use a regular browser window with site storage enabled.',
        );
      let worker;
      let serial = 0;
      const pending = new Map();
      // The worker cannot be interrupted mid-solve, so a timeout terminates it and fails every
      // pending calculation; the next one starts a fresh worker.
      const expire = () => {
        worker?.terminate();
        worker = null;
        for (const p of pending.values()) {
          clearTimeout(p.timer);
          p.reject(Error('Calculation timed out. Try fewer alternate recipes or a smaller goal.'));
        }
        pending.clear();
      };
      // Posts { id, settings } to the worker and settles when the reply with that id arrives. The
      // worker is created on first use and reused. It replies { id, phase } as each of the five
      // phases starts, then { id, result } or { id, error }. Each progress message restarts the
      // three-minute timer, so the limit applies per phase, not to the whole plan. The worker
      // runs one calculation at a time, so a queued request's timer also covers its wait.
      const calculate = (settings, onProgress) =>
        new Promise((resolve, reject) => {
          if (!worker) {
            worker = new Worker(new URL('./calculator-worker.js', import.meta.url), {
              type: 'module',
            });
            worker.onmessage = e => {
              const entry = pending.get(e.data.id);
              if (!entry) return;
              if (e.data.phase) {
                clearTimeout(entry.timer);
                entry.timer = setTimeout(expire, 180000);
                try {
                  entry.onProgress?.(e.data.phase);
                } catch {}
                return;
              }
              pending.delete(e.data.id);
              clearTimeout(entry.timer);
              e.data.error ? entry.reject(Error(e.data.error)) : entry.resolve(e.data.result);
            };
            // Script or WASM load failure: fail everything pending and let the next request retry.
            worker.onerror = () => {
              for (const p of pending.values()) {
                clearTimeout(p.timer);
                p.reject(Error('The calculator could not load. Refresh and try again.'));
              }
              pending.clear();
              worker.terminate();
              worker = null;
            };
          }
          const id = ++serial,
            timer = setTimeout(expire, 180000);
          pending.set(id, { resolve, reject, timer, onProgress });
          worker.postMessage({ id, settings });
        });
      const response = await fetch(new URL('./catalog.json', import.meta.url));
      if (!response.ok) throw Error('Could not load recipe catalog.');
      return createBrowserApi(openBrowserStore(indexedDB), calculate, await response.json());
    })();
  return (await instance)(route, options);
}
