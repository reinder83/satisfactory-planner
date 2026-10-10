// "Restore this version" (POST /api/restore-version, #1071): the undo of a recalculation in place,
// in both editions (server/profile-routes.ts restoreVersion and browser-api.ts restoreVersion).
// Re-exported by ../state.ts.
//
// A recalculation in place keeps the previous version as a profile of its own and links it to
// the profile it was the previous version of: the optional profile field `backupOf` (that
// profile's id). Restoring swaps the two versions' contents: the kept version's plan, progress
// and payoff ranking go back into the linked profile's place (same id and name, so links, the
// active profile and open tabs keep pointing at it), and the version it replaces takes the kept
// version's place under the name "<name> (before restore, <date>)", still linked, so the restore
// can be undone the same way. Nothing is deleted and no profile is added.
//
// The field is absent from every profile stored before it and from every profile nothing linked;
// older releases keep it in their stores without reading it and leave it out of what they import
// (validateTransfer rebuilds each profile). A link that names no other profile of the same save
// (its profile removed, or a copy imported without it) offers no restore.
import type { StoredProfile, StoredProfileKind } from '../types/index.ts';
import { fail } from './validate.ts';

// The id of the profile `profile` restores into: the one its link names, when that is another
// profile of the same save (`profiles`), else undefined.
export function restoreTarget(
  profiles: readonly { id: string }[],
  profile: { id: string; backupOf?: unknown },
): string | undefined {
  const link = profile.backupOf;
  return typeof link === 'string' && link !== profile.id && profiles.some(p => p.id === link)
    ? link
    : undefined;
}

// What a profile's entry in the save list (summary() in server/scope.ts, browser-api.ts) adds for
// a restore: the profile it restores into, only while that profile exists, and its plan's
// createdAt, which the request names. Nothing for a profile without either.
export function restoreFields(
  profiles: readonly { id: string }[],
  profile: { id: string; backupOf?: unknown; plan?: { createdAt?: unknown } | null },
): { backupOf?: string; planCreatedAt?: string } {
  const into = restoreTarget(profiles, profile),
    created = profile.plan?.createdAt;
  return {
    ...(into ? { backupOf: into } : {}),
    ...(typeof created === 'string' ? { planCreatedAt: created } : {}),
  };
}

export const notAKeptVersion =
  'This profile is not a kept version of another profile, so there is nothing to restore it into.';
export const restoreTargetGone =
  'The profile this version was kept for no longer exists, so there is nothing to restore it into.';
export const restoreNeedsCalculated =
  'Only a calculated profile can be restored. Create a calculated profile instead.';
export const restoreStale =
  'This profile or its kept version changed in another tab or on another device, so nothing ' +
  'was restored. Look at Saves & profiles again before restoring.';

// What the request names: the profile to restore into (`into`) and the plans the user saw on
// both profiles (`planCreatedAt` the linked profile's, `backupPlanCreatedAt` the kept version's).
export interface RestoreRequest {
  into?: unknown;
  planCreatedAt?: unknown;
  backupPlanCreatedAt?: unknown;
}

type Restorable = {
  id: string;
  kind: StoredProfileKind;
  plan?: { createdAt: string } | null;
  backupOf?: unknown;
};

// The refusals both editions give, checked against the save's profiles as stored at write time.
// Returns the profile restored into. A profile without a usable link, a link to a profile that is
// gone and a request naming another profile are refused; so is a request made while either
// profile showed another plan (409, the stale-tab guard /api/recalculate has too).
export function checkRestore<T extends Restorable>(
  profiles: readonly T[],
  backup: T,
  input: RestoreRequest,
): T {
  const into = restoreTarget(profiles, backup);
  if (!into) fail(typeof backup.backupOf === 'string' ? restoreTargetGone : notAKeptVersion, 404);
  if (input.into !== into) fail(restoreStale, 409);
  // restoreTarget found it among `profiles`.
  const target = profiles.find(p => p.id === into)!;
  for (const profile of [target, backup])
    if (profile.kind !== 'calculated' || !profile.plan) fail(restoreNeedsCalculated);
  if (
    input.planCreatedAt !== target.plan!.createdAt ||
    input.backupPlanCreatedAt !== backup.plan!.createdAt
  )
    fail(restoreStale, 409);
  return target;
}

// The two profiles after the restore: `restored` (the target's id, name and own link, with the
// kept version's plan, progress and payoff) and `kept` (the kept version's id, named `keptName`,
// linked to the target, with the content the target had). Both states get a revision past either
// one's, so a whole-value write from a tab that still shows one of the old versions is refused.
// The inputs are cloned, never changed.
export function restoredVersions<T extends StoredProfile>(target: T, backup: T, keptName: string) {
  const content = ({ id: _id, name: _name, backupOf: _link, ...rest }: T) => structuredClone(rest);
  const revision = Math.max(target.state.revision ?? 0, backup.state.revision ?? 0) + 1;
  const restored = {
    ...content(backup),
    id: target.id,
    name: target.name,
    ...(target.backupOf === undefined ? {} : { backupOf: target.backupOf }),
  } as T;
  const kept = { ...content(target), id: backup.id, name: keptName, backupOf: target.id } as T;
  restored.state.revision = revision;
  kept.state.revision = revision;
  return { restored, kept };
}
