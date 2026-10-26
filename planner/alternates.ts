// The hard-drive payoff of each alternate a profile does not allow yet (rankAlternates, #67).
// Re-exported by ../planner.ts.
import type {
  AlternatePayoff,
  AlternateRanking,
  CurrentStage,
  PhaseFigures,
  StageKey,
} from '../public/types/index.ts';
import { DATA, STANDARD_ALTERNATES } from './data.ts';
import { turbofuelRecipes } from '../public/preferences.ts';
import { fail, settings } from './settings.ts';
import { pureNames, standardAlternateIn } from './recipes.ts';
import { calculate } from './calculate.ts';

// Hard-drive payoff (#67): for each alternate recipe the profile does not allow yet, calculate
// the plan again with it allowed and compare one phase with the profile's own plan. `input` is
// the profile's settings (normalised by settings() like calculate's). Candidates are the
// alternates available by `phase` that the recipe setting leaves out: every one for 'standard'
// (the STANDARD_ALTERNATES its pool holds aside), the unticked ones for 'custom',
// none for 'all'; the pure ingot alternates are skipped while `pureIngots` brings them in anyway.
// Alternates no hard drive buys are never candidates (NO_HARD_DRIVE below). Each trial runs
// under recipes: 'custom' with the owned list plus the candidate, so nothing else changes.
// A trial that throws or does not fit is reported, not thrown. `onProgress(done, total)` runs
// after each trial; past `budgetMs` the rest are skipped and `stopped` is set. `onPhase(phase)`
// is called as each phase of the base plan and of every trial starts, which the browser worker
// forwards as progress so its timeout restarts per phase, as for a calculation (#633).
// Two options the plan page's ranking sends (#1075), both off for every caller before it, which
// therefore ranks exactly as before:
// - `remaining`: the figures are summed over `phase` and every later phase the base plan builds
//   (`phases` on the ranking, each candidate's buildings per phase in `byPhase`). Every trial
//   calculates all phases anyway, so this costs nothing more.
// - `hunting`: the alternates the recipe setting already allows but the player does not own (the
//   recipe picker's hunting ones, app/recipe-states.ts) are ranked too, each tried with the pool
//   less it; their deltas are the plan with it minus that trial, so negative is what finding it
//   saves, and 'infeasible' that the plan does not fit without it (`hunting` on the candidate).
// The alternates the game unlocks with neither a hard drive nor research that costs one (#1044):
// Polyester Fabric's MAM research and Distilled Silica's milestone. The MAM research for Turbofuel
// and Compacted Coal costs a Hard Drive each, so a profile with the MAM recipes off still ranks them.
const NO_HARD_DRIVE = STANDARD_ALTERNATES.filter(id => !turbofuelRecipes.includes(id));
type Stages = Partial<Record<StageKey, CurrentStage>>;
export function rankAlternates(
  input: unknown,
  {
    phase,
    remaining = false,
    hunting = false,
    onProgress,
    onPhase,
    budgetMs = Infinity,
  }: {
    phase: StageKey;
    remaining?: boolean;
    hunting?: boolean;
    onProgress?: (done: number, total: number) => void;
    onPhase?: (phase: number) => void;
    budgetMs?: number;
  },
): AlternateRanking {
  const started = Date.now();
  // A cap on hard drives (#1233) is left out: the payoff of an alternate is what allowing it
  // changes, and under a cap that binds each trial would pick another set (a search per trial).
  const { driveCap: _cap, ...config } = settings(input);
  // The alternates the game unlocks without a hard drive count as allowed where the pool holds
  // them (standardAlternateIn: the MAM recipes by their own setting, #1058), so a trial under
  // 'custom' plans with exactly the base plan's pool and the candidate.
  const held = STANDARD_ALTERNATES.filter(id => standardAlternateIn(config, id));
  const owned =
    config.recipes === 'custom'
      ? [...new Set([...config.alternateRecipes, ...held])]
      : config.recipes === 'standard'
        ? held
        : null;
  // Every alternate the recipe setting allows: under 'all' each hard-drive alternate as well.
  const allowed = owned ?? [
    ...DATA.recipes
      .filter(recipe => recipe.alternate && !STANDARD_ALTERNATES.includes(recipe.id))
      .map(recipe => recipe.id),
    ...held,
  ];
  const phaseNumber = Number(phase);
  const ranked = (recipe: (typeof DATA.recipes)[number]) =>
    recipe.alternate &&
    recipe.phase <= phaseNumber &&
    // An alternate the player already owns (#1068) needs no hard drive to rank.
    !config.ownedAlternates?.includes(recipe.id) &&
    !NO_HARD_DRIVE.includes(recipe.id) &&
    !(config.pureIngots && pureNames.includes(recipe.name));
  const candidates = owned
    ? DATA.recipes.filter(recipe => ranked(recipe) && !owned.includes(recipe.id))
    : [];
  // The hunting ones (#1075): hard-drive alternates only, as the picker lists them.
  const hunted = hunting
    ? DATA.recipes.filter(
        recipe =>
          ranked(recipe) && allowed.includes(recipe.id) && !STANDARD_ALTERNATES.includes(recipe.id),
      )
    : [];
  const figures = (stage: CurrentStage | undefined): PhaseFigures | null =>
    stage?.feasible && stage.rows
      ? {
          buildings: stage.rows.reduce((total, row) => total + row.machines, 0),
          rawTotal: Object.values(stage.raw || {}).reduce((total, rate) => total + rate, 0),
          // The phase's power need as the plan sizes it (#1064).
          requiredMW: stage.grid?.needMW ?? (stage.requiredMW || 0),
          hours: Number.isFinite(stage.hours) ? stage.hours! : null,
        }
      : null;
  const baseStages: Stages = calculate(config, onPhase).stages;
  if (!figures(baseStages[phase])) fail('This phase has no plan to compare alternates against.');
  // The phases ranked: `phase`, and with `remaining` each later one the base plan builds.
  const phases = remaining
    ? (Object.keys(baseStages) as StageKey[])
        .filter(key => Number(key) >= phaseNumber && figures(baseStages[key]))
        .sort()
    : [phase];
  // Figures summed over the ranked phases; null when any of them has no plan.
  const summed = (stages: Stages): PhaseFigures | null => {
    const each = phases.map(key => figures(stages[key]));
    if (each.some(entry => !entry)) return null;
    return (each as PhaseFigures[]).reduce((total, entry) => ({
      buildings: total.buildings + entry.buildings,
      rawTotal: total.rawTotal + entry.rawTotal,
      requiredMW: total.requiredMW + entry.requiredMW,
      hours: total.hours === null || entry.hours === null ? null : total.hours + entry.hours,
    }));
  };
  const rawOf = (stages: Stages) => {
    const total: Record<string, number> = {};
    for (const key of phases)
      for (const [resource, rate] of Object.entries(stages[key]?.raw || {}))
        total[resource] = (total[resource] || 0) + rate;
    return total;
  };
  const machines = (stages: Stages, key: StageKey) => figures(stages[key])!.buildings;
  const base = summed(baseStages)!;
  const list: AlternatePayoff[] = [];
  let stopped = false;
  const jobs = [
    ...candidates.map(recipe => ({ recipe, hunt: false })),
    ...hunted.map(recipe => ({ recipe, hunt: true })),
  ];
  for (const { recipe: candidate, hunt } of jobs) {
    if (Date.now() - started > budgetMs) {
      stopped = true;
      break;
    }
    const entry: AlternatePayoff = {
      id: candidate.id,
      name: candidate.name.replace('Alternate: ', ''),
      machine: candidate.machine,
      phase: candidate.phase,
      status: 'same',
      buildings: 0,
      raw: {},
      rawTotal: 0,
      powerMW: 0,
      hours: 0,
      ...(hunt ? { hunting: true as const } : {}),
    };
    try {
      // A candidate is tried with the plan's own pool plus it, a hunting one with the pool less
      // it; either way the deltas below are "with it" minus "without it".
      const pool = hunt ? allowed.filter(id => id !== candidate.id) : [...owned!, candidate.id];
      const trialStages: Stages = calculate(
        {
          ...config,
          recipes: 'custom',
          alternateRecipes: pool,
          // A preferred list only counts under 'custom'. A standard profile can still carry one
          // from when it was custom; the trial would force it where the base plan ignores it (#185).
          preferredRecipes:
            config.recipes === 'custom'
              ? config.preferredRecipes.filter(id => pool.includes(id))
              : [],
        },
        onPhase,
      ).stages;
      const trialFigures = summed(trialStages);
      if (!trialFigures) {
        entry.status = 'infeasible';
        entry.error = phases.map(key => trialStages[key]?.reason).find(Boolean);
      } else {
        const [withIt, without] = hunt ? [base, trialFigures] : [trialFigures, base];
        const [withStages, withoutStages] = hunt
          ? [baseStages, trialStages]
          : [trialStages, baseStages];
        entry.buildings = withIt.buildings - without.buildings;
        entry.rawTotal = withIt.rawTotal - without.rawTotal;
        entry.powerMW = withIt.requiredMW - without.requiredMW;
        entry.hours =
          withIt.hours === null || without.hours === null ? null : withIt.hours - without.hours;
        const withRaw = rawOf(withStages),
          withoutRaw = rawOf(withoutStages);
        for (const resource of new Set([...Object.keys(withRaw), ...Object.keys(withoutRaw)])) {
          const difference = (withRaw[resource] || 0) - (withoutRaw[resource] || 0);
          if (Math.abs(difference) > 1e-6) entry.raw[resource] = difference;
        }
        if (remaining)
          entry.byPhase = Object.fromEntries(
            phases.map(key => [key, machines(withStages, key) - machines(withoutStages, key)]),
          );
        // Better or worse on buildings, raw and hours together; 'mixed' when they disagree.
        const signs = [entry.buildings, entry.rawTotal, entry.hours ?? 0].map(difference =>
          Math.abs(difference) < 1e-6 ? 0 : Math.sign(difference),
        );
        entry.status = signs.every(sign => sign === 0)
          ? 'same'
          : signs.every(sign => sign <= 0)
            ? 'better'
            : signs.every(sign => sign >= 0)
              ? 'worse'
              : 'mixed';
      }
    } catch (error) {
      entry.status = 'error';
      entry.error = (error as Error).message;
    }
    list.push(entry);
    onProgress?.(list.length, jobs.length);
  }
  return {
    phase,
    ...(remaining ? { phases } : {}),
    base,
    candidates: list,
    total: jobs.length,
    stopped,
    elapsedMs: Date.now() - started,
  };
}
