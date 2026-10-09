// The handover from one phase to the next (#1069). A production line marked running in the phase
// before (its check `calc-<previous>-<row id>`) that this phase's plan builds again under the same
// row id is already standing with the previous phase's machines, so its build-plan step says what
// to add or change rather than the whole line again ("add 6 machines", "raise the last Smelter
// from 7.75% to 82.25%"), and the build plan opens with a summary of the handover: the lines kept,
// the machines added to them, the clocks changed, the lines still to build and the ones retired.
// The Factories page gives each factory its part of it (handoverLines, placeHandover). Everything
// here reads the stored plan and the saved checks: nothing is ticked, stored or recalculated, and
// a line's Running box in this phase stays the user's to tick.
import {
  formatNumber,
  milestoneOnlyPhase,
  retiredLines,
  type RetiredLine,
} from '../progression.ts';
import type { CalcRow, Phase, StageKey, StoredCalculatedPlan } from '../types/index.ts';

type HandoverPlan = Pick<StoredCalculatedPlan, 'settings' | 'stages' | 'guide'>;

// A line the phase before ran: that phase, and the row it ran there.
export interface CarriedLine {
  from: StageKey;
  before: CalcRow;
}

// The phase a handover into `phase` comes from: the one before it, when the plan builds both
// (from its start phase on, no plan guide). Post Phase 5 shares Phase 5's steps and checks, so
// nothing is handed over into it.
function previousStage(plan: HandoverPlan, phase: Phase): StageKey | null {
  if (plan.guide || phase === 'post' || milestoneOnlyPhase(plan, phase)) return null;
  const previous = Number(phase) - 1;
  if (previous < Number(plan.settings.phase || 1) || previous < 1) return null;
  return String(previous) as StageKey;
}

// Row `rowId` as the phase before `phase` ran it, or null when that phase did not mark it running.
export function carriedLine(
  plan: HandoverPlan,
  checks: Record<string, boolean>,
  phase: Phase,
  rowId: string,
): CarriedLine | null {
  const from = previousStage(plan, phase);
  if (!from || !checks['calc-' + from + '-' + rowId]) return null;
  const before = plan.stages[from]?.rows?.find(row => row.id === rowId);
  return before ? { from, before } : null;
}

const SAME = 1e-6;
const clockOf = (row: CalcRow): number => (row.lastClock > 0 ? row.lastClock : 100);
const machinesWord = (count: number) => `${formatNumber(count)} machine${count === 1 ? '' : 's'}`;
const percent = (clock: number) => formatNumber(clock) + '%';

// What a carried line's step changes on the line: the machines it adds (or switches off) and the
// clock it sets on a machine that already stands.
function lineChange({ before }: CarriedLine, row: CalcRow) {
  const oldClock = clockOf(before),
    newClock = clockOf(row),
    extra = row.machines - before.machines;
  // With more machines the old adjustable one runs at 100% (the new last one is adjustable).
  const clockChange =
    extra > 0 ? oldClock < 100 - SAME : extra === 0 && Math.abs(newClock - oldClock) > SAME;
  return { oldClock, newClock, extra, clockChange };
}

// What a carried line's step changes, after what already runs: "Add 6 machines, and raise the last
// Phase 1 Smelter from 7.75% to 100%.", "Nothing to add: raise the last Smelter from 7.75% to
// 82.25%.", "This phase needs 2 machines fewer: …" or "Nothing to add or change." The build-plan
// step says it (carriedText), and so does each factory's handover on the Factories page
// (ui/factories/FactoryHandover.vue).
export function carriedChange(carried: CarriedLine, row: CalcRow): string {
  const { oldClock, newClock, extra, clockChange } = lineChange(carried, row),
    machine = row.machine;
  if (extra > 0)
    return (
      `Add ${machinesWord(extra)}` +
      (clockChange
        ? `, and raise the last Phase ${carried.from} ${machine} from ${percent(oldClock)} to 100%.`
        : '.')
    );
  if (extra < 0)
    return (
      `This phase needs ${machinesWord(-extra)} fewer: switch off ${formatNumber(-extra)}` +
      (newClock < 100 - SAME ? ` and set the last one to ${percent(newClock)}.` : '.')
    );
  if (clockChange)
    return `Nothing to add: ${newClock > oldClock ? 'raise' : 'lower'} the last ${machine} from ${percent(oldClock)} to ${percent(newClock)}.`;
  return 'Nothing to add or change.';
}

