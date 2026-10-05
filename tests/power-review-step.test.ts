// "Power available now" (powerReviewTask in public/progression.ts, #1048). It used to follow the
// ticked power unlocks only, so a player who runs Turbofuel power with 44.4 GW of spare power in
// the settings, Coal Power ticked and no Fuel Generator in the plan was told to "Build coal
// extraction, water and generators" in every phase: Petroleum Power was only listed when the
// plan built Fuel Generators, so it could never be ticked. Now the step builds on the spare
// existing power (availablePowerGW) with the stage's own figures, never advises a source below
// the one ticked or planned, and Petroleum Power is listed from Phase 3 like Coal Power from
// Phase 2. Numbers are written as in en-US.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { milestonePhase, phaseSteps } from '../public/progression.ts';
import { calculate } from '../planner.ts';
import type {
  CalcRow,
  Progression,
  StageKey,
  StoredCalculatedPlan,
  StoredStage,
} from '../public/types/index.ts';

// The numbers read as in en-US whatever this machine's locale is.
const toLocale = Number.prototype.toLocaleString;
Number.prototype.toLocaleString = function (
  this: number,
  _locale?: unknown,
  options?: Intl.NumberFormatOptions,
) {
  return toLocale.call(this, 'en-US', options);
};

const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const unlockId = (name: string) => 'unlock-' + data.entries.find(entry => entry.name === name)!.id;
const COAL = unlockId('Coal Power'),
  PETROLEUM = unlockId('Petroleum Power'),
  NUCLEAR = unlockId('Nuclear Power');
// The owner's ticks: Oil Processing, Plastics and Alternative Fluid Transport (Schematic 5-1, 5-2
// and 5-4), and Coal Power.
const OIL = {
  'unlock-Schematic_5-1_C': true,
  'unlock-Schematic_5-2_C': true,
  'unlock-Schematic_5-4_C': true,
};

const review = (plan: StoredCalculatedPlan, checks: Record<string, boolean>, phase: string) =>
  phaseSteps(plan, { checks }, data, phase).find(step => step.id.endsWith('-power-review'))!;

