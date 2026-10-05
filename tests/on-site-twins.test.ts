// Made on site with amplified twins (#904): an amplified line (`amp:X`) and its unamplified twin
// (`X`) are separate rows everywhere in the interface. Each has its own memberships
// (factoryGroups.assignments by row id), its own card and its own check key; a recalculation
// carries memberships by the exact id (mergeGroups in public/state/carry.ts), and the Logistics
// books place a row by its own memberships alone (rowPlaces). So the planner reads a group's share
// and its fixed-rate part of a row by the row's own id too (shareOf and phaseRate in
// planner/on-site.ts), with no fallback from one twin to the other either way, and a group's line
// is never drawn on for a twin the books do not credit it with.
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, recipePool, settings } from '../planner.ts';
import { siteCopies, siteRoutes, siteBalance } from '../planner/on-site.ts';
import { amplified } from '../planner/recipes.ts';
import { onSiteSettings } from '../public/app/on-site.ts';
import { itemBooks } from '../public/app/group-links.ts';
import { lineProblems, random, rowsOf } from './helpers/on-site-books.ts';
import { STANDARD_BEFORE_1040 } from './helpers/standard-before-1040.ts';
import type {
  CurrentCalculatedPlan,
  FactoryGroups,
  OnSiteSettings,
  StageKey,
  StoredStage,
} from '../public/types/index.ts';

const ALPHA = 'fg-alpha',
  BETA = 'fg-beta';
const PLATE = 'Recipe_IronPlateReinforced_C',
  ROTOR = 'Recipe_Rotor_C',
  STATOR = 'Recipe_Stator_C',
  CABLE = 'Recipe_Cable_C',
  FRAME = 'Recipe_ModularFrameHeavy_C';
const amp = (id: string) => 'amp:' + id;
const row = (stage: StoredStage, id: string) => rowsOf(stage).find(entry => entry.id === id);

// The issue's plan: amplification on, the rows' totals fractional.
const ISSUE = {
  phase: '1',
  wholeMachines: false,
  recipes: 'standard',
  somersloops: 106,
  amplifySloops: 106,
} as const;
let issuePlan: CurrentCalculatedPlan | undefined;
const planBefore = () => (issuePlan ??= calculate(ISSUE));

// The issue's groups: Alpha and Beta both make Wire and Screws on site, and the plan's consumers
// of them are assigned in rotation, each twin on its own: Alpha holds the unamplified Reinforced
// Iron Plate line and the amplified Rotor line, Beta the other way round.
const rotation = (): FactoryGroups => ({
  groups: [
    { id: ALPHA, name: 'Alpha' },
    { id: BETA, name: 'Beta' },
  ],
  assignments: {
    [PLATE]: [{ group: ALPHA, rate: null }],
    [ROTOR]: [{ group: BETA, rate: null }],
    [CABLE]: [{ group: ALPHA, rate: null }],
    [STATOR]: [{ group: BETA, rate: null }],
    [amp(ROTOR)]: [{ group: ALPHA, rate: null }],
    [amp(STATOR)]: [{ group: BETA, rate: null }],
    [amp(CABLE)]: [{ group: ALPHA, rate: null }],
    [amp(PLATE)]: [{ group: BETA, rate: null }],
    [FRAME]: [{ group: ALPHA, rate: null }],
  },
  local: { [ALPHA]: ['Screws', 'Wire'], [BETA]: ['Screws', 'Wire'] },
});

// The issue's plan recalculated with `groups`' marks, the groups unchanged.
function recalculated(groups: FactoryGroups) {
  const plan = calculate({ ...ISSUE, onSite: onSiteSettings(planBefore(), groups) });
  return { plan, phases: Object.entries(plan.stages) as [StageKey, StoredStage][] };
}

// Where a consumer row of `recipe` (its amplified twin when `twin`) takes `item` from in `phase`
// of a plan with `onSite`: [balance, fraction] pairs, as siteRoutes gives the model.
function routesOf(
  onSite: OnSiteSettings,
  phase: number,
  recipe: string,
  item: string,
  twin = true,
) {
  const config = settings({ ...ISSUE, onSite });
  const pool = recipePool(config, phase, false);
  const base = pool.find(entry => entry.id === recipe)!;
  const consumer = twin ? amplified(base) : base;
  const whole = [...pool, ...siteCopies(config, phase, pool), ...(twin ? [consumer] : [])];
  return siteRoutes(config, phase, whole).routes(consumer, item, 'in');
}

