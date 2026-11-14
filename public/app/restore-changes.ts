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
//   - the notes that now read differently;
//   - the ticks that are neither a line's running box nor a build-plan step;
//   - which other parts of the progress the restore replaced (personal tasks, storage, trains,
//     map markers…), named but not counted.
// "Nothing changed" is said only when the whole progress is the same (#1389 review): a restore
// replaces all of it, so a difference the lines above do not count is still named.
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
  // Build-plan steps done before and after, in all phases, out of how many steps each had (the
  // confirmation says the one before), and how many step ticks moved; null without a plan or
  // progression.json.
  steps: {
    before: number;
    after: number;
    totalBefore: number;
    total: number;
    changed: number;
  } | null;
  // The ticks of every kind, before and after.
  ticks: { before: number; after: number };
  // The ticks that are neither a line's running box nor a step, and how many of those moved.
  otherTicks: { before: number; after: number; changed: number };
  // The other parts of the progress that differ, as words ("personal tasks", "trains").
  replaced: string[];
  // Whether the whole progress is the same.
  identical: boolean;
  // The phase the profile works on before and after; null when it is the same.
  phase: { before: StageKey; after: StageKey } | null;
  notes: number;
}

// What the changes need besides the two states.
export interface ChangeContext {
  plan: StoredCalculatedPlan | null | undefined;
  progression: Progression | null | undefined;
}

const restoreTicked = (state: SavedState) => Object.values(state.checks).filter(Boolean).length;

// The text of a note, an unset note and an empty one being the same.
const restoreNoteText = (state: SavedState, key: string) => state.notes[key] ?? '';

// The words for the parts of the progress the lines do not count. Bookkeeping that changes with
// every write (version, revision, who ticked what) is not a difference.
const RESTORE_SKIPPED = new Set([
  'version',
  'revision',
  'tickedBy',
  'checks',
  'notes',
  'deliveries',
]);
const RESTORE_PART_WORDS: Record<string, string> = {
  customTasks: 'personal tasks',
  storageEdits: 'storage',
  taskEdits: 'build plan edits',
  factoryGroups: 'factory groups',
  handbookOrigin: 'migration details',
  onSiteReview: 'made-on-site reviews',
  exactClocks: 'machine clocks',
  lineClocks: 'machine clocks',
  builtMachines: 'built machines',
  sloopPins: 'Somersloop pins',
  mapMarkers: 'map markers',
  mapLayers: 'map layers',
  factoryPlaces: 'factory places on the map',
  trainStations: 'trains',
  trainLines: 'trains',
  trainLayout: 'trains',
  detailLevel: 'detail level',
  settings: 'settings',
};

