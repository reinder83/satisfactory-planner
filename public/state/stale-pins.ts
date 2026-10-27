// Pins on a recipe the game data no longer has (#1271): a somersloop pin (`sloopPins`, #1235) or a
// Power Shard pin (`lineClocks`, #1239) is saved on a recipe id, in the progress state and frozen
// in a plan's settings. When a later game-data update removes the recipe (or, for somersloops, its
// machine can no longer take them), the planner refuses the pin (sloopPinsSetting and
// lineClocksSetting in planner/settings.ts), and no line's dialog can clear it, since no plan row
// has that recipe. So every recalculation the user starts leaves those pins out of its settings
// (sloopPinsSettings in app/sloop-pins.ts, lineClocksSettings in app/shard-pins.ts), the notice
// that offers the recalculation names them, and a recalculation in place drops them from the
// progress (keepAsked in carry.ts) and adds a plan warning that names them (stalePinWarnings).
// Never silently, and no state version: an existing field only loses lines. An import drops the
// same pins with the game data itself (dropUnknownPins in transfer.ts). Round-up and the payoff
// ranking solve the plan's own settings, so they leave those pins out too (knownPlanSettings,
// #1273): round-up names them in its new plan's warnings, the ranking in its reply.
//
// The book is the catalog's (recipeBook, built-match.ts), as both editions have it: the same game
// data the planner checks against. An empty book (no catalog) knows every recipe, so nothing is
// ever dropped for want of one.
import { AMPLIFY_SLOTS } from '../somersloops.ts';
import { listNames } from '../wording.ts';
import type { RecipeBook } from './built-match.ts';
import type { StageKey, StoredCalculatedPlan } from '../types/index.ts';

export type PinField = 'sloopPins' | 'lineClocks';
type PinMap = Partial<Record<StageKey, Record<string, number>>>;
const PHASES: StageKey[] = ['1', '2', '3', '4', '5'];
const TWIN = 'amp:';

// Whether a pin of `field` on `recipe` is one the planner takes: a recipe the book has (not a
// generator line, whose main product is power), and for somersloops one whose machine has slots
// (amplifySlots; every recipe of such a machine draws power).
export function pinnable(book: RecipeBook, field: PinField, recipe: string): boolean {
  if (!book.size) return true;
  const facts = book.get(recipe);
  if (!facts || facts.product?.startsWith('power:')) return false;
  return field === 'lineClocks' || (AMPLIFY_SLOTS[facts.machine] ?? 0) > 0;
}

// `pins` without the lines the planner no longer takes (pinnable), and those lines as
// [phase, recipe] in phase order. A phase left without lines goes; the map itself stays, even
// empty, since an empty map asks for no pins.
export function knownPins<T extends PinMap>(
  pins: T,
  book: RecipeBook,
  field: PinField,
): { kept: T; stale: [StageKey, string][] } {
  const kept: PinMap = {};
  const stale: [StageKey, string][] = [];
  for (const phase of PHASES) {
    const lines = pins[phase];
    if (!lines) continue;
    const ids = Object.keys(lines)
      .sort()
      .filter(id => {
        if (pinnable(book, field, id)) return true;
        stale.push([phase, id]);
        return false;
      });
    // Each id is a key of `lines`, so its value is there.
    if (ids.length) kept[phase] = Object.fromEntries(ids.map(id => [id, lines[id]!]));
  }
  return { kept: (stale.length ? kept : pins) as T, stale };
}

// "Iron Rod in Phase 3" for each stale line: named as the book names its recipe, else as a row of
// `plan` does (its plain row, or its twin without "(somersloop amplified)"), else by its id.
export function staleNames(
  stale: [StageKey, string][],
  book: RecipeBook,
  plan?: Pick<StoredCalculatedPlan, 'stages'> | null,
): string[] {
  const rowName = (recipe: string) => {
    for (const phase of PHASES) {
      const rows = plan?.stages[phase]?.rows ?? [];
      const plain = rows.find(row => row.id === recipe)?.name;
      const twin = rows.find(row => row.id === TWIN + recipe)?.name;
      const name = plain ?? twin?.replace(/ \(somersloop amplified\)$/, '');
      if (name) return name;
    }
    return undefined;
  };
  return stale.map(
    ([phase, recipe]) => `${book.get(recipe)?.name ?? rowName(recipe) ?? recipe} in Phase ${phase}`,
  );
}

