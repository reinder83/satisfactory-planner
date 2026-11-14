// What a saved change tells ADA (#1353): the events behind her event-triggered remarks. save() in
// api.ts hands each finished update here with the progress before and after it, and ada-panel.ts
// decides whether she says anything (her chatter setting, the per-session cap and de-duplicating
// are there). Pure: no session state, so the node tests can import it.
import type { AdaEventKind, AdaEventParams } from '../ada.ts';
import type { Phase, ProgressState, UpdateOp } from '../types/index.ts';

export interface AdaEventCall {
  kind: AdaEventKind;
  params: AdaEventParams;
}

// How an event names what changed, from the planner's own data (the panel supplies these).
export interface AdaEventNames {
  // The name of the production line whose Running tick is `key` (calc-<phase>-<row id>).
  line: (key: string) => string;
  // The Space Elevator parts the change delivered in full: the part's name and "125,000 of 125,000".
  parts: (before: ProgressState, after: ProgressState) => { name: string; count: string }[];
}

const ADA_PHASES: Phase[] = ['1', '2', '3', '4', '5', 'post'];
const adaTicks = (state: ProgressState) =>
  Object.values(state.checks || {}).filter(value => value === true).length;

// "02:14", the local time as ADA reads it out.
export const adaClock = (now: Date) =>
  `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

// The events a progress change made, in the order she would mention them. A bulk tick ("Mark all
// running") says nothing about single lines, so a crowd of lines never speaks at once.
export function adaEventsOf(
  operation: UpdateOp,
  before: ProgressState,
  after: ProgressState,
  now: Date,
  names: AdaEventNames,
): AdaEventCall[] {
  const out: AdaEventCall[] = [];
  const ticking =
    operation.type === 'check' || operation.type === 'checks' || operation.type === 'builtCount';
  if (ticking) {
    const was = adaTicks(before),
      is = adaTicks(after);
    if (is > was) {
      if (was === 0) out.push({ kind: 'first-step', params: {} });
      if (was < 100 && is >= 100) out.push({ kind: 'hundred-steps', params: {} });
      // After 01:00 and before the morning: the small hours.
      if (now.getHours() >= 1 && now.getHours() < 5)
        out.push({ kind: 'late-step', params: { time: adaClock(now) } });
      const added = Object.keys(after.checks || {}).filter(
        key => after.checks[key] === true && before.checks?.[key] !== true && /^calc-/.test(key),
      );
      if (added.length === 1)
        out.push({ kind: 'line-running', params: { name: names.line(added[0]!) } });
    }
  }
  if (operation.type === 'delivery') {
    for (const part of names.parts(before, after))
      out.push({ kind: 'part-delivered', params: { name: part.name, count: part.count } });
  }
  if (operation.type === 'phase')
    out.push(...adaPhaseEvents(before.settings.phase, operation.value));
  return out;
}

// Opening or working on phase `to` from phase `from`: going back to an earlier one, and the first
// time past Phase 4.
export function adaPhaseEvents(from: Phase, to: Phase): AdaEventCall[] {
  const was = ADA_PHASES.indexOf(from),
    is = ADA_PHASES.indexOf(to);
  if (was < 0 || is < 0 || was === is) return [];
  if (is < was) return [{ kind: 'phase-back', params: {} }];
  return was < 4 && is >= 4 ? [{ kind: 'past-phase-four', params: {} }] : [];
}
