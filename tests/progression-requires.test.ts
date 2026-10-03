import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { guideContext, hardDriveTasks, requiredMilestones } from '../public/progression.ts';
import { calculate } from '../planner.ts';
import type { CalcRow, Progression } from '../public/types/index.ts';
const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);

// The HUB tutorial upgrades before HUB Upgrade 6 are left out of progression.json on purpose
// (see listedNames in public/progression.ts), so HUB Upgrade 6's prerequisite is the one id
// that need not resolve.
const UNLISTED = new Set(['Schematic_Tutorial4_C']);

test('every requires id in progression.json names an entry it lists', () => {
  const ids = new Set(data.entries.map(entry => entry.id));
  const dangling = data.entries.flatMap(entry =>
    entry.requires
      .filter(id => !ids.has(id) && !UNLISTED.has(id))
      .map(id => `${entry.name} -> ${id}`),
  );
  assert.deepEqual(dangling, []);
});

// Turbo Heavy Fuel, Compacted Steel Ingot and Fine Black Powder are offered by hard drives only
// after the MAM research Compacted Coal (#828). The dataset named the retired hard-drive schematic
// Schematic_Alternate_EnrichedCoal_C, which no entry has, so their step named no first unlock.
test('the alternates that need Compacted Coal name it as a first unlock', () => {
  const compacted = data.entries.find(entry => entry.id === 'Research_Sulfur_CompactedCoal_C')!;
  assert.equal(compacted.name, 'Compacted Coal');
  const context = guideContext(calculate({ phase: '1' }), { checks: {} }, data, '1');
  const alternates: [string, string, string][] = [
    ['Recipe_Alternate_TurboHeavyFuel_C', 'Turbo Heavy Fuel', 'Refinery'],
    ['Recipe_Alternate_IngotSteel_2_C', 'Compacted Steel Ingot', 'Foundry'],
    ['Recipe_Alternate_Gunpowder_1_C', 'Fine Black Powder', 'Assembler'],
  ];
  for (const [id, name, machine] of alternates) {
    // A partial row: hardDriveTasks and requiredMilestones read only these fields.
    const row = { id, name, machine, alternate: true, inputs: {}, outputs: {} } as CalcRow;
    const unlock = hardDriveTasks({ ...context, rows: [row] })[1]!;
    assert.equal(unlock.id, 'recipe-unlock-' + id, 'the check key is unchanged');
    assert.match(unlock.body, /First unlock: [^.]*\bCompacted Coal\b[^.]*\. /, name);
    const milestones = requiredMilestones({ ...context, rows: [row] }).map(entry => entry.id);
    assert.ok(milestones.includes(compacted.id), `${name} brings in the Compacted Coal research`);
  }
});
