// What the ticks say the player already has beyond what the plan counts (#1068, "ticks keep it
// current"). The plan's "What you already have" settings (ownedMiner, ownedBelt, ownedAlternates,
// ownedGenerators) are set once, in All settings or the guided start; the player then keeps
// ticking steps. This reads those ticks and names what they show beyond the settings:
//
// - a better miner: the HUB milestone that unlocks Miner Mk.2 or Mk.3 ticked (`unlock-<entry>`
//   of MINER_MARKS: Advanced Steel Production, Leading-Edge Production);
// - a better belt: the milestone of Mk.3 to Mk.6 belts ticked (`unlock-<entry>` of BELT_MARKS);
// - an alternate: a hard-drive alternate's unlock step ticked (`recipe-unlock-<recipe>`);
// - generators: a generator line marked running (`calc-<phase>-<row id>`, a row with negative
//   power in one of the OWNED_GENERATORS buildings), as many as that phase runs.
//
// Each counts only where it genuinely changes the plan from the working phase on (`phase`,
// ticksPhase: the saved phase raised to the start phase; earlier phases are passed): a miner or
// belt only under mining per phase (settings.phaseMining), and only when that phase's mark with
// it (phaseMiner, phaseBelt: a survey's miner still caps it) is better than with the plan's own
// setting, so a milestone the phase unlocks anyway is not more; an alternate only when the plan's
// recipe pool does not hold it already (Recipe access 'all', a picked one under 'custom', an owned
// one, a pure ingot alternate with pureIngots on, as recipePool in planner/recipes.ts reads them);
// generators only when some phase from the working phase on that runs that building runs fewer
// (the phase before's generators are kept already, carryGenerators in public/power.ts). A plan
// guide (a profile moved from the retired handbook) has steps of its own and is left out.
//
// Nothing here is stored or sent. The build plan's notice (ui/plan/OwnedTicksNotice.vue) offers
// the recalculation in place with the plan's settings raised to it (withOwnedFound), and Edit
// settings starts from those settings (startEdit in wizard/wizard.ts).
import {
  BELT_MARKS,
  MINER_MARKS,
  OWNED_GENERATORS,
  ownedGeneratorCounts,
  phaseBelt,
  phaseMiner,
} from '../preferences.ts';
import { listNames } from '../wording.ts';
import { num } from './format.ts';
import type {
  CatalogRecipe,
  OwnedGeneratorMachine,
  OwnedGenerators,
  Phase,
  StoredCalculatedPlan,
  StoredSettings,
  StoredStage,
} from '../types/index.ts';

// What the ticks show beyond the plan's settings: the miner mark (2 or 3), the belt mark (3 to 6),
// the hard-drive alternates (recipe ids, sorted) and the generators by building, each as the
// owned setting it would raise. Fields with nothing found are absent (the lists empty).
export interface OwnedFound {
  miner?: number;
  belt?: number;
  alternates: string[];
  generators: OwnedGenerators;
}

type Checks = Record<string, boolean | undefined>;
type TicksPlan = Pick<StoredCalculatedPlan, 'settings' | 'stages' | 'guide'>;

// The phase the ticks are measured against: the saved working phase (Post Phase 5 plans with Phase
// 5), raised to the profile's start phase, since the phases before it plan no production.
export function ticksPhase(plan: Pick<StoredCalculatedPlan, 'settings'>, saved?: Phase): number {
  const start = Number(plan.settings.phase || 1) || 1;
  const working = saved === 'post' ? 5 : Number(saved) || start;
  return Math.min(5, Math.max(start, working));
}

// The best mark of `marks` whose milestone is ticked, as its number ("Mk.4" is 4); 0 for none.
function tickedMark(
  marks: readonly { mark: number | string; entry: string | null }[],
  checks: Checks,
) {
  let best = 0;
  for (const { mark, entry } of marks)
    if (entry && checks['unlock-' + entry] === true)
      best = Math.max(best, typeof mark === 'number' ? mark : Number(mark.slice(3)));
  return best;
}

// A better miner than the plan gives the working phase: the ticked mark, or undefined.
function minerFound(settings: StoredSettings, checks: Checks, phase: number): number | undefined {
  const ticked = tickedMark(MINER_MARKS, checks);
  if (!settings.phaseMining || ticked < 2) return undefined;
  const survey = settings.extraction;
  return phaseMiner(phase, survey, ticked).mark >
    phaseMiner(phase, survey, settings.ownedMiner).mark
    ? ticked
    : undefined;
}