test("the issue's example: each group's own lines make exactly what the books give it (#904)", () => {
  const { plan, phases } = recalculated(rotation());
  // Phase 2 of the recalculated plan has only the amplified Reinforced Iron Plate line, which
  // only Beta holds; Alpha holds the unamplified one.
  const phase2 = plan.stages['2'];
  assert.ok(row(phase2, amp(PLATE)), 'amplified line');
  assert.equal(row(phase2, PLATE), undefined, 'no unamplified line');
  // Beta's Screws line used to make 132.5 of the 162.5 its rows use, and Alpha's 30 that none of
  // its rows use: Alpha's frozen share of the unamplified line was borrowed by the amplified one.
  const books = itemBooks(phase2, rotation());
  assert.deepEqual(books.local['Screws']?.get(BETA), { made: 162.5, asked: 162.5 });
  assert.equal(books.local['Screws']?.get(ALPHA), undefined, 'Alpha has no Screws line');
  const problems: string[] = [];
  const left = { count: 0 };
  for (const [phase, stage] of phases)
    problems.push(...lineProblems(stage, rotation(), `phase ${phase}`, left));
  assert.deepEqual(problems, []);
  assert.equal(left.count, 0);
});

test('an amplified twin takes no share of a group that holds only its unamplified line (#904)', () => {
  // Alpha holds the unamplified line, Beta the amplified one: the amplified line takes all its
  // Screws from Beta's balance, none from Alpha's (it used to take half from each).
  const onSite: OnSiteSettings = {
    [ALPHA]: { name: 'Alpha', items: ['Screws'], shares: { 2: { [PLATE]: 1 } } },
    [BETA]: { name: 'Beta', items: ['Screws'], shares: { 2: { [amp(PLATE)]: 1 } } },
  };
  assert.deepEqual(routesOf(onSite, 2, PLATE, 'Screws'), [[siteBalance('Screws', BETA), 1]]);
  // Without Beta, the amplified line takes its Screws centrally, though Alpha holds its twin.
  const { [BETA]: _beta, ...alone } = onSite;
  assert.deepEqual(routesOf(alone, 2, PLATE, 'Screws'), [['item:Screws', 1]]);
});

test('an unamplified line takes no share of a group that holds only its amplified twin (#904)', () => {
  // The other half of the rule, which the planner already followed: a group holding only the
  // amplified Rotor line gets no share of the unamplified one, as the books give it none.
  const onSite: OnSiteSettings = {
    [ALPHA]: { name: 'Alpha', items: ['Screws'], shares: { 3: { [amp(ROTOR)]: 1 } } },
  };
  assert.deepEqual(routesOf(onSite, 3, ROTOR, 'Screws', false), [['item:Screws', 1]]);
  assert.deepEqual(routesOf(onSite, 3, ROTOR, 'Screws'), [[siteBalance('Screws', ALPHA), 1]]);
});

test("a fixed rate carries to its own row only, not to the row's amplified twin (#904)", () => {
  // Alpha holds the unamplified Reinforced Iron Plate line at a fixed 3/min, which the planner
  // gets as a part of that row (#984). Its amplified twin, held only by Beta, takes none of it:
  // it used to take Alpha's frozen share of the unamplified line through the fallback.
  const onSite: OnSiteSettings = {
    [ALPHA]: {
      name: 'Alpha',
      items: ['Screws'],
      shares: { 2: { [PLATE]: 0.5 } },
      rates: { 2: { [PLATE]: { rate: 3, open: 0, after: 0 } } },
    },
  };
  assert.deepEqual(routesOf(onSite, 2, PLATE, 'Screws'), [['item:Screws', 1]]);
});