// A value as text with its keys sorted and unset keys left out, so two equal values read the same
// whatever order the server or IndexedDB gave their keys in.
function restoreStable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(restoreStable).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter(key => record[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${restoreStable(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

// The parts besides ticks, notes and deliveries that differ, in words, each once. The phase is
// its own line, so settings count only for what else they hold.
function restoreReplaced(before: SavedState, after: SavedState): string[] {
  const part = (state: SavedState, key: string): unknown => {
    if (key === 'settings') return { ...state.settings, phase: undefined };
    const record: Record<string, unknown> = { ...state };
    return record[key];
  };
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const words = [...keys]
    .filter(key => !RESTORE_SKIPPED.has(key))
    .filter(key => restoreStable(part(before, key)) !== restoreStable(part(after, key)))
    .map(key => RESTORE_PART_WORDS[key] ?? 'other details');
  return [...new Set(words)];
}

// "a, b and c".
const restoreList = (words: string[]) =>
  words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;

export function restoreChanges(
  before: SavedState,
  after: SavedState,
  { plan, progression }: ChangeContext,
): RestoreChanges {
  let started = 0;
  let stopped = 0;
  let running = 0;
  let lines = 0;
  const runningKeys = new Set<string>();
  const deliveries: DeliveryChange[] = [];
  for (const [phase, stage] of Object.entries(plan?.stages ?? {}) as [
    StageKey,
    StoredCalculatedPlan['stages'][StageKey],
  ][]) {
    for (const row of stage?.rows ?? []) {
      const key = `calc-${phase}-${row.id}`;
      runningKeys.add(key);
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
  // Each tick is a running box, a step (as listed for that state's own progress) or another tick.
  const none: ReadonlySet<string> = new Set();
  const kind = (state: SavedState, listed: ReadonlySet<string>, key: string) =>
    !state.checks[key] ? '' : runningKeys.has(key) ? 'running' : listed.has(key) ? 'step' : 'other';
  const tickKeys = new Set([...Object.keys(before.checks), ...Object.keys(after.checks)]);
  let otherBefore = 0;
  let otherAfter = 0;
  let otherChanged = 0;
  let stepChanged = 0;
  for (const key of tickKeys) {
    const was = kind(before, stepsBefore?.listed ?? none, key);
    const now = kind(after, stepsAfter?.listed ?? none, key);
    if (was === 'other') otherBefore++;
    if (now === 'other') otherAfter++;
    if ((was === 'other') !== (now === 'other')) otherChanged++;
    if ((was === 'step') !== (now === 'step')) stepChanged++;
  }
  const replaced = restoreReplaced(before, after);
  const sameMap = (a: Record<string, unknown>, b: Record<string, unknown>, empty: unknown) =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])].every(
      key => (a[key] ?? empty) === (b[key] ?? empty),
    );
  const identical =
    !replaced.length &&
    before.settings.phase === after.settings.phase &&
    sameMap(before.checks, after.checks, false) &&
    sameMap(before.notes, after.notes, '') &&
    sameMap(before.deliveries, after.deliveries, 0);
  return {
    started,
    stopped,
    running,
    lines,
    deliveries,
    steps:
      stepsBefore && stepsAfter
        ? {
            before: stepsBefore.done,
            after: stepsAfter.done,
            totalBefore: stepsBefore.total,
            total: stepsAfter.total,
            changed: stepChanged,
          }
        : null,
    ticks: { before: restoreTicked(before), after: restoreTicked(after) },
    otherTicks: { before: otherBefore, after: otherAfter, changed: otherChanged },
    replaced,
    identical,
    phase:
      before.settings.phase === after.settings.phase
        ? null
        : { before: before.settings.phase as StageKey, after: after.settings.phase as StageKey },
    notes: [...noteKeys].filter(key => restoreNoteText(before, key) !== restoreNoteText(after, key))
      .length,
  };
}

// Whether the restore left the progress exactly as it was.
export const restoreUnchanged = (changes: RestoreChanges): boolean => changes.identical;

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
  const steps = changes.steps;
  if (steps && steps.before !== steps.after)
    out.push(
      steps.totalBefore === steps.total
        ? `Steps done: ${restoreCount(steps.before)} → ${restoreCount(steps.after)} of ${restoreCount(steps.total)}`
        : `Steps done: ${restoreCount(steps.before)} of ${restoreCount(steps.totalBefore)} → ${restoreCount(steps.after)} of ${restoreCount(steps.total)}`,
    );
  else if (steps?.changed)
    out.push(
      `${plural(steps.changed, 'step')} ticked differently, ${restoreCount(steps.after)} of ${restoreCount(steps.total)} done either way`,
    );
  // The ticks that are neither running boxes nor steps, whether or not the steps moved.
  const other = changes.otherTicks;
  if (other.changed > 0)
    out.push(
      other.before === other.after
        ? `${plural(other.changed, 'other tick')} changed`
        : `Other ticks: ${restoreCount(other.before)} → ${restoreCount(other.after)}`,
    );
  if (changes.phase)
    out.push(
      `Works on ${phaseLabel(changes.phase.after)}, was ${phaseLabel(changes.phase.before)}`,
    );
  if (changes.notes) out.push(`${plural(changes.notes, 'note')} now read differently`);
  if (changes.replaced.length) {
    const list = restoreList(changes.replaced);
    out.push(`Also replaced: ${list.charAt(0).toUpperCase()}${list.slice(1)}`);
  }
  // Never an empty list for a progress that differs: a restore replaces all of it.
  if (!out.length && !changes.identical) out.push('Some saved details differ from before');
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
  if (changes.replaced.length)
    parts.push(
      `${parts.length ? 'It also replaced' : 'It replaced'} ${restoreList(changes.replaced)}.`,
    );
  if (!parts.length) parts.push('Only ticks, notes or the phase changed.');
  parts.push(
    restoreWentBack(changes)
      ? 'Some of that went backwards. I only report it.'
      : 'I will allow it.',
  );
  return parts.join(' ');
}
