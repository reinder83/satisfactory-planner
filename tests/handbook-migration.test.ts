// The handbook transcribed into a calculated snapshot (#486, part 3b of #394): every stage row
// is the handbook factory's own figures, the oil campus becomes its lines, the narrative goes
// into the guide with every id unchanged and in order, and the result is a plan the import checks
// accept. An older handbook with other ids or a recipe no longer in recipes.json still converts
// and reports what it left out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handbookToPlan,
  migrateHandbookState,
  OIL_CAMPUS,
  POWER_BLOCKS,
  POWER_CHECKS,
  TRANSCRIBED,
} from '../public/handbook-migration.ts';
import { validateTransfer } from '../public/transfer.ts';
import { saveExport, states, version11 } from './types/fixtures.ts';
import { newProfileState, validateState } from '../public/state.ts';
import type { SavedState, StoredCalculatedPlan } from '../public/types/index.ts';
import { handbook, recipes } from './helpers/data.ts';

const byName = new Map(recipes.map(r => [r.name, r]));
const accepts = (plan: StoredCalculatedPlan) => {
  const transfer = structuredClone(saveExport);
  transfer.saves[0]!.profiles[0]!.plan = plan as never;
  return validateTransfer(transfer).saves[0]!.profiles[0]!.plan!;
};

test("plan.json's factories become rows with the handbook's own figures", () => {
  const { plan, rows, skipped } = handbookToPlan(handbook, recipes);
  for (const phase of ['3', '4', '5'] as const) {
    const stage = plan.stages[phase];
    for (const factory of handbook.factories) {
      const factoryStage = factory.stages[phase];
      if (!factoryStage || factoryStage.recipe === OIL_CAMPUS) continue;
      const recipe = byName.get(factoryStage.recipe)!;
      assert.ok(recipe, `${factory.id}: ${factoryStage.recipe} is in recipes.json`);
      assert.equal(
        rows[phase]![factory.id],
        recipe.id,
        `${phase} ${factory.id} maps to its recipe's row`,
      );
      const row = stage.rows!.find(x => x.id === recipe.id)!;
      assert.equal(row.name, factory.name);
      assert.equal(row.outputs[factory.name], factoryStage.output, factory.id);
      // A factory the stage's oil campus makes has that line's figures (Phase 3's Plastic and
      // Rubber, which the handbook lists with 0 machines); every other one its own.
      const line = handbook.plans[phase]!.oil.find(l => l.recipe === factoryStage.recipe);
      if (line) {
        assert.equal(row.machines, line.machines, factory.id);
        assert.equal(row.peakMW, line.peakMW, factory.id);
        assert.ok(Object.keys(row.inputs).length > 0, factory.id + ' has its inputs');
        continue;
      }
      assert.equal(row.machines, factoryStage.machines, factory.id);
      assert.equal(row.equivalent, factoryStage.equivalent ?? factoryStage.machines, factory.id);
      assert.equal(row.peakMW, factoryStage.peakMW, factory.id);
      assert.deepEqual(row.inputs, factoryStage.inputs, factory.id);
    }
    // Row ids are unique within a stage, so each calc-<stage>-<id> tick names one row.
    const ids = stage.rows!.map(r => r.id);
    assert.equal(new Set(ids).size, ids.length, phase);
    // The stage's figures come from the handbook.
    assert.deepEqual(stage.raw, handbook.resources[phase]);
    assert.equal(stage.availableMW, handbook.power[phase]! * 1000);
    assert.equal(stage.requiredMW, handbook.plans[phase]!.manufacturingPeakGW * 1000);
    for (const delivery of handbook.deliveries.filter(d => d.phase === phase))
      assert.deepEqual(stage.delivery![delivery.name], {
        target: delivery.target,
        rate: delivery.rate,
      });
  }
  // The campus's own lines are rows in Phases 4 and 5, drawn at the oil site.
  for (const phase of ['4', '5'] as const)
    for (const line of handbook.plans[phase]!.oil) {
      const id = byName.get(line.recipe)!.id;
      const row = plan.stages[phase].rows!.find(x => x.id === id)!;
      assert.ok(row, `${phase}: the ${line.recipe} line`);
      assert.equal(row.machines, line.machines);
      assert.equal(plan.guide!.factories![id]!.site, 'oil');
    }
  // Only the campus's Plastic and Rubber are left out; their ticks are not guessed (6B).
  assert.deepEqual(
    skipped.map(x => `${x.stage}:${x.factory}:${x.why}`),
    ['4:plastic:oil-campus', '4:rubber:oil-campus', '5:plastic:oil-campus', '5:rubber:oil-campus'],
  );
});

