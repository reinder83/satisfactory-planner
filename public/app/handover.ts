// The handover from one phase to the next (#1069). A production line marked running in the phase
// before (its check `calc-<previous>-<row id>`) that this phase's plan builds again under the same
// row id is already standing with the previous phase's machines, so its build-plan step says what
// to add or change rather than the whole line again ("add 6 machines", "raise the last Smelter
// from 7.75% to 82.25%"), and the build plan opens with a summary of the handover: the lines kept,
// the machines added to them, the clocks changed, the lines still to build and the ones retired.
// Everything here reads the stored plan and the saved checks: nothing is ticked, stored or
// recalculated, and a line's Running box in this phase stays the user's to tick.
import { formatNumber, milestoneOnlyPhase, retiredLines } from '../progression.ts';
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

// The sentence that opens a carried line's step: what already runs, then what to add or change.
export function carriedText(carried: CarriedLine, row: CalcRow): string {
  const { before, from } = carried,
    { oldClock, newClock, extra, clockChange } = lineChange(carried, row),
    machine = row.machine,
    phaseName = 'Phase ' + from;
  const running =
    `Running since ${phaseName}: ${formatNumber(before.machines)} × ${before.machine}` +
    (oldClock < 100 - SAME ? `, the last at ${percent(oldClock)}.` : '.');
  let change: string;
  if (extra > 0)
    change =
      `Add ${machinesWord(extra)}` +
      (clockChange
        ? `, and raise the last ${phaseName} ${machine} from ${percent(oldClock)} to 100%.`
        : '.');
  else if (extra < 0)
    change =
      `This phase needs ${machinesWord(-extra)} fewer: switch off ${formatNumber(-extra)}` +
      (newClock < 100 - SAME ? ` and set the last one to ${percent(newClock)}.` : '.');
  else if (clockChange)
    change = `Nothing to add: ${newClock > oldClock ? 'raise' : 'lower'} the last ${machine} from ${percent(oldClock)} to ${percent(newClock)}.`;
  else change = 'Nothing to add or change.';
  return running + ' ' + change + ' ';
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
  const from = previousStage(plan, phase);
  const rows = plan.stages[phase as StageKey]?.rows || [];
  if (!from || !rows.length || rows.every(row => checks['calc-' + phase + '-' + row.id]))
    return null;
  const handover: Handover = { from, kept: 0, add: 0, clocks: 0, build: 0, retire: 0 };
  for (const row of rows) {
    const carried = carriedLine(plan, checks, phase, row.id);
    if (!carried) {
      handover.build++;
      continue;
    }
    const change = lineChange(carried, row);
    handover.kept++;
    handover.add += Math.max(0, change.extra);
    if (change.clockChange || (change.extra < 0 && change.newClock < 100 - SAME)) handover.clocks++;
  }
  handover.retire = retiredLines(plan, Number(phase)).length;
  return handover;
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
