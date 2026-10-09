// Recalculating a profile in place (POST /api/recalculate, #1071), the one request behind Edit
// settings' "Recalculate in place" (recalculateProfile in wizard/wizard.ts) and the plan's own
// recalculation offers (ui/recalc-offer.ts: exact clocks, items made on site, transport fuel).
// The profile keeps its id and gets the new plan and the progress carried from itself; its
// previous version is kept whole as a profile of its own, named by backupName in profile-edit.ts.
// The request names the plan it started from (planCreatedAt), so a profile recalculated meanwhile
// in another tab or on another device is refused (409) rather than replaced.
import { post } from './api.ts';
import type { RequestOptions } from './api.ts';
import { plural } from './format.ts';
import { backupName } from './profile-edit.ts';
import { workspace } from './session.ts';
import type { WorkspaceSummary } from '../types/index.ts';

// The reply of POST /api/recalculate: the profile's id stays, backupId is the previous version's.
export interface RecalculatedProfile {
  workspace: WorkspaceSummary;
  saveId: string;
  profileId: string;
  backupId: string;
  carriedChecks: number;
  reviewCount: number;
}

// What POST /api/recalculate is sent: the profile it recalculates, the name it keeps and the
// name of its backup, the settings to calculate, the plan the change started from, and the carry
// picks and finished-work keys of Edit settings' Review (none from an offer: everything is carried,
// as a new profile carried from it without picks was).
export interface Recalculation {
  saveId: string;
  profileId: string;
  name: string;
  backupName: string;
  settings: object;
  planCreatedAt: string;
  carry?: Record<string, boolean> | undefined;
  built?: string[];
}

// The name the previous version of profile `name` in save `saveId` is kept under now:
// "<name> (before edit, Oct 7, 2:05 PM)", numbered when that name is taken in the save.
export const keptName = (saveId: string, name: string, date = new Date()): string =>
  backupName(
    name,
    date,
    workspace?.saves.find(save => save.id === saveId)?.profiles.map(p => p.name),
  );

// Sends the recalculation; `extra` carries the progress callback (calcProgress in
// wizard/wizard.ts). Rejects with the refusal, its status attached (409 for a stale plan).
export function postRecalculation(
  { saveId, profileId, ...body }: Recalculation,
  extra: RequestOptions,
): Promise<RecalculatedProfile> {
  return post<RecalculatedProfile>(
    '/api/recalculate',
    body,
    { save: saveId, profile: profileId },
    extra,
  );
}

// The toast after a recalculation in place: the lines left for review, and where the previous
// version is kept.
export function recalculatedText(reviewCount: number, kept: string): string {
  const review = reviewCount
    ? ' ' + plural(reviewCount, 'production line') + ' left unticked for review.'
    : '';
  return `Recalculated in place.${review} The previous version is kept as “${kept}” under Profiles.`;
}