const KIND: Record<PinField, string> = { sloopPins: 'somersloop', lineClocks: 'Power Shard' };
const REASON: Record<PinField, string> = {
  sloopPins:
    'this planner has no such recipe any more, or its machine can no longer take somersloops',
  lineClocks: 'this planner has no such recipe any more',
};
// The notice's sentence before a recalculation: "A recalculation drops the Power Shard pin on
// Recipe_Gone_C in Phase 3, because this planner has no such recipe any more."
export const staleNotice = (field: PinField, names: string[]): string =>
  `A recalculation drops the ${KIND[field]} pin${names.length === 1 ? '' : 's'} on ${listNames(names)}, because ${REASON[field]}.`;
// The plan warning after a recalculation in place dropped them.
export const staleWarning = (field: PinField, names: string[]): string =>
  `This recalculation dropped the ${KIND[field]} pin${names.length === 1 ? '' : 's'} on ${listNames(names)}, because ${REASON[field]}.`;

// The plan warnings for the pins a recalculation of `previous` leaves out: the pins it asked for
// (the progress state's, else its plan's own, as wantedPins and wantedClocks take them) that the
// planner no longer takes, one warning per kind.
export function stalePinWarnings(
  previous: {
    state: Partial<Record<PinField, PinMap>>;
    plan?: Pick<StoredCalculatedPlan, 'settings' | 'stages'> | null;
  },
  book: RecipeBook | undefined,
): string[] {
  if (!book) return [];
  return (['sloopPins', 'lineClocks'] as const).flatMap(field => {
    const asked = previous.state[field] ?? previous.plan?.settings[field];
    const stale = asked ? knownPins(asked, book, field).stale : [];
    return stale.length ? [staleWarning(field, staleNames(stale, book, previous.plan))] : [];
  });
}
// What the payoff ranking says it left out (#1273): it only reports, so nothing is dropped.
export const staleRankNote = (field: PinField, names: string[]): string =>
  `This ranking left out the ${KIND[field]} pin${names.length === 1 ? '' : 's'} on ${listNames(names)}, because ${REASON[field]}.`;

// The settings round-up and the payoff ranking solve (#1273): the plan's own, frozen with the pins
// it was calculated with, less the pins the planner no longer takes (knownPins), and one sentence
// per kind that names them (`say`: staleWarning for round-up's new plan, staleRankNote for the
// ranking). A kind left without pins goes, as sloopPinsSettings leaves it out. Settings without
// such pins are the very same object, so those plans solve exactly as before.
export function knownPlanSettings<S extends Partial<Record<PinField, PinMap>>>(
  plan: Pick<StoredCalculatedPlan, 'stages'> & { settings: S },
  book: RecipeBook,
  say: (field: PinField, names: string[]) => string,
): { settings: S; stale: string[] } {
  let settings = plan.settings;
  const stale: string[] = [];
  for (const field of ['sloopPins', 'lineClocks'] as const) {
    const pins = settings[field];
    const known = pins && knownPins(pins, book, field);
    if (!known?.stale.length) continue;
    const { [field]: _stale, ...rest } = settings;
    settings = (Object.keys(known.kept).length ? { ...rest, [field]: known.kept } : rest) as S;
    stale.push(say(field, staleNames(known.stale, book, plan)));
  }
  return { settings, stale };
}

// `plan` with `warnings` added to its own; the same plan when there are none.
export const withWarnings = <P extends object>(plan: P, warnings: string[]): P =>
  warnings.length
    ? { ...plan, warnings: [...((plan as { warnings?: string[] }).warnings ?? []), ...warnings] }
    : plan;