test('the transcribed snapshot: its settings, engine, warning and empty early phases', () => {
  const { plan } = handbookToPlan(handbook, recipes);
  assert.equal(plan.engine, 'handbook-' + handbook.version);
  assert.deepEqual(plan.warnings, [TRANSCRIBED]);
  assert.doesNotMatch(TRANSCRIBED, /handbook/i, 'no "handbook" in user-facing copy (decision 8)');
  assert.equal(plan.createdAt, handbook.version + 'T00:00:00.000Z');
  assert.equal(plan.settings.phase, '3');
  assert.equal(plan.settings.multiplier, 50);
  assert.equal(plan.settings.wholeMachines, true);
  assert.deepEqual(
    plan.settings.limits,
    handbook.capacities,
    'without base limits, the capacities',
  );
  // With the catalog's all-pure limits, Water and Nitrogen Gas have a budget too; the handbook's
  // own capacities win where it has one.
  const pure = { ...handbook.capacities, 'Iron Ore': 1, Water: 1000000, 'Nitrogen Gas': 13500 };
  assert.deepEqual(handbookToPlan(handbook, recipes, pure).plan.settings.limits, {
    ...handbook.capacities,
    Water: 1000000,
    'Nitrogen Gas': 13500,
  });
  // Phases 1 and 2 are empty, selectable phases (decision 4).
  for (const phase of ['1', '2'] as const)
    assert.deepEqual(plan.stages[phase], { feasible: true, rows: [] });
  // Converting is repeatable.
  assert.deepEqual(handbookToPlan(handbook, recipes).plan, plan);
});

test('the narrative goes into the guide with every id unchanged and in order', () => {
  const { plan } = handbookToPlan(handbook, recipes);
  const guide = plan.guide!;
  for (const [phase, tasks] of Object.entries(handbook.phases))
    assert.deepEqual(
      guide.phases[phase]!.map(t => [t.id, t.title, t.body]),
      tasks.map(t => [t.id, t.title, t.body]),
      phase,
    );
  assert.deepEqual(
    guide.storageTasks!.map(t => t.id),
    handbook.storageTasks.map(t => t.id),
  );
  assert.deepEqual(guide.completion, handbook.completion);
  assert.deepEqual(guide.power!.checks, POWER_CHECKS);
  assert.deepEqual(guide.power!.blocks, POWER_BLOCKS);
  assert.deepEqual(guide.sources, handbook.sources);
  // A factory's note, page and flags follow its row.
  const factory = handbook.factories.find(
    x => x.note && x.stages['3'] && x.stages['3'].recipe !== OIL_CAMPUS,
  )!;
  const id = byName.get(factory.stages['3']!.recipe)!.id;
  assert.equal(guide.factories![id]!.note, factory.note);
  assert.equal(guide.factories![id]!.page, factory.page);
  for (const nuclearFactory of handbook.factories.filter(x => x.nuclear && x.stages['5']))
    assert.equal(
      guide.factories![byName.get(nuclearFactory.stages['5']!.recipe)!.id]!.site,
      'nuclear',
      nuclearFactory.id,
    );
});

test('the snapshot passes the import checks, guide included', () => {
  const { plan } = handbookToPlan(handbook, recipes);
  assert.deepEqual(accepts(plan).guide, plan.guide);
});

test('an older handbook with other ids and a lost recipe converts and reports what it left out', () => {
  const older = structuredClone(handbook);
  older.version = 'v1';
  const first = older.factories.find(f => f.stages['3'] && f.stages['3'].recipe !== OIL_CAMPUS)!;
  first.id = 'renamed-factory';
  const lost = older.factories.find(f => f !== first && f.stages['3'])!;
  lost.stages['3']!.recipe = 'A recipe that is gone';
  older.storageTasks = [];
  older.completion = [];
  delete older.sources;
  const { plan, rows, skipped } = handbookToPlan(older, recipes);
  assert.equal(rows['3']!['renamed-factory'], byName.get(first.stages['3']!.recipe)!.id);
  assert.equal(rows['3']![lost.id], undefined);
  assert.ok(
    skipped.some(x => x.stage === '3' && x.factory === lost.id && x.why === 'unknown-recipe'),
  );
  // Parts the handbook does not have are left out, not written empty (#473 review).
  assert.equal('storageTasks' in plan.guide!, false);
  assert.equal('completion' in plan.guide!, false);
  assert.equal('sources' in plan.guide!, false);
  assert.equal(plan.createdAt, '1970-01-01T00:00:00.000Z', 'an undated handbook gets a fixed date');
  accepts(plan);
});

