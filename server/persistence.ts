// The Docker edition's workspace on disk: loading and migrating DATA_DIR/workspace.json (and
// the progress.json of earlier releases), and the queue every later write goes through. The
// whole workspace lives in memory and in workspace.json:
//   { version: 2, revision, accountsEnabled, registration,
//     users:    [{ id ('owner' or random), username, password: 'salt:scryptHex', activeSave }],
//     saves:    [{ id, name, userId, activeProfile, profiles: [
//                 { id, name, kind: 'original' | 'calculated', plan, handbook?, state }] }],
//     sessions: [{ hash: sha256(token), userId, expires }] }
// state is the progress object from public/state.ts. The 'owner' user always exists.
import fs from 'node:fs/promises';
import path from 'node:path';
import { catalog } from '../planner.ts';
import {
  handbookMapping,
  handbookToPlan,
  migrateOriginalProfile,
  usableHandbook,
  type FrozenMapping,
  type MigrationData,
} from '../public/handbook-migration.ts';
import { errorCode } from './errors.ts';
import type {
  Handbook,
  ProgressState,
  Recipe,
  StoredProfile,
  StoredSave,
  WorkspaceFile,
} from '../public/types/index.ts';

// workspace.json as it is held in memory: every profile's progress has been through
// validateState, so it is the current ProgressState, whatever version the file stored.
export type Profile = Omit<StoredProfile, 'state'> & { state: ProgressState };
export type Save = Omit<StoredSave, 'profiles'> & { profiles: Profile[] };
export type Workspace = Omit<WorkspaceFile, 'saves'> & { saves: Save[] };
type ValidateState = (state: unknown) => ProgressState;

// Retiring the handbook profile type (#387, #495): every original profile becomes a calculated
// one with its progress re-keyed (migrateOriginalProfile). One that carries no handbook of its
// own was made with this handbook: a frozen, server-only copy of the handbook (plan.json) as it
// was released; no release ships plan.json any more (#397). The Docker
// image copies migrations/; the Pages build never includes it. Read only when there is
// something to migrate.
const read = async (file: string) =>
  JSON.parse(await fs.readFile(new URL(file, import.meta.url), 'utf8'));
// The recipes and base budgets the migration uses, here and for an imported original profile
// (save-routes.ts, #605).
export const migrationData = async (): Promise<MigrationData> => ({
  recipes: ((await read('../recipes.json')) as { recipes: Recipe[] }).recipes,
  pureLimits: catalog().pureLimits,
});
const frozenHandbook = async () =>
  (await read('../migrations/handbook-2026-09-13.json')) as Handbook;
// What the migration of an original profile without a handbook of its own mapped (#606): the
// frozen handbook's mapping. A progress backup made before the migration is re-keyed with it
// onto a profile migrated before handbookOrigin.mapping was recorded (profile-routes.ts). Read
// once, when such a restore first needs it; a failed read is tried again by the next restore.
let frozen: Promise<FrozenMapping> | undefined;
export const frozenMapping = (): Promise<FrozenMapping> =>
  (frozen ??= (async () => {
    const { handbook } = usableHandbook(await frozenHandbook());
    const { recipes } = await migrationData();
    return {
      version: handbook.version,
      mapping: handbookMapping(handbook, handbookToPlan(handbook, recipes)),
    };
  })().catch(error => {
    frozen = undefined;
    throw error;
  }));
const migrateOriginals = async (saves: Save[]) => {
  const handbook = await frozenHandbook();
  const { recipes, pureLimits } = await migrationData();
  for (const save of saves)
    save.profiles = save.profiles.map(profile =>
      migrateOriginalProfile(profile, handbook, recipes, pureLimits),
    );
};
const original = (state: ProgressState): Profile => ({
  id: 'original',
  name: 'Original · 50× complete automation',
  kind: 'original',
  state,
});
// A workspace, or a profile's progress, from a newer release is refused with this rather than
// the generic message, so the owner knows an update is what is needed.
const newer = () =>
  Object.assign(
    new Error(
      'workspace.json was written by a newer version of the planner. Update the app to open it; existing data has not been overwritten.',
    ),
    { newer: true },
  );

// Parses workspace.json and validates every profile's progress, throwing for anything that is
// not a workspace this release can open.
function parseWorkspace(raw: string, validateState: ValidateState): Workspace {
  const workspace: Workspace = JSON.parse(raw);
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
  return workspace;
}

