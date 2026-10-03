// The planner's data files, typed for the node tests (#572). A JSON import widens string unions
// and has no Handbook or Recipe type, so the files are read as unknown and narrowed by the
// shape checks below, which fail loudly if a file stops looking like its type.
import { readFileSync } from 'node:fs';
import type { Handbook, Recipe } from '../../public/types/index.ts';

const readJson = (fromRepo: string): unknown =>
  JSON.parse(readFileSync(new URL('../../' + fromRepo, import.meta.url), 'utf8'));

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isHandbook(value: unknown): value is Handbook {
  return (
    isObject(value) &&
    typeof value.version === 'string' &&
    isObject(value.phases) &&
    Array.isArray(value.factories) &&
    Array.isArray(value.storage) &&
    Array.isArray(value.deliveries) &&
    isObject(value.plans)
  );
}

function isRecipe(value: unknown): value is Recipe {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isObject(value.inputs) &&
    isObject(value.outputs)
  );
}

function handbookFile(fromRepo: string): Handbook {
  const value = readJson(fromRepo);
  if (!isHandbook(value)) throw new Error(fromRepo + ' is not a handbook');
  return value;
}

function recipesFile(fromRepo: string): Recipe[] {
  const value = readJson(fromRepo);
  if (!isObject(value) || !Array.isArray(value.recipes) || !value.recipes.every(isRecipe))
    throw new Error(fromRepo + ' is not a recipe list');
  return value.recipes;
}

// The retired handbook as the server's migration reads it (migrations/handbook-2026-09-13.json):
// the copy of public/plan.json as it was released, which #397 removed. Old exports and
// workspaces carry the same handbook.
export const frozenHandbook = handbookFile('migrations/handbook-2026-09-13.json');
export const handbook = frozenHandbook;
// The recipes the planner solves with (recipes.json).
export const recipes = recipesFile('recipes.json');