test('right after a recalculation, a fixed rate on one twin offers nothing (#904)', () => {
  // The comment's case in the issue's plan: Alpha holds the unamplified Reinforced Iron Plate
  // line at a fixed 1/min, the rest of it is Beta's, and Beta alone holds the amplified line.
  // Phases 3 and 4 have both lines. The amplified one used to draw Alpha's frozen share of the
  // unamplified one from Alpha's Screws line, which the books give Alpha none of: 20 Screws/min
  // offered in Phase 3 right after the recalculation.
  const groups: FactoryGroups = {
    groups: rotation().groups,
    assignments: {
      [PLATE]: [
        { group: ALPHA, rate: 1 },
        { group: BETA, rate: null },
      ],
      [amp(PLATE)]: [{ group: BETA, rate: null }],
    },
    local: { [ALPHA]: ['Screws'], [BETA]: ['Screws'] },
  };
  const { plan, phases } = recalculated(groups);
  for (const phase of ['3', '4'] as const)
    assert.ok(row(plan.stages[phase], PLATE) && row(plan.stages[phase], amp(PLATE)), phase);
  // Alpha's line makes the 12 Screws/min its 1 Reinforced Iron Plate/min uses.
  const books = itemBooks(plan.stages['3'], groups);
  assert.deepEqual(books.local['Screws']?.get(ALPHA), { made: 12, asked: 12 });
  const problems: string[] = [];
  for (const [phase, stage] of phases)
    problems.push(...lineProblems(stage, groups, `phase ${phase}`, { count: 0 }));
  assert.deepEqual(problems, []);
});

// The profiles the random configurations start from, all with amplification on: the start phase,
// whole machines or not, the storage rate and the somersloops for production. All on the standard
// recipes as they were before #1040 (with Pure Aluminum Ingot), so the seeds draw the plans they
// always drew, seed 36 and the settle loop's cases among them (SETTLE_SEEDS below).
const STARTS = [
  { ...ISSUE },
  { phase: '2', wholeMachines: true, limitsConfirmed: true, somersloops: 106, amplifySloops: 40 },
  { phase: '3', wholeMachines: false, limitsConfirmed: true, somersloops: 106, amplifySloops: 40 },
  {
    phase: '3',
    wholeMachines: true,
    limitsConfirmed: true,
    somersloops: 106,
    amplifySloops: 80,
    storageRate: 2,
  },
  { phase: '4', wholeMachines: true, limitsConfirmed: true, somersloops: 106, amplifySloops: 80 },
].map(start => ({ ...start, ...STANDARD_BEFORE_1040 }));
const starts = new Map<number, CurrentCalculatedPlan>();
const startPlan = (index: number) => {
  if (!starts.has(index)) starts.set(index, calculate(STARTS[index]!));
  return starts.get(index)!;
};

// A random configuration: two or three groups holding random rows of the plan, wholly or split
// with another group, each membership with a fixed rate (a part of the row's total in one of its
// phases, sometimes all of it) or none. Both lines of each pair of twins the plan has are held,
// each on its own, so the twins are often in different groups or held at different rates. Each
// group marks one or two items its rows use and the plan makes. Then the plan recalculated with
// those marks, the groups unchanged, half the time also with another storage rate or another
// number of somersloops for production, so lines change their totals and turn amplified or back.
function configuration(seed: number) {
  const { next, pick } = random(seed);
  const start = Math.floor(next() * STARTS.length);
  const before = startPlan(start);
  const totals = new Map<string, number[]>();
  for (const stage of Object.values(before.stages))
    for (const line of rowsOf(stage))
      if (!line.id.startsWith('power-'))
        totals.set(line.id, [...(totals.get(line.id) || []), Object.values(line.outputs)[0] || 0]);
  const twinned = (id: string) =>
    totals.has(id.startsWith('amp:') ? id.slice(4) : amp(id)) && totals.has(id);
  const groups: FactoryGroups['groups'] = Array.from(
    { length: 2 + Math.floor(next() * 2) },
    (_, i) => ({ id: `fg-twin${i}`, name: `Group ${i}` }),
  );
  const membership = (group: string, id: string) => {
    if (next() < 0.45) return { group, rate: null };
    const total = pick(totals.get(id)!);
    const part = next() < 0.1 ? 1 : 0.1 + next() * 0.6;
    return { group, rate: Math.max(1, Math.round(total * part * 10) / 10) };
  };
  const assignments: FactoryGroups['assignments'] = {};
  for (const id of totals.keys()) {
    const roll = next();
    if (roll < 0.3 && !twinned(id)) continue;
    const first = pick(groups).id;
    const second = pick(groups.filter(group => group.id !== first)).id;
    assignments[id] =
      roll < 0.65 ? [membership(first, id)] : [membership(first, id), membership(second, id)];
  }
  const rows = Object.values(before.stages).flatMap(rowsOf);
  const made = new Set(rows.flatMap(line => Object.keys(line.outputs || {})));
  const local: FactoryGroups['local'] = {};
  for (const group of groups) {
    const used = [
      ...new Set(
        rows
          .filter(line => assignments[line.id]?.some(entry => entry.group === group.id))
          .flatMap(line => Object.keys(line.inputs || {}))
          .filter(item => made.has(item)),
      ),
    ].sort();
    if (!used.length) continue;
    const items = new Set([pick(used)]);
    if (next() < 0.4) items.add(pick(used));
    local[group.id] = [...items].sort();
  }
  const marking: FactoryGroups = { groups, assignments, local };
  const onSite = onSiteSettings(before, marking);
  const roll = next();
  const change =
    roll < 0.25
      ? { storageRate: pick([0.5, 1, 2, 3]) }
      : roll < 0.5
        ? { amplifySloops: pick([20, 40, 80, 106]) }
        : {};
  const plan = calculate({ ...STARTS[start]!, ...change, onSite });
  return { before, plan, groups: marking };
}

