// Co-op progress (#1160, the first slice of #1077): a ticks-only progress export, and merging a
// friend's ticks into the open profile from a file, with a preview first.
//
// The export is a small file of its own format, `satisfactory-planner-ticks`, version 1:
//   { format, version: 1, exportedAt, saveName, profileName, ticks: [check id, …], tickedBy? }
// with the ids of the profile's ticked checks (`state.checks` set to true), sorted, and who ticked
// them and when where the profile knows it (#1206: `tickedBy`, { check id: { at, by? } }, only
// with a record; a release before it reads the file and merges the ticks without them). No plan,
// settings, notes or deliveries: it is not a backup and nothing imports it as one.
//
// A merge reads that file, or the ticks of a progress backup (`satisfactory-planner-backup`, the
// Docker edition's "Download this profile") or of a full save export holding one profile
// (`satisfactory-planner-saves`), and ticks in the open profile every step the file ticks that
// this profile's plan lists and has not ticked yet: a union, so nothing is ever unticked, and the
// plan is never recalculated. Step ids are stable (AGENTS.md), so the same plan's steps carry from
// one copy to another. An id this plan does not list is skipped and listed in the preview. The
// merge is one `checks` update per thousand ids through the usual save queue (save() in api.ts),
// so both editions store it as they store any tick. Each update carries the file's own records of
// who ticked those steps and when (#1206, mergeUpdate), never the merging device's: a step the
// file has no record for is ticked without one.
//
// This module reads no session state, so the node tests import it; the Backup page's panel
// (ui/backup/ProgressMerge.vue) hands it the open profile's ticks and step ids.
import { safeKey, validateState, validateTickedBy } from '../state.ts';
import { transferFormat, validateTransfer } from '../transfer.ts';
import { recordsFor } from './ticked-by.ts';
import type { TickRecord, UpdateOp } from '../types/index.ts';
import type { ConfirmOptions } from './ui/confirm.ts';

export const TICKS_FORMAT = 'satisfactory-planner-ticks';
export const TICKS_VERSION = 1;
// The progress backup's format (GET /api/export in both editions).
const BACKUP_FORMAT = 'satisfactory-planner-backup';
// As many ids as a state may hold checks (validateState).
const MAX_TICKS = 20000;
// The most ids one `checks` update takes (setChecks in state/mutate.ts).
export const MERGE_CHUNK = 1000;
// The most skipped ids the preview lists by name; the rest are counted.
const LISTED_SKIPPED = 50;

export interface TicksExport {
  format: typeof TICKS_FORMAT;
  version: typeof TICKS_VERSION;
  exportedAt: string;
  saveName: string;
  profileName: string;
  ticks: string[];
  // Who ticked them and when (#1206), for the ticks that have a record; absent when none has.
  tickedBy?: Record<string, TickRecord>;
}

// The ids of the ticked checks, sorted.
export const tickedIds = (checks: Record<string, boolean>): string[] =>
  Object.keys(checks)
    .filter(id => checks[id] === true)
    .sort();

export function ticksExport(
  checks: Record<string, boolean>,
  saveName: string,
  profileName: string,
  now = new Date(),
  tickedBy?: Record<string, TickRecord>,
): TicksExport {
  const ticks = tickedIds(checks),
    records = recordsFor(tickedBy, ticks);
  return {
    format: TICKS_FORMAT,
    version: TICKS_VERSION,
    exportedAt: now.toISOString(),
    saveName,
    profileName,
    ticks,
    ...(Object.keys(records).length ? { tickedBy: records } : {}),
  };
}

// The export's file name: "satisfactory-ticks-<profile>.json", the profile's name in lower case
// with anything but letters and digits as dashes.
export function ticksFileName(profileName: string): string {
  const name = profileName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');
  return `satisfactory-ticks-${name || 'profile'}.json`;
}

// What a merge read from a file: the ids it ticks, and who and when where the file says so.
export interface ProgressSource {
  kind: 'ticks' | 'backup' | 'saves';
  saveName: string;
  profileName: string;
  exportedAt: string;
  ticks: string[];
  // Who ticked them and when (#1206), for the ticks the file has a record for.
  tickedBy: Record<string, TickRecord>;
}

export const NOT_PROGRESS =
  'This file is not a progress export, so nothing was merged. Choose a file from “Export ticks”, a progress backup or a save export.';
const NEWER_TICKS =
  'This progress file was made by a newer planner version, so nothing was merged. Update the app to merge it.';
