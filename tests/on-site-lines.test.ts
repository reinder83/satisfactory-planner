// Made on site, sub-task 2 of #868 (#875): a factory group that marks an item gets its own
// whole-machine line for it, sized to its own consumers (settings.onSite, planner/on-site.ts),
// worked out from the groups when the user starts a recalculation (public/app/on-site.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate, settings } from '../planner.ts';
import { onSiteSettings } from '../public/app/on-site.ts';
import { phaseSteps } from '../public/progression.ts';
import { safeKey } from '../public/state.ts';
import type {
  CalcRow,
  CurrentCalculatedPlan,
  CurrentStage,
  FactoryGroups,
  Progression,
} from '../public/types/index.ts';

const BASE = { phase: '3', wholeMachines: true, limitsConfirmed: true };
const ALPHA = 'fg-alpha1',
  BETA = 'fg-beta22';
const WIRE = 'Recipe_Wire_C';
const WIRE_PER_MACHINE = 30;

let plain: CurrentCalculatedPlan | undefined;
// Phase 3 with whole machines and no item made on site, made once for the file.
const plainPlan = () => (plain ??= calculate(BASE));
const rowsOf = (stage: CurrentStage) => stage.rows || [];
const row = (stage: CurrentStage, id: string) =>
  rowsOf(stage).find(candidate => candidate.id === id);
const wireUse = (stage: CurrentStage, id: string) => row(stage, id)?.inputs.Wire || 0;
// Phase 3's Cable line's output, which a fixed membership rate on it is measured against.
const cableOutput = () => row(plainPlan().stages['3'], 'Recipe_Cable_C')!.outputs.Cable!;

// Two groups marking Wire: Alpha holds the Stator line, Beta half of the Cable line (the other
// half is Ungrouped), worked out from the plan as the recalculation would.
function twoGroups(): FactoryGroups {
  return {
    groups: [
      { id: ALPHA, name: 'Alpha' },
      { id: BETA, name: 'Beta' },
    ],
    assignments: {
      Recipe_Stator_C: [{ group: ALPHA, rate: null }],
      Recipe_Cable_C: [{ group: BETA, rate: cableOutput() / 2 }],
    },
    local: { [ALPHA]: ['Wire'], [BETA]: ['Wire'] },
  };
}

test('settings without items made on site stay as they were', () => {
  assert.equal('onSite' in settings({}), false, 'absent');
  assert.equal('onSite' in settings({ onSite: {} }), false, 'an empty map is dropped');
  assert.equal(
    'onSite' in settings({ onSite: { [ALPHA]: { items: ['Wire'], shares: { '3': {} } } } }),
    false,
    'a group without a share is dropped',
  );
  assert.deepEqual(
    settings({
      onSite: {
        [ALPHA]: {
          name: ' Alpha ',
          items: ['Wire', 'Screws', 'Wire'],
          shares: { '3': { Recipe_Cable_C: 0.5, Recipe_Stator_C: 0 }, '4': {} },
        },
      },
    }).onSite,
    {
      [ALPHA]: {
        name: 'Alpha',
        items: ['Screws', 'Wire'],
        shares: { '3': { Recipe_Cable_C: 0.5 } },
      },
    },
    'normalised: items once and sorted, zero shares and empty phases dropped',
  );
  for (const onSite of [
    [],
    { 'not-a-group': { items: ['Wire'], shares: {} } },
    { [ALPHA]: { items: ['Iron Ore'], shares: {} } },
    { [ALPHA]: { items: ['Nonsense'], shares: {} } },
    { [ALPHA]: { items: 'Wire', shares: {} } },
    { [ALPHA]: { items: ['Wire'], shares: { post: {} } } },
    { [ALPHA]: { items: ['Wire'], shares: { '3': { 'bad id': 0.5 } } } },
    { [ALPHA]: { items: ['Wire'], shares: { '3': { Recipe_Cable_C: 1.5 } } } },
    { [ALPHA]: { name: 7, items: ['Wire'], shares: {} } },
  ])
    assert.throws(() => settings({ onSite }), JSON.stringify(onSite));
});

