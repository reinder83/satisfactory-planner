// Built production lines as existing capacity (#1176, slice 3 of #1172): a recalculation the user
// starts (Edit settings' "Recalculate in place", a new profile carried from another, the plan's
// recalculation offers) that carries progress on production lines sends the lines that stand in
// the profile it carries from (ticked as built, or partly built: builtLinesOf in
// public/state/carry.ts) as `settings.builtLines`. The solve counts them as existing capacity
// (addBuiltLines in planner/model.ts), so it keeps and extends them rather than replacing them,
// and Review says so. Nothing is stored beyond the plan's own settings, and nothing recalculates
// a stored plan: only these requests send the field.
import { builtLinesOf, recipeBook, type RecipeBook } from '../state.ts';
import { request } from './api.ts';
import { plural } from './format.ts';
import { calculated, currentProfile, currentSave, state, workspace } from './session.ts';
import { listNames } from '../wording.ts';
import type { BuiltLines, ContextReply, ProgressState } from '../types/index.ts';

// The catalog's recipes, which name the lines a source plan no longer has (built-match.ts) and tell
// the pins on a recipe the game data no longer has (stale-pins.ts, #1271); worked out again only
// when the workspace brings another catalog.
let builtBookOf: { catalog: unknown; book: RecipeBook } | undefined;
export function catalogRecipeBook(): RecipeBook {
  const catalog = workspace?.catalog;
  if (builtBookOf?.catalog !== catalog) builtBookOf = { catalog, book: recipeBook(catalog) };
  return builtBookOf.book;
}

// `settings` with `lines` as its built lines, or without any (a copy; the field is replaced).
export function withBuiltLines<T extends object>(settings: T, lines: BuiltLines | undefined): T {
  const { builtLines: _replaced, ...rest } = settings as T & { builtLines?: BuiltLines };
  return (lines ? { ...rest, builtLines: lines } : rest) as T;
}

// The lines that stand in the open profile (its plan and progress), for the plan's offers.
export const openBuiltLines = (): BuiltLines | undefined =>
  calculated ? builtLinesOf(state || { checks: {} }, calculated, catalogRecipeBook()) : undefined;

// The lines that stand in profile `profileId` of save `saveId`, when a recalculation carries its
// progress on production lines (`carry.factories`, on unless unticked): none without a source,
// or with that pick off. The open profile's are at hand; another's are read first (GET
// /api/context, which changes nothing).
export async function sourceBuiltLines(
  saveId: string | null,
  profileId: string | null,
  carry: Record<string, boolean> | undefined,
): Promise<BuiltLines | undefined> {
  if (!saveId || !profileId || carry?.factories === false) return undefined;
  if (currentSave?.id === saveId && currentProfile?.id === profileId && calculated)
    return openBuiltLines();
  const context = await request<ContextReply>('/api/context', {
    headers: { 'X-Save-Id': saveId, 'X-Profile-Id': profileId },
  });
  if (!context.plan) return undefined;
  const progress: Pick<ProgressState, 'checks' | 'builtMachines'> = context.state || { checks: {} };
  return builtLinesOf(progress, context.plan, catalogRecipeBook());
}

// How many lines stand, and in which phases.
export function builtCount(lines: BuiltLines | undefined): { lines: number; phases: string[] } {
  const phases = Object.entries(lines || {}).filter(([, rows]) => Object.keys(rows).length);
  return {
    lines: phases.reduce((total, [, rows]) => total + Object.keys(rows).length, 0),
    phases: phases.map(([phase]) => phase).sort(),
  };
}

// Review's sentence (Edit settings' "What changes", the carry panel of a new profile): "12
// production lines you built in Phases 3 and 4 are kept: the plan counts their machines as
// standing, so it keeps and extends them rather than replacing them, and plans the rest around
// them." Empty when none stand.
export function builtKeptText(lines: BuiltLines | undefined): string {
  const count = builtCount(lines);
  if (!count.lines) return '';
  const where = (count.phases.length > 1 ? 'Phases ' : 'Phase ') + listNames(count.phases);
  return (
    `${plural(count.lines, 'production line')} you built in ${where} ` +
    `${count.lines === 1 ? 'is' : 'are'} kept: the plan counts ` +
    `${count.lines === 1 ? 'its' : 'their'} machines as standing, so it keeps and extends ` +
    `${count.lines === 1 ? 'it' : 'them'} rather than replacing ` +
    `${count.lines === 1 ? 'it' : 'them'}, and plans the rest around ` +
    `${count.lines === 1 ? 'it' : 'them'}.`
  );
}