test("Phase 3's Plastic and Rubber take their oil campus line's machines", () => {
  const { plan } = handbookToPlan(handbook, recipes);
  for (const name of ['Plastic', 'Rubber']) {
    const row = plan.stages['3'].rows!.find(r => r.name === name)!;
    const line = handbook.plans['3']!.oil.find(l => l.recipe === name)!;
    assert.equal(row.machines, line.machines, name);
    assert.ok(row.machines > 0, name + ' is built by some refineries');
  }
});

// ---- migrateHandbookState (#487, part 3c) ----
const conversion = handbookToPlan(handbook, recipes);
const rowOf = (phase: string, factoryId: string) => conversion.rows[phase]![factoryId];
const mapped = handbook.factories.find(f => f.stages['3'] && rowOf('3', f.id) && f.stages['5'])!;
const campus = 'plastic';
// A handbook profile's progress touching every rule, on top of the version-11 fixture.
const handbookState = (): SavedState => {
  const state = structuredClone(version11) as SavedState;
  state.checks = {
    ...state.checks,
    ['factory-3-' + mapped.id]: true,
    ['factory-5-' + mapped.id]: false,
    ['factory-4-' + campus]: true,
    'factory-3-no-such-factory': true,
    'phase-3-survey': true,
    'slot-A01-built': true,
  };
  state.notes = {
    ...state.notes,
    ['factory-' + mapped.id]: 'Build it by the lake',
    'factory-no-such-factory': 'An old note',
    'slot-A01': 'Top shelf',
  };
  state.deliveries = { '3-modular-engine': 12 };
  state.factoryGroups = {
    groups: [{ id: 'fg-plates1', name: 'Plates' }],
    assignments: {
      [mapped.id]: [{ group: 'fg-plates1', rate: null }],
      'no-such-factory': [{ group: 'fg-plates1', rate: 5 }],
    },
  };
  state.taskEdits = { ...state.taskEdits, links: { 'phase-5-survey': mapped.id } };
  return state;
};

test('migrateHandbookState moves each record to its new key, or keeps it unmapped', () => {
  const migrated = migrateHandbookState(handbookState(), handbook, conversion);
  assert.equal(migrated.version, 12);
  assert.equal(migrated.handbookOrigin!.version, handbook.version);
  // Factory ticks become their row's, per stage.
  assert.equal(migrated.checks[`calc-3-${rowOf('3', mapped.id)}`], true);
  assert.equal(migrated.checks[`calc-5-${rowOf('5', mapped.id)}`], false);
  assert.equal('factory-3-' + mapped.id in migrated.checks, false);
  // The campus tick is not guessed (6B), nor is an unknown factory's.
  assert.deepEqual(migrated.handbookOrigin!.unmapped.checks, {
    ['factory-4-' + campus]: true,
    'factory-3-no-such-factory': true,
  });
  // Everything else is unchanged, and the handbook's known checks are written.
  assert.equal(migrated.checks['phase-3-survey'], true);
  assert.equal(migrated.checks['slot-A01-built'], true);
  for (const [key, value] of Object.entries(handbook.knownChecks))
    assert.equal(migrated.checks[key], value);
  // The factory note follows every row it became; one for a factory this handbook no longer
  // has is kept for review (#493 review).
  for (const row of new Set([rowOf('3', mapped.id), rowOf('5', mapped.id)]))
    assert.equal(migrated.notes['factory-' + row], 'Build it by the lake');
  assert.equal('factory-no-such-factory' in migrated.notes, false);
  assert.deepEqual(migrated.handbookOrigin!.unmapped.notes, {
    'factory-no-such-factory': 'An old note',
  });
  assert.equal(migrated.notes['slot-A01'], 'Top shelf');
  // Deliveries keep their ids; the handbook's recorded count is written where none is saved.
  assert.equal(migrated.deliveries['3-modular-engine'], 12);
  for (const delivery of handbook.deliveries.filter(
    d => d.initial > 0 && d.id !== '3-modular-engine',
  ))
    assert.equal(migrated.deliveries[delivery.id], delivery.initial);
  // Group assignments follow the rows; one for no factory of the handbook is kept for review.
  assert.deepEqual(migrated.factoryGroups.assignments[rowOf('3', mapped.id)!], [
    { group: 'fg-plates1', rate: null },
  ]);
  assert.equal('no-such-factory' in migrated.factoryGroups.assignments, false);
  assert.deepEqual(migrated.handbookOrigin!.unmapped.assignments, {
    'no-such-factory': [{ group: 'fg-plates1', rate: 5 }],
  });
  // A step link names its phase's row.
  assert.equal(migrated.taskEdits.links['phase-5-survey'], rowOf('5', mapped.id));
  // Task edits, custom tasks and the storage layout are untouched.
  assert.deepEqual(migrated.customTasks, validateState(handbookState()).customTasks);
  assert.deepEqual(migrated.storageEdits, validateState(handbookState()).storageEdits);
  assert.deepEqual(migrated.taskEdits.titles, validateState(handbookState()).taskEdits.titles);
});

