// The recipes a phase plans with: the recipe pool, the amplified twins, the nuclear recycle
// chain's period and the power generators.
// Re-exported by ../planner.ts.
import type { CurrentSettings, ItemRates, Recipe } from '../public/types/index.ts';
import type { PoolRecipe } from './types.ts';
import { DATA, MAM_RECIPES, RAW } from './data.ts';

export const pureNames = [
  'Alternate: Pure Iron Ingot',
  'Alternate: Pure Copper Ingot',
  'Alternate: Pure Caterium Ingot',
  'Alternate: Pure Aluminum Ingot',
];
const metals = ['Iron Ingot', 'Copper Ingot', 'Caterium Ingot', 'Aluminum Ingot'];
// Slug for generated row ids ('power-rocket-fuel'). Row ids are progress keys, so keep it stable.
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
// The recipes a phase may choose from, before power generators are added (generators() below).
// `config` is normalised settings, `phase` a number 1 to 5, and `conversion` whether the Phase 5
// Converter recipes that make raw resources (SAM-based ore conversion) are allowed. Returns
// recipe objects from recipes.json, MAM recipes relabelled as standard. Used only by `run`.
// The filters, in order:
// 1. MAM recipes are always in, except under 'custom' where they must be selected; the map
//    then relabels them as standard recipes.
// 2. Available by this phase, and standard, or allowed by the recipe setting, or one of the
//    pure ingot alternates when `pureIngots` is on.
// 3. With `pureIngots`, from Phase 3 the pure alternates replace every other recipe for the four
//    metal ingots (the owner's handbook runs pure ingot recipes from Phase 3).
// 4. Recipes that make a raw resource (the Converter's ore conversions) only with `conversion`.
//    Water is exempt: aluminum scrap, batteries and several blender recipes return water.
// 5. Nuclear fuel and waste-processing recipes only with a nuclear strategy, except that from
//    Phase 4 uranium drone fuel admits the Uranium Fuel Rod and Encased Uranium Cell recipes.
// 6. Preferred recipes (custom only) push out the competitors for their primary product.
export function recipePool(config: CurrentSettings, phase: number, conversion: boolean): Recipe[] {
  return DATA.recipes
    .filter(
      recipe =>
        !MAM_RECIPES.includes(recipe.id) ||
        config.recipes !== 'custom' ||
        config.alternateRecipes.includes(recipe.id),
    )
    .map(recipe =>
      MAM_RECIPES.includes(recipe.id)
        ? { ...recipe, alternate: false, name: recipe.name.replace('Alternate: ', '') }
        : recipe,
    )
    .filter(
      recipe =>
        recipe.phase <= phase &&
        (config.recipes === 'all' ||
          !recipe.alternate ||
          (config.recipes === 'custom' && config.alternateRecipes.includes(recipe.id)) ||
          (config.pureIngots && pureNames.includes(recipe.name))),
    )
    .filter(
      recipe =>
        !(
          config.pureIngots &&
          phase >= 3 &&
          metals.some(metal => recipe.outputs[metal]) &&
          !pureNames.includes(recipe.name)
        ),
    )
    .filter(
      recipe =>
        !Object.keys(recipe.outputs).some(item => RAW.includes(item) && item !== 'Water') ||
        conversion,
    )
    .filter(
      recipe =>
        ![
          'Uranium Fuel Rod',
          'Plutonium Fuel Rod',
          'Ficsonium',
          'Ficsonium Fuel Rod',
          'Encased Uranium Cell',
          'Non-Fissile Uranium',
          'Plutonium Pellet',
          'Encased Plutonium Cell',
        ].some(item => recipe.outputs[item]) ||
        config.nuclear !== 'none' ||
        (phase >= 4 &&
          config.droneFuel === 'Uranium Fuel Rod' &&
          ['Uranium Fuel Rod', 'Encased Uranium Cell'].some(item => recipe.outputs[item])),
    )
    .filter(recipe => {
      // a preferred recipe replaces competing recipes for its primary product at phases where it is available
      const preferred = config.recipes === 'custom' ? config.preferredRecipes || [] : [];
      if (!preferred.length || preferred.includes(recipe.id)) return true;
      return !preferred.some(id => {
        const other = DATA.recipes.find(r => r.id === id);
        return (
          other &&
          other.phase <= phase &&
          Object.keys(other.outputs)[0] === Object.keys(recipe.outputs)[0]
        );
      });
    });
}
// Production amplification. A somersloop machine is a whole machine: the same inputs, double the
// output and four times the power, per (1 + filled/total)^2 with every slot filled. Miners,
// extractors, packagers and generators have no slots. Opt-in: with no budget nothing is offered,
// so a plan that does not want to go slug hunting is calculated exactly as before.
// How many of the largest lines are offered an amplified twin. Every twin is another integer
// variable, and the fit has to finish inside the solver's search limit (SEARCH_LIMITS in
// optimizer.ts): whole-machine plans already carry integer machine counts, so they can afford
// fewer twins than precisely balanced ones.
// Measured against the heaviest plans in the test set; raising these starts losing whole phases.
export const AMPLIFY_CANDIDATES = { whole: 22, precise: 26 };
// Somersloop slots per production machine, as in the game. Amplifying a machine fills all its
// slots, so this is also the somersloop cost of one amplified machine.
export const AMPLIFY_SLOTS: Record<string, number> = {
  Smelter: 1,
  Constructor: 1,
  Assembler: 2,
  Foundry: 2,
  Refinery: 2,
  Converter: 2,
  Manufacturer: 4,
  Blender: 4,
  'Particle Accelerator': 4,
  'Quantum Encoder': 4,
};
export const amplifiable = (recipe: PoolRecipe) =>
  recipe.power > 0 && (AMPLIFY_SLOTS[recipe.machine] ?? 0) > 0;