// The sentence that opens a carried line's step: what already runs, then what to add or change.
export function carriedText(carried: CarriedLine, row: CalcRow): string {
  const { before, from } = carried,
    oldClock = clockOf(before);
  const running =
    `Running since Phase ${from}: ${formatNumber(before.machines)} × ${before.machine}` +
    (oldClock < 100 - SAME ? `, the last at ${percent(oldClock)}.` : '.');
  return running + ' ' + carriedChange(carried, row) + ' ';
}

// The handover into `phase`: the phase it comes from, the lines kept (marked running there and
// built again here), the machines added to them, the kept lines whose clock changes, the other
// lines still to build and the lines retired (retireTasks' list). null where nothing is handed
// over, and once every line of the phase is marked running (the handover is done).
export interface Handover {
  from: StageKey;
  kept: number;
  add: number;
  clocks: number;
  build: number;
  retire: number;
}
export function phaseHandover(
  plan: HandoverPlan,
  checks: Record<string, boolean>,
  phase: Phase,
): Handover | null {
  const handover = handoverLines(plan, checks, phase);
  return handover && handoverCount(handover.from, handover.lines, handover.retired);
}

// What each line of `phase` is in the handover from the phase before, as each factory on the
// Factories page lists it (ui/factories/FactoryHandover.vue): kept as it runs ('keep'), kept with
// machines to add or switch off or a clock to change ('add', with carriedChange's sentence), new
// in this phase ('new': the phase before does not build it) or built there but not marked running
// ('build'); and the lines retired (retiredLines, the retire step's list). `running` is whether
// the line is ticked running in this phase. null where nothing is handed over, and once every
// line of the phase is marked running, as phaseHandover, whose counts these are.
export type HandoverStatus = 'keep' | 'add' | 'new' | 'build';
export interface HandoverLine {
  row: CalcRow;
  status: HandoverStatus;
  // carriedChange's sentence for an 'add' line, else ''.
  change: string;
  // The machines added to a kept line (0 for one this phase shrinks), and whether a clock changes.
  added: number;
  clock: boolean;
  running: boolean;
}
export interface HandoverLines {
  from: StageKey;
  lines: HandoverLine[];
  retired: RetiredLine[];
}
export function handoverLines(
  plan: HandoverPlan,
  checks: Record<string, boolean>,
  phase: Phase,
): HandoverLines | null {
  const from = previousStage(plan, phase);
  const rows = plan.stages[phase as StageKey]?.rows || [];
  const running = (row: CalcRow) => !!checks['calc-' + phase + '-' + row.id];
  if (!from || !rows.length || rows.every(running)) return null;
  const before = new Set((plan.stages[from]?.rows || []).map(row => row.id));
  const lines = rows.map((row): HandoverLine => {
    const carried = carriedLine(plan, checks, phase, row.id);
    const base = { row, change: '', added: 0, clock: false, running: running(row) };
    if (!carried) return { ...base, status: before.has(row.id) ? 'build' : 'new' };
    const change = lineChange(carried, row),
      kept = change.extra === 0 && !change.clockChange;
    return {
      ...base,
      status: kept ? 'keep' : 'add',
      change: kept ? '' : carriedChange(carried, row),
      added: Math.max(0, change.extra),
      clock: change.clockChange || (change.extra < 0 && change.newClock < 100 - SAME),
    };
  });
  return { from, lines, retired: retiredLines(plan, Number(phase)) };
}

// The handover's counts over some of its lines: the whole phase's (phaseHandover) or a factory's.
export function handoverCount(
  from: StageKey,
  lines: HandoverLine[],
  retired: RetiredLine[],
): Handover {
  const handover: Handover = { from, kept: 0, add: 0, clocks: 0, build: 0, retire: retired.length };
  for (const line of lines) {
    if (line.status === 'new' || line.status === 'build') {
      handover.build++;
      continue;
    }
    handover.kept++;
    handover.add += line.added;
    if (line.clock) handover.clocks++;
  }
  return handover;
}

