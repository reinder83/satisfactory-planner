// Somersloop pins per production line (#1235, slice 10 of #1079). A pin fixes how many somersloops
// one line of a phase takes (the recipe's plain row and its amplified twin 'amp:<recipe>' are one
// line); 0 asks for none, and the planner places the rest of the phase's amplification budget
// itself. The pins are saved in the progress state (`sloopPins`, state version 24, from the line's
// dialog, ui/detail/SloopPinChoice.vue) and change nothing until the user starts a recalculation
// (ui/plan/SloopPinsRecalc.vue), which freezes them in the new plan's `settings.sloopPins`; a state
// without the field follows the plan's own pins. The planner keeps them in planner/pins.ts, or
// plans a phase without the ones it cannot keep and records them in `sloopPinsDropped`.
//
// Plain functions of the plan and the progress, no session: the pages pass them in.
import {
  AMPLIFIER_PHASE,
  amplifySlots,
  pinReasonWords,
  pinRemedyWords,
  SLOOP_PIN_MAX,
} from '../somersloops.ts';
import { localeNumber } from '../wording.ts';
import type {
  CalcRow,
  ProgressState,
  SloopPinDrop,
  SloopPins,
  StageKey,
  StoredCalculatedPlan,
  StoredSettings,
} from '../types/index.ts';

const PIN_PHASES: StageKey[] = ['1', '2', '3', '4', '5'];
const PIN_TWIN = 'amp:';

// The recipe a row's pin names: the row's own id, or its plain recipe's for an amplified twin.
export const pinRecipe = (row: Pick<CalcRow, 'id'>): string =>
  row.id.startsWith(PIN_TWIN) ? row.id.slice(PIN_TWIN.length) : row.id;
// The somersloops one amplified machine of a row's line takes (its machine's slots), or 0 when the
// line cannot be pinned: a machine without slots or one that makes power, a factory's own line for
// an item made on site (#875), a storage-only line (#1061), or a phase before the MAM's Production
// Amplifier (#1056). An amplified twin's power is four times its recipe's, still above 0.
export function pinSlots(
  row: Pick<CalcRow, 'machine' | 'power' | 'onSite' | 'stock'>,
  phase: StageKey,
): number {
  if (row.onSite || row.stock || Number(phase) < AMPLIFIER_PHASE) return 0;
  return amplifySlots(row);
}
// The most somersloops a pin on a line of `slots` may name: SLOOP_PIN_MAX in whole machines.
export const pinMax = (slots: number): number =>
  slots > 0 ? Math.floor(SLOOP_PIN_MAX / slots) * slots : 0;
// Whether `sloops` is a pin a line of `slots` takes: whole machines, from 0 to pinMax.
export const validPin = (sloops: number, slots: number): boolean =>
  slots > 0 &&
  Number.isInteger(sloops) &&
  sloops >= 0 &&
  sloops <= pinMax(slots) &&
  sloops % slots === 0;

// The pins a plan was calculated with.
export const plannedPins = (plan: Pick<StoredCalculatedPlan, 'settings'>): SloopPins =>
  plan.settings.sloopPins ?? {};
// The pins the user asks for: the progress state's once they changed one, else the plan's.
export const wantedPins = (
  plan: Pick<StoredCalculatedPlan, 'settings'>,
  progress: Pick<ProgressState, 'sloopPins'>,
): SloopPins => progress.sloopPins ?? plannedPins(plan);
// The pin `pins` puts on line `recipe` of `phase`, or undefined when it has none.
export const pinOf = (pins: SloopPins, phase: StageKey, recipe: string): number | undefined =>
  pins[phase]?.[recipe];
// `pins` with each phase's keys sorted and without an empty phase, as the planner and validateState
// keep them.
export function normalPins(pins: SloopPins): SloopPins {
  const out: SloopPins = {};
  for (const phase of PIN_PHASES) {
    const lines = pins[phase] ?? {};
    const ids = Object.keys(lines).sort();
    // Each id is a key of `lines`, so its count is there.
    if (ids.length) out[phase] = Object.fromEntries(ids.map(id => [id, lines[id]!]));
  }
  return out;
}
// `pins` with line `recipe` of `phase` pinned to `sloops`, or without a pin (undefined), normalised.
export function withPin(
  pins: SloopPins,
  phase: StageKey,
  recipe: string,
  sloops: number | undefined,
): SloopPins {
  const lines = { ...(pins[phase] ?? {}) };
  if (sloops === undefined) delete lines[recipe];
  else lines[recipe] = sloops;
  return normalPins({ ...pins, [phase]: lines });
}
// Whether two maps pin the same lines to the same counts.
export const samePins = (a: SloopPins, b: SloopPins): boolean =>
  JSON.stringify(normalPins(a)) === JSON.stringify(normalPins(b));

