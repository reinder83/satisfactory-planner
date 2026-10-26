// Infeasibility advice that knows the map (#1222, slice 4 of #1078, public/app/draft-advice.ts):
// what runs out against what the map gives at the nodes the plan may tap (mapSupply in
// public/preferences/mining.ts), how much of it is fuel for power, and only the levers that apply
// to the phase and its unlocks. Presentation only: it reads a stored draft and never solves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { draftAdvice, draftNeeds } from '../public/app/draft-advice.ts';
import { mapSupply, resourceDefaults } from '../public/preferences.ts';
import type {
  CalcRow,
  CatalogRecipe,
  CurrentSettings,
  ExtractionRecord,
  StoredStage,
} from '../public/types/index.ts';

// A production line as the planner stores it, at `equivalent` machines at 100%.
function line(
  id: string,
  machine: string,
  power: number,
  equivalent: number,
  inputs: Record<string, number>,
  outputs: Record<string, number>,
): CalcRow {
  const machines = Math.ceil(equivalent - 1e-9);
  return {
    id,
    name: id,
    phase: 1,
    machine,
    power,
    inputs,
    outputs,
    equivalent,
    machines,
    lastClock: (equivalent - machines + 1) * 100,
    peakMW: machines * Math.max(0, power),
    generationMW: power < 0 ? -power * equivalent : 0,
  };
}
// A survey counting Bauxite (5 impure, 6 normal, 6 pure) and leaving `left` pure nodes out.
const survey = (left: number, used = 0): ExtractionRecord => ({
  mark: 3,
  clock: 2.5,
  nodes: { Bauxite: { impure: 5, normal: 6, pure: 6 } },
  wells: {},
  used: used ? { Bauxite: used } : {},
  ...(left ? { excludedNodes: { Bauxite: { impure: 0, normal: 0, pure: left } } } : {}),
});
// A Phase 4 draft short of Bauxite (Alumina Solution) and Coal (Coal power and a Steel line).
const draft = (): StoredStage => ({
  feasible: false,
  reason: 'This phase needs more Coal and Bauxite than the entered budgets provide.',
  shortfalls: [
    { name: 'Coal', needed: 400, budget: 300 },
    { name: 'Bauxite', needed: 6000, budget: 4800 },
  ],
  minHours: 6,
  raw: { Coal: 400, Bauxite: 6000, Water: 900, 'Iron Ore': 100 },
  rows: [
    line(
      'Recipe_AluminaSolution_C',
      'Refinery',
      30,
      50,
      { Bauxite: 6000, Water: 9000 },
      {
        'Alumina Solution': 6000,
        Silica: 2500,
      },
    ),
    line(
      'Recipe_IngotSteel_C',
      'Foundry',
      16,
      2,
      { 'Iron Ore': 100, Coal: 100 },
      {
        'Steel Ingot': 100,
      },
    ),
    line('power-coal', 'Coal Generator', -75, 20, { Coal: 300, Water: 900 }, {}),
  ],
});
const settings = (over: Partial<CurrentSettings> = {}): Partial<CurrentSettings> => ({
  goal: 'timed',
  hours: 2,
  recipes: 'standard',
  sam: 'avoid',
  nuclear: 'none',
  powerFactor: 1,
  limits: { Coal: 300, Bauxite: 4800 },
  extraction: survey(6, 300),
  ...over,
});
// Two catalog alternates: one making Alumina Solution from raw resources with less Bauxite, one
// making Steel Ingot from another part (which says nothing about the ore behind it).
const alternates: CatalogRecipe[] = [
  {
    id: 'Recipe_Alternate_SloppyAlumina_C',
    name: 'Sloppy Alumina',
    phase: 4,
    machine: 'Refinery',
    inputs: { Bauxite: 200, Water: 200 },
    outputs: { 'Alumina Solution': 240 },
  },
  {
    id: 'Recipe_Alternate_IngotSteel_1_C',
    name: 'Solid Steel Ingot',
    phase: 3,
    machine: 'Foundry',
    inputs: { 'Iron Ingot': 40, Coal: 40 },
    outputs: { 'Steel Ingot': 60 },
  },
];
const levers = (stage: StoredStage, over: Partial<CurrentSettings> = {}, phase = 4) =>
  draftAdvice(stage, settings(over), { phase, alternates }).levers;
