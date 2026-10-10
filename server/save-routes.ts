// The routes over the signed-in user's saves and profiles: full-save export and import,
// creating, copying, selecting, removing and renaming profiles, and the calculator preview.
import {
  activeAfterImport,
  exportQuery,
  importableTransfer,
  remapImportedIds,
  selectForExport,
} from '../public/transfer.ts';
import { calculatedProfile, checkNewProfileKind, renameOfferFields } from '../public/state.ts';
import { calculate } from '../planner.ts';
import { reviewedPlans } from '../public/reviewed-plans.ts';
import type { CurrentCalculatedPlan } from '../public/types/index.ts';
import { randomId } from './accounts.ts';
import { fail } from './errors.ts';
import { migrationData, type Save } from './persistence.ts';
import { response } from './routing.ts';
import type { UserRequest, WorkspaceContext } from './routing.ts';

// A save or profile name from a request, trimmed.
const name = (value: unknown): string =>
  typeof value === 'string' && value.trim() && value.length <= 80
    ? value.trim()
    : fail('Enter a name with 1–80 characters.');

export function saveRoutes({
  current,
  commit,
  limits,
  currentSummary,
  scope,
  scopeNamed,
}: WorkspaceContext) {
  // The plans Review showed, per user, for Create profile (#1060, public/reviewed-plans.ts).
  const reviewed = reviewedPlans<CurrentCalculatedPlan>();
  // Full-save export (public/transfer.ts format) of the user's saves, scoped by the query as
  // selectForExport describes; share=1 strips progress with shareState. Each save keeps the shape
  // this route has always written: no userId, and a profile's plan null when it has none.
  // Read-only.
  async function exportSaves({ url, user }: UserRequest) {
    const owned = current()
      .saves.filter(s => s.userId === user.id)
      .map(save => ({
        id: save.id,
        name: save.name,
        activeProfile: save.activeProfile,
        profiles: save.profiles.map(profile => ({
          id: profile.id,
          name: profile.name,
          kind: profile.kind,
          plan: profile.plan || null,
          state: profile.state,
          // The kept-version link (#1071); selectForExport leaves out one whose profile is not
          // exported.
          ...(profile.backupOf === undefined ? {} : { backupOf: profile.backupOf }),
          // The dismissed "Rename to …" offer (#1071), so an import does not offer it again.
          ...renameOfferFields(profile),
        })),
      }));
    const { exported } = selectForExport(owned, exportQuery(url.searchParams), message =>
      fail(message, 404),
    );
    return response(exported);
  }
  // Copies a profile of one of the user's saves, plan and progress included, into the same
  // save under a new id and makes the copy active. The source is not changed.
  async function duplicateProfile({ url, user, body }: UserRequest) {
    const input = await body();
    if (!input.saveId || !input.profileId) fail('Choose a profile to copy.');
    const { save, profile } = scopeNamed(input, url, user);
    const profileId = randomId();
    await commit(draft => {
      const draftSave = draft.saves.find(s => s.id === save.id && s.userId === user.id);
      const source = draftSave?.profiles.find(p => p.id === profile.id);
      if (!draftSave || !source) fail('Profile not found.', 404);
      if (draftSave.profiles.length >= 30) fail('You can keep up to 30 profiles per save.');
      // A copy is not a kept version (#1071): it leaves the source's backupOf link behind, and
      // the dismissed "Rename to …" offer too, since it has a name of its own.
      const {
        backupOf: _link,
        renameOfferDismissed: _dismissed,
        ...copy
      } = structuredClone(source);
      draftSave.profiles.push({
        ...copy,
        id: profileId,
        name: (source.name + ' · copy').slice(0, 80),
      });
      draftSave.activeProfile = profileId;
      draft.users.find(account => account.id === user.id)!.activeSave = draftSave.id;
    });
    return response({ saveId: save.id, profileId, workspace: currentSummary(user) }, 201);
  }
  // Imports a full-save export as new saves owned by this user, with fresh save and
  // profile ids, so nothing existing is overwritten. Validated completely before the
  // single commit, so a bad file adds nothing. The user's active save stays active (#1052), so
  // nobody is moved into the copy; only a user without one gets the last imported save. An
  // original profile is stored already converted into a calculated one (importableTransfer).
  async function importSaves({ user, body }: UserRequest) {
    const imported = await importableTransfer(await body(), migrationData);
    await commit(draft => {
      if (draft.saves.filter(s => s.userId === user.id).length + imported.saves.length > 50)
        fail('Import would exceed the save limit.');
      // importableTransfer ran every profile's progress through validateState; the owner is
      // added below.
      const owner = draft.users.find(account => account.id === user.id)!;
      const added = remapImportedIds(imported, randomId) as Save[];
      owner.activeSave = activeAfterImport(
        owner.activeSave,
        draft.saves.filter(s => s.userId === user.id),
        added,
      );
      for (const save of added) {
        save.userId = user.id;
        draft.saves.push(save);
      }
    });
    return response(currentSummary(user));
  }
  // Runs the calculator for the wizard without storing anything; throttled because a
  // solve is expensive. A live estimate (`?estimate=1`) counts against its own allowance and
  // solving-time budget (limits.ts). Both checks run before the body is read. Review's plan (not
  // an estimate) is kept in memory for Create profile (reviewedPlans, #1060).
  async function preview({ req, url, user, body }: UserRequest) {
    const budget = url.searchParams.get('estimate') === '1' ? limits.estimateBudget(req) : null;
    if (budget) limits.throttleEstimate(req);
    else limits.throttle(req);
    const input = await body();
    const start = performance.now();
    try {
      const plan = calculate(input.settings);
      if (!budget) reviewed.keep(user.id, input.settings, plan);
      return response(plan);
    } finally {
      if (budget) budget.count += performance.now() - start;
    }
  }
  // Creates a profile in one of the user's saves (saveId) or in a new save (saveName). It is
  // calculated now and the snapshot stored; kind 'original' is refused (checkNewProfileKind), since
  // that profile type is retired (#387, #496). carryFrom names a sibling profile in the same save to start from
  // (copied, never moved) and built lists finished work; see newProfileState. The plan is the
  // one Review showed for these exact settings (reviewedPlans, #1060), else calculated, before the
  // commit; the save lookup and limits are checked inside it.
  async function createProfile({ req, user, body }: UserRequest) {
    limits.throttle(req);
    const input = await body();
    checkNewProfileKind(input.kind);
    const saveName = input.saveId ? null : name(input.saveName),
      profileName = name(input.name);
    const plan = reviewed.take(user.id, input.settings) ?? calculate(input.settings);
    const profileId = randomId();
    // A saveId that is not one of the user's save ids is refused inside the commit.
    let saveId = (input.saveId || randomId()) as string;
    const carried = await commit(draft => {
      let save = draft.saves.find(s => s.id === saveId && s.userId === user.id);
      if (input.saveId && !save) fail('Save not found.', 404);
      if (!save) {
        if (draft.saves.filter(s => s.userId === user.id).length >= 50)
          fail('You can create up to 50 saves.');
        save = {
          id: saveId,
          // Only null when saveId named an existing save.
          name: saveName as string,
          userId: user.id,
          activeProfile: profileId,
          profiles: [],
        };
        draft.saves.push(save);
      }
      if (save.profiles.length >= 30) fail('You can keep up to 30 profiles per save.');
      const source = input.carryFrom ? save.profiles.find(p => p.id === input.carryFrom) : null;
      if (input.carryFrom && !source)
        fail('The profile to carry progress from was not found.', 404);
      // A recalculation of a guided plan keeps its guide (#472).
      const started = calculatedProfile(
        profileId,
        profileName,
        plan,
        source,
        input.carry,
        input.built,
      );
      save.profiles.push(started.profile);
      save.activeProfile = profileId;
      draft.users.find(account => account.id === user.id)!.activeSave = saveId;
      return started;
    });
    return response(
      {
        saveId,
        profileId,
        reviewCount: carried.reviewCount,
        carriedChecks: carried.carried,
        workspace: currentSummary(user),
      },
      201,
    );
  }
  // Remembers the save and profile the user last opened; scope() checks both are theirs.
  async function selectProfile({ url, user, body }: UserRequest) {
    const { save, profile } = scopeNamed(await body(), url, user);
    await commit(draft => {
      draft.users.find(account => account.id === user.id)!.activeSave = save.id;
      draft.saves.find(s => s.id === save.id)!.activeProfile = profile.id;
    });
    return response(currentSummary(user));
  }
  // Permanently deletes one profile and its progress; needs confirmed: true. Removing a
  // save's last profile deletes the save too. The active save and profile are moved to
  // one that still exists.
  async function removeProfile({ url, user, body }: UserRequest) {
    const input = await body();
    if (input.confirmed !== true) fail('Confirm profile removal first.');
    if (!input.saveId || !input.profileId) fail('Choose a profile to remove.');
    const { save, profile } = scopeNamed(input, url, user);
    await commit(draft => {
      const draftSave = draft.saves.find(s => s.id === save.id && s.userId === user.id);
      if (!draftSave || !draftSave.profiles.some(p => p.id === profile.id))
        fail('Profile not found.', 404);
      draftSave.profiles = draftSave.profiles.filter(p => p.id !== profile.id);
      if (!draftSave.profiles.length) draft.saves = draft.saves.filter(s => s.id !== draftSave.id);
      else if (draftSave.activeProfile === profile.id)
        draftSave.activeProfile = draftSave.profiles[0]!.id;
      const owner = draft.users.find(account => account.id === user.id)!;
      if (!draft.saves.some(s => s.id === owner.activeSave && s.userId === user.id))
        owner.activeSave = draft.saves.find(s => s.userId === user.id)?.id || null;
    });
    return response(currentSummary(user));
  }
  // Renames the scoped save or profile (target 'save' or 'profile'). Only the display
  // name changes; ids, which progress hangs on, stay. The name is checked before the scope.
  async function rename({ req, url, user, body }: UserRequest) {
    const input = await body();
    const title = name(input.name);
    const { save, profile } = scope(req, url, user);
    await commit(draft => {
      const draftSave = draft.saves.find(s => s.id === save.id)!;
      if (input.target === 'save') draftSave.name = title;
      else if (input.target === 'profile')
        draftSave.profiles.find(p => p.id === profile.id)!.name = title;
      else fail('Unknown rename target.');
    });
    return response(currentSummary(user));
  }
  // "Keep the name" on a profile card's "Rename to …" offer (#1071, public/state/rename-offer.ts):
  // marks the scoped profile so the offer does not come back. Only the flag changes; the name,
  // plan and progress stay. Running it again changes nothing.
  async function dismissRenameOffer({ req, url, user, body }: UserRequest) {
    await body();
    const { save, profile } = scope(req, url, user);
    await commit(draft => {
      draft.saves
        .find(s => s.id === save.id)!
        .profiles.find(p => p.id === profile.id)!.renameOfferDismissed = true;
    });
    return response(currentSummary(user));
  }
  return {
    exportSaves,
    duplicateProfile,
    importSaves,
    preview,
    createProfile,
    selectProfile,
    removeProfile,
    rename,
    dismissRenameOffer,
  };
}
