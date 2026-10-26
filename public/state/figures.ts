// What Saves & profiles compares of a profile's plan (#1074): per planned phase, the figures the
// stored plan already holds, read and added up, never calculated again. Re-exported by
// ../state.ts; both editions' workspace summaries send it (ProfileSummary.figures).
//
// A figure an older plan does not hold is null, so the page shows "—" for it rather than a
// number made up from nothing: a bare draft without rows has no buildings, power or alternates,
// a stage without `raw` no ore or oil, a stage without `hours` no delivery time.
import { buildParts, minedResources } from '../preferences.ts';
import { powerView } from '../power.ts';
import { recipeIdOf } from '../progression.ts';
import type {
  ComparedPhase,
  PlanFigures,
  StageKey,
  StoredCalculatedPlan,
  StoredStage,
} from '../types/index.ts';

const PHASES: StageKey[] = ['1', '2', '3', '4', '5'];

// A finite number, else null (NaN from an older plan's missing field never reaches the page).
const finite = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

// The buildings of a stage: its lines' machines, as the build plan's summary and Review add them.
const buildingsOf = (stage: StoredStage): number | null =>
  stage.rows ? finite(stage.rows.reduce((sum, row) => sum + row.machines, 0)) : null;

// The machines a stage adds over `before`, the planned phase before it (none for the first): a
// line `before` also has, by row id and machine, adds only the machines beyond the ones it ran
// there, as the build plan's handover counts a line kept from the phase before (carriedLine in
// app/handover.ts); any other line all of its machines. And the parts they cost to build together
// (buildParts), null when one of them has no cost in the table, so no part count is a guess.
function buildWorkload(
  stage: StoredStage,
  before: StoredStage | undefined,
): { newBuildings: number | null; buildParts: number | null } {
  if (!stage.rows) return { newBuildings: null, buildParts: null };
  const added: [string, number][] = stage.rows.map(row => {
    const kept = before?.rows?.find(old => old.id === row.id && old.machine === row.machine);
    return [row.machine, Math.max(0, row.machines - (kept?.machines ?? 0))];
  });
  const { parts, unknown } = buildParts(added.filter(([, count]) => count > 0));
  return {
    newBuildings: finite(added.reduce((sum, [, count]) => sum + count, 0)),
    buildParts: unknown.length ? null : finite([...parts.values()].reduce((a, b) => a + b, 0)),
  };
}

// The power the phase needs, as every page gives it (powerView in public/power.ts).
const powerOf = (stage: StoredStage, plan: StoredCalculatedPlan): number | null =>
  stage.rows ? finite(powerView(stage, plan.settings).needMW) : null;

// Ore: the per-minute draw on every mined resource (the node survey's ores, SAM included);
// oil: the per-minute draw on Crude Oil.
const oreOf = (stage: StoredStage): number | null =>
  stage.raw
    ? finite(minedResources.reduce((sum, resource) => sum + (stage.raw?.[resource] ?? 0), 0))
    : null;
const oilOf = (stage: StoredStage): number | null =>
  stage.raw ? finite(stage.raw['Crude Oil'] ?? 0) : null;

// The phase's delivery time in hours. A plan holds null (JSON has no Infinity) or Infinity for a
// phase that never finishes (`never`); a stage stored without hours has none to show.
function hoursOf(stage: StoredStage): { hours: number | null; never?: true } {
  if (stage.hours === null || stage.hours === Infinity) return { hours: null, never: true };
  return { hours: finite(stage.hours) };
}

// Each planned phase's figures, from the plan's start phase on (a phase before it lists only its
// milestones and builds nothing). `alternates` counts the alternate recipes the phase's lines use
// first, which its hard-drive step asks for (hardDriveTasks in progression.ts: an alternate an
// earlier planned phase already uses is not counted again, and an amplified twin or a factory's
// own line shares its recipe's count); a plan with a guide (a migrated handbook) has no such step,
// so none. `newBuildings` and `buildParts` are what the phase adds to build (buildWorkload; a plan
// guide hands no line over, so each phase counts all its machines). The total is the delivery
// hours of every planned phase together, only while each of them fits and has a delivery time.
export function planFigures(
  plan: StoredCalculatedPlan | null | undefined,
): PlanFigures | undefined {
  if (!plan?.stages) return undefined;
  const from = Number(plan.settings?.phase || 1);
  const seen = new Set<string>();
  const phases: ComparedPhase[] = [];
  let before: StoredStage | undefined;
  for (const phase of PHASES) {
    const stage = plan.stages[phase];
    if (!stage || Number(phase) < from) continue;
    const firstUsed = new Set(
      (stage.rows || [])
        .filter(row => row.alternate)
        .map(row => recipeIdOf(row))
        .filter(id => !seen.has(id)),
    );
    for (const id of firstUsed) seen.add(id);
    phases.push({
      phase,
      feasible: !!stage.feasible,
      buildings: buildingsOf(stage),
      ...buildWorkload(stage, plan.guide ? undefined : before),
      powerMW: powerOf(stage, plan),
      ore: oreOf(stage),
      oil: oilOf(stage),
      alternates: plan.guide || !stage.rows ? null : firstUsed.size,
      ...hoursOf(stage),
    });
    before = stage;
  }
  const complete = phases.length > 0 && phases.every(p => p.feasible && p.hours !== null);
  return {
    from,
    phases,
    totalHours: complete ? phases.reduce((sum, p) => sum + (p.hours ?? 0), 0) : null,
  };
}

// planFigures kept per plan object: a stored plan is never edited (a recalculation gives the
// profile a new plan), so the server works a profile's figures out once per plan it holds.
const kept = new WeakMap<object, PlanFigures | undefined>();
export function cachedPlanFigures(
  plan: StoredCalculatedPlan | null | undefined,
): PlanFigures | undefined {
  if (!plan) return undefined;
  if (!kept.has(plan)) kept.set(plan, planFigures(plan));
  const figures = kept.get(plan);
  // Its own copy, so a caller may change it freely.
  return figures && structuredClone(figures);
}