// The parts of rows with a fixed-rate membership that the plan being recalculated lacks in
// `phase` (settings.onSite[group].ifBuilt, #1038) and that `stage` builds: the planner counts
// them only there, so the group's line follows the books there too.
const builtParts = (plan: CurrentCalculatedPlan, phase: StageKey, stage: StoredStage) =>
  Object.values(plan.settings.onSite || {}).flatMap(entry =>
    Object.keys(entry.ifBuilt?.[phase] || {}).filter(id => row(stage, id)),
  ).length;

// The seeds checked: 1 to 40, and the settle loop's cases among seeds 41 to 600 (#1037, #1042),
// where the first plan makes a row less than its fixed rates and withinRates used to keep a plan
// whose parts were not measured at its own totals. In seeds 223 and 571 (Phase 3), as in seed 36
// (Phase 2, 180 Copper Ingot/min for the 101.8 the books gave fg-twin1, 53.2 of it offered), the
// plan settled at the totals of the plan with the shares made the items centrally, because the
// exact LP still sized the group's line by the share it was calculated with and left the network
// no central line for the rest; in seeds 118, 135, 311, 345, 397, 455, 476, 531 and 590 (Phase 5)
// it did not fit at all. Either way the plan with the shares stood. In seeds 420 (Phase 4) and
// 489 (Phase 3) the rounds ran out on a plan settled at another plan's totals. Seeds 326, 358,
// 429 and 595 still end on a plan whose parts were not measured at its own totals (listed on
// #1038). And cases of #1038 among seeds 41 to 600, where the recalculation builds a row the plan
// being recalculated lacks in a phase and holds at a fixed rate: the group's line was sized by
// the row's share alone, an even split of its null-rate memberships, so it made more than the
// books give (seeds 44, 115, 152 and 530, Phase 2 to 5), offered the rest (seeds 346, 421, 504 and
// 596, Phase 1 to 4) or made less (seed 247, Phase 1), as seed 16 offered 10.5 Steel Ingot/min in
// Phase 5 and seed 10's lines made 7.8 of the 19.65 Steel Beam/min the books gave fg-twin2 there.
// #1064's power model changed the plans these seeds draw: seeds 65, 84, 199 and 316 are added for
// the most #1038 cases among seeds 41 to 600 on its plans (4, 3, 4 and 4 such parts built).
// #1086's fuel lines changed them again: seeds 325, 513 and 553 are added (4, 4 and 3 such parts
// built), among the most on its plans. (Seed 171, with 4, ends Phase 3 on a plan whose fixed-rate
// part was not measured at its own totals, the case listed on #1038.)
const SETTLE_SEEDS = [118, 135, 223, 311, 345, 397, 420, 455, 476, 489, 531, 571, 590];
const IF_BUILT_SEEDS = [
  44, 115, 152, 247, 346, 421, 504, 530, 596, 65, 84, 199, 316, 325, 513, 553,
];
const SEEDS = [...Array.from({ length: 40 }, (_, i) => i + 1), ...SETTLE_SEEDS, ...IF_BUILT_SEEDS];

