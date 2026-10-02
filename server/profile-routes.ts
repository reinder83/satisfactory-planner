// The routes over the scoped profile (see scope.ts): reading it, its progress backup, changing
// or restoring its progress, the whole-machine copy and the hard-drive payoff ranking.
import {
  checkBase,
  checkPlanStart,
  checkRoundUp,
  currentPayoff,
  wholeMachineProfile,
} from '../public/state.ts';
import { needsFrozenMapping, restoreProgress } from '../public/handbook-migration.ts';
import type { FrozenMapping } from '../public/handbook-migration.ts';
import { calculate, rankAlternates } from '../planner.ts';
import { randomId } from './accounts.ts';
import { fail } from './errors.ts';
import { frozenMapping } from './persistence.ts';
import { response } from './routing.ts';
import type { Body, ScopedRequest, WorkspaceContext } from './routing.ts';
import type { ProgressState, StageKey, StoredPayoff, UpdateOp } from '../public/types/index.ts';

export function profileRoutes({
  commit,
  limits,
  currentSummary,
  validateState,
  mutate,
  rankBudgetMs,
}: WorkspaceContext) {
  // Adds a whole-machine version of a calculated profile as a new profile in the same
  // save; the original profile is untouched. Its progress is copied, and a ticked
  // 'calc-' row is unticked for review where the rounded plan needs more machines or more
  // of any input (wholeMachineProfile and roundUpState in public/state/carry.ts, shared with
  // browser-api.ts). The same rule newProfileState uses when carrying factory progress.
  async function roundUp({ req, user, save, profile }: ScopedRequest) {
    checkRoundUp(profile);
    // checkRoundUp passes only a calculated profile, which always carries its plan.
    const plan = profile.plan!;
    limits.throttle(req);
    const rounded = calculate({ ...plan.settings, wholeMachines: true }),
      profileId = randomId();
    let reviewCount = 0;
    await commit(draft => {
      const draftSave = draft.saves.find(s => s.id === save.id && s.userId === user.id)!;
      if (draftSave.profiles.length >= 30) fail('Profile limit reached.');
      const previous = draftSave.profiles.find(p => p.id === profile.id)!;
      const copy = wholeMachineProfile(profileId, previous, rounded);
      reviewCount = copy.reviewCount;
      draftSave.profiles.push(copy.profile);
      draftSave.activeProfile = profileId;
      draft.users.find(account => account.id === user.id)!.activeSave = draftSave.id;
    });
    return response(
      { saveId: save.id, profileId, reviewCount, workspace: currentSummary(user) },
      201,
    );
  }
  // Hard-drive payoff (#203): ranks the alternates the scoped calculated profile does not
  // allow yet for body.phase (rankAlternates in planner.ts) and stores the result on the
  // profile with the createdAt of its plan. Throttled at the cost of five calculations and
  // stopped after rankBudgetMs; progress is untouched.
  async function rankPayoff({ req, user, save, profile, body }: ScopedRequest) {
    const plan = profile.plan;
    if (profile.kind !== 'calculated' || !plan)
      fail('Hard-drive payoff needs a calculated profile.');
    const input = await body();
    const phase = String(input.phase) as StageKey;
    if (!['1', '2', '3', '4', '5'].includes(phase)) fail('Choose a phase from 1 to 5.');
    limits.throttle(req, 5);
    const payoff: StoredPayoff = {
      planCreatedAt: plan.createdAt,
      rankedAt: new Date().toISOString(),
      ranking: rankAlternates(plan.settings, { phase, budgetMs: rankBudgetMs }),
    };
    await commit(draft => {
      const draftProfile = draft.saves
        .find(s => s.id === save.id && s.userId === user.id)
        ?.profiles.find(p => p.id === profile.id);
      if (!draftProfile) fail('Profile not found.', 404);
      draftProfile.payoff = payoff;
    });
    return response(payoff);
  }
  // Everything the interface needs to open the scoped profile. handbook is only present
  // on an original profile that carries its own (from an import, or a copy of one);
  // otherwise the client falls back to its default handbook. A stored payoff ranking is
  // only sent while it belongs to the profile's plan.
  function profileContext({ save, profile }: ScopedRequest) {
    return response({
      save: { id: save.id, name: save.name },
      profile: { id: profile.id, name: profile.name, kind: profile.kind },
      state: profile.state,
      plan: profile.plan || null,
      handbook: profile.handbook,
      payoff: currentPayoff(profile),
    });
  }
  function progressState({ profile }: ScopedRequest) {
    return response(profile.state);
  }
  // Progress-only backup of the scoped profile, a separate format from the full-save
  // export: it restores into this same profile through /api/import.
  function exportProgress({ save, profile }: ScopedRequest) {
    return response(
      {
        format: 'satisfactory-planner-backup',
        exportedAt: new Date().toISOString(),
        saveName: save.name,
        profileName: profile.name,
        profileId: profile.id,
        state: profile.state,
      },
      200,
      { 'Content-Disposition': 'attachment; filename="satisfactory-progress.json"' },
    );
  }
  // /api/update applies one mutate() operation to the scoped profile's progress;
  // /api/import replaces it with a progress backup (or a bare state), refusing a backup
  // that names another profile. Both are validated before the state is replaced and
  // written in one commit (writeProgress), so a rejected change leaves the saved state as it
  // was. The revision counts accepted writes. An update can carry the revision its tab last
  // saw (X-Planner-Revision); checkBase refuses a stale whole-value one (#165). An original
  // profile cannot be moved before Phase 3, which its handbook does not cover. A backup made
  // before a profile's handbook migration is re-keyed for it (restoreProgress, #606), with the
  // frozen handbook's mapping for a profile migrated before the mapping was recorded.
  async function updateProgress(request: ScopedRequest) {
    return writeProgress(request, await request.body());
  }
  async function importProgress(request: ScopedRequest) {
    const input = await request.body();
    if (input.format && input.format !== 'satisfactory-planner-backup')
      fail('Wrong backup format.');
    if (input.profileId && input.profileId !== request.profile.id)
      fail('This backup belongs to another profile. Switch to that profile before restoring.');
    const backup = validateState(input.format ? input.state : input);
    const frozen = needsFrozenMapping(request.profile.state, backup)
      ? await frozenMapping()
      : undefined;
    return writeProgress(request, input, backup, frozen);
  }
  // Writes the scoped profile's next progress: the imported state, or else input applied as an
  // update. `imported` and `frozen` are only set by /api/import.
  async function writeProgress(
    { req, user, save, profile }: ScopedRequest,
    input: Body,
    imported?: ProgressState,
    frozen?: FrozenMapping,
  ) {
    const next = await commit(draft => {
      const draftProfile = draft.saves
        .find(s => s.id === save.id && s.userId === user.id)
        ?.profiles.find(p => p.id === profile.id);
      if (!draftProfile) fail('Profile not found.', 404);
      // A whole-value write from a tab that has not seen the latest change is refused (409).
      if (!imported)
        checkBase(draftProfile.state, input, [req.headers['x-planner-revision']].flat()[0]);
      // mutate() checks the operation and throws for one it does not know.
      const state = imported
        ? restoreProgress(draftProfile.state, imported, frozen)
        : mutate(draftProfile.state, input as UpdateOp);
      // An original profile cannot be moved before Phase 3, where its plan starts.
      checkPlanStart(draftProfile.kind, state);
      state.revision = draftProfile.state.revision + 1;
      draftProfile.state = state;
      return state;
    });
    return response(next);
  }
  return {
    roundUp,
    rankPayoff,
    profileContext,
    progressState,
    exportProgress,
    updateProgress,
    importProgress,
  };
}
