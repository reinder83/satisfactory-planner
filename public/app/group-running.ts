// "Mark all running" on a factory (#1163, the first slice of #1079): one action that marks every
// production line of a factory group running in the phase shown, and its reverse once all of them
// are, instead of ticking each card's Running box. It writes exactly what those boxes write, the
// `calc-<phase>-<row id>` checks, in one `checks` update through the normal save path: nothing new
// is stored and nothing is recalculated. A line already marked running is not sent, so its tick
// stays, and lines outside the group are never named. Undo puts each line it changed back as it
// was: ticked, deliberately unticked (`false`) or never ticked (forgotten with `value: null`), and
// only while the line still has the value the action gave it, so a box changed since is left
// alone. No session imports: ui/factories/GroupRunning.vue passes the plan's rows and the ticks.
import type { GroupAssignment, UpdateOp } from '../types/index.ts';

type ChecksUpdate = Extract<UpdateOp, { type: 'checks' }>;

// What one press changes: the keys sent, the value they get, each key's record before (null when
// it had none), and the counts the toast gives.
export interface RunningChange {
  keys: string[];
  value: boolean;
  previous: Record<string, boolean | null>;
  // The factory's lines in the phase, and those already marked as the action marks them.
  lines: number;
  already: number;
}

// The Running checks of the group's lines in the phase `stageKey`: every row with a membership in
// the group, as the factories page draws its cards there (GroupSections.vue), whatever the search
// or the status chips show.
export function groupRunningKeys(
  rows: { id: string }[],
  groupId: string,
  membershipsOf: (rowId: string) => GroupAssignment[],
  stageKey: string,
): string[] {
  return rows
    .filter(row => membershipsOf(row.id).some(member => member.group === groupId))
    .map(row => `calc-${stageKey}-${row.id}`);
}

// The change one press makes: mark the lines running while any is not, otherwise mark them all
// not running. Null for a factory without lines.
export function runningChange(
  keys: string[],
  checks: Record<string, boolean>,
): RunningChange | null {
  if (!keys.length) return null;
  const value = keys.some(key => checks[key] !== true);
  const changed = keys.filter(key => (checks[key] === true) !== value);
  return {
    keys: changed,
    value,
    previous: Object.fromEntries(
      changed.map(key => [key, Object.hasOwn(checks, key) ? checks[key]! : null]),
    ),
    lines: keys.length,
    already: keys.length - changed.length,
  };
}

// The updates that undo `change` on the ticks as they are now: one `checks` update per earlier
// record (ticked, unticked, none), for the keys that still have the value the change gave them.
export function undoUpdates(
  change: RunningChange,
  checks: Record<string, boolean>,
): ChecksUpdate[] {
  const unchanged = change.keys.filter(key => (checks[key] === true) === change.value);
  return ([true, false, null] as const)
    .map(value => ({
      type: 'checks' as const,
      keys: unchanged.filter(key => change.previous[key] === value),
      value,
    }))
    .filter(update => update.keys.length);
}

const lineCount = (count: number) => (count === 1 ? '1 line' : `${count} lines`);

// The button's own words and its accessible name, which names the factory.
export function runningAction(change: RunningChange, name: string) {
  const state = change.value ? 'running' : 'not running';
  return {
    label: `Mark all ${state}`,
    aria: `Mark all ${lineCount(change.lines)} of ${name} ${state}`,
  };
}

// What a press did, for the toast: "Marked 9 lines of Iron works running; 2 already were."
export function runningNews(change: RunningChange, name: string): string {
  const state = change.value ? 'running' : 'not running';
  const already = change.already ? `; ${change.already} already ${verb(change.already)}` : '';
  return `Marked ${lineCount(change.keys.length)} of ${name} ${state}${already}.`;
}
const verb = (count: number) => (count === 1 ? 'was' : 'were');

// What its Undo did: "Undone: 9 lines of Iron works are back as they were." A line changed since
// the press is left as it is, and the toast says so.
export function undoNews(change: RunningChange, restored: number, name: string): string {
  if (!restored) return `Nothing to undo: the lines of ${name} were changed since.`;
  const kept = change.keys.length - restored;
  return (
    `Undone: ${lineCount(restored)} of ${name} ${restored === 1 ? 'is' : 'are'} back as ` +
    `${restored === 1 ? 'it was' : 'they were'}` +
    (kept
      ? `; ${kept} changed since ${kept === 1 ? 'stays' : 'stay'} as ${kept === 1 ? 'it is' : 'they are'}.`
      : '.')
  );
}
