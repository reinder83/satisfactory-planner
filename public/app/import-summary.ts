// What an import holds and what it will do (#1217, the last slice of #1077): the Backup page asks
// before "Import saves…" adds copies and before "Restore this profile…" replaces the open
// profile's progress, and the question says what is in the file (its saves and profiles, each
// profile's phase and steps done, the export date) and what the import does with it ("adds a copy
// next to your 3 profiles", "replaces the progress of “Main”: 412 of 980 steps done now, 380 in
// the file").
//
// Each question is built only after the file passed the checks the import itself runs, so a
// damaged file or one from a newer planner is refused here with the message the import would
// give, and no question is asked: a full save export goes through labelImport and
// validateTransfer as the import sends it (transfer.ts), a progress backup through the Docker
// server's checks of /api/import (importProgress in server/profile-routes.ts: the format, the
// profile it belongs to, then validateState). Nothing is changed or stored here; the import
// itself still runs only after the question's confirm button, exactly as before.
//
// "Steps done" counts a plan's build-plan steps over every phase the profile offers, ticked or
// done by their own condition, as the profile card's progress bar does (profilePhases in
// state/summary.ts). A profile without a plan (an export from before the original profile type
// was retired) has its ticks counted instead.
//
// This module reads no session state, so the node tests import it; the Backup page
// (ui/pages/BackupPage.vue) hands it the workspace, the open profile and progression.json.
import { profilePhases, validateState } from '../state.ts';
import { labelImport, localStamp, validateTransfer } from '../transfer.ts';
import { restoreProgress } from '../handbook-migration.ts';
import { plural } from './format.ts';
import type {
  Progression,
  ProgressState,
  SavedState,
  StoredCalculatedPlan,
  WorkspaceSummary,
} from '../types/index.ts';
import type { ConfirmOptions } from './ui/confirm.ts';

// The progress backup's format (GET /api/export in both editions).
const BACKUP_FORMAT = 'satisfactory-planner-backup';
// The Docker server's refusals of a progress backup (importProgress in server/profile-routes.ts),
// word for word, so a refused file reads as it did before the question was added (tested against
// the server in tests/import-summary.test.ts).
export const WRONG_BACKUP_FORMAT = 'Wrong backup format.';
export const OTHER_PROFILE_BACKUP =
  'This backup belongs to another profile. Switch to that profile before restoring.';
// The most profiles an import question lists one by one; the rest are folded under a summary.
const LISTED_PROFILES = 12;

// What the questions read besides the file.
export interface ImportContext {
  // The chosen file's name, which the copies are named after.
  fileName: string;
  // progression.json, which the step counts read; without it only ticks are counted.
  progression: Progression | null | undefined;
  // "Phase 3", "Post Phase 5" (phaseLabel in app/session.ts).
  phaseLabel: (phase: string) => string;
}

// A profile's progress in words: "Phase 3, 412 of 980 steps done", or "Phase 3, 30 ticked"
// without a plan (or without progression.json).
export function progressText(
  plan: StoredCalculatedPlan | null | undefined,
  state: SavedState,
  context: Pick<ImportContext, 'progression' | 'phaseLabel'>,
): string {
  const phase = context.phaseLabel(state.settings.phase);
  const steps = stepsDone(plan, state, context.progression);
  if (!steps) return `${phase}, ${Object.values(state.checks).filter(Boolean).length} ticked`;
  return `${phase}, ${steps.done} of ${plural(steps.total, 'step')} done`;
}

// The build-plan steps of `plan` done in `state`, over every phase the profile offers: the counts
// of profilePhases with no phase worked on, which gives every phase its steps.
function stepsDone(
  plan: StoredCalculatedPlan | null | undefined,
  state: SavedState,
  progression: Progression | null | undefined,
): { done: number; total: number } | null {
  if (!plan || !progression) return null;
  const { settings: _working, ...progress } = state;
  const phases = profilePhases(plan, progress, progression) || [];
  const steps = phases.reduce(
    (sum, entry) => ({
      done: sum.done + (entry.steps?.done ?? 0),
      total: sum.total + (entry.steps?.total ?? 0),
    }),
    { done: 0, total: 0 },
  );
  // A plan without steps to count ("0 of 0") says nothing; its ticks are counted instead.
  return steps.total ? steps : null;
}

const fileRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

