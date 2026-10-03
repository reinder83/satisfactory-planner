// A single record lets each IndexedDB transaction atomically change selection and progress.
// Opens the browser edition's database; browserRequest in browser-api.ts is the caller (tests
// hand createBrowserApi a stand-in store instead). The name, store `workspace` and key `main`
// hold existing users' saves: renaming any of them makes those saves disappear from the UI. A
// second key, PRE_HANDBOOK, keeps the record as it was before the handbook migration (#497).
import { migrateOriginalProfile, type MigrationData } from './handbook-migration.ts';
import type { BrowserWorkspace, StoredProfile } from './types/index.ts';

// What an older planner says about saves a newer one wrote, whether the database itself or the
// workspace record is newer. Neither is read or written: AGENTS.md forbids downgrading them.
const NEWER =
  'The saves in this browser were written by a newer version of the planner. Open the latest ' +
  'version to use them; nothing has been changed. You can also download the stored data below ' +
  'to keep a copy.';
// A record that is there but is not a workspace. It is refused rather than treated as missing,
// which would put a blank workspace in its place on the next write. This browser cannot restore
// anything while it is refused (every route reads the record first), so the message names the
// ways out (#142).
const UNREADABLE =
  'The saves in this browser could not be read, so the planner cannot open here. Nothing has ' +
  "been changed: reload to try again, and keep this browser's site data. Download the stored " +
  'data below to keep a copy, and restore your last full save export in another browser or ' +
  'the Docker edition (Backup → Import saves).';
// Errors about the stored data itself carry storedData, so the start-up error page (boot() in
// app/session.ts) offers readStoredData's download next to the message.
const refused = (message: string) => Object.assign(Error(message), { storedData: true });
// A migration that failed (#497). Its transaction was aborted, so the record is as it was.
const NOT_MIGRATED =
  'The saves in this browser could not be updated for this version of the planner. Nothing ' +
  "has been changed: reload to try again, and keep this browser's site data. Download the " +
  'stored data below to keep a copy.';

// Whether a stored record has the shape browser-api.ts reads without checking: a saves list
// whose saves each have an id and a profiles list, and whose profiles each have an id and a
// progress state with checks and settings. Every release wrote records like this; anything
// else is damaged and is refused (UNREADABLE) instead of failing later with a raw TypeError.
// Deeper checks (the state's own fields) stay with validateState where the state is used.
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function workspaceRecord(found: unknown): found is BrowserWorkspace {
  return (
    object(found) &&
    Array.isArray(found.saves) &&
    found.saves.every(
      (save: unknown) =>
        object(save) &&
        typeof save.id === 'string' &&
        Array.isArray(save.profiles) &&
        save.profiles.every(
          (profile: unknown) =>
            object(profile) &&
            typeof profile.id === 'string' &&
            object(profile.state) &&
            object(profile.state.checks) &&
            object(profile.state.settings),
        ),
    )
  );
}

// A record this release reads: a workspace of version 1. Anything else is refused by
// transaction() below, with the message that fits it.
const newer = (record: unknown) =>
  object(record) && typeof record.version === 'number' && record.version > 1;
const current = (record: unknown): record is BrowserWorkspace =>
  workspaceRecord(record) && !newer(record);

// Retiring the handbook profile type (#387, #497): every original profile becomes a calculated
// one with its progress re-keyed (migrateOriginalProfile). In this edition an original profile
// always carries its own handbook, the one it migrates with: it only ever arrived through an
// import, which requires one (validateTransfer), or as a duplicate of one. A record with an
// original profile without one was never written by a release; it is left as it is, because the
// Pages build has no handbook to transcribe it from.
const migratable = (profile: StoredProfile) =>
  profile.kind === 'original' && object(profile.handbook);
const needsMigration = (workspace: BrowserWorkspace) =>
  workspace.saves.some(s => s.profiles.some(migratable));
// The second key (#497): the record as it was read before its first migration. Written in the
// migration's own transaction, only when the key is empty, so it is never replaced; nothing in
// the planner reads it. It is the pre-migration copy AGENTS.md requires, the counterpart of the
// server's workspace.json.pre-handbook.
export const PRE_HANDBOOK = 'pre-handbook';
// What the migration needs (MigrationData): browser-api.ts loads it, and only when there is
// something to migrate. The same loader converts an imported original profile (#605).
export type { MigrationData };

// Schema version 2 (#518) marks a database whose record went through the handbook migration. The
// migration runs in the upgrade to it, so every tab of an earlier release (schema version 1)
// hears of it: each release since 2026-09-26 closes its connection on versionchange and says to
// reload, an older one blocks the upgrade until it is closed, and after a reload an earlier
// release refuses the database with NEWER. None of them can then file a tick or a note under a
// handbook key on a profile that is calculated by now. The record's own `version` stays 1.
const SCHEMA = 2;

