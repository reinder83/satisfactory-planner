// Power Shard pins per production line (#1239, slice 2): a pin runs every machine of one line of a
// phase at a clock above 100% with Power Shards in it (the recipe's plain row, its amplified twin
// 'amp:<recipe>' and the factories' own lines of it are one line), so the line needs fewer
// machines. The pins are saved in the progress state (`lineClocks`, state version 26, from the
// line's dialog, ui/detail/ShardPinChoice.vue) and change nothing until the user starts a
// recalculation (ui/plan/ShardPinsRecalc.vue), which freezes them in the new plan's
// `settings.lineClocks`; a state without the field follows the plan's own clocks. The planner
// keeps them in planner/clocks.ts, or plans a phase without the ones it cannot keep and records
// them in `lineClocksDropped`, which the warnings, ADA and the dialog report, never silently.
//
// The same pattern as somersloop pins (app/sloop-pins.ts). Plain functions of the plan and the
// progress, no session: the pages pass them in.
import {
  clockReasonWords,
  clockRemedyWords,
  shardsPerMachine,
  powerShardWords,
} from '../shards.ts';
import { localeNumber } from '../wording.ts';
import { knownPins, staleNames, staleNotice, type RecipeBook } from '../state.ts';
import type {
  CalcRow,
  LineClockDrop,
  LineClocks,
  ProgressState,
  StageKey,
  StoredCalculatedPlan,
  StoredSettings,
} from '../types/index.ts';

const CLOCK_PHASES: StageKey[] = ['1', '2', '3', '4', '5'];
const TWIN = 'amp:';

// The recipe a row's pin names: the row's own id, or its plain recipe's for an amplified twin.
export const clockRecipe = (row: Pick<CalcRow, 'id'>): string =>
  row.id.startsWith(TWIN) ? row.id.slice(TWIN.length) : row.id;
// Whether a row's line can be pinned to a clock: a production machine that draws power (not a
// generator line), the line of a recipe itself (not a factory's own line made on site, #875, nor
// a storage-only line, #1061, which follow their recipe's clock), from Phase 2 on, or in Phase 1
// when the player can overclock (settings.overclock), as the planner's 'research' rule.
export function clockable(
  row: Pick<CalcRow, 'id' | 'power' | 'onSite' | 'stock'>,
  phase: StageKey,
  settings: Pick<StoredSettings, 'overclock'>,
): boolean {
  if (row.onSite || row.stock || !(row.power > 0) || clockRecipe(row).includes(':')) return false;
  return phase !== '1' || !!settings.overclock;
}

// The clocks a plan was calculated with.
export const plannedClocks = (plan: Pick<StoredCalculatedPlan, 'settings'>): LineClocks =>
  plan.settings.lineClocks ?? {};
// The clocks the user asks for: the progress state's once they changed one, else the plan's.
export const wantedClocks = (
  plan: Pick<StoredCalculatedPlan, 'settings'>,
  progress: Pick<ProgressState, 'lineClocks'>,
): LineClocks => progress.lineClocks ?? plannedClocks(plan);
// The clock `clocks` puts on line `recipe` of `phase`, or undefined when it runs at 100%.
export const pinnedClockOf = (
  clocks: LineClocks,
  phase: StageKey,
  recipe: string,
): number | undefined => clocks[phase]?.[recipe];
// `clocks` with each phase's keys sorted and without an empty phase, as the planner and
// validateState keep them.
export function normalClocks(clocks: LineClocks): LineClocks {
  const out: LineClocks = {};
  for (const phase of CLOCK_PHASES) {
    const lines = clocks[phase] ?? {};
    const ids = Object.keys(lines).sort();
    // Each id is a key of `lines`, so its clock is there.
    if (ids.length) out[phase] = Object.fromEntries(ids.map(id => [id, lines[id]!]));
  }
  return out;
}
// `clocks` with line `recipe` of `phase` pinned to `clock`, or without a pin (undefined), normalised.
export function withClock(
  clocks: LineClocks,
  phase: StageKey,
  recipe: string,
  clock: number | undefined,
): LineClocks {
  const lines = { ...(clocks[phase] ?? {}) };
  if (clock === undefined) delete lines[recipe];
  else lines[recipe] = clock;
  return normalClocks({ ...clocks, [phase]: lines });
}
// Whether two maps pin the same lines to the same clocks.
export const sameClocks = (a: LineClocks, b: LineClocks): boolean =>
  JSON.stringify(normalClocks(a)) === JSON.stringify(normalClocks(b));