const ids = (stage: StoredStage, over: Partial<CurrentSettings> = {}, phase = 4) =>
  levers(stage, over, phase).map(lever => lever.id);
// Numbers in the test's locale, whatever its separators.
const n = (digits: string) => digits.split('').join('[.,\\s ]?');

test('the map gives what the nodes the survey keeps give, less what is committed elsewhere', () => {
  // 5 impure (300/min each) and 6 normal (600/min each) at Mk.3 and 250%, less 300 committed.
  assert.equal(mapSupply({ extraction: survey(6, 300) }, 'Bauxite')?.total, 1500 + 3600 - 300);
  assert.equal(mapSupply({ extraction: survey(0) }, 'Bauxite')?.total, 1500 + 3600 + 7200);
  // Without a survey, the world's known counts: the default budget of that world.
  for (const purity of ['vanilla', 'pure', 'mostly-impure'] as const)
    assert.equal(
      mapSupply({ purity, distribution: 'original' }, 'Bauxite')?.total,
      resourceDefaults(purity).limits.Bauxite,
      purity,
    );
  assert.equal(mapSupply({}, 'Crude Oil')?.wells, false, 'the known table has no oil wells');
  // Nothing is estimated: a seed-dependent world, Water and nitrogen off the default map.
  assert.equal(mapSupply({ purity: 'vanilla', distribution: 'basic' }, 'Bauxite'), null);
  assert.equal(mapSupply({ purity: 'random', distribution: 'original' }, 'Bauxite'), null);
  assert.equal(mapSupply({ purity: 'pure', distribution: 'randomized' }, 'Nitrogen Gas'), null);
  assert.equal(mapSupply({}, 'Water'), null);
});

test('a short resource is set against what the map gives at the nodes you allow', () => {
  const [coal, bauxite] = draftNeeds(draft(), settings());
  assert.match(
    bauxite!.text,
    new RegExp(
      `^Bauxite: needs about ${n('6000')}/min; the map gives ${n('4800')}/min at the nodes you allow \\(Miner Mk.3 at 250%\\), so a higher budget alone will not fit it\\.$`,
    ),
  );
  assert.equal(bauxite!.overMap, true);
  assert.equal(bauxite!.power, 0, 'no Bauxite goes to power');
  // Coal is not surveyed: the default map's 62 nodes give far more than 400/min.
  assert.equal(coal!.overMap, false);
  assert.match(coal!.text, new RegExp(`the map gives ${n('42300')}/min at the nodes you allow`));
  // The budget lever leaves out what no budget can give, and keeps the rest.
  const budget = levers(draft()).find(lever => lever.id === 'budget')!;
  assert.match(budget.text, /^Raise the short budget \(Resources\): Coal to about /);
  assert.doesNotMatch(budget.text, /Bauxite/);
  assert.equal(budget.step, 4);
  // A survey that leaves no node out has enough: both budgets can be raised.
  const all = levers(draft(), { extraction: survey(0) }).find(lever => lever.id === 'budget')!;
  assert.match(all.text, /^Raise the short budgets \(Resources\): Coal .*; Bauxite /);
  // A world whose counts are not known says so, and claims nothing.
  const unknown = draftNeeds(draft(), settings({ extraction: null, distribution: 'basic' }));
  assert.match(unknown[1]!.text, /the map total is not known for this world/);
  assert.equal(unknown[1]!.overMap, false);
});