// workspace.json is missing but its backup is not: starting fresh would overwrite that backup
// on the first save, so stop and say how to recover instead. Only a backup that is certainly
// absent (ENOENT) lets start-up continue; any other stat error might hide one, so it stops too,
// but says the backup could not be checked rather than that it exists.
async function refuseOverBackup(file: string) {
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
}

// First start of this format: migrate the single-profile progress.json of earlier releases
// into the Original profile of one save. progress.json is only read, never changed, so it
// stays as the pre-migration copy; a corrupt one stops start-up. With neither file, the owner
// starts with no saves, and the interface opens the guided start like the Pages edition
// (decision 5A on #387, #496). The 'wx' flag refuses to overwrite a workspace.json that
// appeared in the meantime.
async function createWorkspace(
  dataDir: string,
  file: string,
  validateState: ValidateState,
): Promise<Workspace> {
  let legacy: ProgressState | null;
  try {
    legacy = validateState(
      JSON.parse(await fs.readFile(path.join(dataDir, 'progress.json'), 'utf8')),
    );
  } catch (error) {
    if (errorCode(error) === 'ENOENT') legacy = null;
    else throw new Error('Progress could not be read; existing data has not been overwritten.');
  }
  const workspace: Workspace = {
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
  return workspace;
}

// A workspace.json with original profiles (#495): first keep it as it was read in
// workspace.json.pre-handbook, written once and never replaced, so a later start cannot
// overwrite the copy with a partly migrated file. Then every original profile migrates in one
// write, through .tmp and a rename like commit's, so a crash leaves the unmigrated file and the
// next start finishes. A workspace without any is left as it is, so starting again changes
// nothing.
async function migrateHandbookProfiles(file: string, raw: string, workspace: Workspace) {
  if (!workspace.saves.some(s => s.profiles.some(p => p.kind === 'original'))) return workspace;
  await fs.writeFile(file + '.pre-handbook', raw, { flag: 'wx', mode: 0o600 }).catch(error => {
    if (errorCode(error) !== 'EEXIST') throw error;
  });
  const next = structuredClone(workspace);
  await migrateOriginals(next.saves);
  next.revision = workspace.revision + 1;
  await fs.writeFile(file + '.tmp', JSON.stringify(next), { mode: 0o600 });
  await fs.rename(file + '.tmp', file);
  return next;
}

// Loads workspace.json from dataDir and validates every profile's progress. Any failure other
// than a missing file (unreadable JSON, an unknown or newer workspace.version, a broken save, a
// state validateState refuses) stops start-up and leaves the file untouched, so a damaged or
// newer workspace never turns into an empty one. Normalised states are only held in memory
// until the next write. A missing file is created (createWorkspace), unless its backup exists.
export async function loadWorkspace(
  dataDir: string,
  validateState: ValidateState,
): Promise<Workspace> {
  const file = path.join(dataDir, 'workspace.json');
  // workspace.json exactly as it was read, kept as the pre-migration copy.
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (errorCode(error) !== 'ENOENT')
      throw new Error('Workspace could not be read; existing data has not been overwritten.');
    await refuseOverBackup(file);
    return createWorkspace(dataDir, file, validateState);
  }
  let workspace: Workspace;
  try {
    workspace = parseWorkspace(raw, validateState);
  } catch (error) {
    if ((error as { newer?: boolean })?.newer) throw error;
    throw new Error('Workspace could not be read; existing data has not been overwritten.');
  }
  return migrateHandbookProfiles(file, raw, workspace);
}

// A commit: change edits a deep copy of the workspace and returns what the caller gets back.
export type Commit = <T>(change: (draft: Workspace) => T) => Promise<T>;
// The workspace in memory and the queue every write goes through, one at a time in queue
// order. change edits a deep copy of the workspace; if it throws, nothing is written and the
// workspace stays as it was. Otherwise the previous in-memory workspace is kept as
// workspace.json.bak, the new one goes to .tmp and renamed over workspace.json, and only then
// does the workspace become the copy. So a crash leaves either the old or the new workspace,
// never a half-written one. commit returns change's result; a failed commit does not block the
// ones queued after it. current() is the workspace as the last finished commit left it.
export function createCommitQueue(dataDir: string, loaded: Workspace) {
  const file = path.join(dataDir, 'workspace.json');
  let workspace = loaded;
  let queue: Promise<unknown> = Promise.resolve();
  const commit: Commit = change => {
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
  return { current: () => workspace, commit };
}
