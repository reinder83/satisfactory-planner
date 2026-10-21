// Grouped unlocks (#1197, expert mode, expert.ts): the build plan's HUB milestone and MAM research
// steps (`unlock-<schematic id>`, milestoneTasks in progression.ts) grouped by tier, MAM research
// as one group after the tiers, so an experienced player can mark a whole tier at once. A group's
// tick writes exactly the per-item checks: one `checks` update through the normal save path with
// the keys ticking each open item would tick (runningChange in group-running.ts, shared with a
// factory's "Mark all running"), and its untick only the group's own ticked items. Nothing new is
// stored and nothing is recalculated. Other steps (startup, power, production lines, hard drives,
// alternate recipe unlocks, personal tasks) are not grouped. No session imports: the build plan
// (ui/plan/Checklist.vue) passes its steps and the progression data.
import type { Progression, ProgressionEntry } from '../types/index.ts';
import type { RunningChange } from './group-running.ts';
import type { PlanStepView } from './tasks.ts';

const UNLOCK = 'unlock-';

export interface UnlockGroup<T> {
  // 'tier-<n>' or 'mam': a view key, never stored.
  key: string;
  label: string;
  items: T[];
}

// A group as the build plan draws it: every one of its steps in the phase (`keys`, which its tick
// writes, whatever the search, Hide completed or Required steps only show), how many are done, and
// the steps those filters show (`items`).
export interface UnlockGroupView {
  key: string;
  label: string;
  keys: string[];
  done: number;
  items: PlanStepView[];
}

// The milestones by schematic id, once per progression data.
const indexes = new WeakMap<Progression, Map<string, ProgressionEntry>>();
function entryOf(stepId: string, data: Progression): ProgressionEntry | undefined {
  let index = indexes.get(data);
  if (!index) indexes.set(data, (index = new Map(data.entries.map(entry => [entry.id, entry]))));
  return index.get(stepId.slice(UNLOCK.length));
}

// The group of a step: its HUB tier or MAM research for a milestone the progression data knows,
// null for any other step.
export function unlockGroupOf(
  stepId: string,
  data: Progression,
): { key: string; label: string; order: number } | null {
  if (!stepId.startsWith(UNLOCK)) return null;
  const entry = entryOf(stepId, data);
  if (!entry || entry.alternate) return null;
  return entry.mam
    ? { key: 'mam', label: 'MAM research', order: Number.MAX_SAFE_INTEGER }
    : { key: 'tier-' + entry.tier, label: 'Tier ' + entry.tier, order: entry.tier };
}

// The unlock steps of `steps` in their groups: tiers in ascending order, MAM research last, each
// group's items in the order of `steps` (the build plan's).
export function unlockGroups<T extends { id: string }>(
  steps: T[],
  data: Progression,
): UnlockGroup<T>[] {
  const groups = new Map<string, UnlockGroup<T> & { order: number }>();
  for (const step of steps) {
    const group = unlockGroupOf(step.id, data);
    if (!group) continue;
    if (!groups.has(group.key)) groups.set(group.key, { ...group, items: [] });
    groups.get(group.key)!.items.push(step);
  }
  return [...groups.values()]
    .sort((first, second) => first.order - second.order)
    .map(({ key, label, items }) => ({ key, label, items }));
}

const unlockCount = (count: number) => (count === 1 ? '1 unlock' : `${count} unlocks`);

// The group tick's words, for its label and the toast: "Tier 3 done".
export const groupDoneLabel = (label: string) => `${label} done`;

// What a group tick did, for the toast: "Tier 3 done: 4 unlocks ticked; 1 already was." or
// "Tier 3 not done: 5 unlocks unticked."
export function groupTickNews(change: RunningChange, label: string): string {
  if (!change.value) return `${label} not done: ${unlockCount(change.keys.length)} unticked.`;
  const already = change.already
    ? `; ${change.already} already ${change.already === 1 ? 'was' : 'were'}`
    : '';
  return `${label} done: ${unlockCount(change.keys.length)} ticked${already}.`;
}

// What its Undo did: "Undone: 4 unlocks of Tier 3 are back as they were." An item changed since
// the tick is left as it is, and the toast says so.
export function groupUndoNews(change: RunningChange, restored: number, label: string): string {
  if (!restored) return `Nothing to undo: the unlocks of ${label} were changed since.`;
  const kept = change.keys.length - restored;
  return (
    `Undone: ${unlockCount(restored)} of ${label} ${restored === 1 ? 'is' : 'are'} back as ` +
    `${restored === 1 ? 'it was' : 'they were'}` +
    (kept
      ? `; ${kept} changed since ${kept === 1 ? 'stays' : 'stay'} as ${kept === 1 ? 'it is' : 'they are'}.`
      : '.')
  );
}

// An item's title inside its group, without the group it repeats: "Tier 3: Coal Power" under
// Tier 3 is "Coal Power", "MAM: Caterium" under MAM research "Caterium". A title the user rewrote
// (taskEdits) is shown as it is unless it starts the same way.
export function itemTitle(title: string, groupKey: string): string {
  const prefix = groupKey === 'mam' ? 'MAM: ' : `Tier ${groupKey.slice('tier-'.length)}: `;
  return title.startsWith(prefix) && title.length > prefix.length
    ? title.slice(prefix.length)
    : title;
}
