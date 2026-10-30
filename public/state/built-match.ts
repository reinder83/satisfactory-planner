// Built lines a plan changed (#1175, slice 2 of #1172): what a production line ticked as built was
// and which line of a new plan it turned into. A carry (carryLines in carry.ts) and the build plan
// (public/app/built-lines.ts) both match a built line to its successor here, so the task the step
// shows is the one the carry counted.
//
// The machines that stand on a line the new plan no longer has stay in `builtMachines` under that
// line's own check key (`calc-<phase>-<row id>`, state version 19, no new field): ticked, it is no
// longer needed ("can be dismantled or kept"); not ticked, its machines are to be switched to the
// successor, the first line of the same phase that makes the same main product and is not ticked
// yet (same machine first, then plan order). Once every such line is ticked, the switch is done.
// A line's main product is its first output; a generator's is the power its building makes, so
// Fuel Generators on Rocket Fuel switch to Fuel Generators on Fuel.
import type { CalcRow, Catalog, StoredCalculatedPlan } from '../types/index.ts';

// What a line was: its name, its machine and its main product (undefined when not known).
export interface LineFacts {
  name: string;
  machine: string;
  product: string | undefined;
}
// The catalog's recipes by id (both editions have the catalog: planner.ts catalog(), the
// browser edition's catalog.json), for lines no plan at hand has any more.
export type RecipeBook = ReadonlyMap<string, LineFacts>;

// A line's name in a change task: a plan row's without "Alternate: ", as the catalog names it.
export const builtLineName = (name: string): string => name.replace(/^Alternate: /, '');

const AMP = 'amp:';
const AMP_NAME = ' (somersloop amplified)';

// The book of a catalog: standard recipes, alternates (named without "Alternate: ") and generator
// lines (their power). An empty book without one.
export function recipeBook(
  catalog: Partial<Pick<Catalog, 'alternates' | 'standardRecipes' | 'generatorLines'>> | undefined,
): RecipeBook {
  const book = new Map<string, LineFacts>();
  for (const recipe of [...(catalog?.standardRecipes || []), ...(catalog?.alternates || [])])
    book.set(recipe.id, {
      name: recipe.name,
      machine: recipe.machine,
      product: Object.keys(recipe.outputs || {})[0],
    });
  for (const line of catalog?.generatorLines || [])
    book.set(line.id, { name: line.name, machine: line.machine, product: 'power:' + line.machine });
  return book;
}

// A row's main product (above): its first output, or for a generator its building's power.
const mainProduct = (row: Pick<CalcRow, 'outputs' | 'power' | 'machine'>) =>
  row.power < 0 ? 'power:' + row.machine : Object.keys(row.outputs || {})[0];

const factsOfRow = (row: CalcRow): LineFacts => ({
  name: builtLineName(row.name),
  machine: row.machine,
  product: mainProduct(row),
});

// What the line with row id `rowId` was: a row of that id in any phase of `plans` (the plans at
// hand), else its recipe in `book` ('amp:<recipe>' an amplified twin, '<recipe>:<group>' a
// factory's own line); else only its id, with no machine or product.
export function lineFacts(
  rowId: string,
  plans: readonly (Pick<StoredCalculatedPlan, 'stages'> | null | undefined)[],
  book: RecipeBook | undefined,
): LineFacts {
  for (const plan of plans)
    for (const stage of Object.values(plan?.stages || {})) {
      const row = stage?.rows?.find(candidate => candidate.id === rowId);
      if (row) return factsOfRow(row);
    }
  const amplified = rowId.startsWith(AMP);
  const recipe = (amplified ? rowId.slice(AMP.length) : rowId).split(':')[0] ?? '';
  const facts = book?.get(recipe);
  if (!facts) return { name: rowId, machine: '', product: undefined };
  return amplified ? { ...facts, name: facts.name + AMP_NAME } : facts;
}

// The rows of phase `stageKey` ('1'-'5') of `plan`; none for a phase it does not have.
export const stageRowsOf = (
  plan: Pick<StoredCalculatedPlan, 'stages'> | null | undefined,
  stageKey: string,
): CalcRow[] =>
  Object.entries(plan?.stages || {}).find(([phase]) => phase === stageKey)?.[1]?.rows || [];

// The rows of `rows` (one phase's) other than `exceptId` that make `product`: the lines a built
// line of another recipe could switch to.
export const sameProduct = (
  rows: readonly CalcRow[],
  product: string | undefined,
  exceptId: string,
): CalcRow[] =>
  product === undefined
    ? []
    : rows.filter(row => row.id !== exceptId && mainProduct(row) === product);

// The successor of a built line no longer in the plan (above): of the rows making its product,
// the first not ticked whose machine is the line's, else the first not ticked; null when every
// such row is ticked or there is none.
export function successorOf(
  facts: LineFacts,
  rowId: string,
  rows: readonly CalcRow[],
  checks: Readonly<Record<string, boolean>>,
  stageKey: string,
): CalcRow | null {
  const open = sameProduct(rows, facts.product, rowId).filter(
    row => !checks['calc-' + stageKey + '-' + row.id],
  );
  return open.find(row => row.machine === facts.machine) ?? open[0] ?? null;
}

// A check key's phase and row id: 'calc-4-Recipe_X' → ['4', 'Recipe_X']; null for another key.
export function calcKeyParts(key: string): [stageKey: string, rowId: string] | null {
  const found = /^calc-([1-5])-(.+)$/.exec(key);
  // A match has both groups.
  return found ? [found[1]!, found[2]!] : null;
}
