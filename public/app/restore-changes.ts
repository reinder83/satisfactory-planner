// What a restored progress backup changed (X-6, #1352): the Backup page's "Restore this profile…"
// replaces the open profile's progress, and afterwards says what is different, the way the
// confirmation before it said what would be (import-summary.ts). It is worked out from the
// progress as it was and the progress the restore left, against the profile's stored plan, so
// nothing about it is stored and the same words come out in the Docker edition and in the browser
// edition (whose /api/import answers the same).
//
// What it counts:
//   - lines now running: the plan's production lines whose "running" tick ('calc-<phase>-<row>',
//     the factories page and the build plan tick it) is on now and was not, over every phase of
//     the plan, and the lines no longer marked running;
//   - Space Elevator parts whose delivered count moved ("Modular Engine, Phase 3: 4,200 →
//     9,800 of 12,000"), by delivery id as the build plan's counters key them;
//   - the build-plan steps done, as the confirmation counts them (stepsDone), and the phase the
//     profile works on;
//   - the notes that now read differently.
// A profile whose plan has no stages to count says only what its other ticks, deliveries and notes do.
//
// This module reads no session state, so the node tests import it; the Backup page hands it the
// profile's plan and progression.json.
import { formatNumber } from '../numbers.ts';
import { deliveryKey } from '../progression.ts';
import { plural } from './format.ts';
import { stepsDone } from './import-summary.ts';
import type { Progression, SavedState, StageKey, StoredCalculatedPlan } from '../types/index.ts';

// A part whose delivered count moved.
export interface DeliveryChange {
  part: string;
  phase: StageKey;
  from: number;
  to: number;
  // The phase's target for it; 0 when the plan has none.
  target: number;
}

export interface RestoreChanges {
  // Lines of the plan now marked running that were not, and the reverse, with how many lines the
  // plan has and how many run now.
  started: number;
  stopped: number;
  running: number;
  lines: number;
  deliveries: DeliveryChange[];
  // Build-plan steps done before and after, in all phases; null without a plan or progression.json.
  steps: { before: number; after: number; total: number } | null;
  // The ticks of every kind, and how many keys are ticked in one and not the other.
  ticks: { before: number; after: number; changed: number };
  // The phase the profile works on before and after; null when it is the same.
  phase: { before: StageKey; after: StageKey } | null;
  notes: number;
}

// What the changes need besides the two states.
export interface ChangeContext {
  plan: StoredCalculatedPlan | null | undefined;
  progression: Progression | null | undefined;
}

// The keys ticked in one state and not in the other.
const restoreTickChanges = (before: SavedState, after: SavedState) =>
  [...new Set([...Object.keys(before.checks), ...Object.keys(after.checks)])].filter(
    key => !!before.checks[key] !== !!after.checks[key],
  ).length;
const restoreTicked = (state: SavedState) => Object.values(state.checks).filter(Boolean).length;

// The text of a note, an unset note and an empty one being the same.
const restoreNoteText = (state: SavedState, key: string) => state.notes[key] ?? '';

export function restoreChanges(
  before: SavedState,
  after: SavedState,
  { plan, progression }: ChangeContext,
): RestoreChanges {
  let started = 0;
  let stopped = 0;
  let running = 0;
  let lines = 0;
  const deliveries: DeliveryChange[] = [];
  for (const [phase, stage] of Object.entries(plan?.stages ?? {}) as [
    StageKey,
    StoredCalculatedPlan['stages'][StageKey],
  ][]) {
    for (const row of stage?.rows ?? []) {
      const key = `calc-${phase}-${row.id}`;
      const was = !!before.checks[key];
      const now = !!after.checks[key];
      lines++;
      if (now) running++;
      if (now && !was) started++;
      if (was && !now) stopped++;
    }
    for (const [part, delivery] of Object.entries(stage?.delivery ?? {})) {
      const key = deliveryKey(phase, part);
      const from = before.deliveries[key] ?? 0;
      const to = after.deliveries[key] ?? 0;
      if (from !== to) deliveries.push({ part, phase, from, to, target: delivery.target });
    }
  }
  const stepsBefore = stepsDone(plan, before, progression);
  const stepsAfter = stepsDone(plan, after, progression);
  const noteKeys = new Set([...Object.keys(before.notes), ...Object.keys(after.notes)]);
  return {
    started,
    stopped,
    running,
    lines,
    deliveries,
    steps:
      stepsBefore && stepsAfter
        ? { before: stepsBefore.done, after: stepsAfter.done, total: stepsAfter.total }
        : null,
    ticks: {
      before: restoreTicked(before),
      after: restoreTicked(after),
      changed: restoreTickChanges(before, after),
    },
    phase:
      before.settings.phase === after.settings.phase
        ? null
        : { before: before.settings.phase as StageKey, after: after.settings.phase as StageKey },
    notes: [...noteKeys].filter(key => restoreNoteText(before, key) !== restoreNoteText(after, key))
      .length,
  };
}

