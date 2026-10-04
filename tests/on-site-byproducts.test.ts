// Made on site (#1012, the decision on #1018): a group gets its own line only of a recipe whose
// primary product (its first output) is an item the group marks; a recipe that makes the item only
// as a byproduct stays central. Copying it ran the whole recipe for the group: the copy took over
// the group's own consumer row (Rocket Fuel, copied for its Compacted Coal), so the interface no
// longer saw a consumer and every recalculation dropped and re-added the group's lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, recipePool, settings } from '../planner.ts';
import { siteCopies } from '../planner/on-site.ts';
import { onSitePlannable, onSiteSettings } from '../public/app/on-site.ts';
import { onSiteChange, onSiteSummaries, RAW_NOTE } from '../public/app/on-site-picker.ts';
import { newProfileState, validateState } from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import type {
  CalcRow,
  CurrentCalculatedPlan,
  FactoryGroups,
  StageKey,
  StoredCalculatedPlan,
} from '../public/types/index.ts';

const ALPHA = 'fg-alpha1',
  BETA = 'fg-beta22';
const ROCKET = 'Recipe_RocketFuel_C';
const ROCKET_COPY = `${ROCKET}:${ALPHA}`;
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

let plain: CurrentCalculatedPlan | undefined;
// The issue's plan: the default settings (Phase 3, Phases 1 and 2 milestone-only), made once.
const plainPlan = () => (plain ??= calculate({}));
// The plan "Recalculate with items made on site" makes from `plan` and the groups now.
function recalculated(plan: StoredCalculatedPlan, groups: FactoryGroups) {
  const onSite = onSiteSettings(plan, groups);
  const { onSite: _old, ...rest } = plan.settings;
  return calculate({ ...rest, ...(onSite ? { onSite } : {}) });
}
const rowsOf = (plan: StoredCalculatedPlan, phase: StageKey): CalcRow[] =>
  plan.stages[phase]?.rows || [];
// Every phase's own lines (rows with `onSite`), as sorted ids.
const ownLines = (plan: StoredCalculatedPlan) =>
  Object.fromEntries(
    Object.keys(plan.stages).map(phase => [
      phase,
      rowsOf(plan, phase as StageKey)
        .filter(row => row.onSite)
        .map(row => row.id)
        .sort(),
    ]),
  );
// A group, Alpha, holding `rows` and marking `local`.
const alpha = (local: string[], rows: string[]): FactoryGroups => ({
  groups: [{ id: ALPHA, name: 'Alpha' }],
  assignments: Object.fromEntries(rows.map(row => [row, [{ group: ALPHA, rate: null }]])),
  local: { [ALPHA]: local },
});
// The issue's group: Alpha holds the Rocket Fuel line and marks Compacted Coal and Turbofuel.
const rocketGroup = () => alpha(['Compacted Coal', 'Turbofuel'], [ROCKET]);

test('#1012: Rocket Fuel stays central when its group marks its byproduct Compacted Coal', () => {
  const plan = plainPlan();
  for (const phase of ['4', '5'] as const)
    assert.ok(
      rowsOf(plan, phase).some(row => row.id === ROCKET),
      `Phase ${phase} has a Rocket Fuel line`,
    );
  const first = recalculated(plan, rocketGroup());
  assert.deepEqual(first.settings.onSite?.[ALPHA]?.items, ['Compacted Coal', 'Turbofuel']);
  for (const phase of ['4', '5'] as const) {
    const rows = rowsOf(first, phase);
    assert.ok(!rows.some(row => row.id === ROCKET_COPY), `no Rocket Fuel copy in Phase ${phase}`);
    assert.ok(
      rows.some(row => row.id === ROCKET),
      `the central Rocket Fuel line stays in Phase ${phase}`,
    );
    // Its own lines are of recipes whose primary product it marks.
    assert.deepEqual(ownLines(first)[phase], [
      `Recipe_Alternate_EnrichedCoal_C:${ALPHA}`,
      `Recipe_Alternate_Turbofuel_C:${ALPHA}`,
    ]);
  }
  // The plan's own lines are what the marks ask for: no notice, and no "(until a recalculation)".
  assert.equal(onSiteChange(first, rocketGroup()), null);
  assert.deepEqual(onSiteSummaries(first, rocketGroup(), first.stages['4'])[ALPHA], {
    made: [
      { item: 'Compacted Coal', note: '' },
      { item: 'Turbofuel', note: '' },
    ],
    marked: [],
  });
  // So a recalculation started for another reason keeps them (it dropped and re-added them).
  const second = recalculated(first, rocketGroup());
  assert.deepEqual(second.settings.onSite?.[ALPHA]?.items, ['Compacted Coal', 'Turbofuel']);
  assert.deepEqual(ownLines(second), ownLines(first));
  assert.deepEqual(ownLines(recalculated(second, rocketGroup())), ownLines(first));
});

