// Recipe power as the game draws it (#935). recipes.json comes from SatisfactoryTools, whose data
// gives a recipe a variable-power range (`isVariablePower`, `minPower`, `maxPower`) from the
// game's mVariablePowerConsumptionConstant and Factor; the import takes `maxPower` (a line's peak,
// peakMW) for such a recipe and the building's power for any other. But the game reads a recipe's
// range only in a building that has variable power (FGBuildableManufacturerVariablePower: the
// Particle Accelerator, Converter and Quantum Encoder); a Manufacturer or a Blender always draws
// its own power. Three recipes carry a range in a fixed-power building, and the import gave them
// that range's maximum: Singularity Cell 0 MW (range 0-0) and Ballistic Warp Drive 1500 MW in a
// Manufacturer (55 MW), and Biochemical Sculptor 1500 MW in a Blender (75 MW). At 0 MW Singularity
// Cell also never got a line made on site, because the planner copies only production recipes
// for a group, and it read "draws power" as "is not a generator".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate } from '../planner.ts';
import { onSiteCopyable, onSiteSettings } from '../public/app/on-site.ts';
import { onSiteChange, onSiteOffers, onSiteSummaries } from '../public/app/on-site-picker.ts';
import { recipes } from './helpers/data.ts';
import type {
  CalcRow,
  CurrentCalculatedPlan,
  FactoryGroups,
  StoredCalculatedPlan,
} from '../public/types/index.ts';

// The machines whose power follows the recipe in the game, at the recipe's peak here.
const VARIABLE_POWER = ['Particle Accelerator', 'Converter', 'Quantum Encoder'];
const SINGULARITY = 'Recipe_SingularityCell_C',
  WARP_DRIVE = 'Recipe_SpaceElevatorPart_11_C',
  SCULPTOR = 'Recipe_SpaceElevatorPart_10_C';
const recipe = (id: string) => recipes.find(candidate => candidate.id === id)!;

test('#935: the three recipes draw their building power', () => {
  assert.equal(recipe(SINGULARITY).machine, 'Manufacturer');
  assert.equal(recipe(SINGULARITY).power, 55, 'Singularity Cell');
  assert.equal(recipe(WARP_DRIVE).machine, 'Manufacturer');
  assert.equal(recipe(WARP_DRIVE).power, 55, 'Ballistic Warp Drive');
  assert.equal(recipe(SCULPTOR).machine, 'Blender');
  assert.equal(recipe(SCULPTOR).power, 75, 'Biochemical Sculptor');
});

test('#935: every recipe of a fixed-power machine draws that machine power', () => {
  const powers = new Map<string, Set<number>>();
  for (const { machine, power } of recipes)
    if (!VARIABLE_POWER.includes(machine))
      powers.set(machine, (powers.get(machine) || new Set()).add(power));
  for (const [machine, seen] of powers)
    assert.equal(seen.size, 1, `${machine}: ${[...seen].join(', ')} MW`);
  assert.deepEqual(
    Object.fromEntries([...powers].map(([machine, seen]) => [machine, [...seen][0]])),
    {
      Assembler: 15,
      Blender: 75,
      Constructor: 4,
      Foundry: 16,
      Manufacturer: 55,
      Packager: 10,
      Refinery: 30,
      Smelter: 4,
    },
  );
  for (const { name, power } of recipes) assert.ok(power > 0, `${name} draws power`);
});

let phase5: CurrentCalculatedPlan | undefined;
// Phase 5 with the default (standard) recipes, made once for the file.
const phase5Plan = () => (phase5 ??= calculate({ phase: '5' }));
const rowOf = (plan: StoredCalculatedPlan, id: string): CalcRow | undefined =>
  plan.stages['5']?.rows?.find(row => row.id === id);

test("#935: Phase 5's power counts these lines at their building power", () => {
  const stage = phase5Plan().stages['5'];
  assert.equal(stage.feasible, true);
  for (const [id, power] of [
    [SINGULARITY, 55],
    [WARP_DRIVE, 55],
    [SCULPTOR, 75],
  ] as const) {
    const row = rowOf(phase5Plan(), id);
    assert.ok(row && row.machines > 0, `Phase 5 builds ${id}`);
    assert.equal(row.peakMW, row.machines * power, id);
  }
  const rows = stage.rows || [];
  const peak = rows.reduce((total, row) => total + row.peakMW, 0);
  assert.ok(Math.abs(stage.peakMW - peak) < 1e-6, 'the stage total is the rows');
});

const ALPHA = 'fg-alpha1';
// Alpha holds the Ballistic Warp Drive line, which takes Singularity Cells, and marks them.
const alpha = (): FactoryGroups => ({
  groups: [{ id: ALPHA, name: 'Alpha' }],
  assignments: { [WARP_DRIVE]: [{ group: ALPHA, rate: null }] },
  local: { [ALPHA]: ['Singularity Cell'] },
});
// The plan "Recalculate with items made on site" makes from `plan` and Alpha's marks.
function recalculated(plan: StoredCalculatedPlan) {
  const onSite = onSiteSettings(plan, alpha());
  const { onSite: _old, ...rest } = plan.settings;
  return calculate({ ...rest, ...(onSite ? { onSite } : {}) });
}

test('#935: Singularity Cell is offered on site and a recalculation makes its line', () => {
  const plan = phase5Plan();
  assert.ok(onSiteOffers(plan, alpha(), ALPHA).includes('Singularity Cell'), 'offered');
  assert.deepEqual(onSiteSettings(plan, alpha())?.[ALPHA]?.items, ['Singularity Cell']);
  assert.ok(onSiteChange(plan, alpha()), 'the page asks for a recalculation');
  const marked = recalculated(plan);
  const line = rowOf(marked, `${SINGULARITY}:${ALPHA}`);
  assert.ok(line && line.machines > 0, "Alpha's own Singularity Cell line");
  assert.equal(line.peakMW, line.machines * 55);
  assert.equal(onSiteChange(marked, alpha()), null, 'and then asks nothing more');
  const heading = onSiteSummaries(marked, alpha(), marked.stages['5'])[ALPHA]!;
  assert.deepEqual(heading.made, [{ item: 'Singularity Cell', note: '' }]);
  assert.deepEqual(heading.marked, []);
});

test('#935: a plan made before the fix, with Singularity Cell at 0 MW, keeps its numbers and still asks for the line', () => {
  const old: StoredCalculatedPlan = JSON.parse(
    fs.readFileSync(new URL('./fixtures/calculated-plan-2026-09-12.json', import.meta.url), 'utf8'),
  );
  const cells = rowOf(old, SINGULARITY)!;
  assert.equal(cells.power, 0, 'frozen as it was calculated');
  assert.equal(cells.peakMW, 0);
  assert.equal(onSiteCopyable(cells, 'Singularity Cell'), true, 'a production line all the same');
  for (const row of old.stages['5']?.rows || [])
    if (row.power < 0)
      for (const item of Object.keys(row.outputs))
        assert.equal(onSiteCopyable(row, item), false, `${row.name} is a generator`);
  assert.ok(onSiteOffers(old, alpha(), ALPHA).includes('Singularity Cell'));
  assert.deepEqual(onSiteSettings(old, alpha())?.[ALPHA]?.items, ['Singularity Cell']);
  assert.ok(onSiteChange(old, alpha()), 'the page offers the recalculation');
  assert.ok(rowOf(recalculated(old), `${SINGULARITY}:${ALPHA}`), 'which makes the line');
});
