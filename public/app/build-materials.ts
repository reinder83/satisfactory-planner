// What a build-plan step takes to build (#1073): its buildings ("2 Refineries + 1 Water
// Extractor"), the parts those buildings cost (buildParts in preferences/build-costs.ts) and the
// belt and pipe marks its line is fed by. Belts and pipes are named by their mark only: their cost
// follows a length no plan holds. It reads only its arguments (no session), so the build plan's
// steps (views/step-materials.ts) and the session view add up the same way.
import { buildParts } from '../preferences.ts';
import { num } from './format.ts';
import { buildingName } from '../wording.ts';

// A building and how many of it to build.
export interface BuildingCount {
  building: string;
  count: number;
}

// A step's buildings (each count at least 1), the parts they cost together, the largest amount
// first, and the belt and pipe marks ("Mk.4 belts", "Mk.2 pipes"). `unknown` names a building with
// no cost in the table, whose parts are left out rather than guessed.
export interface BuildMaterials {
  buildings: BuildingCount[];
  parts: [item: string, amount: number][];
  lanes: string[];
  unknown: string[];
}

// The parts `buildings` cost together, with `lanes` as given: buildings of the same name are
// counted once, in the order first given.
export function buildMaterials(
  buildings: readonly BuildingCount[],
  lanes: readonly string[] = [],
): BuildMaterials {
  const counts = new Map<string, number>();
  for (const { building, count } of buildings)
    if (count > 0) counts.set(building, (counts.get(building) ?? 0) + count);
  const { parts, unknown } = buildParts(counts);
  return {
    buildings: [...counts].map(([building, count]) => ({ building, count })),
    parts: [...parts].sort(([a, first], [b, second]) => second - first || a.localeCompare(b)),
    lanes: [...new Set(lanes)],
    unknown,
  };
}

// Several steps' materials as one: their buildings and parts added up, their lanes once each.
export const addMaterials = (list: readonly BuildMaterials[]): BuildMaterials =>
  buildMaterials(
    list.flatMap(materials => materials.buildings),
    list.flatMap(materials => materials.lanes),
  );

// Whether there is anything to build.
export const hasMaterials = (materials: BuildMaterials): boolean => materials.buildings.length > 0;

// "2 Refineries + 1 Water Extractor + Mk.4 belts and Mk.2 pipes"; '' for nothing to build.
export function buildWords(materials: BuildMaterials): string {
  if (!hasMaterials(materials)) return '';
  const buildings = materials.buildings.map(
    ({ building, count }) => `${num(count)} ${buildingName(building, count)}`,
  );
  const lanes = materials.lanes.length ? [materials.lanes.join(' and ')] : [];
  return [...buildings, ...lanes].join(' + ');
}

// "60 × Steel Pipe, 20 × Copper Sheet, 10 × Motor": the parts with their amounts, the largest
// first; '' for none.
export const partsWords = (materials: BuildMaterials): string =>
  materials.parts.map(([item, amount]) => `${num(amount)} × ${item}`).join(', ');