const DAMAGED_TICKS =
  'This progress file is damaged, so nothing was merged. Ask for a new “Export ticks” file.';

const fileRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const fileText = (value: unknown): string => (typeof value === 'string' ? value : '');

// Reads a parsed file as a progress source, or throws an Error whose message the page shows.
// Nothing is changed either way.
export function readProgressFile(data: unknown): ProgressSource {
  if (!fileRecord(data)) throw Error(NOT_PROGRESS);
  if (data.format === TICKS_FORMAT) return readTicks(data);
  if (data.format === BACKUP_FORMAT) return readBackup(data);
  if (data.format === transferFormat) return readSaves(data);
  throw Error(NOT_PROGRESS);
}

function readTicks(data: Record<string, unknown>): ProgressSource {
  if (typeof data.version === 'number' && data.version > TICKS_VERSION) throw Error(NEWER_TICKS);
  if (
    data.version !== TICKS_VERSION ||
    !Array.isArray(data.ticks) ||
    data.ticks.length > MAX_TICKS ||
    data.ticks.some(id => typeof id !== 'string')
  )
    throw Error(DAMAGED_TICKS);
  // Checked above: every entry is a string.
  const ticks = [...new Set(data.ticks as string[])];
  return {
    kind: 'ticks',
    saveName: fileText(data.saveName),
    profileName: fileText(data.profileName),
    exportedAt: fileText(data.exportedAt),
    ticks,
    tickedBy: fileRecords(data.tickedBy, ticks),
  };
}
// A ticks file's records of who ticked (#1206), for the ids it ticks; a malformed one makes the
// file damaged, as a malformed tick does.
function fileRecords(raw: unknown, ticks: string[]): Record<string, TickRecord> {
  try {
    return validateTickedBy(raw, Object.fromEntries(ticks.map(id => [id, true]))) || {};
  } catch {
    throw Error(DAMAGED_TICKS);
  }
}

// A progress backup's state goes through validateState, so an older version is read as an import
// reads it (old unlock keys merged) and a newer one is refused with its update message.
function readBackup(data: Record<string, unknown>): ProgressSource {
  const state = validateState(data.state);
  return {
    kind: 'backup',
    saveName: fileText(data.saveName),
    profileName: fileText(data.profileName),
    exportedAt: fileText(data.exportedAt),
    ticks: tickedIds(state.checks),
    tickedBy: state.tickedBy || {},
  };
}

// A full save export is checked as an import checks it (validateTransfer, which validates each
// profile's state). Only a file with one profile says whose ticks to take.
function readSaves(data: Record<string, unknown>): ProgressSource {
  const saves = validateTransfer(data).saves;
  const profiles = saves.flatMap(save => save.profiles.map(profile => ({ save, profile })));
  if (profiles.length !== 1)
    throw Error(
      `This save export holds ${profiles.length} profiles, so it does not say whose ticks to merge. Ask for “Export ticks” from the one profile instead.`,
    );
  // One profile, checked just above.
  const { save, profile } = profiles[0]!;
  return {
    kind: 'saves',
    saveName: save.name,
    profileName: profile.name,
    exportedAt: fileText(data.exportedAt),
    ticks: tickedIds(profile.state.checks),
    tickedBy: profile.state.tickedBy || {},
  };
}

// The steps a merge may tick, in the order the preview counts them: one group per phase of the
// open profile ("Phase 1", with that phase's build-plan step ids) and the storage room's container
// steps. An id two groups list counts under the first.
export interface MergeGroup {
  label: string;
  // What one of its ids is called in the preview's count: "step", "container step".
  unit: string;
  ids: readonly string[];
}

export interface MergePreview {
  // The ids the merge ticks: listed in a group and not ticked here yet, in the file's order.
  newIds: string[];
  // How many of them each group gets, groups with none left out.
  perGroup: { label: string; unit: string; count: number }[];
  // Ids the file ticks that are ticked here already.
  already: number;
  // Ids the file ticks that no group lists: skipped.
  skipped: string[];
}

