// "Restore this version" (POST /api/restore-version, #1071): the undo of a recalculation in place,
// offered on the card of a version it kept (ui/pages/ProfilesPage.vue). The kept version's plan
// and progress go back into the profile it was kept for, which keeps its id, name and place; the
// version they replace is kept in turn as "<name> (before restore, Oct 7, 2:05 PM)", still
// linked, so the restore can be undone the same way. The request names the plans the user saw on
// both profiles, so one changed meanwhile in another tab or on another device is refused (409).
import { post } from './api.ts';
import { backupName } from './profile-edit.ts';
import { workspace } from './session.ts';
import type { WorkspaceSummary } from '../types/index.ts';

// The reply of POST /api/restore-version: the profile restored into keeps its id (profileId), and
// the kept version's place (backupId) now holds the version it replaced.
export interface RestoredVersion {
  workspace: WorkspaceSummary;
  saveId: string;
  profileId: string;
  backupId: string;
}

// What the request is about: the kept version (`backupId`) and the profile it is restored into
// (`into`), each with the createdAt of the plan the page showed, and the name the replaced
// version is kept under.
export interface Restore {
  saveId: string;
  backupId: string;
  into: string;
  planCreatedAt: string;
  backupPlanCreatedAt: string;
  backupName: string;
}

// The name the version a restore replaces is kept under: "<name> (before restore, Oct 7, 2:05
// PM)", numbered when that name is taken in the save.
export const restoreKeptName = (saveId: string, name: string, date = new Date()): string =>
  backupName(
    name,
    date,
    workspace?.saves.find(save => save.id === saveId)?.profiles.map(p => p.name),
    'restore',
  );

// The question asked before anything is sent: it names the kept version, the profile it goes
// back into and the name the replaced version is kept under.
export const restoreQuestion = (kept: string, into: string, keptName: string) => ({
  title: 'Restore this version?',
  body:
    `“${into}” gets the plan and progress of “${kept}” back, under its own name. Its current ` +
    `version is kept as “${keptName}”, with all of its progress, so you can switch back the ` +
    'same way.',
  confirmLabel: 'Restore this version',
});

// The toast after a restore.
export const restoredText = (into: string, keptName: string): string =>
  `Restored. “${into}” has this version’s plan and progress again. The version it replaced is ` +
  `kept as “${keptName}” under Profiles.`;

// Sends the restore, scoped to the kept version. Rejects with the refusal, its status attached
// (409 for a profile changed meanwhile).
export function postRestore({ saveId, backupId, ...body }: Restore): Promise<RestoredVersion> {
  return post<RestoredVersion>('/api/restore-version', body, { save: saveId, profile: backupId });
}
