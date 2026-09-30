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