test('migrating twice equals migrating once', () => {
  const once = migrateHandbookState(handbookState(), handbook, conversion);
  assert.deepEqual(migrateHandbookState(once, handbook, conversion), once);
});

// Nothing disappears: every check, note, delivery count and assignment of the state is either
// kept under its key, moved to its new key, or listed in unmapped. Over plan.json with every
// fixture version 1–11 and the handbook state above.
test('no record disappears, for every state version and the handbook state', () => {
  for (const [state, version] of [...states, [handbookState(), 11] as const]) {
    const before = validateState(structuredClone(state));
    const migrated = migrateHandbookState(state, handbook, conversion);
    const unmapped = migrated.handbookOrigin!.unmapped;
    for (const [key, value] of Object.entries(before.checks)) {
      const match = /^factory-([345])-(.+)$/.exec(key);
      const moved =
        match && rowOf(match[1]!, match[2]!)
          ? `calc-${match[1]}-${rowOf(match[1]!, match[2]!)}`
          : key;
      assert.ok(
        migrated.checks[moved] === value || unmapped.checks[key] === value,
        `v${version} check ${key}`,
      );
    }
    for (const [key, value] of Object.entries(before.notes)) {
      const factoryId = key.slice('factory-'.length);
      const rows = [rowOf('3', factoryId), rowOf('4', factoryId), rowOf('5', factoryId)].filter(
        Boolean,
      );
      assert.ok(
        migrated.notes[key] === value ||
          rows.some(r => migrated.notes['factory-' + r] === value) ||
          unmapped.notes[key] === value,
        `v${version} note ${key}`,
      );
    }
    for (const [key, value] of Object.entries(before.deliveries))
      assert.equal(migrated.deliveries[key], value, `v${version} delivery ${key}`);
    for (const [key, list] of Object.entries(before.factoryGroups.assignments)) {
      const rows = [rowOf('3', key), rowOf('4', key), rowOf('5', key)].filter(Boolean) as string[];
      assert.ok(
        JSON.stringify(migrated.factoryGroups.assignments[key]) === JSON.stringify(list) ||
          rows.some(
            r => JSON.stringify(migrated.factoryGroups.assignments[r]) === JSON.stringify(list),
          ) ||
          JSON.stringify(unmapped.assignments[key]) === JSON.stringify(list),
        `v${version} assignment ${key}`,
      );
    }
    // The layout, task edits, custom tasks and phase are as they were.
    assert.deepEqual(migrated.storageEdits, before.storageEdits, `v${version} layout`);
    assert.deepEqual(migrated.customTasks, before.customTasks);
    assert.equal(migrated.settings.phase, before.settings.phase);
  }
});

// What the migration kept for review survives a Recalculate of the migrated profile (#489), so
// an unknown factory's note and assignment are never lost (#493 review).
test("an unknown factory's note and assignment survive a Recalculate of the migrated profile", () => {
  const migrated = migrateHandbookState(handbookState(), handbook, conversion);
  const { state } = newProfileState(
    conversion.plan,
    migrated,
    conversion.plan,
    undefined,
    undefined,
  );
  assert.deepEqual(state.handbookOrigin, migrated.handbookOrigin);
  assert.equal(state.handbookOrigin!.unmapped.notes['factory-no-such-factory'], 'An old note');
  assert.deepEqual(state.handbookOrigin!.unmapped.assignments['no-such-factory'], [
    { group: 'fg-plates1', rate: 5 },
  ]);
});