// The amplified twin of a recipe: a separate row with an 'amp:' id (its own progress key), which
// `run` makes an integer variable. `slots` marks it as amplified there.
export const amplified = (recipe: PoolRecipe): PoolRecipe => ({
  ...recipe,
  id: 'amp:' + recipe.id,
  name: recipe.name + ' (somersloop amplified)',
  power: recipe.power * 4,
  slots: AMPLIFY_SLOTS[recipe.machine],
  outputs: Object.fromEntries(
    Object.entries(recipe.outputs).map(([item, rate]) => [item, rate * 2]),
  ),
});
// The largest period nuclearPeriod accepts. A longer one would force a plan to many more uranium
// plants than it needs, so such a chain gets whole uranium plants only (#370).
const NUCLEAR_PERIOD_MAX = 100;
// The recycle chain's period (#370): the smallest number of uranium plants for which every line
// downstream of their waste, up to the plutonium and ficsonium plants, runs whole machines at
// 100%. Radioactive items balance exactly, so with one recipe per chain item the chain is linear
// in the uranium plant count. Solve it for one uranium plant, write each line's machines as a
// fraction and take the least common multiple of the denominators: 20 with the default recipes
// (Ficsonium is 0.05 machines per plant).
//
// `pool` is the recipe network being fitted, `demand` its per-minute demands. Returns 1 when
// there is no such period: no uranium plant, a chain item some demand also draws (plutonium drone
// fuel, which makes the chain affine rather than linear), two recipes competing for one chain
// item (mixed alternates or an amplified twin), or a period above NUCLEAR_PERIOD_MAX.
type ChainRecipe = Pick<PoolRecipe, 'id' | 'inputs' | 'outputs'>;
export function nuclearPeriod(pool: ChainRecipe[], demand: ItemRates = {}): number {
  const uranium = pool.find(recipe => recipe.id === 'power-uranium');
  if (!uranium) return 1;
  // The chain: every recipe that makes or uses a radioactive item the chain carries, starting
  // from the uranium plants' waste. The fuel feed (cells and rods) is upstream, so it stays out.
  const radioactive = (item: string) => !!DATA.items[item]?.radioactive;
  const items = new Set(Object.keys(uranium.outputs).filter(radioactive));
  const chain: ChainRecipe[] = [];
  for (let grew = true; grew; ) {
    grew = false;
    for (const recipe of pool)
      if (
        recipe !== uranium &&
        !chain.includes(recipe) &&
        [...Object.keys(recipe.inputs), ...Object.keys(recipe.outputs)].some(item =>
          items.has(item),
        )
      ) {
        chain.push(recipe);
        Object.keys(recipe.outputs)
          .filter(radioactive)
          .forEach(item => items.add(item));
        grew = true;
      }
  }
  const names = [...items];
  if (!chain.length || names.length !== chain.length || names.some(item => (demand[item] || 0) > 0))
    return 1;
  // One balance per chain item: the chain's net output plus the uranium plant's is zero.
  const net = (recipe: ChainRecipe, item: string) =>
    (recipe.outputs[item] || 0) - (recipe.inputs[item] || 0);
  // Each row is one item: its net output per machine of each chain line, then the uranium plant's
  // waste on the right-hand side.
  const matrix = names.map(item => [
    ...chain.map(recipe => net(recipe, item)),
    -net(uranium, item),
  ]);
  // Gauss-Jordan elimination with partial pivoting. A singular system has no unique chain.
  const size = chain.length;
  for (let col = 0; col < size; col++) {
    let best = col;
    for (let row = col + 1; row < size; row++)
      if (Math.abs(matrix[row]![col]!) > Math.abs(matrix[best]![col]!)) best = row;
    if (Math.abs(matrix[best]![col]!) < 1e-9) return 1;
    [matrix[col], matrix[best]] = [matrix[best]!, matrix[col]!];
    const pivot = matrix[col]!;
    for (let row = 0; row < size; row++) {
      const line = matrix[row]!;
      if (row === col || line[col] === 0) continue;
      const factor = line[col]! / pivot[col]!;
      for (let k = col; k <= size; k++) line[k]! -= factor * pivot[k]!;
    }
  }
  // Machines of each chain line per uranium plant.
  const perPlant = matrix.map((line, col) => line[size]! / line[col]!);
  // The smallest denominator that makes each line's machines per plant whole.
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  let period = 1;
  for (const machines of perPlant) {
    if (machines < -1e-9) return 1;
    let denominator = 1;
    const scaled = () => machines * denominator;
    while (
      denominator <= NUCLEAR_PERIOD_MAX &&
      Math.abs(scaled() - Math.round(scaled())) > 1e-7 * Math.max(1, scaled())
    )
      denominator++;
    period = (period * denominator) / gcd(period, denominator);
    if (period > NUCLEAR_PERIOD_MAX) return 1;
  }
  return period;
}
// Power plants modelled as recipes, so the LP sizes generation and fuel chains with everything
// else. `power` is negative (MW generated per plant at 100%); inputs are fuel and water per
// minute. Coal from Phase 2, fuel generators from Phase 3 (rocket fuel from 4), nuclear from 4
// with a waste strategy, plutonium and ficsonium plants in Phase 5 when recycling. Phase 1 has no
// generators: biomass burners are hand-fed and stay out of the model. Then `mainPower` narrows
// the list from Phase 3 on; 'auto' leaves the choice to the solver.
export function generators(config: CurrentSettings, phase: number): PoolRecipe[] {
  const result: PoolRecipe[] = [];
  if (phase >= 2)
    result.push({
      id: 'power-coal',
      name: 'Coal power',
      machine: 'Coal Generator',
      phase: 2,
      power: -75,
      inputs: { Coal: 15, Water: 45 },
      outputs: {},
    });
  if (phase >= 3)
    for (const name of ['Fuel', 'Turbofuel', ...(phase >= 4 ? ['Rocket Fuel'] : [])])
      result.push({
        id: 'power-' + slug(name),
        name: name + ' power',
        machine: 'Fuel Generator',
        phase: 3,
        power: -250,
        // 250 MW is 15,000 MJ per minute, divided by the fuel's energy per m³.
        inputs: { [name]: 15000 / DATA.items[name]!.energy },
        outputs: {},
      });
  if (phase >= 4 && config.nuclear !== 'none') {
    result.push({
      id: 'power-uranium',
      name: 'Uranium power',
      machine: 'Nuclear Power Plant',
      phase: 4,
      power: -2500,
      inputs: { 'Uranium Fuel Rod': 0.2, Water: 240 },
      outputs: { 'Uranium Waste': 10 },
    });
    if (phase === 5 && config.nuclear === 'recycle')
      result.push(
        {
          id: 'power-plutonium',
          name: 'Plutonium power',
          machine: 'Nuclear Power Plant',
          phase: 5,
          power: -2500,
          inputs: { 'Plutonium Fuel Rod': 0.1, Water: 240 },
          outputs: { 'Plutonium Waste': 1 },
        },
        {
          id: 'power-ficsonium',
          name: 'Ficsonium power',
          machine: 'Nuclear Power Plant',
          phase: 5,
          power: -2500,
          inputs: { 'Ficsonium Fuel Rod': 1, Water: 240 },
          outputs: {},
        },
      );
  }
  // Nuclear plants (present only with a waste strategy) are kept under every preference. The
  // others keep one fuel: coal, 'fuel', rocket fuel from Phase 4 for the rocket options, and
  // turbofuel otherwise, which is also the Phase 3 bridge for 'nuclear' before plants unlock.
  const preferred = config.mainPower || 'auto';
  if (preferred === 'auto' || phase < 3) return result;
  if (preferred === 'coal')
    return result.filter(r => r.id === 'power-coal' || r.machine === 'Nuclear Power Plant');
  if (preferred === 'nuclear' && phase >= 4)
    return result.filter(r => r.machine === 'Nuclear Power Plant');
  const fuel =
    preferred === 'fuel'
      ? 'Fuel'
      : preferred.startsWith('rocket') && phase >= 4
        ? 'Rocket Fuel'
        : 'Turbofuel';
  return result.filter(r => r.machine === 'Nuclear Power Plant' || r.inputs[fuel]);
}
