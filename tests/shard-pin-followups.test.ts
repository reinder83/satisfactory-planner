// Follow-ups to the Power Shard pins per line (#1239, review of #1268), the parts without a page:
// the plan's warning for a line of one machine below 100%, the research step counting a line once
// (not its amplified twin again), the handover of a clocked line against its own clock, and an
// import that says which pins it dropped (on recipes the game data lacks or cannot amplify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate, catalog, DATA, settings } from '../planner.ts';
import { lineClocksSettings } from '../public/app/shard-pins.ts';
import { carriedChange, carriedText, phaseCarry } from '../public/app/handover.ts';
import { phaseSteps } from '../public/progression.ts';
import { amplifySlots } from '../public/somersloops.ts';
import { importableTransfer } from '../public/transfer.ts';
import { version26 } from './types/fixtures.ts';
import type {
  CalcRow,
  LineClocks,
  Progression,
  SaveExport,
  StageKey,
  StoredCalculatedPlan,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const ROD = 'Recipe_IronRod_C';
const RUBBER = 'Recipe_Rubber_C';
const BASE = { phase: '3', recipes: 'standard', wholeMachines: true, storageFromSurplus: true };
const plan = (clocks: LineClocks, extra: object = {}) =>
  json(
    calculate(lineClocksSettings(settings({ ...BASE, ...extra }), clocks)),
  ) as StoredCalculatedPlan;
const rowOf = (stored: StoredCalculatedPlan, phase: StageKey, id: string) =>
  stored.stages[phase]!.rows!.find(row => row.id === id)!;

test('the warning for a clocked line of one machine below 100% names no zero shards', () => {
  // An exact plan: Rubber is one machine at 87.5%, so the game needs no Power Shards for it.
  const exact = plan({ '3': { [RUBBER]: 250 } }, { wholeMachines: false });
  const rubber = rowOf(exact, '3', RUBBER);
  assert.equal(rubber.machines, 1);
  assert.ok(rubber.lastClock < 100);
  const warning = exact.warnings.find(line => line.startsWith('One production line runs at'))!;
  assert.match(
    warning,
    /: Rubber in Phase 3 \(250%, no Power Shards: its one machine runs below 100%\)\./,
  );
  assert.doesNotMatch(warning, /\b0 Power Shards/);
  // A line whose machines hold shards still names them.
  const rod = plan({ '3': { [ROD]: 250 } });
  assert.ok(
    rod.warnings.some(line =>
      line.includes(`Iron Rod in Phase 3 (250%, ${rowOf(rod, '3', ROD).shards} Power Shards)`),
    ),
  );
});

test('the research step counts a line once, with its amplified twin', () => {
  const clocked = plan({ '3': { [ROD]: 250 } });
  const rows = clocked.stages['3']!.rows!;
  const rod = rowOf(clocked, '3', ROD);
  const twin: CalcRow = { ...rod, id: 'amp:' + ROD, amplified: true, sloops: 2 * rod.machines };
  const research = (stored: StoredCalculatedPlan) =>
    phaseSteps(stored, { checks: {} }, data, '3').find(step => step.id === 'power-shards-3')!.body;
  const one = research(clocked);
  assert.match(one, /^Phase 3 runs a production line overclocked at the clock you pinned/);
  // The twin holds shards of its own, so the count is the sum; the line is still one.
  const withTwin = structuredClone(clocked);
  withTwin.stages['3']!.rows = [...rows, twin];
  const body = research(withTwin);
  assert.match(
    body,
    new RegExp(
      `^Phase 3 runs a production line overclocked at the clock you pinned, whose machines hold ${2 * rod.shards!} Power Shards\\.`,
    ),
  );
  // A second recipe is a second line.
  const other = rows.find(row => row.power > 0 && row.id !== ROD && !row.id.includes(':'))!;
  const two = structuredClone(withTwin);
  two.stages['3']!.rows = [...two.stages['3']!.rows!, { ...other, clock: 150, shards: 1 }];
  assert.match(
    research(two),
    /^Phase 3 runs 2 production lines overclocked at the clock you pinned/,
  );
});

// A carried line of a clocked plan: Phase 3's Iron Rod before, Phase 4's after.
test('the handover words a clocked line against its own clock, not 100%', () => {
  const stored = plan({ '3': { [ROD]: 250 } });
  const before = rowOf(stored, '3', ROD);
  const row = (over: Partial<CalcRow>): CalcRow => ({ ...before, ...over });
  const carried = (old: CalcRow) => ({ from: '3' as const, before: old });
  const oldRow = row({ machines: 10, equivalent: 9.5, lastClock: 125 });
  // Running since: the machines at 250% with the last at its own clock.
  assert.match(
    carriedText(carried(oldRow), oldRow),
    /^Running since Phase 3: 10 × Constructor at 250%, the last at 125%\. /,
  );
  // More machines: the old adjustable one is raised to the line's clock, 250%, not 100%.
  assert.equal(
    carriedChange(carried(oldRow), row({ machines: 12, equivalent: 12, lastClock: 250 })),
    'Add 2 machines, and raise the last Phase 3 Constructor from 125% to 250%.',
  );
  // Fewer machines: the last one set to its clock, which is below the line's 250%.
  assert.equal(
    carriedChange(carried(oldRow), row({ machines: 8, equivalent: 7.5, lastClock: 125 })),
    'This phase needs 2 machines fewer: switch off 2 and set the last one to 125%.',
  );
  // The same size is left as it is, and a different last clock is lowered or raised.
  assert.equal(carriedChange(carried(oldRow), oldRow), 'Nothing to add or change.');
  assert.equal(
    carriedChange(carried(oldRow), row({ machines: 10, equivalent: 9.8, lastClock: 200 })),
    'Nothing to add: raise the last Constructor from 125% to 200%.',
  );
  // A line pinned to another clock than it ran at sets every machine anew.
  const plainBefore = row({ clock: undefined, shards: undefined, machines: 30, lastClock: 100 });
  assert.equal(
    carriedChange(carried(plainBefore), row({ machines: 12, equivalent: 11.5, lastClock: 125 })),
    'This phase needs 18 machines fewer: switch off 18. Set every Constructor to 250%, from 100%, the last one to 125%.',
  );
  assert.equal(
    carriedChange(
      carried(oldRow),
      row({ clock: 200, machines: 12, equivalent: 12, lastClock: 200 }),
    ),
    'Add 2 machines. Set every Constructor to 200%, from 250%.',
  );
  // A line at 100% reads as it always did.
  const plain = row({ clock: undefined, shards: undefined, machines: 30, lastClock: 62 });
  assert.equal(
    carriedChange(
      carried(plain),
      row({ clock: undefined, shards: undefined, machines: 32, lastClock: 100 }),
    ),
    'Add 2 machines, and raise the last Phase 3 Constructor from 62% to 100%.',
  );
  assert.equal(
    carriedText(carried(plain), plain),
    'Running since Phase 3: 30 × Constructor, the last at 62%. Nothing to add or change. ',
  );
});

test('the share a carried clocked line already makes counts its machines at their clock', () => {
  // Phase 3 ran Iron Rod at 250% (4 machines make what 10 do at 100%); Phase 4 needs 5 machines
  // at 100%-equivalents of 10 → the same output, so the line is fully carried.
  const stored = plan({ '3': { [ROD]: 250 }, '4': { [ROD]: 250 } }, { phase: '3' });
  const before = rowOf(stored, '3', ROD);
  const after = rowOf(stored, '4', ROD);
  assert.equal(after.clock, 250);
  const carry = phaseCarry(stored, { ['calc-3-' + ROD]: true }, '4')!;
  const share = carry.shares.get(ROD)!;
  const made = (row: CalcRow) => (row.equivalent * (row.clock ?? 100)) / 100;
  assert.ok(Math.abs(share - Math.min(1, made(before) / made(after))) < 1e-9, `${share}`);
});

// An import (dropUnknownPins): the pins the game data cannot keep are dropped and said so.
test('an import names the pins it dropped, in the plan’s warnings', async () => {
  const stored = plan({});
  const file = (state: object, settingsPins: object = {}): SaveExport => ({
    format: 'satisfactory-planner-saves',
    version: 1,
    exportedAt: '2026-10-27T08:00:00.000Z',
    saves: [
      {
        id: 's1',
        name: 'World',
        activeProfile: 'p1',
        profiles: [
          {
            id: 'p1',
            name: 'Pinned',
            kind: 'calculated',
            plan: { ...json(stored), settings: { ...stored.settings, ...settingsPins } },
            state: { ...json(version26), ...state },
          },
        ],
      },
    ],
  });
  const recipes = async () => ({ recipes: DATA.recipes, pureLimits: catalog().pureLimits });
  const profile = async (f: SaveExport) =>
    (await importableTransfer(json(f), recipes)).saves[0]!.profiles[0]!;
  const before = stored.warnings.length;
  // Power Shard pins on a recipe the game data lacks, from the progress and the plan's settings.
  const shards = await profile(
    file(
      { lineClocks: { '3': { Recipe_Gone_C: 150, [ROD]: 200 } } },
      { lineClocks: { '3': { Recipe_Gone_C: 150 }, '4': { Recipe_Gone_C: 250 } } },
    ),
  );
  assert.deepEqual(shards.state.lineClocks, { '3': { [ROD]: 200 } });
  const warnings = shards.plan!.warnings;
  assert.equal(warnings.length, before + 1);
  assert.equal(
    warnings.at(-1),
    'This file pinned Power Shards on Recipe_Gone_C in Phase 3 and Recipe_Gone_C in Phase 4, which the import dropped, because this planner has no such recipe. Pin the lines again in their production lines’ dialogs if you still want them.',
  );
  // Somersloop pins on an unknown recipe, and one a machine cannot amplify (a known recipe: named).
  const fixed = DATA.recipes.find(recipe => amplifySlots(recipe) === 0)!;
  const sloops = await profile(file({ sloopPins: { '3': { Recipe_Gone_C: 1, [fixed.id]: 1 } } }));
  assert.ok(
    sloops
      .plan!.warnings.at(-1)!
      .startsWith(
        `This file pinned somersloops on Recipe_Gone_C in Phase 3 and ${fixed.name} in Phase 3, which the import dropped, because this planner has no such recipe, or one whose machine cannot take somersloops. `,
      ),
    sloops.plan!.warnings.at(-1),
  );
  assert.equal(sloops.plan!.warnings.length, before + 1);
  assert.equal(
    (sloops.state.sloopPins?.['3'] ?? {})[fixed.id],
    undefined,
    'the unamplifiable pin is dropped',
  );
  // Pins the game data has, or none at all, add nothing.
  assert.equal((await profile(file({}))).plan!.warnings.length, before);
  assert.equal(
    (await profile(file({ lineClocks: { '3': { [ROD]: 200 } } }))).plan!.warnings.length,
    before,
  );
  // Both kinds in one file: one warning each.
  const both = await profile(
    file({ lineClocks: { '3': { Recipe_Gone_C: 150 } }, sloopPins: { '3': { Recipe_Gone_C: 1 } } }),
  );
  assert.equal(both.plan!.warnings.length, before + 2);
});
