// What one user sees of the workspace: the summary of their saves the interface lists, and the
// save and profile a request is about. Both only ever read saves whose userId is the user's.
import { readFileSync } from 'node:fs';
import { isTranscribed } from '../public/handbook-migration.ts';
import { profilePhasesCache, restoreFields } from '../public/state.ts';
import { catalog } from '../planner.ts';
import { publicUser } from './accounts.ts';
import { fail } from './errors.ts';
import type { Progression, StoredUser, WorkspaceSummary } from '../public/types/index.ts';
import type { Workspace } from './persistence.ts';

// progression.json, which the summary's per-phase step counts read (profilePhases, #746): the
// file the interface loads, in public/ (the Docker image's built public/ has it too). Read once,
// on the first summary. It is the server's own shipped data, so it is used as it is. A
// recalculation in place reads it too, for the steps the new plan lists (profile-routes.ts, #1112).
let progression: Progression | undefined;
export const progressionData = (): Progression =>
  (progression ??= JSON.parse(
    readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
  ) as Progression);

// Each profile's per-phase counts, kept until its plan or progress changes (#804): the summary is
// asked for at boot, when Saves & profiles opens and after every save or profile change, and
// working the step counts out again for every profile each time was most of its cost.
const cachedPhases = profilePhasesCache();

// What the interface needs to list saves: only this user's saves, and per profile its
// settings and tick count rather than the full state.
export const summary = (
  workspace: Workspace,
  user: StoredUser | null | undefined,
): WorkspaceSummary => ({
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
        phases: cachedPhases(profile.id, profile.plan, profile.state, progressionData()),
        ...restoreFields(save.profiles, profile),
      })),
    })),
});
// Resolves which save and profile a request is about: the X-Save-Id / X-Profile-Id
// headers, then ?save= / ?profile=, then the user's active save and its active profile.
// Each browser tab sends its own headers, so tabs on different profiles never write into
// each other. A save that belongs to another user is reported as not found.
export const scope = (
  workspace: Workspace,
  req: { headers: Record<string, unknown> },
  url: URL,
  user: StoredUser,
) => {
  const saveId = req.headers['x-save-id'] || url.searchParams.get('save') || user.activeSave;
  const save = workspace.saves.find(s => s.id === saveId && s.userId === user.id);
  if (!save) fail('Save not found.', 404);
  const profileId =
    req.headers['x-profile-id'] || url.searchParams.get('profile') || save.activeProfile;
  const profile = save.profiles.find(p => p.id === profileId);
  if (!profile) fail('Profile not found.', 404);
  return { save, profile };
};
