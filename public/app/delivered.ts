// Space Elevator parts delivered in full (#1062), and what that changes on the pages. A part is
// delivered once its saved count (state.deliveries, keyed `<stage>-<item slug>`, the build plan's
// counters) reaches the plan's target. The plan stays as it was calculated: these only read it
// beside the saved counts, so nothing here is stored and nothing is recalculated.
//   - The lines that only made a delivered part are dimmed in the build plan, saying whether a
//     later phase of the plan builds them again ("now only needed for Phase 4") or none does
//     (idleLines). Their checks stay as they are: dimming ticks nothing.
//   - The plan's summary gives the time the rest of the delivery takes at steady state
//     (deliveryHoursLeft), and Logistics marks a delivered part's link to the Space Elevator.
// Post Phase 5 reads Phase 5's stage, but it keeps every Phase 5 line running ("Retain these
// Phase 5 capacities"), so its build plan dims nothing (the caller passes no stage then).
import { deliveryKey } from '../progression.ts';
import type { StageKey, StoredCalculatedPlan, StoredStage } from '../types/index.ts';

// The parts of `stagePlan` whose saved count has reached the target.
export function deliveredParts(
  stagePlan: StoredStage | undefined,
  stageKey: StageKey,
  deliveries: Record<string, number>,
): Set<string> {
  return new Set(
    Object.entries(stagePlan?.delivery || {})
      .filter(
        ([item, part]) =>
          part.target > 0 && (deliveries[deliveryKey(stageKey, item)] ?? 0) >= part.target,
      )
      .map(([item]) => item),
  );
}

// The hours the rest of the stage's delivery takes at steady state: the slowest unfinished part's
// count still to go over its rate. null while no count is saved (the plan's own `hours` stands),
// 0 once every part is delivered, and Infinity while an unfinished part has no rate (a plan
// migrated from the handbook, whose parts were handed in when it was written).
export function deliveryHoursLeft(
  stagePlan: StoredStage | undefined,
  stageKey: StageKey,
  deliveries: Record<string, number>,
): number | null {
  const parts = Object.entries(stagePlan?.delivery || {});
  const counted = (item: string) => deliveries[deliveryKey(stageKey, item)] ?? 0;
  if (!parts.some(([item]) => counted(item) > 0)) return null;
  let hours = 0;
  for (const [item, part] of parts) {
    const left = Math.max(0, part.target - counted(item));
    if (left) hours = Math.max(hours, part.rate > 0 ? left / part.rate / 60 : Infinity);
  }
  return hours;
}

// A line a delivered part leaves without work in this phase: the part it made, and the first
// later phase of the plan that builds the same line (its row id), or null when none does.
export interface IdleLine {
  part: string;
  later: StageKey | null;
}

// The lines of `stageKey` that make a delivered part and nothing this phase still wants: none of
// their products feeds another line of the phase, goes to an unfinished delivery, protected
// storage or fuel. A line whose part another line uses (Phase 5's Nuclear Pasta, which the
// Singularity Cells take) or whose byproduct another line takes stays as it is.
export function idleLines(
  plan: StoredCalculatedPlan | null | undefined,
  stageKey: StageKey,
  deliveries: Record<string, number>,
): Map<string, IdleLine> {
  const idle = new Map<string, IdleLine>();
  const stagePlan = plan?.stages[stageKey];
  const done = deliveredParts(stagePlan, stageKey, deliveries);
  if (!plan || !stagePlan || !done.size) return idle;
  const rows = stagePlan.rows || [];
  for (const row of rows) {
    const outputs = Object.keys(row.outputs || {});
    const part = outputs.find(item => done.has(item));
    if (!part) continue;
    const usedElsewhere = (item: string) =>
      rows.some(other => other !== row && (other.inputs?.[item] ?? 0) > 0);
    const wanted = (item: string) =>
      usedElsewhere(item) ||
      (!!stagePlan.delivery?.[item] && !done.has(item)) ||
      (stagePlan.storage?.[item] ?? 0) > 0 ||
      (stagePlan.drone?.[item] ?? 0) > 0 ||
      (stagePlan.transport?.[item] ?? 0) > 0;
    if (outputs.some(wanted)) continue;
    idle.set(row.id, { part, later: laterPhase(plan, stageKey, row.id) });
  }
  return idle;
}

// The first phase after `stageKey` whose plan builds line `rowId`, or null.
function laterPhase(
  plan: StoredCalculatedPlan,
  stageKey: StageKey,
  rowId: string,
): StageKey | null {
  for (let next = Number(stageKey) + 1; next <= 5; next++) {
    const key = String(next) as StageKey;
    if (plan.stages[key]?.rows?.some(row => row.id === rowId)) return key;
  }
  return null;
}

// What a dimmed step says under its title.
export const idleLineNote = ({ part, later }: IdleLine): string =>
  later
    ? `${part} is delivered: this line is now only needed for Phase ${later}.`
    : `${part} is delivered: this line is no longer needed.`;
