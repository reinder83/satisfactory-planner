// Made on site with amplified twins (#904): an amplified line (`amp:X`) and its unamplified twin
// (`X`) are separate rows everywhere in the interface. Each has its own memberships
// (factoryGroups.assignments by row id), its own card and its own check key; a recalculation
// carries memberships by the exact id (mergeGroups in public/state/carry.ts), and the Logistics
// books place a row by its own memberships alone (rowPlaces). So the planner reads a group's share
// and its fixed-rate part of a row by the row's own id too (shareOf and phaseRate in
// planner/on-site.ts), with no fallback from one twin to the other either way, and a group's line
// is never drawn on for a twin the books do not credit it with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, recipePool, settings } from '../planner.ts';
import { siteCopies, siteRoutes, siteBalance } from '../planner/on-site.ts';
import { amplified } from '../planner/recipes.ts';
import { onSiteSettings } from '../public/app/on-site.ts';
import { itemBooks } from '../public/app/group-links.ts';
import { lineProblems, random, rowsOf } from './helpers/on-site-books.ts';
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
// whole machines or not, the storage rate and the somersloops for production.
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
] as const;
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

// A group's item whose consumers in `stage` include a row the plan being recalculated lacks in
// that phase and that has a fixed-rate membership: onSiteSettings counts only such a row's
// null-rate memberships (no total to measure a fixed rate against), so the group's line is sized
// by an even split the books do not use (#1038, a limit of its own, not a twin's).
function unmeasured(stage: StoredStage, previous: StoredStage | undefined, groups: FactoryGroups) {
  const had = new Set((previous?.rows || []).map(line => line.id));
  return (group: string, item: string) =>
    rowsOf(stage).some(
      line =>
        !line.onSite &&
        line.inputs[item] &&
        !had.has(line.id) &&
        groups.assignments[line.id]?.some(entry => entry.group === group) &&
        groups.assignments[line.id]?.some(entry => entry.rate !== null),
    );
}

// The phases where withinRates keeps the plan made with the frozen shares because the settled
// plan drops the groups' lines, so a group's line is sized by a share the books do not use
// (#1037, on main too). Remove each once that is fixed.
const KNOWN = new Set(['seed 36, phase 2']);

test('right after a recalculation with amplification on, each own line matches the books (#904)', () => {
  const problems: string[] = [];
  let phases = 0,
    lines = 0,
    twins = 0,
    split = 0,
    turned = 0;
  const left = { count: 0 },
    skipped = { count: 0 };
  for (let seed = 1; seed <= 40; seed++) {
    const { before, plan, groups } = configuration(seed);
    for (const [phase, stage] of Object.entries(plan.stages) as [StageKey, StoredStage][]) {
      if (!stage.feasible || stage.onSiteDropped) continue;
      const own = rowsOf(stage).filter(line => line.onSite).length;
      if (!own) continue;
      phases++;
      lines += own;
      const label = `seed ${seed}, phase ${phase}`;
      const skip = unmeasured(stage, before.stages[phase], groups);
      const counted = { count: 0 };
      const found = lineProblems(stage, groups, label, counted, skip);
      if (KNOWN.has(label)) assert.ok(found.length, `${label} is no longer a known exception`);
      else problems.push(...found);
      for (const [item, places] of Object.entries(itemBooks(stage, groups).local))
        for (const group of places.keys()) if (skip(group, item)) skipped.count++;
      left.count += counted.count;
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
  assert.ok(skipped.count * 10 <= lines, `${skipped.count} items with an unmeasured fixed rate`);
  assert.ok(left.count * 5 <= lines, `${left.count} items left out`);
});
