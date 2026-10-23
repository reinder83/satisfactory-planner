// "Ticked by" (#1206, co-op slice 3 of #1077): who ticked a step and when. Every tick this page
// saves of a step not ticked yet carries this device's "Your name" (app/mine.ts, when one is set)
// and the time: save() in api.ts adds it to each `check` and `checks` update that ticks
// (tickStamped), so a single tick, a factory's "Mark all running", an unlock group's tick and the
// storage room's steps record the same who and when for each step they tick. The co-op merge
// (ui/backup/ProgressMerge.vue) sends the file's own records instead (`tickedBy`), and never this
// device's. The records are saved per check key in `tickedBy` (state version 21, only while one is
// there, validateTickedBy in state/validate.ts); unticking a step drops its record, and ticks made
// before this change have none, so they show nothing. A ticked step says it quietly under its
// title: "Ticked by Anna, 21 Oct" (tickedWords). Nothing is recalculated.
//
// No session imports, so the node tests can import it.
import { meName } from './mine.ts';
import type { TickRecord, UpdateOp } from '../types/index.ts';

// Who ticks now and when: this device's name, if any, and the time.
export function tickStamp(now = new Date()): TickRecord {
  const by = meName();
  return { at: now.toISOString(), ...(by ? { by } : {}) };
}

// `operation` with who ticks and when added, when it ticks (value true) and names neither: every
// other update goes as it is.
export function tickStamped(operation: UpdateOp, now = new Date()): UpdateOp {
  if (operation.type === 'check' && operation.value === true && !operation.ticked)
    return { ...operation, ticked: tickStamp(now) };
  if (
    operation.type === 'checks' &&
    operation.value === true &&
    !operation.ticked &&
    !operation.tickedBy
  )
    return { ...operation, ticked: tickStamp(now) };
  return operation;
}

// The records `tickedBy` holds for `keys`, for a merge's `checks` update.
export function recordsFor(
  tickedBy: Record<string, TickRecord> | undefined,
  keys: readonly string[],
): Record<string, TickRecord> {
  return Object.fromEntries(keys.flatMap(key => (tickedBy?.[key] ? [[key, tickedBy[key]]] : [])));
}

// The day and month of `time` in the locale's own order, with the year when it is not `now`'s.
const dayParts = (time: Date, now: Date): Intl.DateTimeFormatOptions => ({
  day: 'numeric',
  month: 'short',
  ...(time.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
});

// A record as a ticked step says it: "Ticked by Anna, 21 Oct", or "Ticked 21 Oct" without a name,
// the day and month in the locale's own order, with the year when it is not this year's. '' for a
// time that does not read as one.
export function tickedWords(record: TickRecord, now = new Date(), locale?: string): string {
  const time = new Date(record.at);
  if (Number.isNaN(time.getTime())) return '';
  const day = time.toLocaleDateString(locale, dayParts(time, now));
  return record.by ? `Ticked by ${record.by}, ${day}` : `Ticked ${day}`;
}

// When a record says its step was ticked, with the time of day, as the activity log (#1214) lists
// it: "Oct 21, 2:05 PM" in en-US, "21 okt, 14:05" in Dutch, with the year when it is not this
// year's. '' for a time that does not read as one.
export function tickedAt(at: string, now = new Date(), locale?: string): string {
  const time = new Date(at);
  if (Number.isNaN(time.getTime())) return '';
  return time.toLocaleString(locale, {
    ...dayParts(time, now),
    hour: 'numeric',
    minute: '2-digit',
  });
}

// What step `key` says about its tick in a state: its record's words while it is ticked, else ''.
export function tickedNote(
  progress: { checks: Record<string, boolean>; tickedBy?: Record<string, TickRecord> },
  key: string,
  now = new Date(),
): string {
  const record = progress.checks[key] === true ? progress.tickedBy?.[key] : undefined;
  return record ? tickedWords(record, now) : '';
}
