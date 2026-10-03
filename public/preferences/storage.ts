// The storage setting: which items get a container and a protected refill, and at what rate.
import type { Choice, CurrentSettings } from '../types/index.ts';

// The settings storageRateFor reads: normalised (planner.ts) or a draft.
type RateSettings = Pick<Partial<CurrentSettings>, 'storageOverrides' | 'buildRate'> & {
  storageRate: number;
};
// [value, label] pairs for the storage setting (`settings.storage`), shown by the wizard and the
// guided start and validated by planner.ts. wantsStorage below decides what each one covers.
export const storageOptions: Choice[] = [
  ['none', 'No dedicated storage'],
  ['construction', 'Construction materials'],
  ['electronics', 'Construction + electronics'],
  ['supplies', 'Construction + ammunition and filters'],
  ['packaged', 'Packaged fluids only'],
  ['all', 'All automatable solids and packaged fluids'],
];
// Materials you carry out by hand to build with. They get the construction rate (`buildRate`)
// in storageRateFor and are in every storage mode except 'none' and 'packaged'.
export const constructionItems: string[] = [
  'Iron Plate',
  'Iron Rod',
  'Reinforced Iron Plate',
  'Concrete',
  'Wire',
  'Cable',
  'Copper Sheet',
  'Steel Beam',
  'Steel Pipe',
  'Modular Frame',
  'Encased Industrial Beam',
  'Heavy Modular Frame',
  'Motor',
  'Computer',
  'Plastic',
  'Rubber',
  'Alclad Aluminum Sheet',
  'Aluminum Casing',
];
// Whether item `name` gets a container and a protected refill under storage mode `mode`.
// planner.ts uses it for the storage contract; the wizard uses it to list the covered items.
export function wantsStorage(name: string, mode: string): boolean {
  if (mode === 'none') return false;
  if (mode === 'all') return true;
  if (mode === 'packaged') return name.startsWith('Packaged ');
  return (
    constructionItems.includes(name) ||
    (mode === 'electronics' &&
      /Circuit Board|[Cc]omputer|AI Limiter|High-Speed Connector|Radio Control Unit|Crystal Oscillator|Superposition Oscillator|Neural-Quantum Processor/.test(
        name,
      )) ||
    (mode === 'supplies' && /Cartridge|Rebar|Nobelisk|Filter|Inhaler/.test(name))
  );
}
// Space Elevator parts go up the elevator or straight into the next project
// part; the plan already produces what those deliveries and recipes consume, so
// a standing storage buffer on top of that is production nobody draws from.
// They keep their container and address at a zero rate, and a per-item rate
// still buys a buffer for anyone who wants one. Kept in step with the planner's
// DELIVERIES table by a test.
export const elevatorParts: string[] = [
  'Smart Plating',
  'Versatile Framework',
  'Automated Wiring',
  'Modular Engine',
  'Adaptive Control Unit',
  'Assembly Director System',
  'Magnetic Field Generator',
  'Thermal Propulsion Rocket',
  'Nuclear Pasta',
  'Biochemical Sculptor',
  'AI Expansion Server',
  'Ballistic Warp Drive',
];
// The parts you carry out of storage by hand — foundations, belts, pipes — are
// worth a faster guaranteed refill than items you never take out. A per-item
// rate wins over everything; 0 keeps the container and its address without
// reserving any production for it.
export const storageRateFor = (settings: RateSettings, name: string): number => {
  const override = settings.storageOverrides?.[name];
  if (override !== undefined) return override;
  if (elevatorParts.includes(name)) return 0;
  return constructionItems.includes(name)
    ? (settings.buildRate ?? settings.storageRate)
    : settings.storageRate;
};