test('onSiteSettings attributes each consumer by the memberships (rowShares)', () => {
  const plan = plainPlan();
  const cable = wireUse(plan.stages['3'], 'Recipe_Cable_C');
  assert.ok(cable > 0, 'Phase 3 makes Cable from Wire');
  const groups = twoGroups();
  const onSite = onSiteSettings(plan, groups)!;
  assert.equal(onSite[ALPHA]!.name, 'Alpha');
  assert.deepEqual(onSite[ALPHA]!.items, ['Wire']);
  assert.equal(onSite[ALPHA]!.shares['3']!.Recipe_Stator_C, 1, 'a single null membership');
  // Beta's fixed rate is half the Cable line's output, measured against it.
  assert.ok(
    Math.abs(onSite[BETA]!.shares['3']!.Recipe_Cable_C! - 0.5) < 1e-9,
    'a fixed rate against the row total in that phase',
  );
  assert.equal(onSite[ALPHA]!.shares['3']!.Recipe_Cable_C, undefined, 'not a member');
  // A row the plan lacks in a phase: only the null-rate memberships count, split evenly.
  const absent = onSiteSettings(
    { stages: { ...plan.stages, '2': { ...plan.stages['2'], rows: [] } } },
    {
      ...groups,
      assignments: {
        Recipe_Cable_C: [
          { group: ALPHA, rate: null },
          { group: BETA, rate: 5 },
        ],
      },
    },
  )!;
  assert.equal(absent[ALPHA]!.shares['2']!.Recipe_Cable_C, 1, 'the only null membership');
  assert.equal(absent[BETA]?.shares['2'], undefined, 'a fixed rate has nothing to measure against');
  // Nothing marked, or only a removed group: no setting at all.
  assert.equal(onSiteSettings(plan, { ...groups, local: {} }), undefined);
  assert.equal(onSiteSettings(plan, { ...groups, groups: [] }), undefined);
  assert.equal(onSiteSettings(plan, undefined), undefined);
});

test('two groups that mark Wire get a whole-machine Wire line each, plus a central one', () => {
  const plan = plainPlan();
  const stage = plan.stages['3'];
  const onSite = onSiteSettings(plan, twoGroups());
  const marked = calculate({ ...BASE, onSite });
  const result = marked.stages['3'];
  assert.equal(result.feasible, true);
  assert.equal(result.onSiteDropped, undefined);
  assert.deepEqual(marked.settings.onSite, onSite, 'frozen with the plan');
  const alpha = row(result, `${WIRE}:${ALPHA}`),
    beta = row(result, `${WIRE}:${BETA}`),
    central = row(result, WIRE);
  assert.ok(alpha && beta && central, 'two group lines and a central one');
  assert.deepEqual(alpha.onSite, { group: ALPHA, recipe: WIRE });
  assert.deepEqual(beta.onSite, { group: BETA, recipe: WIRE });
  assert.equal(central.onSite, undefined);
  for (const line of [alpha, beta, central]) {
    assert.equal(line.machines, Math.round(line.equivalent), `${line.id} whole machines`);
    assert.ok(Math.abs(line.equivalent - line.machines) < 1e-6, `${line.id} at 100%`);
    assert.ok(!line.amplified, 'never amplified');
  }
  // Each group line covers its own consumers and is the smallest whole count that does.
  const fits = (line: CalcRow, need: number) => {
    assert.ok(line.outputs.Wire! >= need - 1e-6, `${line.id} makes ${need}`);
    assert.ok(line.outputs.Wire! < need + WIRE_PER_MACHINE, `${line.id} no more than it needs`);
  };
  fits(alpha, wireUse(result, 'Recipe_Stator_C'));
  fits(beta, wireUse(result, 'Recipe_Cable_C') / 2);
  // The central line makes the rest: the other consumers, the other half of the Cable line and
  // the protected storage.
  const used = rowsOf(result).reduce((total, line) => total + (line.inputs.Wire || 0), 0);
  fits(
    central,
    used -
      wireUse(result, 'Recipe_Stator_C') -
      wireUse(result, 'Recipe_Cable_C') / 2 +
      (result.storage?.Wire || 0),
  );
  // The consumers, inputs and the rest of the plan are what they were.
  assert.equal(wireUse(result, 'Recipe_Stator_C'), wireUse(stage, 'Recipe_Stator_C'));
  assert.equal(wireUse(result, 'Recipe_Cable_C'), wireUse(stage, 'Recipe_Cable_C'));
  // In every phase a group has a line exactly when one of its consumers is in that phase's plan.
  for (const phase of ['1', '2', '3', '4', '5'] as const)
    for (const [group, consumer] of [
      [ALPHA, 'Recipe_Stator_C'],
      [BETA, 'Recipe_Cable_C'],
    ] as const)
      assert.equal(
        rowsOf(marked.stages[phase]).some(line => line.onSite?.group === group),
        wireUse(marked.stages[phase], consumer) > 0,
        `${group} in Phase ${phase}`,
      );
  assert.ok(marked.warnings.some(w => /Alpha makes Wire; Beta makes Wire/.test(w)));
  assert.ok(!plan.warnings.some(w => /on site/.test(w)));
});