test('#1012: Heavy Oil Residue, a fluid the plan makes only as a byproduct, gets no line', () => {
  const plan = plainPlan();
  const makers = rowsOf(plan, '3').filter(row => row.outputs['Heavy Oil Residue']);
  assert.deepEqual(
    makers.map(row => row.id),
    ['Recipe_Plastic_C', 'Recipe_Rubber_C'],
    'only Plastic and Rubber make it, as a byproduct',
  );
  const groups = alpha(['Heavy Oil Residue'], ['Recipe_ResidualFuel_C']);
  // No recipe the plan uses makes it as its product, so a recalculation asks for no line ...
  assert.equal(onSiteSettings(plan, groups), undefined);
  assert.equal(onSiteChange(plan, groups), null);
  assert.deepEqual(onSiteSummaries(plan, groups, plan.stages['3'])[ALPHA]!.marked, [
    { item: 'Heavy Oil Residue', note: RAW_NOTE },
  ]);
  // ... and the planner, asked for one, does not copy Plastic or Rubber for it.
  const shares = { Recipe_ResidualFuel_C: 1 };
  const asked = calculate({
    ...plan.settings,
    onSite: {
      [ALPHA]: { name: 'Alpha', items: ['Heavy Oil Residue'], shares: { 3: shares, 4: shares } },
    },
  });
  for (const phase of ['3', '4'] as const) {
    assert.equal(asked.stages[phase].feasible, true);
    for (const id of ['Recipe_Plastic_C', 'Recipe_Rubber_C'])
      assert.ok(!rowsOf(asked, phase).some(row => row.id === `${id}:${ALPHA}`), `${id}, ${phase}`);
  }
});

test('#1012: Dark Matter Residue is copied only from the recipe that makes it as its product', () => {
  const config = settings({
    ...plainPlan().settings,
    onSite: {
      [ALPHA]: { items: ['Dark Matter Residue'], shares: { 5: { Recipe_DarkMatter_C: 1 } } },
    },
  });
  const pool = recipePool(config, 5, false);
  const byproduct = pool.filter(
    recipe =>
      recipe.outputs['Dark Matter Residue'] &&
      Object.keys(recipe.outputs)[0] !== 'Dark Matter Residue',
  );
  assert.ok(
    byproduct.some(recipe => recipe.id === 'Recipe_SpaceElevatorPart_12_C'),
    'AI Expansion Server makes it as a byproduct',
  );
  assert.deepEqual(
    siteCopies(config, 5, pool).map(copy => copy.id),
    [`Recipe_DarkEnergy_C:${ALPHA}`],
  );
});

// A plan an earlier release calculated for the issue's group: its Rocket Fuel line was Alpha's
// copy, `Recipe_RocketFuel_C:fg-alpha1`, in place of the central line. Made from today's plan by
// putting that copy back, as the earlier planner made it.
function storedBefore1012(): StoredCalculatedPlan {
  const plan: StoredCalculatedPlan = json(recalculated(plainPlan(), rocketGroup()));
  for (const phase of ['4', '5'] as const)
    plan.stages[phase].rows = rowsOf(plan, phase).map(row =>
      row.id === ROCKET
        ? { ...row, id: ROCKET_COPY, onSite: { group: ALPHA, recipe: ROCKET } }
        : row,
    );
  return plan;
}

