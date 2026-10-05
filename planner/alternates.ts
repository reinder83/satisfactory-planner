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
import { pureNames } from './recipes.ts';
import { calculate } from './calculate.ts';

// Hard-drive payoff (#67): for each alternate recipe the profile does not allow yet, calculate
// the plan again with it allowed and compare one phase with the profile's own plan. `input` is
// the profile's settings (normalised by settings() like calculate's). Candidates are the
// alternates available by `phase` that the recipe setting leaves out: every one for 'standard'
// (the alternates it already has, STANDARD_ALTERNATES, aside), the unticked ones for 'custom',
// none for 'all'; the pure ingot alternates are skipped while `pureIngots` brings them in anyway.
// Alternates no hard drive buys are never candidates (NO_HARD_DRIVE below). Each trial runs
// under recipes: 'custom' with the owned list plus the candidate, so nothing else changes.
// A trial that throws or does not fit is reported, not thrown. `onProgress(done, total)` runs
// after each trial; past `budgetMs` the rest are skipped and `stopped` is set. `onPhase(phase)`
// is called as each phase of the base plan and of every trial starts, which the browser worker
// forwards as progress so its timeout restarts per phase, as for a calculation (#633).
// The alternates the game unlocks with neither a hard drive nor research that costs one (#1044):
// Polyester Fabric's MAM research and Distilled Silica's milestone. The MAM research for Turbofuel
// and Compacted Coal costs a Hard Drive each, so a custom profile without them still ranks them.
const NO_HARD_DRIVE = STANDARD_ALTERNATES.filter(id => !turbofuelRecipes.includes(id));
export function rankAlternates(
  input: unknown,
  {
    phase,
    onProgress,
    onPhase,
    budgetMs = Infinity,
  }: {
    phase: StageKey;
    onProgress?: (done: number, total: number) => void;
    onPhase?: (phase: number) => void;
    budgetMs?: number;
  },
): AlternateRanking {
  const started = Date.now();
  const config = settings(input);
  const owned =
    config.recipes === 'custom'
      ? config.alternateRecipes
      : config.recipes === 'standard'
        ? STANDARD_ALTERNATES
        : null;
  const phaseNumber = Number(phase);
  const candidates = owned
    ? DATA.recipes.filter(
        recipe =>
          recipe.alternate &&
          recipe.phase <= phaseNumber &&
          !owned.includes(recipe.id) &&
          !NO_HARD_DRIVE.includes(recipe.id) &&
          !(config.pureIngots && pureNames.includes(recipe.name)),
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
  const baseStage = calculate(config, onPhase).stages[phase];
  const base = figures(baseStage);
  if (!base) fail('This phase has no plan to compare alternates against.');
  const list: AlternatePayoff[] = [];
  let stopped = false;
  for (const candidate of candidates) {
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
    };
    try {
      const trial = calculate(
        {
          ...config,
          recipes: 'custom',
          alternateRecipes: [...owned!, candidate.id],
          // A preferred list only counts under 'custom'. A standard profile can still carry one
          // from when it was custom; the trial would force it where the base plan ignores it (#185).
          preferredRecipes: config.recipes === 'custom' ? config.preferredRecipes : [],
        },
        onPhase,
      ).stages[phase];
      const trialFigures = figures(trial);
      if (!trialFigures) {
        entry.status = 'infeasible';
        entry.error = trial?.reason;
      } else {
        entry.buildings = trialFigures.buildings - base.buildings;
        entry.rawTotal = trialFigures.rawTotal - base.rawTotal;
        entry.powerMW = trialFigures.requiredMW - base.requiredMW;
        entry.hours =
          trialFigures.hours === null || base.hours === null
            ? null
            : trialFigures.hours - base.hours;
        for (const resource of new Set([
          ...Object.keys(trial!.raw || {}),
          ...Object.keys(baseStage!.raw || {}),
        ])) {
          const difference = (trial!.raw?.[resource] || 0) - (baseStage!.raw?.[resource] || 0);
          if (Math.abs(difference) > 1e-6) entry.raw[resource] = difference;
        }
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
    onProgress?.(list.length, candidates.length);
  }
  return {
    phase,
    base,
    candidates: list,
    total: candidates.length,
    stopped,
    elapsedMs: Date.now() - started,
  };
}
