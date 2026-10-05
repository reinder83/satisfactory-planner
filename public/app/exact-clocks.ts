// Production lines at exact clocks (#1066). A whole-machine plan runs every solid-part line on
// whole machines at 100% and sends the overflow to storage or the sink; the user can ask for a
// line to run at exact clocks instead: whole machines at 100% but the last, underclocked to the
// exact remainder. The choice is saved in the progress state (`exactClocks`, state version 16,
// from the line's dialog, ui/detail/ExactClockChoice.vue) and changes nothing until the user starts
// a recalculation (ui/plan/ExactClocksRecalc.vue), which freezes it in the new plan's
// `settings.exactClocks`; a state without the field follows the plan's own choice. The planner
// reads it in planner/model.ts (exactClockLine, wholeLine).
//
// Also what rounding costs: a whole-machine phase carries `exactPlan`, the same phase planned with
// exact clocks (planner/calculate.ts), which roundingCost words for ui/plan/RoundingCost.vue.
//
// Plain functions of the plan, the progress and the catalog, no session: the pages pass them in.
import { rawResources } from '../preferences.ts';
import type {
  CalcRow,
  ExactClocks,
  ExactPlan,
  ItemRates,
  ProgressState,
  StageKey,
  StoredCalculatedPlan,
  StoredSettings,
  StoredStage,
} from '../types/index.ts';

// The recipes whose balance the planner keeps exact whatever the setting (roundsToWholeMachines
// in planner/model.ts): nuclear fuel, waste and their recycling.
const EXACT_NUCLEAR = /uranium|plutonium|ficsonium|waste|non-fissile/i;

// Whether a whole-machine plan rounds `row` to whole machines, as roundsToWholeMachines in
// planner/model.ts decides it: a line that makes a solid, sinkable item that is not a raw
// resource, and nothing nuclear. `solidSinkable` names the items a container takes (the catalog's
// storageItems: solid, sinkable, not raw, not radioactive), which is the planner's rule for every
// recipe the data has; tests/exact-clocks.test.ts checks the two agree. Fluid, generator and
// nuclear lines always run at exact clocks, so the choice is not offered for them, and neither is
// an amplified twin, which is always whole machines.
export function roundsWholeLine(
  row: Pick<CalcRow, 'name' | 'inputs' | 'outputs'>,
  solidSinkable: ReadonlySet<string>,
): boolean {
  return (
    Object.keys(row.outputs || {}).some(
      item => solidSinkable.has(item) && !rawResources.includes(item),
    ) &&
    !EXACT_NUCLEAR.test(
      [row.name, ...Object.keys(row.inputs || {}), ...Object.keys(row.outputs || {})].join(' '),
    )
  );
}

// The lines a plan was calculated with at exact clocks.
export const plannedExactClocks = (plan: Pick<StoredCalculatedPlan, 'settings'>): ExactClocks =>
  plan.settings.exactClocks ?? {};
// The lines the user asks for: the progress state's choice once they changed one, else the plan's.
export const wantedExactClocks = (
  plan: Pick<StoredCalculatedPlan, 'settings'>,
  progress: Pick<ProgressState, 'exactClocks'>,
): ExactClocks => progress.exactClocks ?? plannedExactClocks(plan);
// Whether `clocks` puts line `id` of `phase` at exact clocks.
export const exactClockIn = (clocks: ExactClocks, phase: StageKey, id: string): boolean =>
  !!clocks[phase]?.includes(id);
// `clocks` with line `id` of `phase` at exact clocks (`on`) or not, normalised as the planner and
// validateState keep it: each phase's ids sorted, without an empty phase.
export function withExactClock(
  clocks: ExactClocks,
  phase: StageKey,
  id: string,
  on: boolean,
): ExactClocks {
  const out: ExactClocks = {};
  for (const [key, ids] of Object.entries(clocks) as [StageKey, string[]][])
    if (key !== phase && ids.length) out[key] = [...ids];
  const ids = new Set(clocks[phase] ?? []);
  if (on) ids.add(id);
  else ids.delete(id);
  if (ids.size) out[phase] = [...ids].sort();
  return out;
}
// Whether two choices ask for the same lines.
export const sameExactClocks = (a: ExactClocks, b: ExactClocks): boolean =>
  (['1', '2', '3', '4', '5'] as StageKey[]).every(
    phase => [...(a[phase] ?? [])].sort().join('\n') === [...(b[phase] ?? [])].sort().join('\n'),
  );