test('compat: a plan stored with a byproduct copy loads unchanged; the next recalculation drops it', () => {
  const stored = storedBefore1012();
  const ticked = `calc-4-${ROCKET_COPY}`;
  const state = validateState({
    version: 14,
    settings: { phase: '3' },
    checks: { [ticked]: true },
    notes: {},
    deliveries: {},
    customTasks: [],
    factoryGroups: rocketGroup(),
  });
  assert.equal(state.checks[ticked], true, 'its tick is a valid check key');
  const imported = validateTransfer({
    format: 'satisfactory-planner-saves',
    version: 1,
    exportedAt: '2026-10-04T12:00:00.000Z',
    saves: [
      {
        id: 's1',
        name: 'World',
        activeProfile: 'p1',
        profiles: [
          { id: 'p1', name: 'Made on site', kind: 'calculated', plan: stored, state: json(state) },
        ],
      },
    ],
  });
  const loaded = imported.saves[0]!.profiles[0]!;
  assert.deepEqual(loaded.plan, stored, 'the plan loads as it was stored');
  assert.deepEqual(loaded.state.checks, { [ticked]: true });
  // The planner still accepts its settings, and a recalculation has no copy of Rocket Fuel.
  assert.deepEqual(settings(stored.settings).onSite, stored.settings.onSite);
  const next = recalculated(stored, rocketGroup());
  for (const phase of ['4', '5'] as const) {
    assert.ok(!rowsOf(next, phase).some(row => row.id === ROCKET_COPY));
    assert.ok(rowsOf(next, phase).some(row => row.id === ROCKET));
  }
  // The tick on the copy is kept for review in the new profile, never lost (#876).
  const carried = newProfileState(next, loaded.state, stored, undefined, undefined).state;
  assert.equal(carried.onSiteReview?.checks[ticked], true);
});

// A small deterministic random sequence (a linear congruential generator), so a failure repeats.
function sequence(seed: number) {
  let value = seed;
  return () => (value = (value * 1103515245 + 12345) % 2147483648) / 2147483648;
}

test('#1012 property: no copy of a byproduct maker, and a second recalculation keeps the lines', () => {
  // Whole machines, the wizard's default; random groups holding rows of the plan and marking
  // their ingredients and the ingredients' ingredients.
  const base = calculate({ wholeMachines: true, limitsConfirmed: true });
  const rows = Object.values(base.stages).flatMap(stage => stage.rows || []);
  const ids = [...new Set(rows.map(row => row.id))].filter(id => !id.startsWith('power-'));
  const random = sequence(1012);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  const inputsOf = (id: string) =>
    rows.filter(row => row.id === id).flatMap(row => Object.keys(row.inputs));
  let checked = 0;
  for (let round = 0; round < 24; round++) {
    const groups: FactoryGroups = { groups: [], assignments: {}, local: {} };
    for (const group of [ALPHA, BETA]) {
      groups.groups.push({ id: group, name: group });
      const held = Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(ids));
      for (const id of held) (groups.assignments[id] ??= []).push({ group, rate: null });
      const inputs = held.flatMap(inputsOf);
      const deeper = rows
        .filter(row => inputs.some(item => row.outputs[item]))
        .flatMap(row => Object.keys(row.inputs));
      const items = [...new Set([...inputs, ...deeper])].filter(onSitePlannable);
      if (items.length)
        groups.local![group] = [
          ...new Set(Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(items))),
        ];
    }
    const first = recalculated(base, groups);
    if (!first.settings.onSite) continue;
    checked++;
    const label = JSON.stringify(groups);
    for (const stage of Object.values(first.stages))
      for (const row of stage.rows || [])
        if (row.onSite)
          assert.ok(
            first.settings.onSite[row.onSite.group]!.items.includes(Object.keys(row.outputs)[0]!),
            `${row.id} is a line of an item its group marks: ${label}`,
          );
    assert.equal(onSiteChange(first, groups), null, label);
    assert.deepEqual(ownLines(recalculated(first, groups)), ownLines(first), label);
  }
  assert.ok(checked >= 10, `${checked} cases with lines made on site`);
});
