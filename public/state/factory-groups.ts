// Seed data: the default factory groups a newly calculated profile starts with. Re-exported by
// ../state.ts.
import type { FactoryGroups, GroupAssignment } from '../types/index.ts';
import type { RowsPlan } from './validate.ts';

// Default factory groups for newly calculated profiles: production areas keyed by each row's primary output.
const GROUP_NAMES: [id: string, name: string][] = [
  ['fg-iron01', 'Iron & steel works'],
  ['fg-coppr1', 'Copper & caterium'],
  ['fg-stone1', 'Concrete & quartz'],
  ['fg-oilcp1', 'Oil & fuel campus'],
  ['fg-alumn1', 'Aluminum campus'],
  ['fg-elect1', 'Electronics'],
  ['fg-parts1', 'Industrial parts'],
  ['fg-projct', 'Project assembly'],
  ['fg-nuclr1', 'Nuclear site'],
  ['fg-quant1', 'Quantum & SAM'],
  ['fg-convr1', 'Resource conversion'],
  ['fg-power1', 'Power generation'],
  ['fg-pack01', 'Packaging'],
  ['fg-ammo01', 'Ammunition & equipment'],
  ['fg-other1', 'Everything else'],
];
const GROUP_BY_ITEM: Record<string, string> = {
  'Iron Ingot': 'fg-iron01',
  'Iron Plate': 'fg-iron01',
  'Iron Rod': 'fg-iron01',
  Screws: 'fg-iron01',
  'Reinforced Iron Plate': 'fg-iron01',
  'Modular Frame': 'fg-iron01',
  'Steel Ingot': 'fg-iron01',
  'Steel Beam': 'fg-iron01',
  'Steel Pipe': 'fg-iron01',
  'Encased Industrial Beam': 'fg-iron01',
  'Heavy Modular Frame': 'fg-iron01',
  'Copper Ingot': 'fg-coppr1',
  'Copper Sheet': 'fg-coppr1',
  Wire: 'fg-coppr1',
  Cable: 'fg-coppr1',
  Quickwire: 'fg-coppr1',
  'Caterium Ingot': 'fg-coppr1',
  'Copper Powder': 'fg-coppr1',
  Concrete: 'fg-stone1',
  Silica: 'fg-stone1',
  'Quartz Crystal': 'fg-stone1',
  'Dissolved Silica': 'fg-stone1',
  Plastic: 'fg-oilcp1',
  Rubber: 'fg-oilcp1',
  'Heavy Oil Residue': 'fg-oilcp1',
  'Polymer Resin': 'fg-oilcp1',
  Fuel: 'fg-oilcp1',
  Turbofuel: 'fg-oilcp1',
  'Petroleum Coke': 'fg-oilcp1',
  'Rocket Fuel': 'fg-oilcp1',
  'Ionized Fuel': 'fg-oilcp1',
  'Compacted Coal': 'fg-oilcp1',
  'Liquid Biofuel': 'fg-oilcp1',
  'Alumina Solution': 'fg-alumn1',
  'Aluminum Scrap': 'fg-alumn1',
  'Aluminum Ingot': 'fg-alumn1',
  'Aluminum Casing': 'fg-alumn1',
  'Alclad Aluminum Sheet': 'fg-alumn1',
  'Circuit Board': 'fg-elect1',
  Computer: 'fg-elect1',
  Supercomputer: 'fg-elect1',
  'High-Speed Connector': 'fg-elect1',
  'Crystal Oscillator': 'fg-elect1',
  'AI Limiter': 'fg-elect1',
  'Radio Control Unit': 'fg-elect1',
  Rotor: 'fg-parts1',
  Stator: 'fg-parts1',
  Motor: 'fg-parts1',
  'Heat Sink': 'fg-parts1',
  'Cooling System': 'fg-parts1',
  Battery: 'fg-parts1',
  'Electromagnetic Control Rod': 'fg-parts1',
  'Fused Modular Frame': 'fg-parts1',
  'Pressure Conversion Cube': 'fg-parts1',
  'Turbo Motor': 'fg-parts1',
  'Smart Plating': 'fg-projct',
  'Versatile Framework': 'fg-projct',
  'Automated Wiring': 'fg-projct',
  'Modular Engine': 'fg-projct',
  'Adaptive Control Unit': 'fg-projct',
  'Assembly Director System': 'fg-projct',
  'Magnetic Field Generator': 'fg-projct',
  'Thermal Propulsion Rocket': 'fg-projct',
  'Nuclear Pasta': 'fg-projct',
  'Biochemical Sculptor': 'fg-projct',
  'AI Expansion Server': 'fg-projct',
  'Ballistic Warp Drive': 'fg-projct',
  'Sulfuric Acid': 'fg-nuclr1',
  'Nitric Acid': 'fg-nuclr1',
  'Encased Uranium Cell': 'fg-nuclr1',
  'Uranium Fuel Rod': 'fg-nuclr1',
  'Non-Fissile Uranium': 'fg-nuclr1',
  'Plutonium Pellet': 'fg-nuclr1',
  'Encased Plutonium Cell': 'fg-nuclr1',
  'Plutonium Fuel Rod': 'fg-nuclr1',
  Ficsonium: 'fg-nuclr1',
  'Ficsonium Fuel Rod': 'fg-nuclr1',
  'Uranium Waste': 'fg-nuclr1',
  'Plutonium Waste': 'fg-nuclr1',
  'Reanimated SAM': 'fg-quant1',
  'SAM Fluctuator': 'fg-quant1',
  'Dark Matter Residue': 'fg-quant1',
  'Excited Photonic Matter': 'fg-quant1',
  'Time Crystal': 'fg-quant1',
  'Dark Matter Crystal': 'fg-quant1',
  Diamonds: 'fg-quant1',
  'Ficsite Ingot': 'fg-quant1',
  'Ficsite Trigon': 'fg-quant1',
  'Singularity Cell': 'fg-quant1',
  'Superposition Oscillator': 'fg-quant1',
  'Neural-Quantum Processor': 'fg-quant1',
  'Power Shard': 'fg-quant1',
  'Alien Power Matrix': 'fg-quant1',
  'Caterium Ore': 'fg-convr1',
  Bauxite: 'fg-convr1',
  Coal: 'fg-convr1',
  'Copper Ore': 'fg-convr1',
  'Nitrogen Gas': 'fg-convr1',
  'Iron Ore': 'fg-convr1',
  'Raw Quartz': 'fg-convr1',
  Sulfur: 'fg-convr1',
  Limestone: 'fg-convr1',
  Uranium: 'fg-convr1',
  'Crude Oil': 'fg-convr1',
  Biomass: 'fg-power1',
  'Solid Biofuel': 'fg-power1',
  'Empty Canister': 'fg-pack01',
  'Empty Fluid Tank': 'fg-pack01',
  'Packaged Fuel': 'fg-pack01',
  'Black Powder': 'fg-ammo01',
  'Smokeless Powder': 'fg-ammo01',
  'Iron Rebar': 'fg-ammo01',
  'Stun Rebar': 'fg-ammo01',
  'Shatter Rebar': 'fg-ammo01',
  'Explosive Rebar': 'fg-ammo01',
  Nobelisk: 'fg-ammo01',
  'Pulse Nobelisk': 'fg-ammo01',
  'Cluster Nobelisk': 'fg-ammo01',
  'Nuke Nobelisk': 'fg-ammo01',
  'Rifle Ammo': 'fg-ammo01',
  'Homing Rifle Ammo': 'fg-ammo01',
  'Turbo Rifle Ammo': 'fg-ammo01',
  'Gas Filter': 'fg-ammo01',
  'Iodine-Infused Filter': 'fg-ammo01',
  Fabric: 'fg-ammo01',
  'Portable Miner': 'fg-ammo01',
};
// Assigns every row of every phase to a default group by its first output ('power-' rows
// to nuclear or power generation by their id), and lists only the groups actually used.
// Called by newProfileState for calculated profiles. Group ids are stored in saves, so the
// fg-… ids above must stay stable even if their names change.
export function defaultFactoryGroups(plan: RowsPlan | null | undefined): FactoryGroups {
  const assignments: Record<string, GroupAssignment[]> = {};
  for (const stage of Object.values(plan?.stages || {}))
    for (const row of stage.rows || []) {
      if (assignments[row.id]) continue;
      let group;
      if (String(row.id).startsWith('power-'))
        group = /uranium|plutonium|ficsonium/.test(row.id) ? 'fg-nuclr1' : 'fg-power1';
      else {
        const output = Object.keys(row.outputs || {})[0];
        group = output
          ? output.startsWith('Packaged')
            ? 'fg-pack01'
            : GROUP_BY_ITEM[output] || 'fg-other1'
          : 'fg-power1';
      }
      assignments[row.id] = [{ group, rate: null }];
    }
  // Every list above has exactly one entry.
  const used = new Set(Object.values(assignments).map(list => list[0]!.group));
  return {
    groups: GROUP_NAMES.filter(([id]) => used.has(id)).map(([id, name]) => ({
      id,
      name,
    })),
    assignments,
  };
}
