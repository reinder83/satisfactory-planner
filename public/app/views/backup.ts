import type { HandbookOrigin } from '../../types/index.ts';

// How old the browser edition's last full backup is (SP-40, #275): workspace.lastBackup, the
// time of the last "Export all saves" in this browser (browser-api.ts). The Backup page shows
// it as a status and the sidebar repeats a short version under the save indicator; ADA's
// reminders count the same days. Worked out on every render, so the age moves on without a
// reload. The Docker edition sends no lastBackup: its saves are on the server.

// A week without a full backup, or none at all, is shown in the warn tone.
export const STALE_BACKUP_DAYS = 7;

export interface BackupAge {
  // Whole days since the last full backup, null when there has been none.
  days: number | null;
  // "Backed up 15 days ago", "Backed up today", "Never backed up".
  text: string;
  // For the sidebar: "Backed up 15d ago".
  short: string;
  stale: boolean;
}

export function backupDays(lastBackup: string | null | undefined, now = Date.now()) {
  if (!lastBackup) return null;
  const backedUpAt = new Date(lastBackup).getTime();
  return Number.isNaN(backedUpAt) ? null : Math.max(0, Math.floor((now - backedUpAt) / 86400000));
}

export function backupAge(lastBackup: string | null | undefined, now = Date.now()): BackupAge {
  const days = backupDays(lastBackup, now);
  if (days === null)
    return { days, text: 'Never backed up', short: 'Never backed up', stale: true };
  const ago = days === 0 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago';
  return {
    days,
    text: 'Backed up ' + ago,
    short: 'Backed up ' + (days > 1 ? days + 'd ago' : ago),
    stale: days > STALE_BACKUP_DAYS,
  };
}

// What the Backup page says after a progress backup is restored (#760). Restoring an old
// backup onto a profile moved from the original plan can keep some of its ticks, notes and
// group assignments for review (handbookOrigin.unmapped, restoreProgress in
// handbook-migration.ts), shown on the Notes page under "From the original plan". Only the
// records the restore newly put there or changed count: a key the review list did not show
// before, or one whose tick, note text or group assignments are now different (#769), since the
// user should look at that record again. Both editions reply to /api/import with the restored
// state, so `before` is the state the page had and `after` that reply.
type Reviewable = { handbookOrigin?: HandbookOrigin };
// Whether two saved values (a tick, a note, a list of group assignments) are the same, whatever
// the order of an object's keys.
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  // Both are objects or both arrays (checked above), read by their own keys.
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
  );
}
export function newlyForReview(before: Reviewable, after: Reviewable): number {
  const had = before.handbookOrigin?.unmapped;
  const now = after.handbookOrigin?.unmapped;
  if (!now) return 0;
  let count = 0;
  for (const kind of ['checks', 'notes', 'assignments'] as const)
    for (const [key, value] of Object.entries(now[kind]))
      if (!had || !Object.hasOwn(had[kind], key) || !sameValue(had[kind][key], value)) count++;
  return count;
}
export function restoreMessage(before: Reviewable, after: Reviewable): string {
  const count = newlyForReview(before, after);
  if (!count) return 'Backup restored.';
  return count === 1
    ? 'Backup restored. 1 item from the original plan needs your review in Notes.'
    : `Backup restored. ${count} items from the original plan need your review in Notes.`;
}