// Whether the restore changed nothing the summary counts.
export const restoreUnchanged = (changes: RestoreChanges): boolean =>
  !changes.started &&
  !changes.stopped &&
  !changes.deliveries.length &&
  !changes.phase &&
  !changes.notes &&
  !changes.ticks.changed;

// Whether anything the summary counts went down: a line stopped, a delivered count or the steps
// done fell. ADA only approves a restore that did not.
export const restoreWentBack = (changes: RestoreChanges): boolean =>
  changes.stopped > 0 ||
  changes.deliveries.some(change => change.to < change.from) ||
  (changes.steps ? changes.steps.after < changes.steps.before : false) ||
  changes.ticks.after < changes.ticks.before;

const restoreCount = (value: number) => formatNumber(value, 0);

// "Modular Engine went from 4,200 to 9,800", as ADA says it.
export const restoreDeliveryWords = ({ part, from, to }: DeliveryChange): string =>
  `${part} went from ${restoreCount(from)} to ${restoreCount(to)}`;

// The summary's lines, in the order the page lists them; each is a whole sentence-less phrase
// ("3 lines now running"), nothing for what did not change.
export function restoreChangeLines(changes: RestoreChanges, phaseLabel: (phase: string) => string) {
  const out: string[] = [];
  if (changes.started)
    out.push(
      `${plural(changes.started, 'line')} now running (${restoreCount(changes.running)} of ${restoreCount(changes.lines)} in the plan)`,
    );
  if (changes.stopped) out.push(`${plural(changes.stopped, 'line')} no longer marked running`);
  for (const change of changes.deliveries)
    out.push(
      `${change.part}, ${phaseLabel(change.phase)}: ${restoreCount(change.from)} → ${restoreCount(change.to)}` +
        (change.target ? ` of ${restoreCount(change.target)} delivered` : ' delivered'),
    );
  const stepsMoved = !!changes.steps && changes.steps.before !== changes.steps.after;
  if (stepsMoved)
    out.push(
      `Steps done: ${restoreCount(changes.steps!.before)} → ${restoreCount(changes.steps!.after)} of ${restoreCount(changes.steps!.total)}`,
    );
  else {
    // The ticks the lines above do not explain: the running boxes are ticks too.
    const wasRunning = changes.running - changes.started + changes.stopped;
    const before = changes.ticks.before - wasRunning;
    const after = changes.ticks.after - changes.running;
    const other = changes.ticks.changed - changes.started - changes.stopped;
    if (other > 0)
      out.push(
        before === after
          ? `${plural(other, 'other tick')} changed`
          : `Other ticks: ${restoreCount(before)} → ${restoreCount(after)}`,
      );
  }
  if (changes.phase)
    out.push(
      `Works on ${phaseLabel(changes.phase.after)}, was ${phaseLabel(changes.phase.before)}`,
    );
  if (changes.notes) out.push(`${plural(changes.notes, 'note')} now read differently`);
  return out;
}

// ADA's remark about the restore: the headline figures in her voice. The first moved delivery
// is named, the rest counted. A restore that changed nothing is said as that.
export function restoreAdaWords(changes: RestoreChanges): string {
  if (restoreUnchanged(changes))
    return 'The backup matched this profile, so nothing changed. A restore with no effect is the safest kind.';
  const parts: string[] = [];
  if (changes.started) parts.push(`${plural(changes.started, 'line')} now running.`);
  if (changes.stopped) parts.push(`${plural(changes.stopped, 'line')} no longer marked running.`);
  const [first, ...rest] = changes.deliveries;
  if (first)
    parts.push(
      `${restoreDeliveryWords(first)}${rest.length ? `, and ${plural(rest.length, 'other part')} moved` : ''}.`,
    );
  if (changes.steps && changes.steps.before !== changes.steps.after)
    parts.push(
      `${restoreCount(changes.steps.after)} of ${restoreCount(changes.steps.total)} steps are done now, was ${restoreCount(changes.steps.before)}.`,
    );
  if (!parts.length) parts.push('Only ticks and notes changed.');
  parts.push(
    restoreWentBack(changes)
      ? 'Some of that went backwards. I only report it.'
      : 'I will allow it.',
  );
  return parts.join(' ');
}
