// What each building the plan names costs to build (#1073): the parts one building takes, as the
// build plan's steps and the session view (build-materials.ts) add them up.
//
// Copied once from the SatisfactoryTools dataset, https://github.com/greeny/SatisfactoryTools,
// commit b5210ae9dcb629046ffc0b2f44152fd4b744067c (the revision recipes.json records), file
// data/data.json, downloaded 2026-10-21: the `recipes[*]` entry with `forBuilding: true` whose id
// progression.json lists for the building (`recipe` here), its `ingredients` with each item's
// class name read as the item's `name` from the same file. No import script is kept (AGENTS.md):
// a data update copies the same fields again, and tests/build-costs.test.ts checks every id
// against progression.json and every part against the item list.
//
// Keyed by the name the plan's rows give the machine (CalcRow.machine): the planner's generators
// are "Coal Generator" and "Fuel Generator", which progression.json names "Coal-Powered Generator"
// and "Fuel-Powered Generator". Belts and pipes are left out: their cost follows a length no plan
// holds, so the steps name their mark only.
export interface BuildCost {
  recipe: string;
  cost: Readonly<Record<string, number>>;
}
export const BUILD_COSTS: Readonly<Record<string, BuildCost>> = {
  Smelter: { recipe: 'Recipe_SmelterBasicMk1_C', cost: { 'Iron Rod': 5, Wire: 8 } },
  Foundry: {
    recipe: 'Recipe_SmelterMk1_C',
    cost: { 'Modular Frame': 10, Rotor: 10, Concrete: 20 },
  },
  Constructor: {
    recipe: 'Recipe_ConstructorMk1_C',
    cost: { 'Reinforced Iron Plate': 2, Cable: 8 },
  },
  Assembler: {
    recipe: 'Recipe_AssemblerMk1_C',
    cost: { 'Reinforced Iron Plate': 8, Rotor: 4, Cable: 10 },
  },
  Manufacturer: {
    recipe: 'Recipe_ManufacturerMk1_C',
    cost: { Motor: 10, 'Modular Frame': 20, Plastic: 50, Cable: 50 },
  },
  Refinery: {
    recipe: 'Recipe_OilRefinery_C',
    cost: { Motor: 10, 'Encased Industrial Beam': 10, 'Steel Pipe': 30, 'Copper Sheet': 20 },
  },
  Blender: {
    recipe: 'Recipe_Blender_C',
    cost: { Computer: 10, 'Heavy Modular Frame': 10, Motor: 20, 'Aluminum Casing': 50 },
  },
  Packager: { recipe: 'Recipe_Packager_C', cost: { 'Steel Beam': 20, Rubber: 10, Plastic: 10 } },
  'Particle Accelerator': {
    recipe: 'Recipe_HadronCollider_C',
    cost: {
      'Turbo Motor': 10,
      Supercomputer: 10,
      'Fused Modular Frame': 25,
      'Cooling System': 50,
      Quickwire: 500,
    },
  },
  Converter: {
    recipe: 'Recipe_Converter_C',
    cost: {
      'Fused Modular Frame': 10,
      'Cooling System': 25,
      'Radio Control Unit': 50,
      'SAM Fluctuator': 100,
    },
  },
  'Quantum Encoder': {
    recipe: 'Recipe_QuantumEncoder_C',
    cost: {
      'Turbo Motor': 20,
      Supercomputer: 20,
      'Cooling System': 50,
      'Time Crystal': 50,
      'Ficsite Trigon': 100,
    },
  },
  'Coal Generator': {
    recipe: 'Recipe_GeneratorCoal_C',
    cost: { 'Reinforced Iron Plate': 20, Rotor: 10, Cable: 30 },
  },
  'Fuel Generator': {
    recipe: 'Recipe_GeneratorFuel_C',
    cost: {
      Motor: 15,
      'Encased Industrial Beam': 15,
      'Copper Sheet': 30,
      Rubber: 50,
      Quickwire: 50,
    },
  },
  'Nuclear Power Plant': {
    recipe: 'Recipe_GeneratorNuclear_C',
    cost: {
      Supercomputer: 10,
      'Heavy Modular Frame': 25,
      'Alclad Aluminum Sheet': 100,
      Cable: 200,
      Concrete: 250,
    },
  },
  'Biomass Burner': {
    recipe: 'Recipe_GeneratorBiomass_Automated_C',
    cost: { 'Iron Plate': 15, 'Iron Rod': 15, Wire: 25 },
  },
  'Miner Mk.1': {
    recipe: 'Recipe_MinerMk1_C',
    cost: { 'Portable Miner': 1, 'Iron Plate': 10, Concrete: 10 },
  },
  'Miner Mk.2': {
    recipe: 'Recipe_MinerMk2_C',
    cost: {
      'Portable Miner': 2,
      'Encased Industrial Beam': 10,
      'Steel Pipe': 20,
      'Modular Frame': 10,
    },
  },
  'Miner Mk.3': {
    recipe: 'Recipe_MinerMk3_C',
    cost: {
      'Portable Miner': 3,
      'Steel Pipe': 50,
      Supercomputer: 5,
      'Fused Modular Frame': 10,
      'Turbo Motor': 3,
    },
  },
  'Oil Extractor': {
    recipe: 'Recipe_OilPump_C',
    cost: { Motor: 15, 'Encased Industrial Beam': 20, Cable: 60 },
  },
  'Water Extractor': {
    recipe: 'Recipe_WaterPump_C',
    cost: { 'Copper Sheet': 20, 'Reinforced Iron Plate': 10, Rotor: 10 },
  },
  'Resource Well Pressurizer': {
    recipe: 'Recipe_FrackingSmasher_C',
    cost: {
      'Radio Control Unit': 10,
      'Heavy Modular Frame': 25,
      Motor: 50,
      'Alclad Aluminum Sheet': 50,
      Rubber: 100,
    },
  },
  'Resource Well Extractor': {
    recipe: 'Recipe_FrackingExtractor_C',
    cost: { 'Steel Beam': 10, 'Aluminum Casing': 10 },
  },
};