// A line whose clock a recalculation would change: its phase, recipe, name, and the clock before
// (in the plan) and after (asked for), undefined for 100%.
export interface ClockChange {
  phase: StageKey;
  recipe: string;
  name: string;
  before: number | undefined;
  after: number | undefined;
}
// The name of line `recipe` of `phase` as its plain row gives it, else as its twin does without
// "(somersloop amplified)", else as any phase names it, else its id.
function clockLineName(
  plan: Pick<StoredCalculatedPlan, 'stages'>,
  phase: StageKey,
  recipe: string,
): string {
  const named = (key: StageKey) => {
    const rows = plan.stages[key]?.rows ?? [];
    const plain = rows.find(row => row.id === recipe);
    const twin = rows.find(row => row.id === TWIN + recipe);
    return plain?.name ?? twin?.name.replace(/ \(somersloop amplified\)$/, '');
  };
  return named(phase) ?? CLOCK_PHASES.map(named).find(Boolean) ?? recipe;
}
// What a recalculation would change: every line whose clock asked for differs from the one the
// plan was calculated with, in phase order. null when nothing would change. With `book` (the
// catalog's, #1271), a pin on a recipe the game data no longer has is no change: every
// recalculation leaves it out (lineClocksSettings), so `wanted` is without it and `stale` says
// so ("A recalculation drops the Power Shard pin on …"), or is '' without such pins.
export function lineClocksChange(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages'>,
  progress: Pick<ProgressState, 'lineClocks'>,
  book?: RecipeBook,
): { wanted: LineClocks; lines: ClockChange[]; stale: string } | null {
  if (!progress.lineClocks) return null;
  const known = book
      ? knownPins(progress.lineClocks, book, 'lineClocks')
      : { kept: progress.lineClocks, stale: [] },
    wanted = known.kept,
    gone = new Set(known.stale.map(([phase, recipe]) => phase + '/' + recipe)),
    planned = plannedClocks(plan);
  const lines: ClockChange[] = [];
  for (const phase of CLOCK_PHASES) {
    const recipes = new Set([
      ...Object.keys(planned[phase] ?? {}),
      ...Object.keys(wanted[phase] ?? {}),
    ]);
    for (const recipe of [...recipes].sort()) {
      if (gone.has(phase + '/' + recipe)) continue;
      const before = pinnedClockOf(planned, phase, recipe),
        after = pinnedClockOf(wanted, phase, recipe);
      if (before !== after)
        lines.push({ phase, recipe, name: clockLineName(plan, phase, recipe), before, after });
    }
  }
  const stale = known.stale.length
    ? staleNotice('lineClocks', staleNames(known.stale, book!, plan))
    : '';
  return lines.length ? { wanted, lines, stale } : null;
}
// The settings a recalculation with the clocks asked for starts from: the plan's, with `lineClocks`
// set to them, or without the field when none is asked for. With `book` (the catalog's, which every
// page passes, #1271), the pins on a recipe the game data no longer has are left out, since the
// planner refuses them; the notice and the new plan's warning name them (stale-pins.ts).
export function lineClocksSettings(
  settings: StoredSettings,
  wanted: LineClocks,
  book?: RecipeBook,
): StoredSettings {
  const out: StoredSettings = { ...settings };
  const clean = normalClocks(book ? knownPins(wanted, book, 'lineClocks').kept : wanted);
  if (Object.keys(clean).length) out.lineClocks = clean;
  else delete out.lineClocks;
  return out;
}
// "250% with 3 Power Shards in each machine", or "100% without Power Shards" for no pin.
export const clockPinWords = (clock: number | undefined): string =>
  clock === undefined
    ? '100% without Power Shards'
    : `${localeNumber(clock)}% with ${powerShardWords(shardsPerMachine(clock))} in each machine`;
// "Iron Rod (Phase 3): 250% with 3 Power Shards in each machine; Screws (Phase 3): 100% …".
export const clockChangeWords = (lines: ClockChange[]): string =>
  lines.map(line => `${line.name} (Phase ${line.phase}): ${clockPinWords(line.after)}`).join('; ');

// The clock a phase of the plan could not keep on line `recipe`, or undefined.
export const droppedClock = (
  plan: Pick<StoredCalculatedPlan, 'stages'>,
  phase: StageKey,
  recipe: string,
): LineClockDrop | undefined =>
  plan.stages[phase]?.lineClocksDropped?.find(drop => drop.recipe === recipe);
// The lines whose clocks the plan could not keep, as "Iron Rod in Phase 1", in phase order.
export const droppedClockNames = (plan: Pick<StoredCalculatedPlan, 'stages'>): string[] =>
  CLOCK_PHASES.flatMap(phase =>
    (plan.stages[phase]?.lineClocksDropped ?? []).map(
      drop => `${clockLineName(plan, phase, drop.recipe)} in Phase ${phase}`,
    ),
  );

// What the line's dialog says under its pin: the change a recalculation would make when the clock
// asked for differs from the plan's; otherwise the plan's clock and whether the phase kept it, or
// that the line runs at 100%.
export function shardPinNote(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages'>,
  progress: Pick<ProgressState, 'lineClocks'>,
  phase: StageKey,
  recipe: string,
): string {
  const planned = pinnedClockOf(plannedClocks(plan), phase, recipe),
    wanted = pinnedClockOf(wantedClocks(plan, progress), phase, recipe);
  if (planned !== wanted)
    return `Saved: ${clockPinWords(wanted)} after a recalculation. The plan keeps this line as it was calculated until you recalculate: the build plan offers “Recalculate in place with Power Shard pins”, which recalculates this profile and keeps the current version as a backup under Profiles.`;
  if (planned === undefined)
    return 'The planner runs this line at 100%. A pin runs every machine of it faster with Power Shards in the next recalculation, so the line needs fewer machines.';
  const drop = droppedClock(plan, phase, recipe);
  if (drop)
    return `Pinned to ${clockPinWords(planned)}, but Phase ${phase} could not keep the pin: ${clockReasonWords(drop.reason, plan.settings.lineShardBudget)}. The phase runs the line at 100%. ${clockRemedyWords(drop.reason, true)}`;
  return `Pinned to ${clockPinWords(planned)}: the plan keeps it exactly.`;
}