// A line whose pin a recalculation would change: its phase, recipe, name, and the pin before (in
// the plan) and after (asked for), undefined for none.
export interface PinChange {
  phase: StageKey;
  recipe: string;
  name: string;
  before: number | undefined;
  after: number | undefined;
}
// The name of line `recipe` of `phase` as its plain row gives it, else as its twin does without
// "(somersloop amplified)", else as any phase names it, else its id.
function pinLineName(
  plan: Pick<StoredCalculatedPlan, 'stages'>,
  phase: StageKey,
  recipe: string,
): string {
  const named = (key: StageKey) => {
    const rows = plan.stages[key]?.rows ?? [];
    const plain = rows.find(row => row.id === recipe);
    const twin = rows.find(row => row.id === PIN_TWIN + recipe);
    return plain?.name ?? twin?.name.replace(/ \(somersloop amplified\)$/, '');
  };
  return named(phase) ?? PIN_PHASES.map(named).find(Boolean) ?? recipe;
}
// What a recalculation would change (#1235): every line whose pin asked for differs from the one
// the plan was calculated with, in phase order. null when nothing would change.
export function sloopPinsChange(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages'>,
  progress: Pick<ProgressState, 'sloopPins'>,
): { wanted: SloopPins; lines: PinChange[] } | null {
  if (!progress.sloopPins) return null;
  const wanted = progress.sloopPins,
    planned = plannedPins(plan);
  const lines: PinChange[] = [];
  for (const phase of PIN_PHASES) {
    const recipes = new Set([
      ...Object.keys(planned[phase] ?? {}),
      ...Object.keys(wanted[phase] ?? {}),
    ]);
    for (const recipe of [...recipes].sort()) {
      const before = pinOf(planned, phase, recipe),
        after = pinOf(wanted, phase, recipe);
      if (before !== after)
        lines.push({ phase, recipe, name: pinLineName(plan, phase, recipe), before, after });
    }
  }
  return lines.length ? { wanted, lines } : null;
}
// The settings a recalculation with the pins asked for starts from: the plan's, with `sloopPins`
// set to them, or without the field when none is asked for.
export function sloopPinsSettings(settings: StoredSettings, wanted: SloopPins): StoredSettings {
  const out: StoredSettings = { ...settings };
  const clean = normalPins(wanted);
  if (Object.keys(clean).length) out.sloopPins = clean;
  else delete out.sloopPins;
  return out;
}
// "8 somersloops", "1 somersloop", "none", or "the planner's choice" for no pin.
export const pinWords = (sloops: number | undefined): string =>
  sloops === undefined
    ? 'the planner’s choice'
    : sloops === 0
      ? 'none'
      : `${localeNumber(sloops)} somersloop${sloops === 1 ? '' : 's'}`;
// "Heavy Modular Frame (Phase 4): 8 somersloops; Iron Plate (Phase 3): the planner's choice".
export const pinChangeWords = (lines: PinChange[]): string =>
  lines.map(line => `${line.name} (Phase ${line.phase}): ${pinWords(line.after)}`).join('; ');
// The phases whose pins asked for add up to more than the plan's amplification budget, which a
// recalculation would plan without them ('budget' in planner/pins.ts), each with its total.
export function pinsOverBudget(
  plan: Pick<StoredCalculatedPlan, 'settings'>,
  wanted: SloopPins,
): [StageKey, number][] {
  const budget = plan.settings.amplifySloops ?? 0;
  return PIN_PHASES.filter(phase => Number(phase) >= AMPLIFIER_PHASE)
    .map((phase): [StageKey, number] => [
      phase,
      Object.values(wanted[phase] ?? {}).reduce((sum, sloops) => sum + sloops, 0),
    ])
    .filter(([, total]) => total > budget);
}

// The pin a phase of the plan could not keep on line `recipe` (#1235), or undefined.
export const droppedPin = (
  plan: Pick<StoredCalculatedPlan, 'stages'>,
  phase: StageKey,
  recipe: string,
): SloopPinDrop | undefined =>
  plan.stages[phase]?.sloopPinsDropped?.find(drop => drop.recipe === recipe);
// Every pin the plan could not keep, as [phase, drop], in phase order.
export const droppedPins = (
  plan: Pick<StoredCalculatedPlan, 'stages'>,
): [StageKey, SloopPinDrop][] =>
  PIN_PHASES.flatMap(phase =>
    (plan.stages[phase]?.sloopPinsDropped ?? []).map((drop): [StageKey, SloopPinDrop] => [
      phase,
      drop,
    ]),
  );

// The lines whose pins the plan could not keep, as "Heavy Modular Frame in Phase 4", in phase order.
export const droppedPinNames = (plan: Pick<StoredCalculatedPlan, 'stages'>): string[] =>
  droppedPins(plan).map(
    ([phase, drop]) => `${pinLineName(plan, phase, drop.recipe)} in Phase ${phase}`,
  );

// What the line's dialog says under its pin (#1235): the change a recalculation would make when the
// pin asked for differs from the plan's; otherwise the plan's pin and whether the phase kept it, or
// that the planner chooses.
export function pinNote(
  plan: Pick<StoredCalculatedPlan, 'settings' | 'stages'>,
  progress: Pick<ProgressState, 'sloopPins'>,
  phase: StageKey,
  recipe: string,
): string {
  const planned = pinOf(plannedPins(plan), phase, recipe),
    wanted = pinOf(wantedPins(plan, progress), phase, recipe);
  if (planned !== wanted)
    return `Saved: ${pinWords(wanted)} after a recalculation. The plan keeps this line as it was calculated until you recalculate: the build plan offers “Recalculate in place with somersloop pins”, which recalculates this profile and keeps the current version as a backup under Profiles.`;
  if (planned === undefined)
    return 'The planner chooses how many somersloops this line takes. A pin fixes it in the next recalculation, and the planner places the rest of the phase’s budget itself.';
  const drop = droppedPin(plan, phase, recipe);
  if (drop)
    return `Pinned to ${pinWords(planned)}, but Phase ${phase} could not keep the pin: ${pinReasonWords(drop.reason, plan.settings.amplifySloops ?? 0)}. The phase is planned without it. ${pinRemedyWords(drop.reason, true)}`;
  return `Pinned to ${pinWords(planned)}: the plan keeps it exactly, and the planner places the rest of the phase’s budget itself.`;
}