test('a power shortfall names the fuel and offers nuclear power where it applies', () => {
  const [coal] = draftNeeds(draft(), settings());
  assert.equal(coal!.power, 300, 'the Coal Generators burn 300 of the 400 Coal/min');
  assert.match(coal!.text, new RegExp(`About ${n('300')}/min of it is fuel for power\\.$`));
  const nuclear = levers(draft()).find(lever => lever.id === 'nuclear')!;
  assert.match(nuclear.text, new RegExp(`burns about ${n('300')} Coal/min for power`));
  assert.match(nuclear.text, /“Nuclear goal” \(Preferences\)/);
  assert.equal(nuclear.step, 2);
  // Not before Nuclear Power Plants (Phase 4), not when a nuclear goal is already set, and not
  // when the map has no Uranium at the nodes the survey keeps.
  assert.ok(!ids(draft(), {}, 3).includes('nuclear'));
  assert.ok(!ids(draft(), { nuclear: 'sink' }).includes('nuclear'));
  const noUranium = survey(6);
  noUranium.nodes.Uranium = { impure: 3, normal: 2, pure: 0 };
  noUranium.excludedNodes = {
    ...noUranium.excludedNodes,
    Uranium: { impure: 3, normal: 2, pure: 0 },
  };
  assert.ok(!ids(draft(), { extraction: noUranium }).includes('nuclear'));
});

