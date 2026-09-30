// What one user sees of the workspace: the summary of their saves the interface lists, and the
// save and profile a request is about. Both only ever read saves whose userId is the user's.
import { isTranscribed } from '../public/handbook-migration.ts';
import { phaseProgress } from '../public/state.ts';
import { catalog } from '../planner.ts';
import { publicUser } from './accounts.ts';
import { fail } from './errors.ts';
import type { StoredUser, WorkspaceSummary } from '../public/types/index.ts';
import type { Workspace } from './persistence.ts';

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
        phases: phaseProgress(profile.plan, profile.state.checks),
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