// A line a recalculation would change: its phase, row id and name.
export interface ExactClockLine {
  phase: StageKey;
  id: string;
  name: string;
}
// What a recalculation would change (#1066): the lines asked for at exact clocks that the plan
// runs whole (`exact`), and the lines the plan runs at exact clocks that are asked for whole again
// (`whole`), each only where the plan has the line in that phase, so an id a phase no longer
// plans asks for nothing. null when nothing would change.
export function exactClocksChange(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages'>,
  progress: Pick<ProgressState, 'exactClocks'>,
): { wanted: ExactClocks; exact: ExactClockLine[]; whole: ExactClockLine[] } | null {
  if (!plan.settings.wholeMachines || !progress.exactClocks) return null;
  const wanted = progress.exactClocks,
    planned = plannedExactClocks(plan);
  const exact: ExactClockLine[] = [],
    whole: ExactClockLine[] = [];
  for (const phase of ['1', '2', '3', '4', '5'] as StageKey[])
    for (const row of plan.stages[phase]?.rows ?? []) {
      const asked = exactClockIn(wanted, phase, row.id),
        has = exactClockIn(planned, phase, row.id);
      if (asked !== has) (asked ? exact : whole).push({ phase, id: row.id, name: row.name });
    }
  return exact.length || whole.length ? { wanted, exact, whole } : null;
}
// The settings a recalculation with the lines asked for starts from: the plan's, with
// `exactClocks` set to them, or without the field when none is asked for.
export function exactClocksSettings(settings: StoredSettings, wanted: ExactClocks): StoredSettings {
  const out: StoredSettings = { ...settings };
  if (Object.values(wanted).some(ids => ids?.length)) out.exactClocks = wanted;
  else delete out.exactClocks;
  return out;
}
// "Iron Plate (Phase 3), Wire (Phases 3 and 4)": lines named once, with their phases.
export function exactClockNames(lines: ExactClockLine[]): string {
  const phases = new Map<string, string[]>();
  for (const line of lines) phases.set(line.name, [...(phases.get(line.name) ?? []), line.phase]);
  return [...phases]
    .map(
      ([name, list]) =>
        `${name} (Phase${list.length > 1 ? 's' : ''} ${list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list.at(-1) : list[0]})`,
    )
    .join(', ');
}

// What the build-plan step, the card and the dialog say about one line's clocks (#1066), for a
// line of phase `phase` of a whole-machine plan that rounds (roundsWholeLine): '' for a line at
// whole machines as planned, 'Exact clocks' for one the plan runs at exact clocks, and the change
// a recalculation would make when the choice differs from the plan.
export function lineClockNote(
  plan: Pick<StoredCalculatedPlan, 'settings'>,
  progress: Pick<ProgressState, 'exactClocks'>,
  phase: StageKey,
  id: string,
): string {
  if (!plan.settings.wholeMachines) return '';
  const has = exactClockIn(plannedExactClocks(plan), phase, id),
    asked = exactClockIn(wantedExactClocks(plan, progress), phase, id);
  if (asked === has) return has ? 'Exact clocks' : '';
  return asked ? 'Exact clocks after a recalculation' : 'Whole machines after a recalculation';
}

// What rounding costs in one phase (#1066), from its stage's `exactPlan`: each figure of the
// whole-machine plan beside the exact one, and the raw resources it draws beyond the exact plan's,
// largest first. null for a stage without one (an exact plan, an older plan, a draft).
export interface RoundingCost {
  buildings: [whole: number, exact: number];
  needMW: [whole: number, exact: number];
  hours: [whole: number, exact: number];
  // Solid output beyond every demand per minute: what storage or the sink takes.
  surplus: [whole: number, exact: number];
  // Raw resources per minute the whole-machine plan draws beyond the exact one.
  extraRaw: [item: string, rate: number][];
}
export function roundingCost(stage: StoredStage | undefined): RoundingCost | null {
  const exact: ExactPlan | undefined = stage?.exactPlan;
  if (!stage?.feasible || !exact) return null;
  const raw: ItemRates = stage.raw ?? {};
  return {
    buildings: [
      (stage.rows ?? []).reduce((total, row) => total + row.machines, 0),
      exact.buildings,
    ],
    // The power the phase needs as every page gives it (its grid's, #1064, else requiredMW).
    needMW: [stage.grid?.needMW ?? stage.requiredMW ?? 0, exact.needMW],
    hours: [stage.hours ?? Infinity, exact.hours],
    surplus: [
      Object.values(stage.surplus ?? {}).reduce((total, rate) => total + rate, 0),
      exact.surplus,
    ],
    extraRaw: Object.entries(raw)
      .map(([item, rate]): [string, number] => [item, rate - (exact.raw[item] ?? 0)])
      .filter(([, extra]) => extra > 0.5)
      .sort((a, b) => b[1] - a[1]),
  };
}
// The whole-machine choice's measured cost on a plan (#1066), for the wizard's Goals step and its
// live estimate: the last phase the plan covers from its start phase whose stage records the exact
// plan, with its rounding cost. null for a plan without whole machines or without that record.
export function measuredRounding(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages'>,
): { phase: StageKey; cost: RoundingCost } | null {
  const from = Number(plan.settings.phase || 1);
  for (const phase of ['5', '4', '3', '2', '1'] as StageKey[]) {
    if (Number(phase) < from) break;
    const cost = roundingCost(plan.stages[phase]);
    if (cost) return { phase, cost };
  }
  return null;
}