test('only the levers that apply to the phase and its unlocks are offered', () => {
  assert.deepEqual(ids(draft()), ['budget', 'time', 'alternates', 'amplify', 'nuclear']);
  // Alternates: the one that makes Alumina Solution with less Bauxite, never one from parts.
  const alternate = levers(draft()).find(lever => lever.id === 'alternates')!;
  assert.match(alternate.text, /^Alternates that use less: Sloppy Alumina \(up to /);
  assert.match(alternate.text, new RegExp(`up to ${n('1000')} Bauxite/min less`));
  assert.doesNotMatch(alternate.text, /Solid Steel/);
  assert.ok(!ids(draft(), { recipes: 'all' }).includes('alternates'), 'all allowed already');
  assert.ok(
    !ids(draft(), {
      recipes: 'custom',
      alternateRecipes: ['Recipe_Alternate_SloppyAlumina_C'],
    }).includes('alternates'),
    'a custom plan that allows it already',
  );
  // Not before it becomes available: Standard recipes then get the general advice.
  assert.equal(
    levers(draft(), {}, 3).find(lever => lever.id === 'alternates')?.text,
    'Allow alternate recipes (Preferences) to cut raw resource use.',
  );
  assert.ok(!ids(draft(), { recipes: 'custom', alternateRecipes: [] }, 3).includes('alternates'));
  // Production Amplifiers from Phase 3 on, naming the line where one amplified machine saves the
  // largest share of a short resource: half the Steel line's Coal, against a fiftieth of the
  // Alumina line's Bauxite.
  const amplify = levers(draft()).find(lever => lever.id === 'amplify')!;
  assert.match(
    amplify.text,
    new RegExp(
      `an amplified Recipe_IngotSteel_C machine \\(2 somersloops\\) needs about 50 Coal/min less`,
    ),
  );
  assert.ok(!ids(draft(), {}, 2).includes('amplify'), 'no amplifiers before Phase 3');
  assert.match(
    levers(draft(), { amplifySloops: 10 }).find(lever => lever.id === 'amplify')!.text,
    /before amplification/,
  );
  // SAM conversion only in Phase 5, and not when SAM itself is what runs out.
  assert.ok(!ids(draft()).includes('sam'), 'the Converter is not planned before Phase 5');
  assert.ok(ids(draft(), {}, 5).includes('sam'));
  assert.ok(!ids(draft(), { sam: 'needed' }, 5).includes('sam'));
  const sam = { ...draft(), shortfalls: [{ name: 'SAM', needed: 10, budget: 5 }] };
  assert.ok(!ids(sam, {}, 5).includes('sam'));
});

test('more time names the least hours that fit, with a recalculation only where hours apply', () => {
  const time = (over: Partial<CurrentSettings>) =>
    levers(draft(), over).find(lever => lever.id === 'time')!;
  assert.match(time({}).text, /^More time: raise “Hours per phase” \(Goals\) to at least 6 h/);
  assert.equal(time({}).hours, 6, 'a target time per phase can be recalculated at 6 h');
  assert.equal(time({ phaseTime: 'final' }).hours, undefined, 'the final phase’s target is not');
  assert.match(time({ goal: 'minimal' }).text, /switch the goal \(Goals\) to “Target completion/);
  assert.equal(time({ goal: 'minimal' }).hours, undefined);
  assert.equal(time({}).step, 3);
});

test('a draft that measured nothing gets no advice, whatever its reason says', () => {
  // A stopped search, recipes that cannot make the goal, an older snapshot or a reason of a kind
  // added later (a cap on buildings, #1221): only the measured fields call for levers.
  for (const reason of ['The whole-machine search stopped.', 'A cap of 200 buildings is reached.'])
    assert.deepEqual(
      draftAdvice({ feasible: false, reason }, settings(), { phase: 4, alternates }),
      {
        needs: [],
        levers: [],
      },
    );
  // Without its phase, the advice keeps what it always said.
  assert.deepEqual(
    draftAdvice(draft(), settings()).levers.map(lever => lever.id),
    ['budget', 'time', 'alternates', 'sam'],
  );
});

test('a cap draft offers to raise the cap and words its other options by the cap (#1221, #1020)', () => {
  const capped: StoredStage = {
    feasible: false,
    reason: "Without the cap, this phase's plan needs 920.5 MW; the cap is 700 MW.",
    capShortfalls: [{ name: 'mw', needed: 920.5, cap: 700 }],
    minHours: 10.5,
  };
  const options = levers(capped);
  assert.deepEqual(
    options.map(lever => lever.id),
    ['phaseCap', 'time'],
  );
  assert.deepEqual(options[0], {
    id: 'phaseCap',
    text: "Raise the cap per phase (Goals): without it, this phase's plan needs 920.5 MW (the cap is 700 MW).",
    step: 3,
    label: 'Change the caps in Edit settings →',
  });
  assert.match(
    options[1]!.text,
    /^More time: raise “Hours per phase” \(Goals\) to at least 10[.,]5 h; this phase may fit within the cap from there\.$/,
  );
  assert.doesNotMatch(options.map(lever => lever.text).join(' '), /budget/);
  // Without minHours (more time does not help) the cap is the only option.
  const { minHours: _hours, ...stuck } = capped;
  assert.deepEqual(
    levers(stuck).map(lever => lever.id),
    ['phaseCap'],
  );
  // Two caps, one only whole machines break.
  const whole = levers({
    feasible: false,
    reason: 'Whole machines break the caps.',
    wholeMachinesOnly: true,
    capShortfalls: [
      { name: 'buildings', needed: 104, cap: 100 },
      { name: 'mw', needed: 950, cap: 900 },
    ],
  });
  assert.equal(
    whole[0]!.text,
    "Raise the caps per phase (Goals): without them, this phase's plan needs 104 buildings (the cap is 100 buildings) and 950 MW (the cap is 900 MW).",
  );
  assert.equal(
    whole.find(lever => lever.id === 'whole')!.text,
    'Keep the caps instead: untick “Whole machines” (Goals). Exact clocks keep within them, with one adjustable machine per production line.',
  );
  // A build-cost draft over a cap as well (#1229): the budgets' wording stays, with the cap's lever.
  const both = levers({ ...draft(), capShortfalls: [{ name: 'mw', needed: 48387.9, cap: 1000 }] });
  assert.ok(both.some(lever => lever.id === 'phaseCap'));
  assert.match(
    both.find(lever => lever.id === 'time')!.text,
    /this phase fits the current budgets from there\.$/,
  );
});
