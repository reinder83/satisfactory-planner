// The activity log (#1214, co-op slice 5 of #1077): the recent ticks of the open profile, newest
// first, as the Backup page's "Co-op progress" lists them (ui/backup/ActivityLog.vue). It is made
// only from what is saved already: the records of who ticked a step and when (`tickedBy`, #1206,
// app/ticked-by.ts) and the step titles the build plan shows. Nothing new is stored. A record is
// listed while its step is ticked and the plan still lists the step; a tick from before the
// records were kept has none, so it is not listed, and a record without a name lists as "Ticked".
//
// No session imports, so the node tests can import it.
import { sameOwner } from './mine.ts';
import { tickedAt } from './ticked-by.ts';
import type { TickRecord } from '../types/index.ts';

// How many entries the log shows at first, and how many more each "Show more" adds.
export const ACTIVITY_PAGE = 50;

// A step the log can name and jump to: its check key, its title as the build plan shows it, and
// the phase whose build plan lists it.
export interface LoggedStep {
  id: string;
  title: string;
  phase: string;
}
// One tick in the log: the step, and who ticked it (absent without a name) and when (ISO, UTC).
export interface ActivityEntry extends LoggedStep {
  at: string;
  by?: string;
}

type TickedProgress = { checks: Record<string, boolean>; tickedBy?: Record<string, TickRecord> };

// The ticks `progress` has a record of, newest first, for the steps of `steps` (in plan order; the
// first listing of a step id names it). Left out: a record of a step that is not ticked, of a step
// `steps` does not list (removed from the plan, or gone in a recalculation) and of a time that does
// not read as one. With `person`, only that person's ticks (the same name once trimmed, any case,
// as "Mine only" compares owners). Ticks made at the same moment (a "Mark all running") keep the
// plan's order.
export function activityEntries(
  progress: TickedProgress,
  steps: readonly LoggedStep[],
  person = '',
): ActivityEntry[] {
  const listed = new Map<string, { step: LoggedStep; place: number }>();
  steps.forEach((step, place) => {
    if (!listed.has(step.id)) listed.set(step.id, { step, place });
  });
  const ticks = Object.entries(progress.tickedBy || {}).flatMap(([key, record]) => {
    const found = listed.get(key);
    const time = Date.parse(record.at);
    if (!found || progress.checks[key] !== true || Number.isNaN(time)) return [];
    if (person && !sameOwner(record.by, person)) return [];
    const entry: ActivityEntry = {
      ...found.step,
      at: record.at,
      ...(record.by ? { by: record.by } : {}),
    };
    return [{ entry, time, place: found.place }];
  });
  ticks.sort((a, b) => b.time - a.time || a.place - b.place);
  return ticks.map(tick => tick.entry);
}

// The names in a log, each once whatever its case (the spelling of that person's newest tick), in
// alphabetical order: the person filter's choices.
export function activityPeople(entries: readonly ActivityEntry[]): string[] {
  const people = new Map<string, string>();
  for (const entry of entries) {
    const key = entry.by?.trim().toLocaleLowerCase();
    if (key && !people.has(key)) people.set(key, entry.by!.trim()); // `key` says `by` is set.
  }
  return [...people.values()].sort((a, b) => a.localeCompare(b));
}

// Who ticked it, as an entry opens: "Anna ticked", or "Ticked" without a name.
export const activityWho = (entry: ActivityEntry): string =>
  entry.by ? `${entry.by} ticked` : 'Ticked';

// An entry as one sentence: "Anna ticked Build 4 Constructors (Iron Plate), Oct 21, 2:05 PM", the
// date and time in the locale's own format.
export const activityWords = (entry: ActivityEntry, now = new Date(), locale?: string): string =>
  `${activityWho(entry)} ${entry.title}, ${tickedAt(entry.at, now, locale)}`;