// A better belt than the plan gives the working phase: the ticked mark (3 to 6), or undefined.
function beltFound(settings: StoredSettings, checks: Checks, phase: number): number | undefined {
  const ticked = tickedMark(
    BELT_MARKS.filter(belt => belt.tier > 2),
    checks,
  );
  if (!settings.phaseMining || ticked < 3) return undefined;
  return phaseBelt(phase, ticked).cap > phaseBelt(phase, settings.ownedBelt).cap
    ? ticked
    : undefined;
}

// Whether the plan's recipe pool holds the alternate already, whatever the ticks say.
function inPool(settings: StoredSettings, recipe: CatalogRecipe): boolean {
  return (
    settings.recipes === 'all' ||
    (settings.recipes === 'custom' && (settings.alternateRecipes || []).includes(recipe.id)) ||
    (settings.ownedAlternates || []).includes(recipe.id) ||
    (!!settings.pureIngots && !!recipe.pure)
  );
}

// The hard-drive alternates ticked as unlocked that the plan's pool does not hold, sorted. MAM and
// milestone recipes come with their research step, so they are not counted.
function alternatesFound(
  settings: StoredSettings,
  checks: Checks,
  alternates: readonly CatalogRecipe[],
): string[] {
  return alternates
    .filter(
      recipe =>
        !recipe.mam &&
        !recipe.milestone &&
        checks['recipe-unlock-' + recipe.id] === true &&
        !inPool(settings, recipe),
    )
    .map(recipe => recipe.id)
    .sort();
}

const isOwnedKind = (machine: string): machine is OwnedGeneratorMachine =>
  OWNED_GENERATORS.some(kind => kind.machine === machine);

// The generators a stage runs in `machine`: its grid's count (the kept and owned ones included),
// else, for a plan stored before the grid (#1064), its lines' machines. 0 for none.
function stageGenerators(stage: StoredStage, machine: string): number {
  const entry = stage.grid?.generators.find(generator => generator.machine === machine);
  if (entry) return entry.machines;
  return (stage.rows || [])
    .filter(row => row.power < 0 && row.machine === machine)
    .reduce((sum, row) => sum + Math.ceil(row.machines), 0);
}

// How many generators of each owned kind the ticks show built: per phase, a building whose
// generator lines are all marked running counts what the phase runs in it, one with only some
// marked counts those lines' machines; the most any phase shows, since a phase keeps the
// generators the phase before built.
function tickedGenerators(plan: TicksPlan, checks: Checks): OwnedGenerators {
  const built: OwnedGenerators = {};
  for (const [phase, stage] of Object.entries(plan.stages || {}) as [string, StoredStage][]) {
    if (!stage?.feasible) continue;
    const lines = (stage.rows || []).filter(row => row.power < 0 && isOwnedKind(row.machine));
    for (const machine of new Set(lines.map(row => row.machine))) {
      if (!isOwnedKind(machine)) continue;
      const own = lines.filter(row => row.machine === machine),
        ticked = own.filter(row => checks['calc-' + phase + '-' + row.id] === true);
      if (!ticked.length) continue;
      const count =
        ticked.length === own.length
          ? stageGenerators(stage, machine)
          : ticked.reduce((sum, row) => sum + Math.ceil(row.machines), 0);
      built[machine] = Math.max(built[machine] ?? 0, count);
    }
  }
  return built;
}

// The ticked generators beyond what the plan counts: a building whose ticked count is more than
// the plan's setting and than some phase from `phase` on that runs that building runs.
function generatorsFound(plan: TicksPlan, checks: Checks, phase: number): OwnedGenerators {
  const found: OwnedGenerators = {},
    owned = plan.settings.ownedGenerators || {};
  for (const [machine, count] of Object.entries(tickedGenerators(plan, checks)) as [
    OwnedGeneratorMachine,
    number,
  ][]) {
    if (count <= (owned[machine] ?? 0)) continue;
    const fewer = Object.entries(plan.stages || {}).some(([key, stage]) => {
      if (Number(key) < phase || !stage?.feasible) return false;
      const runs = stageGenerators(stage, machine);
      return runs > 0 && runs < count;
    });
    if (fewer) found[machine] = count;
  }
  return found;
}

// What the ticks show beyond the plan's settings from `phase` on (ticksPhase), or null when
// nothing; `alternates` is the catalog's (workspace.catalog.alternates, catalog() in planner.ts).
export function ownedFromTicks(
  plan: TicksPlan | null | undefined,
  checks: Checks,
  phase: number,
  alternates: readonly CatalogRecipe[] = [],
): OwnedFound | null {
  if (!plan?.settings || plan.guide) return null;
  const settings = plan.settings;
  const found: OwnedFound = {
    ...markField('miner', minerFound(settings, checks, phase)),
    ...markField('belt', beltFound(settings, checks, phase)),
    alternates: alternatesFound(settings, checks, alternates),
    generators: generatorsFound(plan, checks, phase),
  };
  return found.miner ||
    found.belt ||
    found.alternates.length ||
    Object.keys(found.generators).length
    ? found
    : null;
}
const markField = <K extends 'miner' | 'belt'>(key: K, value: number | undefined) =>
  value ? ({ [key]: value } as Pick<OwnedFound, K>) : {};