test('check keys of unsplit rows are untouched, and a group line has a valid one', () => {
  const data: Progression = JSON.parse(
    fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
  );
  const plan = plainPlan();
  const marked = calculate({ ...BASE, onSite: onSiteSettings(plan, twoGroups()) });
  const calcKeys = (from: CurrentCalculatedPlan, phase: string) =>
    phaseSteps(from, { checks: {} }, data, phase)
      .map(step => step.id)
      .filter(id => id.startsWith('calc-'));
  for (const phase of ['3', '4', '5']) {
    const before = calcKeys(plan, phase),
      after = calcKeys(marked, phase);
    const added = after.filter(key => !before.includes(key));
    // Every other line keeps the key it always had; a later phase's whole-machine fit may pick
    // other lines around the group lines, never other keys for the same line.
    for (const key of after.filter(key => !key.includes(':fg-')))
      assert.match(key, new RegExp(`^calc-${phase}-(amp:)?[A-Za-z0-9_-]+$`), key);
    for (const key of added.filter(key => key.includes(':fg-'))) {
      assert.match(key, /^calc-\d-Recipe_[A-Za-z0-9_]+:fg-[a-z0-9]+$/, key);
      assert.ok(safeKey(key), `${key} passes the saved-state validator`);
    }
    if (phase === '3') {
      assert.deepEqual(
        before.filter(key => !after.includes(key)),
        [],
        'Phase 3: every key of the plan without the group lines is still there',
      );
      assert.equal(added.length, 2, 'and only the two group lines are new');
    }
  }
  assert.ok(calcKeys(marked, '3').includes(`calc-3-${WIRE}`), 'the central line keeps its key');
});

test('a group with no consumer of its item in a phase gets no line', () => {
  const plan = plainPlan();
  // Alpha marks Wire but holds only the Iron Plate line, which uses no Wire.
  const groups: FactoryGroups = {
    groups: [{ id: ALPHA, name: 'Alpha' }],
    assignments: { Recipe_IronPlate_C: [{ group: ALPHA, rate: null }] },
    local: { [ALPHA]: ['Wire'] },
  };
  assert.equal(onSiteSettings(plan, groups), undefined, 'nothing to attribute');
  // Given a share anyway, the planner makes no line for it.
  const marked = calculate({
    ...BASE,
    onSite: { [ALPHA]: { items: ['Wire'], shares: { '3': { Recipe_IronPlate_C: 1 } } } },
  });
  const stage = marked.stages['3'];
  assert.ok(!rowsOf(stage).some(line => line.onSite), 'no group line');
  assert.deepEqual(
    rowsOf(stage).map(line => [line.id, line.machines]),
    rowsOf(plan.stages['3']).map(line => [line.id, line.machines]),
    'the plan without it',
  );
});

