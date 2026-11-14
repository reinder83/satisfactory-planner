// The steps of a factory's build order and the columns of its flow graph (FG-8, #1345): a line's
// step is the column it sits in. Left to themselves the steps are calculated from what feeds
// what: a line is one step after the latest line that feeds it (a link back to a line built
// earlier, a recycling loop, does not count). The user can push a line later with a floor
// (`groups[].layout.steps`, state version 32): "this line sits in step N at the earliest". Lines
// that feed it are never moved by it, lines it feeds follow it, and steps nobody sits in are left
// out, so the steps shown are always 1, 2, 3 … Plain arithmetic with no session: the build order
// (groupFlow, group-flow.ts, which also builds the build order's order from it) and the flow
// graph (flowGraph, flow-graph.ts) both read it, so the two never disagree.

import type { FlowLine } from './group-flow.ts';

// The earliest step each line may sit in, by plan row id (a line with none sits in step 1 or after
// what feeds it).
export type StepFloors = Readonly<Record<string, number>>;

// One link between lines of the factory: the id of the line making the item and of the line using it.
export type StepFeed = readonly [from: string, to: string];

// The links between the lines of a factory's flow, as lineSteps reads them.
export const flowFeeds = (lines: readonly FlowLine[]): StepFeed[] =>
  lines.flatMap(line =>
    line.inputs.flatMap(row =>
      row.links.flatMap((link): StepFeed[] =>
        link.from.kind === 'line' && !link.self ? [[link.from.id, line.id]] : [],
      ),
    ),
  );

// The step of each line of `ids`, in build order, from 1. `feeds` are the links between the lines;
// one from a line built later than its user is a loop and counts for nothing.
export function lineSteps(
  ids: readonly string[],
  feeds: readonly StepFeed[],
  floors: StepFloors = {},
): Map<string, number> {
  const index = new Map(ids.map((id, i) => [id, i]));
  const raw = new Map<string, number>();
  for (const id of ids) {
    let step = Math.max(1, Math.floor(floors[id] ?? 1));
    for (const [from, to] of feeds) {
      const maker = index.get(from);
      if (to === id && maker !== undefined && maker < index.get(id)!)
        step = Math.max(step, (raw.get(from) ?? 1) + 1);
    }
    raw.set(id, step);
  }
  // Steps nobody sits in are left out.
  const used = [...new Set(raw.values())].sort((a, b) => a - b);
  const rank = new Map(used.map((step, i) => [step, i + 1]));
  return new Map(ids.map(id => [id, rank.get(raw.get(id)!)!]));
}

// `ids` in the order of their steps: the build order a floor changes, lines in the same step in
// the order they had. With no floor the order is the one given, which the plan has: only a floor
// moves a line.
export function stepOrder(
  ids: readonly string[],
  feeds: readonly StepFeed[],
  floors: StepFloors,
): string[] {
  if (!ids.some(id => (floors[id] ?? 1) > 1)) return [...ids];
  const steps = lineSteps(ids, feeds, floors);
  return ids
    .map((id, i) => ({ id, i, step: steps.get(id)! }))
    .sort((a, b) => a.step - b.step || a.i - b.i)
    .map(entry => entry.id);
}

// The lowest step `id` may be moved to: one after the latest of the lines feeding it (1 when none
// does), and which of them that is (the last in build order on a tie), for "needs 03 first".
export function earliestStep(
  id: string,
  ids: readonly string[],
  feeds: readonly StepFeed[],
  steps: ReadonlyMap<string, number>,
): { step: number; after: string | null } {
  const at = ids.indexOf(id);
  let step = 1;
  let after: string | null = null;
  for (const [from, to] of feeds) {
    const maker = ids.indexOf(from);
    if (to !== id || maker < 0 || maker >= at) continue;
    const made = steps.get(from) ?? 1;
    if (made + 1 > step || (made + 1 === step && after !== null && maker > ids.indexOf(after))) {
      step = made + 1;
      after = from;
    }
  }
  return { step, after };
}

// The floors after line `id` is moved to `step` (the steps as they show now, `steps`): the floors
// already stored are put to the steps they show as, so a step the user sees as 3 stays 3 when
// others come and go, the line gets its own, and a floor that says nothing (step 1, or at or
// before what the line gets from its feeders anyway) is left out. `earliest` is the line's
// earliest step (earliestStep).
export function movedFloors(
  floors: StepFloors,
  steps: ReadonlyMap<string, number>,
  id: string,
  step: number,
  earliest: number,
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [row, floor] of Object.entries(floors)) {
    const shown = steps.get(row);
    // A line this phase does not have keeps its floor as it was.
    next[row] = shown === undefined ? floor : Math.max(2, Math.min(floor, shown));
  }
  if (step > earliest) next[id] = step;
  else delete next[id];
  return next;
}