// One factory's part of the handover, or Ungrouped's: the lines and retired lines `inPlace` picks
// by row, counted for handoverText and listed by status. null when no line of the place is left to
// mark running in this phase, as the build plan's summary goes once every line of the phase is.
export interface PlaceHandover {
  counts: Handover;
  keep: HandoverLine[];
  add: HandoverLine[];
  new: HandoverLine[];
  build: HandoverLine[];
  retire: RetiredLine[];
}
export function placeHandover(
  handover: HandoverLines,
  inPlace: (row: Pick<CalcRow, 'id' | 'onSite'>) => boolean,
): PlaceHandover | null {
  const lines = handover.lines.filter(line => inPlace(line.row)),
    retired = handover.retired.filter(inPlace);
  if (!lines.some(line => !line.running)) return null;
  const having = (status: HandoverStatus) => lines.filter(line => line.status === status);
  return {
    counts: handoverCount(handover.from, lines, retired),
    keep: having('keep'),
    add: having('add'),
    new: having('new'),
    build: having('build'),
    retire: retired,
  };
}

// The handover summary's sentence (ui/plan/HandoverSummary.vue).
export function handoverText({ from, kept, add, clocks, build, retire }: Handover): string {
  const lines = (count: number) => `${formatNumber(count)} line${count === 1 ? '' : 's'}`;
  const changes = [
    ...(add ? [`adding ${machinesWord(add)}`] : []),
    ...(clocks ? [`changing ${formatNumber(clocks)} clock${clocks === 1 ? '' : 's'}`] : []),
  ].join(' and ');
  const keep = kept
    ? `keep ${lines(kept)} already running${changes ? ', ' + changes : ''}${build ? `; build the other ${formatNumber(build)}` : ''}`
    : `nothing marked running there carries over, so build all ${lines(build)}`;
  return `From Phase ${from}: ${keep}${retire ? `; retire ${formatNumber(retire)}` : ''}.`;
}

// The share of this phase's line that a carried line's machines already make: the phase before's
// machine-equivalents against this phase's, at most 1 (a line this phase shrinks runs whole). The
// build status (build-status.ts) runs a carried line at this share until it is ticked here.
const equivalentOf = (row: CalcRow): number =>
  row.equivalent > 0 ? row.equivalent : Math.max(0, row.machines - 1) + clockOf(row) / 100;
export function carriedShare({ before }: CarriedLine, row: CalcRow): number {
  const needed = equivalentOf(row);
  return needed > 0 ? Math.min(1, equivalentOf(before) / needed) : 1;
}

// The lines of `phase` that run from the phase before and are not ticked running here yet, with
// the share each one makes (carriedShare): what the plan summary, "Built so far" and the build
// status count at the phase before's size. null where nothing is handed over into `phase`.
export interface PhaseCarry {
  from: StageKey;
  shares: Map<string, number>;
}
export function phaseCarry(
  plan: HandoverPlan,
  checks: Record<string, boolean>,
  phase: Phase,
): PhaseCarry | null {
  const from = previousStage(plan, phase);
  if (!from) return null;
  const shares = new Map<string, number>();
  for (const row of plan.stages[phase as StageKey]?.rows || []) {
    if (checks['calc-' + phase + '-' + row.id]) continue;
    const carried = carriedLine(plan, checks, phase, row.id);
    if (carried) shares.set(row.id, carriedShare(carried, row));
  }
  return { from, shares };
}

// A carried line's state on its factory card and in its dialog: "Running since Phase 1: 2 of 5
// machines", or "3 machines, 2 needed here" when this phase needs fewer.
export function carriedMachinesText({ from, before }: CarriedLine, row: CalcRow): string {
  const count =
    before.machines <= row.machines
      ? `${formatNumber(before.machines)} of ${machinesWord(row.machines)}`
      : `${machinesWord(before.machines)}, ${formatNumber(row.machines)} needed here`;
  return `Running since Phase ${from}: ${count}`;
}