// "Import saves…": the question for a full save export (all saves, a selection, one profile or a
// share), after checking a labelled copy of it as the import will send it. `workspace` is the
// user's saves now. Throws the import's own refusal for a file it would refuse.
export function savesImportQuestion(
  data: unknown,
  workspace: Pick<WorkspaceSummary, 'saves'>,
  context: ImportContext,
): ConfirmOptions {
  const labelled = structuredClone(data);
  labelImport(
    labelled,
    context.fileName,
    workspace.saves.map(save => save.name),
  );
  const { saves } = validateTransfer(labelled);
  // validateTransfer accepted the file, so it is an object with a list of saves, each with a
  // name; the list shows each save's own name, and the note the name its copy gets.
  const named = fileRecord(data) && Array.isArray(data.saves) ? data.saves : [];
  const ownName = (index: number) => {
    const save: unknown = named[index];
    return fileRecord(save) && typeof save.name === 'string' ? save.name.trim() : '';
  };
  const exported = fileRecord(data) ? localStamp(data.exportedAt) : '';
  const profiles = saves.flatMap((save, index) =>
    save.profiles.map(profile => ({ save: ownName(index), profile })),
  );
  const lines = profiles.map(
    ({ save, profile }) =>
      (saves.length > 1 ? `${save} · ${profile.name}` : profile.name) +
      ': ' +
      progressText(profile.plan, profile.state, context),
  );
  const one = saves.length === 1;
  const holds = one
    ? `the save “${ownName(0)}” with ${plural(profiles.length, 'profile')}`
    : `${plural(saves.length, 'save')} with ${plural(profiles.length, 'profile')}`;
  const own = workspace.saves.reduce((sum, save) => sum + save.profiles.length, 0);
  const copies = one ? `a new copy, “${saves[0]!.name}”,` : 'new copies named after the file,';
  return {
    title: one ? 'Import this save?' : 'Import these saves?',
    body: `${context.fileName} holds ${holds}${exported ? ', exported ' + exported : ''}:`,
    list: lines.slice(0, LISTED_PROFILES),
    ...(lines.length > LISTED_PROFILES
      ? {
          folded: {
            summary: plural(lines.length - LISTED_PROFILES, 'more profile'),
            items: lines.slice(LISTED_PROFILES),
          },
        }
      : {}),
    note: own
      ? `Importing adds ${one ? 'it' : 'them'} as ${copies} next to your ${plural(own, 'profile')}. Nothing you have is replaced, and you stay on the profile you have open.`
      : `Importing adds ${one ? 'it' : 'them'} as ${copies} and opens ${one ? 'it' : 'the last one'}, since you have no saves yet.`,
    confirmLabel: 'Import saves',
  };
}

// The profile a progress backup would be restored onto: the open one.
export interface RestoreTarget {
  id: string;
  name: string;
  plan: StoredCalculatedPlan | null | undefined;
  state: ProgressState;
}

// "Restore this profile…": the question for a progress backup (or a bare state, which /api/import
// takes too), after the server's checks of it. Its progress is counted as it would be restored
// onto the open profile (restoreProgress, which re-keys a backup made before a migration from the
// original plan). Throws the server's own refusal for a file it would refuse.
export function backupQuestion(
  data: unknown,
  target: RestoreTarget,
  context: ImportContext,
): ConfirmOptions {
  const backup = fileRecord(data) ? data : null;
  if (backup?.format && backup.format !== BACKUP_FORMAT) throw Error(WRONG_BACKUP_FORMAT);
  if (backup?.profileId && backup.profileId !== target.id) throw Error(OTHER_PROFILE_BACKUP);
  const restored = restoreProgress(
    target.state,
    validateState(backup?.format ? backup.state : data),
  );
  const now = stepsDone(target.plan, target.state, context.progression);
  const after = stepsDone(target.plan, restored, context.progression);
  const ticks = (state: SavedState) => Object.values(state.checks).filter(Boolean).length;
  const compared =
    now && after
      ? `${now.done} of ${plural(now.total, 'step')} done now, ${after.done} in the file`
      : `${ticks(target.state)} ticked now, ${ticks(restored)} in the file`;
  const phaseNow = context.phaseLabel(target.state.settings.phase);
  const phaseAfter = context.phaseLabel(restored.settings.phase);
  const details = [
    backup?.format ? backupSource(backup) : '',
    phaseAfter === phaseNow ? '' : `It works on ${phaseAfter}, this profile now on ${phaseNow}.`,
    'Its notes, deliveries and personal tasks replace this profile’s too. The plan stays as it is.',
  ];
  return {
    title: 'Restore this backup?',
    body: `This replaces the progress of “${target.name}”: ${compared}.`,
    note: details.filter(Boolean).join(' '),
    confirmLabel: 'Replace progress',
    danger: true,
  };
}

// Where a progress backup came from, as far as it says: "The file is a backup of “World / Main”,
// exported 2026-10-21 14:05."
function backupSource(backup: Record<string, unknown>): string {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const names = [text(backup.saveName), text(backup.profileName)].filter(Boolean).join(' / ');
  const exported = localStamp(backup.exportedAt);
  if (!names && !exported) return '';
  return (
    'The file is a backup' +
    (names ? ` of “${names}”` : '') +
    (exported ? `, exported ${exported}` : '') +
    '.'
  );
}
