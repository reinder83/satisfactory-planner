// The handbook transcribed into a calculated snapshot (#486, part 3b of #394): every stage row
// is the handbook factory's own figures, the oil campus becomes its lines, the narrative goes
// into the guide with every id unchanged and in order, and the result is a plan the import checks
// accept. An older handbook with other ids or a recipe no longer in recipes.json still converts
// and reports what it left out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handbookJson from '../public/plan.json' with { type: 'json' };
import recipesJson from '../recipes.json' with { type: 'json' };
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
import { validateState } from '../public/state.ts';
import type { Handbook, Recipe, SavedState, StoredCalculatedPlan } from '../public/types/index.ts';

const handbook = handbookJson as unknown as Handbook;
const recipes = (recipesJson as unknown as { recipes: Recipe[] }).recipes;
const byName = new Map(recipes.map(r => [r.name, r]));
const accepts = (plan: StoredCalculatedPlan) => {
  const x = structuredClone(saveExport);
  x.saves[0]!.profiles[0]!.plan = plan as never;
  return validateTransfer(x).saves[0]!.profiles[0]!.plan!;
};

test("plan.json's factories become rows with the handbook's own figures", () => {
  const { plan, rows, skipped } = handbookToPlan(handbook, recipes);
  for (const st of ['3', '4', '5'] as const) {
    const stage = plan.stages[st];
    for (const f of handbook.factories) {
      const s = f.stages[st];
      if (!s || s.recipe === OIL_CAMPUS) continue;
      const r = byName.get(s.recipe)!;
      assert.ok(r, `${f.id}: ${s.recipe} is in recipes.json`);
      assert.equal(rows[st]![f.id], r.id, `${st} ${f.id} maps to its recipe's row`);
      const row = stage.rows!.find(x => x.id === r.id)!;
      assert.equal(row.name, f.name);
      assert.equal(row.outputs[f.name], s.output, f.id);
      // A factory the stage's oil campus makes has that line's figures (Phase 3's Plastic and
      // Rubber, which the handbook lists with 0 machines); every other one its own.
      const line = handbook.plans[st]!.oil.find(l => l.recipe === s.recipe);
      if (line) {
        assert.equal(row.machines, line.machines, f.id);
        assert.equal(row.peakMW, line.peakMW, f.id);
        assert.ok(Object.keys(row.inputs).length > 0, f.id + ' has its inputs');
        continue;
      }
      assert.equal(row.machines, s.machines, f.id);
      assert.equal(row.equivalent, s.equivalent ?? s.machines, f.id);
      assert.equal(row.peakMW, s.peakMW, f.id);
      assert.deepEqual(row.inputs, s.inputs, f.id);
    }
    // Row ids are unique within a stage, so each calc-<stage>-<id> tick names one row.
    const ids = stage.rows!.map(r => r.id);
    assert.equal(new Set(ids).size, ids.length, st);
    // The stage's figures come from the handbook.
    assert.deepEqual(stage.raw, handbook.resources[st]);
    assert.equal(stage.availableMW, handbook.power[st]! * 1000);
    assert.equal(stage.requiredMW, handbook.plans[st]!.manufacturingPeakGW * 1000);
    for (const d of handbook.deliveries.filter(d => d.phase === st))
      assert.deepEqual(stage.delivery![d.name], { target: d.target, rate: d.rate });
  }
  // The campus's own lines are rows in Phases 4 and 5, drawn at the oil site.
  for (const st of ['4', '5'] as const)
    for (const l of handbook.plans[st]!.oil) {
      const id = byName.get(l.recipe)!.id;
      const row = plan.stages[st].rows!.find(x => x.id === id)!;
      assert.ok(row, `${st}: the ${l.recipe} line`);
      assert.equal(row.machines, l.machines);
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
  for (const st of ['1', '2'] as const)
    assert.deepEqual(plan.stages[st], { feasible: true, rows: [] });
  // Converting is repeatable.
  assert.deepEqual(handbookToPlan(handbook, recipes).plan, plan);
});

test('the narrative goes into the guide with every id unchanged and in order', () => {
  const { plan } = handbookToPlan(handbook, recipes);
  const guide = plan.guide!;
  for (const [ph, ts] of Object.entries(handbook.phases))
    assert.deepEqual(
      guide.phases[ph]!.map(t => [t.id, t.title, t.body]),
      ts.map(t => [t.id, t.title, t.body]),
      ph,
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
  const f = handbook.factories.find(
    x => x.note && x.stages['3'] && x.stages['3'].recipe !== OIL_CAMPUS,
  )!;
  const id = byName.get(f.stages['3']!.recipe)!.id;
  assert.equal(guide.factories![id]!.note, f.note);
  assert.equal(guide.factories![id]!.page, f.page);
  for (const x of handbook.factories.filter(x => x.nuclear && x.stages['5']))
    assert.equal(guide.factories![byName.get(x.stages['5']!.recipe)!.id]!.site, 'nuclear', x.id);
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
const rowOf = (st: string, fid: string) => conversion.rows[st]![fid];
const mapped = handbook.factories.find(f => f.stages['3'] && rowOf('3', f.id) && f.stages['5'])!;
const campus = 'plastic';
// A handbook profile's progress touching every rule, on top of the version-11 fixture.
const handbookState = (): SavedState => {
  const s = structuredClone(version11) as SavedState;
  s.checks = {
    ...s.checks,
    ['factory-3-' + mapped.id]: true,
    ['factory-5-' + mapped.id]: false,
    ['factory-4-' + campus]: true,
    'factory-3-no-such-factory': true,
    'phase-3-survey': true,
    'slot-A01-built': true,
  };
  s.notes = {
    ...s.notes,
    ['factory-' + mapped.id]: 'Build it by the lake',
    'factory-no-such-factory': 'An old note',
    'slot-A01': 'Top shelf',
  };
  s.deliveries = { '3-modular-engine': 12 };
  s.factoryGroups = {
    groups: [{ id: 'fg-plates1', name: 'Plates' }],
    assignments: {
      [mapped.id]: [{ group: 'fg-plates1', rate: null }],
      'no-such-factory': [{ group: 'fg-plates1', rate: 5 }],
    },
  };
  s.taskEdits = { ...s.taskEdits, links: { 'phase-5-survey': mapped.id } };
  return s;
};

test('migrateHandbookState moves each record to its new key, or keeps it unmapped', () => {
  const m = migrateHandbookState(handbookState(), handbook, conversion);
  assert.equal(m.version, 12);
  assert.equal(m.handbookOrigin!.version, handbook.version);
  // Factory ticks become their row's, per stage.
  assert.equal(m.checks[`calc-3-${rowOf('3', mapped.id)}`], true);
  assert.equal(m.checks[`calc-5-${rowOf('5', mapped.id)}`], false);
  assert.equal('factory-3-' + mapped.id in m.checks, false);
  // The campus tick is not guessed (6B), nor is an unknown factory's.
  assert.deepEqual(m.handbookOrigin!.unmapped.checks, {
    ['factory-4-' + campus]: true,
    'factory-3-no-such-factory': true,
  });
  // Everything else is unchanged, and the handbook's known checks are written.
  assert.equal(m.checks['phase-3-survey'], true);
  assert.equal(m.checks['slot-A01-built'], true);
  for (const [k, v] of Object.entries(handbook.knownChecks)) assert.equal(m.checks[k], v);
  // The factory note follows every row it became; an unknown factory's stays as it is: only
  // the handbook's own factory ids are re-keyed.
  for (const row of new Set([rowOf('3', mapped.id), rowOf('5', mapped.id)]))
    assert.equal(m.notes['factory-' + row], 'Build it by the lake');
  assert.equal(m.notes['factory-no-such-factory'], 'An old note');
  assert.equal(m.notes['slot-A01'], 'Top shelf');
  // Deliveries keep their ids; the handbook's recorded count is written where none is saved.
  assert.equal(m.deliveries['3-modular-engine'], 12);
  for (const d of handbook.deliveries.filter(d => d.initial > 0 && d.id !== '3-modular-engine'))
    assert.equal(m.deliveries[d.id], d.initial);
  // Group assignments follow the rows; one for no factory of the handbook stays as it is.
  assert.deepEqual(m.factoryGroups.assignments[rowOf('3', mapped.id)!], [
    { group: 'fg-plates1', rate: null },
  ]);
  assert.deepEqual(m.factoryGroups.assignments['no-such-factory'], [
    { group: 'fg-plates1', rate: 5 },
  ]);
  // A step link names its phase's row.
  assert.equal(m.taskEdits.links['phase-5-survey'], rowOf('5', mapped.id));
  // Task edits, custom tasks and the storage layout are untouched.
  assert.deepEqual(m.customTasks, validateState(handbookState()).customTasks);
  assert.deepEqual(m.storageEdits, validateState(handbookState()).storageEdits);
  assert.deepEqual(m.taskEdits.titles, validateState(handbookState()).taskEdits.titles);
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
    const m = migrateHandbookState(state, handbook, conversion);
    const u = m.handbookOrigin!.unmapped;
    for (const [k, v] of Object.entries(before.checks)) {
      const f = /^factory-([345])-(.+)$/.exec(k);
      const moved = f && rowOf(f[1]!, f[2]!) ? `calc-${f[1]}-${rowOf(f[1]!, f[2]!)}` : k;
      assert.ok(m.checks[moved] === v || u.checks[k] === v, `v${version} check ${k}`);
    }
    for (const [k, v] of Object.entries(before.notes)) {
      const fid = k.slice('factory-'.length);
      const rows = [rowOf('3', fid), rowOf('4', fid), rowOf('5', fid)].filter(Boolean);
      assert.ok(
        m.notes[k] === v || rows.some(r => m.notes['factory-' + r] === v) || u.notes[k] === v,
        `v${version} note ${k}`,
      );
    }
    for (const [k, v] of Object.entries(before.deliveries))
      assert.equal(m.deliveries[k], v, `v${version} delivery ${k}`);
    for (const [k, list] of Object.entries(before.factoryGroups.assignments)) {
      const rows = [rowOf('3', k), rowOf('4', k), rowOf('5', k)].filter(Boolean) as string[];
      assert.ok(
        JSON.stringify(m.factoryGroups.assignments[k]) === JSON.stringify(list) ||
          rows.some(r => JSON.stringify(m.factoryGroups.assignments[r]) === JSON.stringify(list)) ||
          JSON.stringify(u.assignments[k]) === JSON.stringify(list),
        `v${version} assignment ${k}`,
      );
    }
    // The layout, task edits, custom tasks and phase are as they were.
    assert.deepEqual(m.storageEdits, before.storageEdits, `v${version} layout`);
    assert.deepEqual(m.customTasks, before.customTasks);
    assert.equal(m.settings.phase, before.settings.phase);
  }
});
