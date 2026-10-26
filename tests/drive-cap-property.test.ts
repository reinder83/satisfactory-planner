// The cap on hard drives (#1233) over a set of settings: several start phases, exact clocks and
// whole machines, every alternate and a custom pick, owned alternates, minimal construction, the
// target time on the final phase, caps per phase beside it, and production amplification. Two
// properties, with the hard-drive alternates counted as the plan's hard-drive steps count them
// (rows marked `alternate` from the start phase on, the owned ones left out):
//   a cap at or above what the plan without it counts on never changes it: the plan is the same,
//     byte for byte, apart from the cap in its settings and the time it was made;
//   a cap below it holds the whole plan to at most that many, and never stores the set it picked.
import './helpers/en-us-numbers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate } from '../planner.ts';
import { driveless, huntedAlternates } from './helpers/drive-cap.ts';
import type { StoredCalculatedPlan } from '../public/types/index.ts';

const amplified = (
  JSON.parse(
    fs.readFileSync(new URL('./fixtures/amplified-early-2026-10-12.json', import.meta.url), 'utf8'),
  ) as StoredCalculatedPlan
).settings;
const SETTINGS: [string, object][] = [
  ['Phase 1, every alternate, exact clocks', { phase: '1', recipes: 'all' }],
  [
    'Phase 3, every alternate, whole machines, storage from surplus',
    { phase: '3', recipes: 'all', wholeMachines: true, storageFromSurplus: true },
  ],
  [
    'Phase 2, a custom pick',
    {
      phase: '2',
      recipes: 'custom',
      alternateRecipes: [
        'Recipe_Alternate_CopperAlloyIngot_C',
        'Recipe_Alternate_IronIngot_Basic_C',
        'Recipe_Alternate_Screw_C',
        'Recipe_Alternate_SteelCastedPlate_C',
        'Recipe_Alternate_SteelRod_C',
        'Recipe_Alternate_Wire_1_C',
      ],
    },
  ],
  [
    'Phase 3, every alternate, owned ones',
    {
      phase: '3',
      recipes: 'all',
      ownedAlternates: ['Recipe_Alternate_Screw_2_C', 'Recipe_Alternate_SteelRod_C'],
    },
  ],
  [
    'Phase 3, every alternate, minimal construction',
    { phase: '3', recipes: 'all', goal: 'minimal' },
  ],
  [
    'Phase 3, every alternate, target time on the final phase',
    { phase: '3', recipes: 'all', phaseTime: 'final' },
  ],
  [
    'Phase 4, every alternate, a cap on buildings per phase',
    { phase: '4', recipes: 'all', phaseCaps: { buildings: 150 } },
  ],
  ['amplified (fixture), every alternate', { ...amplified, recipes: 'all' }],
];

for (const [label, base] of SETTINGS)
  test(`the cap on hard drives keeps the plan true: ${label}`, () => {
    const free = calculate(base);
    const hunted = huntedAlternates(free).size;
    assert.ok(hunted > 0, 'the plan counts on some hard-drive alternates');
    // At or above what the plan counts on: the plan without the cap, byte for byte.
    for (const driveCap of [hunted, hunted + 3]) {
      const plan = calculate({ ...base, driveCap });
      assert.equal(plan.settings.driveCap, driveCap);
      assert.equal(driveless(plan), driveless(free), `cap ${driveCap}`);
    }
    // Below it: at most the cap, over the whole plan, and the set stays inside the planner.
    for (const driveCap of [0, 2, Math.floor(hunted / 2)].filter(cap => cap < hunted)) {
      const plan = calculate({ ...base, driveCap });
      const used = huntedAlternates(plan);
      assert.ok(used.size <= driveCap, `cap ${driveCap}: ${[...used].join(', ')}`);
      assert.equal('driveSet' in plan.settings, false);
      assert.ok(plan.warnings.some(warning => warning.startsWith('Cap on hard drives:')));
    }
  });