// Migrates the original profiles of `found` (the record `main` as read in `store`'s transaction)
// and puts it back, first keeping it under PRE_HANDBOOK unless `kept` (that key's value) holds a
// copy already. A throw leaves the caller to abort the transaction, so both keys stay as they were.
function migrateRecord(
  store: IDBObjectStore,
  found: BrowserWorkspace,
  kept: unknown,
  { recipes, pureLimits }: MigrationData,
) {
  // put() copies the value when it is called, so this is the record as it was read.
  if (kept === undefined) store.put(found, PRE_HANDBOOK);
  for (const save of found.saves)
    save.profiles = save.profiles.map(profile =>
      // migratable() checked that it carries a handbook.
      migratable(profile)
        ? migrateOriginalProfile(profile, profile.handbook!, recipes, pureLimits)
        : profile,
    );
  store.put(found, 'main');
}

// The store browser-api.ts works through (tests pass a stand-in with the same method).
export interface BrowserStore {
  transaction(): Promise<BrowserWorkspace>;
  transaction<T>(change: (data: BrowserWorkspace) => T): Promise<T>;
}

// With `loadMigration`, the original profiles the record holds are migrated: in the upgrade to
// SCHEMA (open below), and on the first transaction of each connection after that (migrate
// below); without it (tests of other behaviour), none is.
export function openBrowserStore(
  indexedDB: IDBFactory,
  name = 'satisfactory-planner-browser-v1',
  loadMigration?: () => Promise<MigrationData>,
): BrowserStore {
  // Set once another tab upgrades the schema and this connection closes for it.
  let upgradedElsewhere = false;
  // The migration's run on this connection: shared by the transactions that wait for it, and
  // cleared when it fails, so the next one tries again.
  let migrated: Promise<void> | undefined;
  // The record can have gained original profiles after the upgrade: an import stored them as they
  // were until #605, which converts them on import. No earlier release opens a database at
  // SCHEMA, so these are migrated here, on the first transaction of the next connection,
  // without the upgrade's notice to older tabs.
  // A readonly look first, so recipes.json is only fetched when there is something to migrate.
  // Then one readwrite transaction reads the record again (another tab may have migrated it
  // meanwhile, and then nothing is written), keeps it under PRE_HANDBOOK unless that key already
  // holds a copy, and puts it back migrated. A throw aborts the transaction, so a failure leaves
  // both keys as they were. A record transaction() refuses (damaged, newer) is left to it.
  const migrate = async (database: IDBDatabase, load: () => Promise<MigrationData>) => {
    const found = await new Promise<unknown>((resolve, reject) => {
      const request = database
        .transaction('workspace', 'readonly')
        .objectStore('workspace')
        .get('main');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!current(found) || !needsMigration(found)) return;
    const migration = await load();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('workspace', 'readwrite'),
        store = transaction.objectStore('workspace');
      let failure: unknown,
        settled = 0;
      const main = store.get('main'),
        kept = store.get(PRE_HANDBOOK);
      main.onsuccess = kept.onsuccess = () => {
        if (++settled < 2) return;
        try {
          // Saved data is unknown until checked (AGENTS.md).
          const data: unknown = main.result;
          if (!current(data) || !needsMigration(data)) return;
          migrateRecord(store, data, kept.result, migration);
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => {
        const why = failure || transaction.error;
        reject(refused(NOT_MIGRATED + (why instanceof Error ? ` (${why.message})` : '')));
      };
      // Request errors also abort the transaction, so onabort reports them.
      transaction.onerror = () => {};
    });
  };
  // Opens the database at SCHEMA. Upgrading from version 1 migrates the record in the upgrade's
  // own transaction (migrateRecord), which commits together with the new version or not at all:
  // an abort leaves the database at version 1 with both keys as they were, so the previous
  // release still opens it and the next open tries again. The migration data is loaded only when
  // the record needs it: the first attempt aborts the upgrade on finding that, loads it, and
  // upgrades again (without `loadMigration`, the upgrade migrates nothing).
  const open = (migration?: MigrationData) =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, SCHEMA);
      // Why the upgrade aborted: the migration data is needed first, or what failed.
      let needsData = false,
        failure: unknown,
        settled = false;
      request.onupgradeneeded = () => {
        const database = request.result;
        // A brand-new database just gets the empty store.
        if (!database.objectStoreNames.contains('workspace')) {
          database.createObjectStore('workspace');
          return;
        }
        if (!loadMigration) return;
        // The upgrade transaction; it is there while onupgradeneeded runs.
        const upgrade = request.transaction!,
          store = upgrade.objectStore('workspace');
        upgrade.onabort = () => (failure ??= upgrade.error);
        let read = 0;
        const main = store.get('main'),
          kept = store.get(PRE_HANDBOOK);
        main.onsuccess = kept.onsuccess = () => {
          if (++read < 2) return;
          try {
            // Saved data is unknown until checked (AGENTS.md). A record transaction() refuses
            // (damaged, newer) is left to it.
            const found: unknown = main.result;
            if (!current(found) || !needsMigration(found)) return;
            if (!migration) {
              needsData = true;
              return upgrade.abort();
            }
            migrateRecord(store, found, kept.result, migration);
          } catch (error) {
            failure = error;
            upgrade.abort();
          }
        };
      };
      request.onsuccess = () => {
        const database = request.result;
        // Opened after this attempt was refused as blocked: the next transaction opens again.
        if (settled) return database.close();
        settled = true;
        // Close when another tab asks to upgrade the schema, so a future upgrade is not blocked by
        // tabs left open. Such a tab then refuses its later transactions, saying why, until it is
        // reloaded (rather than the browser's raw "connection is closing" error).
        database.onversionchange = () => {
          upgradedElsewhere = true;
          database.close();
        };
        resolve(database);
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        // A database a newer release has upgraded refuses this older schema version.
        if (request.error?.name === 'VersionError') return reject(refused(NEWER));
        if (needsData) return resolve(loadMigration!().then(open));
        if (failure !== undefined || request.error?.name === 'AbortError')
          return reject(
            refused(NOT_MIGRATED + (failure instanceof Error ? ` (${failure.message})` : '')),
          );
        reject(request.error);
      };
      // A tab of a release from before 2026-09-26 keeps its connection open through an upgrade.
      request.onblocked = () => {
        if (settled) return;
        settled = true;
        reject(Error('Close other planner tabs to upgrade browser storage.'));
      };
    });
  // Shared by the transactions that wait for it, and cleared when it fails, so the next one
  // (the next request, or a reload) tries again.
  let opened: Promise<IDBDatabase> | undefined;
  return {
    // Without `change`, a readonly read of the whole workspace record. With it, one readwrite
    // transaction: read `main` (or a blank workspace), let `change` mutate it in place and return
    // the response, then put it back. IndexedDB serializes readwrite transactions on a store, so
    // concurrent tabs cannot interleave a read-modify-write. `change` must be synchronous: the
    // transaction commits once no request is pending.
    async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
      opened ??= open().catch(error => {
        opened = undefined;
        throw error;
      });
      const database = await opened;
      if (upgradedElsewhere)
        throw Error(
          'A newer version of the planner was opened in another tab. Reload this tab to continue; nothing has been changed.',
        );
      if (loadMigration) {
        migrated ??= migrate(database, loadMigration).catch(error => {
          migrated = undefined;
          throw error;
        });
        await migrated;
      }
      return new Promise<T>((resolve, reject) => {
        const transaction = database.transaction('workspace', change ? 'readwrite' : 'readonly'),
          store = transaction.objectStore('workspace');
        // Without change, the answer is the record itself.
        let answer: T | undefined, failure: unknown;
        const request = store.get('main');
        request.onsuccess = () => {
          try {
            // Saved data is unknown until checked (AGENTS.md).
            const found: unknown = request.result;
            // Version 1 is the only workspace format so far; a later one is refused unread.
            if (newer(found)) throw refused(NEWER);
            // Only a missing record (a new browser) starts blank; anything else not shaped like
            // a workspace, falsy values included, is refused unread.
            if (found !== undefined && !workspaceRecord(found)) throw refused(UNREADABLE);
            const data: BrowserWorkspace = found ?? {
              version: 1,
              activeSave: null,
              saves: [],
              lastBackup: null,
            };
            // Records written before lastBackup existed have no such field: read it as null
            // ("never exported"), as the type says. A change writes the field back (#72).
            data.lastBackup ??= null;
            answer = change ? change(data) : (data as T);
            if (change) store.put(data, 'main');
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        };
        // Resolve only after the commit is durable. If `change` throws, the abort discards its
        // edits and the promise rejects with that error.
        transaction.oncomplete = () => resolve(answer as T);
        transaction.onabort = () =>
          reject(failure || transaction.error || Error('Browser storage could not be saved.'));
        // Request errors also abort the transaction, so onabort reports them.
        transaction.onerror = () => {};
      });
    },
  };
}

// The stored workspace record exactly as it is, unchecked, for the start-up error page's
// download when the planner refuses it (#142): damaged, or written by a newer release. Opens the
// database at whatever version it has, so a newer schema is readable too, and never writes. A
// browser without the database resolves undefined: the upgrade that opening would start is
// aborted, so no empty database is left behind for the real open to trip over.
export function readStoredData(
  indexedDB: IDBFactory,
  name = 'satisfactory-planner-browser-v1',
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    let missing = false;
    request.onupgradeneeded = () => {
      missing = true;
      request.transaction?.abort();
    };
    request.onerror = () => (missing ? resolve(undefined) : reject(request.error));
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('workspace')) {
        database.close();
        return resolve(undefined);
      }
      const get = database
        .transaction('workspace', 'readonly')
        .objectStore('workspace')
        .get('main');
      get.onsuccess = () => {
        database.close();
        resolve(get.result);
      };
      get.onerror = () => {
        database.close();
        reject(get.error);
      };
    };
  });
}