test('right after a recalculation with amplification on, each own line matches the books (#904)', () => {
  const problems: string[] = [];
  let phases = 0,
    lines = 0,
    twins = 0,
    split = 0,
    turned = 0,
    built = 0;
  const left = { count: 0 },
    routed = { count: 0 };
  for (const seed of SEEDS) {
    const { before, plan, groups } = configuration(seed);
    for (const [phase, stage] of Object.entries(plan.stages) as [StageKey, StoredStage][]) {
      if (!stage.feasible || stage.onSiteDropped) continue;
      const own = rowsOf(stage).filter(line => line.onSite).length;
      if (!own) continue;
      phases++;
      lines += own;
      const label = `seed ${seed}, phase ${phase}`;
      problems.push(...lineProblems(stage, groups, label, left, undefined, routed));
      built += builtParts(plan, phase, stage);
      // The pairs of twins in the phase, those whose lines are held by different groups or at
      // different rates, and the lines the recalculation turned amplified or back.
      const ids = new Set(rowsOf(stage).map(line => line.id));
      const had = new Set(rowsOf(before.stages[phase]).map(line => line.id));
      for (const id of ids) {
        if (!id.startsWith('amp:')) continue;
        const base = id.slice(4);
        if (ids.has(base)) twins++;
        if (JSON.stringify(groups.assignments[id]) !== JSON.stringify(groups.assignments[base]))
          split++;
        if (had.has(base) !== ids.has(base) || had.has(id) !== ids.has(id)) turned++;
      }
    }
  }
  assert.deepEqual(problems.slice(0, 20), [], `${problems.length} problems`);
  assert.ok(phases >= 120, `${phases} phases with own lines checked`);
  assert.ok(lines >= 250, `${lines} own lines checked`);
  assert.ok(twins >= 600, `${twins} pairs of twins in a phase`);
  assert.ok(split >= 800, `${split} amplified lines held apart from their twin`);
  assert.ok(turned >= 150, `${turned} lines turned amplified or back`);
  assert.ok(built >= 30, `${built} parts of rows the plan being recalculated lacked, built`);
  assert.ok(left.count * 5 <= lines, `${left.count} items left out`);
  // Lines whose excess feeds the central demand (#1063) stay few, so the check above still
  // covers almost every line.
  assert.ok(routed.count * 10 <= lines, `${routed.count} lines routed to the central demand`);
});

// #1042's groups (tests/fixtures/on-site-settle-groups-2026-10-04.json): three groups holding rows
// of a Phase 4 profile with amplification on, many at fixed rates and many twins apart. R1 marks
// Copper Sheet and holds the Circuit Board line at a fixed 38.1/min, after R0's 6.8. On the
// standard recipes as they were before #1040, which the issue's plans were made with.
const SETTLE_START = {
  phase: '4',
  wholeMachines: true,
  limitsConfirmed: true,
  somersloops: 106,
  amplifySloops: 80,
  ...STANDARD_BEFORE_1040,
} as const;

test("#1042's example: the plan kept was settled at its own totals, so R1's line makes its part", () => {
  const groups: FactoryGroups = JSON.parse(
    fs.readFileSync('tests/fixtures/on-site-settle-groups-2026-10-04.json', 'utf8'),
  );
  const before = calculate(SETTLE_START);
  const plan = calculate({
    ...SETTLE_START,
    storageRate: 3,
    onSite: onSiteSettings(before, groups),
  });
  // In Phase 3 the Circuit Board line is dropped by one settled plan (the amplified twin, which R1
  // does not hold, makes the Circuit Boards) and built again by the next with no share for R1. The
  // rounds used to end there: R1's Copper Sheet line made 20/min of the 46.4 the books give R1.
  const stage = plan.stages['3'];
  const own = itemBooks(stage, groups).local['Copper Sheet']?.get('fg-rev1');
  assert.ok(own && Math.abs(own.asked - 46.4) < 1e-6, `R1 asks ${own?.asked}`);
  assert.equal(own.made, 50);
  assert.ok(row(stage, 'Recipe_CircuitBoard_C'), 'the Circuit Board line');
  // Phase 4 builds the Circuit Board line, and R1's fixed rate counts there too: every own line
  // matches the books. (Until #1064 the plan being recalculated lacked the line in Phase 4, a case
  // of #1038; its power model changed that plan, and tests/on-site-fixed-rates.test.ts and the
  // property check above keep the case.)
  assert.ok(row(plan.stages['4'], 'Recipe_CircuitBoard_C'), 'the Circuit Board line in Phase 4');
  const problems: string[] = [];
  for (const [phase, stage] of Object.entries(plan.stages) as [StageKey, StoredStage][])
    problems.push(...lineProblems(stage, groups, `phase ${phase}`, { count: 0 }));
  assert.deepEqual(problems, []);
});
