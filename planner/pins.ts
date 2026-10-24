// Somersloop pins per production line (#1235, slice 10 of #1079): settings.sloopPins fixes how
// many somersloops a line of a phase takes, `{ phase: { recipe: sloops } }`, and the planner
// places the rest of the phase's amplification budget itself. A pin is the line's amplified
// machines times their slots (one amplified machine fills them all); 0 asks for no somersloops on
// the line. The solve keeps a pin exactly (addPins in model.ts, the twin's machines held to it), or
// plans the phase without it and says so: the stage records each pin it could not keep, with why,
// in `sloopPinsDropped`, which the plan's warnings, ADA and the line's dialog name. A pin is never
// silently changed. Without pins nothing here runs, so such a plan calculates exactly as before.
import type {
  CurrentSettings,
  SloopPinDrop,
  SloopPinReason,
  StageKey,
} from '../public/types/index.ts';
import type { RunResult } from './types.ts';
import { AMPLIFIER_PHASE } from '../public/somersloops.ts';
import { recipePool } from './recipes.ts';

// A phase's pins, { recipe: sloops }; empty without any.
export const phasePins = (
  config: Pick<CurrentSettings, 'sloopPins'>,
  phase: number,
): Record<string, number> => config.sloopPins?.[String(phase) as StageKey] ?? {};
// The pins of a phase that place somersloops (above 0), as [recipe, sloops].
export const placedPins = (config: Pick<CurrentSettings, 'sloopPins'>, phase: number) =>
  Object.entries(phasePins(config, phase)).filter(([, sloops]) => sloops > 0);

// The pins of a phase that ask for no somersloops: what the phase keeps of its pins when it gives
// up those that place some.
export const zeroPins = (config: Pick<CurrentSettings, 'sloopPins'>, phase: number) =>
  Object.fromEntries(Object.entries(phasePins(config, phase)).filter(([, sloops]) => sloops === 0));

// Which of a phase's pins it can keep before anything is solved, and why it cannot keep the
// others. A pin of 0 asks for no somersloops, which every phase can give, so it is always kept. A
// pin above 0 needs the MAM's Production Amplifier (from Phase 3, #1056: 'research') and its recipe
// in the phase's pool ('unavailable', for example after a change of recipe access); the pins kept
// then need the amplification budget to hold them all ('budget', every pin above 0 of the phase,
// since which to give up is the user's choice). Whether a plan fits with them is the two-step
// fit's question (twoStepFit in fit.ts, 'fit').
export function checkPins(
  config: CurrentSettings,
  phase: number,
  conversion: boolean,
): { kept: Record<string, number>; dropped: SloopPinDrop[] } {
  const kept: Record<string, number> = {},
    dropped: SloopPinDrop[] = [];
  const placed = placedPins(config, phase);
  const pool = placed.length
    ? new Set(recipePool(config, phase, conversion).map(recipe => recipe.id))
    : new Set<string>();
  const drop = (recipe: string, sloops: number, reason: SloopPinReason) =>
    dropped.push({ recipe, sloops, reason });
  for (const [recipe, sloops] of Object.entries(phasePins(config, phase))) {
    if (sloops > 0 && phase < AMPLIFIER_PHASE) drop(recipe, sloops, 'research');
    else if (sloops > 0 && !pool.has(recipe)) drop(recipe, sloops, 'unavailable');
    else kept[recipe] = sloops;
  }
  const total = Object.values(kept).reduce((sum, sloops) => sum + sloops, 0);
  if (total > config.amplifySloops)
    for (const [recipe, sloops] of Object.entries(kept))
      if (sloops > 0) {
        drop(recipe, sloops, 'budget');
        delete kept[recipe];
      }
  return { kept, dropped };
}
// `config` with phase `phase`'s pins replaced by `pins`: the phase's entry left out when `pins` is
// empty, and the field left out when no phase has any.
export function withPhasePins(
  config: CurrentSettings,
  phase: number,
  pins: Record<string, number>,
): CurrentSettings {
  const { sloopPins, ...others } = config;
  const rest = Object.fromEntries(
    Object.entries(sloopPins ?? {}).filter(([key]) => key !== String(phase)),
  );
  if (Object.keys(pins).length) rest[String(phase)] = pins;
  return Object.keys(rest).length ? { ...others, sloopPins: rest } : others;
}
// The settings a phase is solved with: only the pins it can keep (checkPins), so the model holds
// nothing it cannot. The settings themselves when the phase has no pins.
export function keptPins(config: CurrentSettings, phase: number, conversion: boolean) {
  if (!config.sloopPins?.[String(phase) as StageKey]) return config;
  return withPhasePins(config, phase, checkPins(config, phase, conversion).kept);
}
// A phase's result with every pin it could not keep: those checkPins gives up before solving and
// those the two-step fit gave up ('fit'), in that order. The result as it is when it kept them all.
export function withPinDrops(
  result: RunResult,
  config: CurrentSettings,
  phase: number,
  conversion: boolean,
): RunResult {
  if (!result.feasible || !config.sloopPins?.[String(phase) as StageKey]) return result;
  const dropped = [
    ...checkPins(config, phase, conversion).dropped,
    ...(result.sloopPinsDropped ?? []),
  ];
  return dropped.length ? { ...result, sloopPinsDropped: dropped } : result;
}
