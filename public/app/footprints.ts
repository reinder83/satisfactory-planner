// How much floor a production line's machines take, in foundations (#1299), for the Factories
// page's rough "room to reserve" per factory and phase (groupGrowth in later-phases.ts). It is an
// estimate from the buildings' own footprints only: no belts, pipes, splitters, walkways or
// spacing between machines, so a real factory takes more.
//
// The repository's data (recipes.json, from SatisfactoryTools) has no building sizes, so this is a
// small table of the buildings a plan's lines use, width × length in metres. Source: the
// Satisfactory Wiki's building pages (satisfactory.wiki.gg, Update 1.0 dimensions), written down
// by hand, not downloaded; to confirm against the game.
// A foundation is 8 m × 8 m.
export const FOUNDATION_M2 = 64;

export const MACHINE_FOOTPRINTS: Readonly<Record<string, readonly [number, number]>> = {
  Smelter: [6, 9],
  Constructor: [8, 10],
  Assembler: [10, 15],
  Foundry: [10, 9],
  Manufacturer: [18, 20],
  Refinery: [10, 20],
  Packager: [8, 8],
  Blender: [18, 16],
  'Particle Accelerator': [24, 38],
  Converter: [16, 16],
  'Quantum Encoder': [22, 48],
  'Coal Generator': [10, 26],
  'Fuel Generator': [20, 20],
  'Nuclear Power Plant': [36, 43],
};

// The foundations one of each building stands on.
const FOUNDATIONS_EACH = new Map(
  Object.entries(MACHINE_FOOTPRINTS).map(([machine, [width, length]]) => [
    machine,
    (width * length) / FOUNDATION_M2,
  ]),
);

// The foundations `count` of `machine` stand on (fractions kept, the caller rounds the total), or
// 0 for a building the table does not know.
export function machineFoundations(machine: string, count: number): number {
  return (FOUNDATIONS_EACH.get(machine) ?? 0) * count;
}

// What the estimate counts, as the Factories page says it beside the figures.
export const FOOTPRINT_NOTE =
  'Foundations are a rough estimate from machine footprints only, without belts, pipes or spacing.';