export function mergePreview(
  ticks: readonly string[],
  checks: Record<string, boolean>,
  groups: readonly MergeGroup[],
): MergePreview {
  const groupOf = new Map<string, number>();
  groups.forEach((group, index) => {
    for (const id of group.ids) if (!groupOf.has(id)) groupOf.set(id, index);
  });
  const counts = groups.map(() => 0),
    newIds: string[] = [],
    skipped: string[] = [];
  let already = 0;
  for (const id of new Set(ticks)) {
    const index = safeKey(id) ? groupOf.get(id) : undefined;
    if (index === undefined) skipped.push(id);
    else if (checks[id] === true) already++;
    else {
      newIds.push(id);
      counts[index]!++;
    }
  }
  return {
    newIds,
    perGroup: groups
      .map((group, index) => ({ label: group.label, unit: group.unit, count: counts[index]! }))
      .filter(entry => entry.count),
    already,
    skipped,
  };
}

const counted = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

// Who and when, as the file says: "Anna's base / Anna, exported 14/10/2026, 14:05:00".
export function sourceWords(source: ProgressSource, date = localDate): string {
  const who = [source.saveName, source.profileName].filter(Boolean).join(' / ');
  const when = date(source.exportedAt);
  const kind =
    source.kind === 'ticks'
      ? 'a ticks export'
      : source.kind === 'backup'
        ? 'a progress backup'
        : 'a save export';
  return kind + (who ? ` of ${who}` : '') + (when ? `, exported ${when}` : '');
}
function localDate(iso: string): string {
  if (!iso) return '';
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? '' : time.toLocaleString();
}

// Why a file merges nothing, or null when it has something to merge.
export function nothingToMerge(source: ProgressSource, preview: MergePreview): string | null {
  if (!source.ticks.length) return 'This file has no ticked steps, so there is nothing to merge.';
  if (preview.newIds.length) return null;
  const parts = [
    preview.already
      ? `${counted(preview.already, 'step')} it ticks ${preview.already === 1 ? 'is' : 'are'} ticked here already`
      : '',
    preview.skipped.length
      ? `${counted(preview.skipped.length, 'step')} ${preview.skipped.length === 1 ? 'is' : 'are'} not in this plan`
      : '',
  ].filter(Boolean);
  return `Nothing new to merge: ${parts.join(', and ')}.`;
}

// The preview, as the confirmation asks it: the file, what the merge ticks per group, what is
// ticked already and the skipped ids.
export function mergeQuestion(
  fileName: string,
  source: ProgressSource,
  preview: MergePreview,
  date = localDate,
): ConfirmOptions {
  const count = preview.newIds.length;
  const skipped = preview.skipped;
  return {
    title: 'Merge this progress?',
    body:
      `“${fileName}” is ${sourceWords(source, date)}. ` +
      `Merging ticks ${counted(count, 'step')} here that ${count === 1 ? 'is' : 'are'} not ticked yet. ` +
      'Nothing is unticked, and the plan stays as it is.',
    list: preview.perGroup.map(group => `${group.label}: ${counted(group.count, group.unit)}`),
    ...(preview.already
      ? { note: `Already ticked here: ${counted(preview.already, 'step')}.` }
      : {}),
    ...(skipped.length
      ? {
          folded: {
            summary: `Skipped: ${counted(skipped.length, 'step')} not in this plan`,
            items:
              skipped.length > LISTED_SKIPPED
                ? [
                    ...skipped.slice(0, LISTED_SKIPPED),
                    `and ${skipped.length - LISTED_SKIPPED} more`,
                  ]
                : skipped,
          },
        }
      : {}),
    confirmLabel: `Merge ${counted(count, 'tick')}`,
  };
}

// The ids a merge sends, in `checks` updates of at most MERGE_CHUNK ids each; ids ticked since
// the preview are left out.
export function mergeChunks(
  newIds: readonly string[],
  checks: Record<string, boolean>,
): string[][] {
  const ids = newIds.filter(id => checks[id] !== true),
    chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += MERGE_CHUNK) chunks.push(ids.slice(i, i + MERGE_CHUNK));
  return chunks;
}

// The update that merges one chunk: its ids ticked, with the file's records of who ticked them
// and when (#1206). `tickedBy` is always sent, empty too, so save() never adds this device's own.
export const mergeUpdate = (
  keys: string[],
  source: Pick<ProgressSource, 'tickedBy'>,
): Extract<UpdateOp, { type: 'checks' }> => ({
  type: 'checks',
  keys,
  value: true,
  tickedBy: recordsFor(source.tickedBy, keys),
});

// The toast after a merge.
export const mergedMessage = (count: number, fileName: string): string =>
  `Merged ${counted(count, 'tick')} from “${fileName}”. Nothing was unticked.`;