// A power figure in en-US, MW or GW above 1,000 MW, as the pages write it.
const gw = (mw: number) =>
  mw > 1000
    ? (mw / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' GW'
    : mw.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' MW';

const CHECK =
  ' Before connecting the next factory, check the actual load against what your grid supplies.';
const TARGET =
  ' Full-phase generation shown in the calculator is a future target, not power already unlocked. Tick the relevant HUB/MAM unlocks to update this advice.';

// A partial generator row (generators() in planner/recipes.ts): the step reads only these.
function generator(
  kind: 'coal' | 'Fuel' | 'Turbofuel' | 'Rocket Fuel' | 'uranium',
  machines: number,
  equivalent = machines,
): CalcRow {
  const [id, name, machine, unitMW, inputs] =
    kind === 'coal'
      ? ['power-coal', 'Coal power', 'Coal Generator', 75, { Coal: 15 * equivalent, Water: 45 }]
      : kind === 'uranium'
        ? ['power-uranium', 'Uranium power', 'Nuclear Power Plant', 2500, { 'Uranium Fuel Rod': 1 }]
        : [
            'power-' + kind.toLowerCase().replace(/ /g, '-'),
            kind + ' power',
            'Fuel Generator',
            250,
            { [kind]: 4.5 * equivalent },
          ];
  return {
    id,
    name,
    machine,
    machines,
    equivalent,
    inputs,
    outputs: {},
    generationMW: unitMW * equivalent,
    peakMW: 0,
  } as CalcRow;
}

// A Phase 3 profile with `availableGW` of spare power whose `phase` has the given generator lines
// and power figures in MW (as planner/stage.ts writes them: requiredMW, generationMW and
// availableMW, new generation plus the spare power). The stage is one a release before #1064
// stored, without a grid, so the step reads these figures (powerView in public/power.ts); a
// plan with a grid is tested on real plans below.
function planWith(
  phase: StageKey,
  availableGW: number,
  requiredMW: number,
  rows: CalcRow[],
  settings: Partial<StoredCalculatedPlan['settings']> = {},
): StoredCalculatedPlan {
  const plan: StoredCalculatedPlan = calculate({
    phase: '3',
    availablePowerGW: availableGW,
    ...settings,
  });
  const generationMW = rows.reduce((total, row) => total + row.generationMW, 0);
  const stored: StoredStage = { ...plan.stages[phase] };
  delete stored.grid;
  plan.stages[phase] = {
    ...stored,
    rows,
    requiredMW,
    generationMW,
    availableMW: generationMW + availableGW * 1000,
  };
  return plan;
}

test("the owner's case: spare power, Coal Power ticked, nuclear planned, no coal advice", () => {
  const plan = planWith('4', 44.425, 82550.4, [generator('uranium', 50)], {
    uraniumReactors: 50,
  });
  const step = review(plan, { ...OIL, [COAL]: true }, '4');
  assert.equal(step.id, 'startup-4-power-review', 'the check key is unchanged');
  assert.equal(step.title, 'Power available now');
  assert.equal(
    step.body,
    "You have 44.43 GW of spare power available. This phase needs 38.13 GW more (82.55 GW in all, with the 20% utility allowance): build its nuclear power, 50 × Uranium power (Nuclear Power Plant), which provides 125 GW, 86.87 GW spare because this profile's minimum is 50 uranium reactors. Unlock Nuclear Power first." +
      CHECK,
  );
  assert.doesNotMatch(step.body, /coal/i);
  // Ticking Nuclear Power drops only the unlock sentence.
  assert.ok(!review(plan, { ...OIL, [COAL]: true, [NUCLEAR]: true }, '4').body.includes('Unlock'));
});

test('spare power that covers the phase: nothing needs building', () => {
  const plan = planWith('3', 44.425, 11636.4, []);
  for (const checks of [{}, { [COAL]: true }, { ...OIL, [COAL]: true }])
    assert.equal(
      review(plan, checks, '3').body,
      "You have 44.43 GW of spare power available, which covers this phase's 11.64 GW (with the 20% utility allowance): nothing needs building for power in this phase." +
        CHECK,
    );
});

test('spare power that covers the phase, with the minimum uranium reactor built anyway', () => {
  const plan = planWith('4', 44.425, 30000, [generator('uranium', 1)]);
  assert.equal(
    review(plan, {}, '4').body,
    "You have 44.43 GW of spare power available, which covers this phase's 30 GW (with the 20% utility allowance): nothing needs building for that. The plan still builds its nuclear power, 1 × Uranium power (Nuclear Power Plant), which adds 2.5 GW because this profile's minimum is 1 uranium reactor. Unlock Nuclear Power first." +
      CHECK,
  );
});

test('spare power plus new generation: the lines highest source first, and what is left', () => {
  // Coal and Turbofuel lines listed before the nuclear one; a fractional Turbofuel line, so
  // the spare is not put down to whole machines.
  const rows = [generator('coal', 3), generator('Turbofuel', 4, 3.9), generator('uranium', 2)];
  const plan = planWith('4', 44.425, 50025, rows);
  assert.equal(
    review(plan, { [COAL]: true }, '4').body,
    'You have 44.43 GW of spare power available. This phase needs 5.6 GW more (50.03 GW in all, with the 20% utility allowance): build its nuclear, turbofuel and coal power, 2 × Uranium power (Nuclear Power Plant), 4 × Turbofuel power (Fuel Generator) and 3 × Coal power (Coal Generator), which provides 6.2 GW, 600 MW spare. Unlock Petroleum Power and Nuclear Power first.' +
      CHECK,
  );
});

test('spare power plus new generation that falls short, or none at all', () => {
  const short = planWith('4', 44.425, 50025, [generator('Turbofuel', 10)]);
  assert.equal(
    review(short, { [PETROLEUM]: true }, '4').body,
    'You have 44.43 GW of spare power available. This phase needs 5.6 GW more (50.03 GW in all, with the 20% utility allowance): build its turbofuel power, 10 × Turbofuel power (Fuel Generator), which provides 2.5 GW, 3.1 GW short of the need: see the power headroom on the Resources page.' +
      CHECK,
  );
  const none = planWith('4', 44.425, 50025, []);
  assert.equal(
    review(none, {}, '4').body,
    'You have 44.43 GW of spare power available. This phase needs 5.6 GW more (50.03 GW in all, with the 20% utility allowance), and its plan builds no generators for it: see the power headroom on the Resources page.' +
      CHECK,
  );
});

// A real plan: 50 × the elevator costs at half the power consumption, nuclear set to recycle,
// whole machines. Phase 4 needs more than the spare power; the planner builds whole uranium
// plants for the rest, less than one plant's 2.5 GW over. The figures are the stage's grid
// (#1064), which every page reads: its need counts the miners and extractors too.
test('a calculated plan: "needs X more", the new generation and the spare from whole plants', () => {
  const plan = calculate({
    phase: '3',
    multiplier: 50,
    powerFactor: 0.5,
    availablePowerGW: 44.425,
    nuclear: 'recycle',
    wholeMachines: true,
    recipes: 'all',
  });
  const stage = plan.stages['4'],
    grid = stage.grid!,
    plants = stage.rows!.filter(row => row.generationMW > 0);
  assert.deepEqual(
    plants.map(row => row.id),
    ['power-uranium'],
    'Phase 4 generates with uranium plants only',
  );
  const uranium = plants[0]!;
  assert.equal(grid.generationMW, uranium.machines * 2500, 'whole plants at 2,500 MW each');
  assert.ok(grid.extractionMW > 0, 'the need counts the miners and extractors');
  const requiredMW = grid.needMW,
    spare = grid.availableMW - requiredMW;
  assert.ok(spare > 0 && spare < 2500, 'less than one plant over the need');
  assert.equal(
    review(plan, { ...OIL, [COAL]: true }, '4').body,
    `You have 44.43 GW of spare power available. This phase needs ${gw(requiredMW - 44425)} more (${gw(requiredMW)} in all, with extraction and the 20% utility allowance): build its nuclear power, ${uranium.machines} × Uranium power (Nuclear Power Plant), which provides ${gw(grid.generationMW)}, ${gw(spare)} spare from building whole plants. Unlock Nuclear Power first.` +
      CHECK,
  );
  // Phase 3 runs on the spare power alone.
  assert.match(
    review(plan, { ...OIL, [COAL]: true }, '3').body,
    /^You have 44\.43 GW of spare power available, which covers this phase's [\d.]+ GW \(with extraction and the 20% utility allowance\): nothing needs building for power in this phase\./,
  );
});

// Phase 5 under 'recycle' builds the uranium plants in blocks of the waste chain's period (#370),
// so a block's whole plants can leave more over than one plant would. Phase 4's uranium plant is
// kept (#1064), which the step says after the generator lines.
test('a calculated Phase 5 that recycles: the spare from the waste chain period', () => {
  const plan = calculate({
    phase: '3',
    nuclear: 'recycle',
    wholeMachines: true,
    availablePowerGW: 20,
  });
  const stage = plan.stages['5'],
    grid = stage.grid!;
  assert.equal(stage.nuclearPeriod, 20);
  const nuclear = grid.generators.find(entry => entry.machine === 'Nuclear Power Plant')!;
  assert.equal(nuclear.kept, plan.stages['4'].grid!.generators[0]!.machines);
  const requiredMW = grid.needMW,
    spare = grid.availableMW - requiredMW;
  assert.ok(spare > 2500, 'more than one plant over the need');
  const body = review(plan, {}, '5').body;
  assert.ok(
    body.startsWith(
      `You have 20 GW of spare power available. This phase needs ${gw(requiredMW - 20000)} more (${gw(requiredMW)} in all, with extraction and the 20% utility allowance): build its nuclear `,
    ),
    body,
  );
  assert.ok(
    body.includes(
      `(${nuclear.kept} of these Nuclear Power Plants ${nuclear.kept === 1 ? 'was' : 'were'} built in Phase 4)`,
    ),
    body,
  );
  // The waste chain's period explains the spare; the unlocks the sources need follow it.
  assert.ok(
    body.includes(
      `, which provides ${gw(grid.generationMW)}, ${gw(spare)} spare from building the uranium plants in multiples of 20, so every line of the waste chain runs whole. Unlock `,
    ),
    body,
  );
  assert.ok(body.endsWith(' Nuclear Power first.' + CHECK), body);
});

test('without spare power: a ticked source below the planned one is not advised', () => {
  // The default Phase 3 plan generates with Fuel Generators in Phase 3.
  const plan = planWith('3', 0, 1500, [generator('Fuel', 5)]);
  assert.equal(
    review(plan, { [COAL]: true }, '3').body,
    "Coal Power is marked unlocked, but this phase's plan generates with fuel power: unlock Petroleum Power before building it, and keep your coal generators running until then." +
      TARGET,
  );
  const nuclear = planWith('4', 0, 9000, [generator('uranium', 2), generator('Fuel', 10)]);
  assert.equal(
    review(nuclear, { [COAL]: true, [PETROLEUM]: true }, '4').body,
    "Fuel generators are marked unlocked, but this phase's plan generates with nuclear power: unlock Nuclear Power before building it, and keep your fuel generators running until then." +
      TARGET,
  );
  // Once the planned source is ticked, the advice is the one that source always had.
  assert.equal(
    review(plan, { [COAL]: true, [PETROLEUM]: true }, '3').body,
    'Fuel generators are marked unlocked. Use only the fuel recipes you have researched and connect their byproduct handling.' +
      TARGET,
  );
  assert.equal(
    review(nuclear, { [COAL]: true, [PETROLEUM]: true, [NUCLEAR]: true }, '4').body,
    'Nuclear power is marked unlocked. Commission all waste processing before loading fuel rods.' +
      TARGET,
  );
  // Coal planned and ticked, and nothing ticked: the advice as before.
  const coal = planWith('3', 0, 300, [generator('coal', 4)]);
  assert.equal(
    review(coal, { [COAL]: true }, '3').body,
    'Coal Power is marked unlocked. Build coal extraction, water and generators, then verify sustained output.' +
      TARGET,
  );
  assert.equal(
    review(plan, {}, '3').body,
    'Use HUB/built Biomass Burners with gathered fuel or Biomass. Unlock Obstacle Clearing for Solid Biofuel.' +
      TARGET,
  );
});

// The stored first-release plan (a Phase 3 profile) with its Fuel Generator lines taken out.
const stored: StoredCalculatedPlan = JSON.parse(
  fs.readFileSync(new URL('./fixtures/calculated-plan-2026-09-12.json', import.meta.url), 'utf8'),
);
const withoutFuelPower = (plan: StoredCalculatedPlan): StoredCalculatedPlan => {
  const copy = structuredClone(plan);
  for (const stage of Object.values(copy.stages))
    stage.rows = (stage.rows || []).filter(row => row.machine !== 'Fuel Generator');
  return copy;
};
const PHASES = ['1', '2', '3', '4', '5', 'post'];
const listing = (plan: StoredCalculatedPlan, id: string, checks = {}) =>
  PHASES.filter(phase => phaseSteps(plan, { checks }, data, phase).some(step => step.id === id));

test('Petroleum Power is a step from Phase 3 without Fuel Generator lines, and ticking it counts', () => {
  const petroleum = data.entries.find(entry => entry.name === 'Petroleum Power')!;
  assert.equal(milestonePhase(petroleum, data), 3);
  for (const start of ['1', '2', '3', '4', '5'] as const) {
    const plan = withoutFuelPower({ ...stored, settings: { ...stored.settings, phase: start } });
    assert.ok(
      !Object.values(plan.stages).some(stage =>
        stage.rows?.some(row => row.machine === 'Fuel Generator'),
      ),
    );
    assert.deepEqual(
      listing(plan, PETROLEUM),
      ['3'],
      `a Phase ${start} profile lists it in Phase 3`,
    );
    assert.deepEqual(listing(plan, COAL), ['2'], `and Coal Power in Phase 2`);
    // Ticked, it is listed still (as done) and is a tick the power advice reads.
    assert.deepEqual(listing(plan, PETROLEUM, { [PETROLEUM]: true }), ['3']);
  }
  // A Phase 3 profile without fuel power whose Phase 4 plans nuclear: Coal Power ticked says
  // to unlock the higher sources; Petroleum Power ticked now says fuel generators.
  const plan = withoutFuelPower(stored);
  plan.stages['4'] = { ...plan.stages['4'], rows: [generator('uranium', 2)] };
  assert.match(review(plan, { [COAL]: true }, '4').body, /^Coal Power is marked unlocked, but/);
  assert.match(
    review(plan, { [COAL]: true, [PETROLEUM]: true }, '4').body,
    /^Fuel generators are marked unlocked, but this phase's plan generates with nuclear power/,
  );
});

test('with spare power the biomass start-up and the coal unlock are not advised', () => {
  const spare = structuredClone(stored);
  spare.settings.availablePowerGW = 44.425;
  const ids = (plan: StoredCalculatedPlan, phase: string, checks = {}) =>
    phaseSteps(plan, { checks }, data, phase).map(step => step.id);
  for (const phase of ['3', '4', '5', 'post'])
    assert.ok(
      !ids(spare, phase).some(id =>
        /^startup-(biomass|solid-biofuel|burner-bank|coal-unlock)/.test(id),
      ),
      `Phase ${phase} has none`,
    );
  // A phase that
  // builds coal generators keeps "Unlock Coal Power" with spare power too, and Phase 1 its biomass start.
  const coal = structuredClone(spare);
  coal.stages['3'] = { ...coal.stages['3'], rows: [generator('coal', 4)] };
  assert.ok(ids(coal, '3').includes('startup-coal-unlock'));
  assert.ok(!ids(coal, '3', { [COAL]: true }).includes('startup-coal-unlock'));
  const phaseOne = calculate({ phase: '1', availablePowerGW: 0.5 });
  assert.ok(ids(phaseOne, '1').includes('startup-burner-bank-1'), 'Phase 1 keeps its burner bank');
  // Without spare power, Petroleum Power ticked also drops the coal unlock (biomass went already).
  assert.ok(ids(stored, '3').includes('startup-coal-unlock'));
  assert.ok(!ids(stored, '3', { [PETROLEUM]: true }).includes('startup-coal-unlock'));
});

test('"Power available now" stays the first step of each phase from 2 on, with its key', () => {
  const spare = structuredClone(stored);
  spare.settings.availablePowerGW = 44.425;
  for (const plan of [stored, spare])
    for (const phase of ['3', '4', '5', 'post'])
      assert.equal(
        phaseSteps(plan, { checks: { [COAL]: true } }, data, phase)[0]!.id,
        `startup-${phase === 'post' ? 5 : phase}-power-review`,
      );
});

// Every other step keeps its key and its place (recorded from the release before #1048 on the
// stored first-release plan: as stored, with 44.425 GW of spare power, and without its Fuel
// Generator lines, for several sets of ticks; production rows, whose steps nothing here touches,
// left out). The differences are exactly the new Petroleum Power step and, with spare power or a
// higher unlock ticked, the start-up steps that advised a lower source.
test('the build plan keeps every other step key in its place', () => {
  const recorded: Record<string, Record<string, Record<string, string[]>>> = JSON.parse(
    fs.readFileSync(new URL('./fixtures/power-steps-2026-10-04.json', import.meta.url), 'utf8'),
  );
  const spare = structuredClone(stored);
  spare.settings.availablePowerGW = 44.425;
  const variants: Record<string, StoredCalculatedPlan> = {
    stored,
    spare,
    noFuel: withoutFuelPower(stored),
  };
  const ticks: Record<string, Record<string, boolean>> = {
    none: {},
    coal: { [COAL]: true },
    coalPetroleum: { [COAL]: true, [PETROLEUM]: true },
    petroleum: { [PETROLEUM]: true },
    oil: OIL,
  };
  for (const [variant, plan] of Object.entries(variants))
    for (const [label, checks] of Object.entries(ticks))
      for (const phase of PHASES) {
        const now = phaseSteps(plan, { checks }, data, phase)
          .map(step => step.id)
          .filter(id => !id.startsWith('calc-') || id.endsWith('-storage'));
        const before = recorded[variant]![label]![phase]!;
        const stage = phase === 'post' ? 5 : Number(phase);
        const coalRows = (plan.stages[String(stage) as StageKey]?.rows || []).some(
          row => row.machine === 'Coal Generator',
        );
        const dropped = (id: string) =>
          (stage >= 2 &&
            variant === 'spare' &&
            /^startup-(biomass|solid-biofuel|burner-bank-)/.test(id)) ||
          (id === 'startup-coal-unlock' &&
            !coalRows &&
            (variant === 'spare' || !!checks[PETROLEUM]));
        const where = `${variant}, ${label}, Phase ${phase}`;
        assert.deepEqual(
          now.filter(id => id !== PETROLEUM),
          before.filter(id => id !== PETROLEUM && !dropped(id)),
          where,
        );
        assert.equal(now.includes(PETROLEUM), phase === '3', where);
      }
});

// Phase 5's Alien Power Augmenters add their 500 MW each and a boost on installed and new
// generation. The step splits what the phase has as the stage's grid does (#1064): spare power,
// what the augmenters add, and the whole generators with their boost, so the parts add up to
// what the plan was sized with (#1050 review).
const augmenterFigures = (plan: StoredCalculatedPlan) => {
  const stage = plan.stages['5'],
    grid = stage.grid!;
  return {
    stage,
    grid,
    newMW: grid.generationMW,
    spareMW: grid.spareMW,
    augmenterMW: grid.augmenterMW,
  };
};

test('Phase 5 with augmenters that, with the spare power, cover the phase: nothing to build', () => {
  // The review's case: 20 GW spare of 40 GW installed, 10 augmenters.
  const plan = calculate({
    phase: '3',
    availablePowerGW: 20,
    installedPowerGW: 40,
    augmenters: 10,
  });
  const { stage, grid, newMW, augmenterMW } = augmenterFigures(plan);
  assert.equal(stage.augmenters, 10);
  assert.equal(newMW, 0, 'no generator lines');
  assert.equal(augmenterMW, 50000, '10 × 500 MW plus the boost on the 40 GW installed');
  assert.equal(
    review(plan, {}, '5').body,
    `You have 20 GW of spare power available, and your 10 augmenters add 50 GW, which cover this phase's ${gw(grid.needMW)} (with extraction and the 20% utility allowance): nothing needs building for power in this phase.` +
      CHECK,
  );
});

test('Phase 5 with augmenters and new generation: the parts add up to the plan', () => {
  const plan = calculate({
    phase: '3',
    availablePowerGW: 10,
    installedPowerGW: 10,
    augmenters: 4,
  });
  const { grid, newMW, spareMW, augmenterMW } = augmenterFigures(plan);
  assert.ok(newMW > 0 && augmenterMW > 0);
  assert.ok(Math.abs(spareMW + augmenterMW + newMW - grid.availableMW) < 1e-6);
  const requiredMW = grid.needMW,
    leftMW = grid.availableMW - requiredMW;
  const body = review(plan, {}, '5').body;
  assert.ok(
    body.startsWith(
      `You have 10 GW of spare power available, and your 4 augmenters add ${gw(augmenterMW)}. This phase needs ${gw(requiredMW - spareMW - augmenterMW)} more (${gw(requiredMW)} in all, with extraction and the 20% utility allowance): build its `,
    ),
    body,
  );
  // The new generation with the augmenters' boost, and what that leaves over or short.
  assert.ok(body.includes(`, which provides ${gw(newMW)}`), body);
  assert.ok(
    body.includes(
      leftMW >= 0 ? `, ${gw(leftMW)} spare` : `, ${gw(-leftMW)} short of the need: see the power`,
    ),
    body,
  );
});

test('Phase 5 with augmenters and no spare power: the augmenters are named on their own', () => {
  const plan = calculate({ phase: '3', availablePowerGW: 0, installedPowerGW: 10, augmenters: 4 });
  const { augmenterMW } = augmenterFigures(plan);
  assert.ok(augmenterMW > 0);
  assert.ok(
    review(plan, {}, '5').body.startsWith(`Your Alien Power Augmenters add ${gw(augmenterMW)}`),
  );
});

// #1064: the step says why a phase has power left over and which generators it keeps. In a
// whole-machine plan the fuel lines are set by whole production lines and their byproducts, and
// can make more fuel than the phase needs; a kept building's generators count toward the lines.
test('a whole-machine plan names the generators it keeps and the fuel its lines make over', () => {
  const plan = calculate({
    phase: '3',
    wholeMachines: true,
    availablePowerGW: 2,
    installedPowerGW: 2,
  });
  const grid = plan.stages['5'].grid!;
  const fuel = grid.generators.find(entry => entry.machine === 'Fuel Generator')!;
  assert.ok(fuel.kept > 0 && fuel.machines >= fuel.kept);
  const body = review(plan, { [PETROLEUM]: true }, '5').body;
  assert.ok(body.includes(`(${fuel.kept} of these Fuel Generators were built in Phase 4)`), body);
  assert.ok(
    body.includes(
      `, ${gw(grid.availableMW - grid.needMW)} spare because its lines make more fuel than the phase needs: whole production lines and their byproducts set how much.`,
    ),
    body,
  );
});