test('group lines that do not fit the budgets make the item centrally (decision A)', () => {
  const plan = plainPlan();
  const ore = plan.stages['3'].raw!['Copper Ore']!;
  // Three groups each take 2% of the Cable line: a whole Wire machine each, more copper than one
  // central line needs, which a Copper Ore budget of exactly the central plan's draw cannot give.
  const onSite = Object.fromEntries(
    ['fg-aaaa', 'fg-bbbb', 'fg-cccc'].map((group, index) => [
      group,
      { name: `Site ${index + 1}`, items: ['Wire'], shares: { '3': { Recipe_Cable_C: 0.02 } } },
    ]),
  );
  const roomy = calculate({ ...BASE, onSite }).stages['3'];
  assert.ok(roomy.raw!['Copper Ore']! > Math.ceil(ore), 'the group lines need more Copper Ore');
  const limits = { ...plan.settings.limits, 'Copper Ore': Math.ceil(ore) };
  const tight = calculate({ ...BASE, limits, onSite });
  const stage = tight.stages['3'];
  assert.equal(stage.feasible, true, 'the phase is still planned');
  assert.deepEqual(stage.onSiteDropped, {
    'fg-aaaa': ['Wire'],
    'fg-bbbb': ['Wire'],
    'fg-cccc': ['Wire'],
  });
  assert.ok(!rowsOf(stage).some(line => line.onSite), 'no group line in that phase');
  assert.deepEqual(
    rowsOf(stage).map(line => [line.id, line.machines]),
    rowsOf(calculate({ ...BASE, limits }).stages['3']).map(line => [line.id, line.machines]),
    'the plan with Wire made centrally',
  );
  assert.ok(
    tight.warnings.some(w =>
      /^Phase 3 makes Wire centrally: the whole-machine lines of Site 1, Site 2 and Site 3/.test(w),
    ),
  );
  // Precise balancing never needs the fallback: copies cost what one line costs.
  const precise = calculate({ ...BASE, wholeMachines: false, limits, onSite }).stages['3'];
  assert.equal(precise.onSiteDropped, undefined);
  assert.ok(rowsOf(precise).some(line => line.onSite));
});

test('existing plans are unchanged', () => {
  const fixture = JSON.parse(
    fs.readFileSync(new URL('./fixtures/calculated-plan-2026-09-12.json', import.meta.url), 'utf8'),
  );
  const strip = ({ createdAt: _, ...plan }: CurrentCalculatedPlan) => plan;
  for (const input of [BASE, fixture.settings]) {
    const before = strip(calculate(input));
    assert.equal('onSite' in before.settings, false);
    assert.deepEqual(
      strip(calculate({ ...input, onSite: {} })),
      before,
      'an empty map changes nothing',
    );
  }
});

test("a group line of an alternate shares the recipe's unlock step and milestone", () => {
  const data: Progression = JSON.parse(
    fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
  );
  const plan = structuredClone(plainPlan());
  const wire = row(plan.stages['3'], WIRE)!;
  const fused = 'Recipe_Alternate_FusedWire_C';
  // Only the group line runs the alternate: its unlock is still the recipe's, listed once.
  for (const groupsOnly of [true, false]) {
    const stage = structuredClone(plan.stages['3']);
    stage.rows = [
      ...rowsOf(stage).filter(line => line.id !== WIRE),
      ...(groupsOnly ? [] : [{ ...wire, id: fused, alternate: true }]),
      {
        ...wire,
        id: `${fused}:${ALPHA}`,
        alternate: true,
        onSite: { group: ALPHA, recipe: fused },
      },
      { ...wire, id: `${fused}:${BETA}`, alternate: true, onSite: { group: BETA, recipe: fused } },
    ];
    const ids = phaseSteps(
      { ...plan, stages: { ...plan.stages, '3': stage } },
      { checks: {} },
      data,
      '3',
    )
      .map(step => step.id)
      .filter(id => id.startsWith('recipe-unlock-'));
    assert.deepEqual(
      ids,
      ['recipe-unlock-' + fused],
      groupsOnly ? 'group lines only' : 'and central',
    );
  }
});