// The plan's settings with the owned fields raised to what the ticks show: the miner and belt
// marks, the alternates added to those owned (sorted, as settings() keeps them), the generators'
// counts raised. Every other setting is the plan's own.
export function withOwnedFound<S extends StoredSettings>(settings: S, found: OwnedFound): S {
  const generators = ownedGeneratorCounts({ ...settings.ownedGenerators, ...found.generators });
  return {
    ...settings,
    ...(found.miner ? { ownedMiner: found.miner } : {}),
    ...(found.belt ? { ownedBelt: found.belt } : {}),
    ...(found.alternates.length
      ? {
          ownedAlternates: [
            ...new Set([...(settings.ownedAlternates || []), ...found.alternates]),
          ].sort(),
        }
      : {}),
    ...(Object.keys(found.generators).length && generators ? { ownedGenerators: generators } : {}),
  };
}

// Whether `found` holds something `dismissed` (what the notice showed when it was dismissed) did
// not: a better mark, another alternate, or more of a generator. A dismissal hides the notice
// until then.
export function foundSince(found: OwnedFound, dismissed: OwnedFound | null): boolean {
  if (!dismissed) return true;
  return (
    (found.miner ?? 0) > (dismissed.miner ?? 0) ||
    (found.belt ?? 0) > (dismissed.belt ?? 0) ||
    found.alternates.some(id => !dismissed.alternates.includes(id)) ||
    (Object.entries(found.generators) as [OwnedGeneratorMachine, number][]).some(
      ([machine, count]) => count > (dismissed.generators[machine] ?? 0),
    )
  );
}

// A dismissal as stored (in this browser, `planner-ticks-notice`, session.ts), checked: anything
// that is not such a record is null, so the notice shows.
export function dismissedFound(value: unknown): OwnedFound | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const mark = (entry: unknown) =>
    typeof entry === 'number' && Number.isInteger(entry) && entry > 0 ? entry : undefined;
  const miner = mark(record.miner),
    belt = mark(record.belt);
  return {
    ...(miner ? { miner } : {}),
    ...(belt ? { belt } : {}),
    alternates: Array.isArray(record.alternates)
      ? record.alternates.filter((id): id is string => typeof id === 'string')
      : [],
    generators: ownedGeneratorCounts(record.generators) || {},
  };
}

// What was found, in words, by kind: "Miner Mk.3", "Mk.5 belts", the alternates by name (the
// catalog's, without "Alternate: ") and "6 Coal Generators".
export interface FoundWords {
  unlocked: string[];
  alternates: string[];
  generators: string[];
}
export function foundWords(
  found: OwnedFound,
  alternates: readonly CatalogRecipe[] = [],
): FoundWords {
  const name = (id: string) => alternates.find(recipe => recipe.id === id)?.name ?? id;
  return {
    unlocked: [
      ...(found.miner ? [`Miner Mk.${found.miner}`] : []),
      ...(found.belt ? [`Mk.${found.belt} belts`] : []),
    ],
    alternates: found.alternates.map(name),
    generators: (Object.entries(found.generators) as [string, number][]).map(
      ([machine, count]) => `${num(count)} ${machine}${count === 1 ? '' : 's'}`,
    ),
  };
}

// The alternates as a phrase: "the Steel Screw alternate", "the Steel Screw and Cast Screw
// alternates", past five "the Steel Screw, … and 7 more alternates".
export function alternatesPhrase(names: readonly string[]): string {
  if (!names.length) return '';
  const shown = names.length > 5 ? [...names.slice(0, 4), `${names.length - 4} more`] : names;
  return `the ${listNames(shown)} ${names.length === 1 ? 'alternate' : 'alternates'}`;
}

// Everything found, as one list for a sentence: "Miner Mk.3, Mk.5 belts, the Steel Screw
// alternate and 6 Coal Generators running".
export function foundList(words: FoundWords): string {
  return listNames([
    ...words.unlocked,
    ...(words.alternates.length ? [alternatesPhrase(words.alternates)] : []),
    ...(words.generators.length ? [listNames(words.generators) + ' running'] : []),
  ]);
}
