// Made on site with a fixed-rate membership (#984): a recalculation sizes a group's own line to
// the group's part of each consumer in the plan the recalculation produces, as the Logistics
// books (itemBooks, rowPlaces) count it there. A fixed rate is passed to the planner as a rate
// (settings.onSite[group].rates), not as a share of the row's total in the plan being
// recalculated, so the line and the books agree right after the recalculation even when that
// row's total changes: nothing is offered and the sink takes no more than the plan's surplus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../planner.ts';
import { onSiteSettings } from '../public/app/on-site.ts';
import { itemBooks } from '../public/app/group-links.ts';
import { lineProblems, random, rowsOf } from './helpers/on-site-books.ts';
import { STANDARD_BEFORE_1040 } from './helpers/standard-before-1040.ts';
import type {
  CurrentCalculatedPlan,
  FactoryGroups,
  StageKey,
  StoredStage,
} from '../public/types/index.ts';

const PLC3 = 'fg-plc3',
  OTHER = 'fg-oth1';
const PLATE = 'Recipe_IronPlate_C',
  INGOT = 'Recipe_IngotIron_C';
const OWN_INGOT = `${INGOT}:${PLC3}`;
// A Smelter makes 30 Iron Ingot/min; an Iron Plate line uses 3 Iron Ingot for 2 Iron Plate.
const SMELTER = 30;
const row = (stage: StoredStage, id: string) => rowsOf(stage).find(entry => entry.id === id);
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

// The issue's groups: PLC3 marks Iron Ingot and holds the Iron Plate line at a fixed 47 Iron
// Plate/min; the rest of the line is in another group.
const plc3: FactoryGroups = {
  groups: [
    { id: PLC3, name: 'PLC3' },
    { id: OTHER, name: 'Other' },
  ],
  assignments: {
    [PLATE]: [
      { group: PLC3, rate: 47 },
      { group: OTHER, rate: null },
    ],
  },
  local: { [PLC3]: ['Iron Ingot'] },
};

// Phase 4 plans whose Iron Plate line makes 440, 520, 560 and 640 Iron Plate/min.
const PLANS = {
  440: { phase: '4', wholeMachines: true, limitsConfirmed: true, goal: 'timed', hours: 12 },
  520: { phase: '4', wholeMachines: true, limitsConfirmed: true },
  560: { phase: '4', wholeMachines: true, limitsConfirmed: true, storageRate: 2 },
  640: { phase: '4', wholeMachines: true, limitsConfirmed: true, storageRate: 3 },
} as const;
type PlateTotal = keyof typeof PLANS;
const plans = new Map<PlateTotal, CurrentCalculatedPlan>();
const planOf = (total: PlateTotal) => {
  if (!plans.has(total)) plans.set(total, calculate(PLANS[total]));
  return plans.get(total)!;
};

// The plan for `to` recalculated with PLC3's marks worked out from the plan for `from`, and
// PLC3's Iron Ingot in the books of its Phase 4.
function recalculated(from: PlateTotal, to: PlateTotal) {
  const before = planOf(from);
  assert.equal(row(before.stages['4'], PLATE)!.outputs['Iron Plate'], from);
  const plan = calculate({ ...PLANS[to], onSite: onSiteSettings(before, plc3) });
  const stage = plan.stages['4'];
  assert.equal(row(stage, PLATE)!.outputs['Iron Plate'], to);
  const books = itemBooks(stage, plc3);
  return { plan, stage, books, own: books.local['Iron Ingot']!.get(PLC3)! };
}

test("the issue's example: the Iron Plate line grows from 520 to 560 and PLC3's line follows its 47 (#984)", () => {
  const { stage, books, own } = recalculated(520, 560);
  // 47/560 of the 840 Iron Ingot the line uses, which is 47 × 1.5: 70.5, in 3 Smelters.
  assert.equal(row(stage, PLATE)!.inputs['Iron Ingot'], 840);
  assert.ok(near(own.asked, 70.5), `PLC3 asks ${own.asked}`);
  assert.equal(row(stage, OWN_INGOT)!.machines, 3);
  assert.equal(own.made, 3 * SMELTER);
  // Its excess of 19.5 is part of the plan's surplus: the sink takes all of it, nothing is
  // offered. (Before #984 the line was sized to 0.0904 × 840 = 75.9 and the plan sank only 15.)
  assert.equal(books.offered['Iron Ingot'], undefined, 'nothing offered');
  assert.ok(near(books.sunk['Iron Ingot']!.get(PLC3)!, 19.5));
  assert.ok(stage.surplus!['Iron Ingot']! >= 19.5 - 1e-6, `${stage.surplus!['Iron Ingot']} sunk`);
});

test('a growing Iron Plate line no longer gives PLC3 a Smelter more than its 47 needs (#984)', () => {
  // 47/440 of 960 would be 102.5 Iron Ingot, 4 Smelters; the books give PLC3 70.5.
  const { stage, books, own } = recalculated(440, 640);
  assert.ok(near(own.asked, 70.5), `PLC3 asks ${own.asked}`);
  assert.equal(row(stage, OWN_INGOT)!.machines, 3);
  assert.equal(books.offered['Iron Ingot'], undefined, 'nothing offered');
});

test('a shrinking Iron Plate line no longer leaves PLC3 a Smelter short (#984)', () => {
  // 47/560 of 660 would be 55.4 Iron Ingot, 2 Smelters making 60; the books give PLC3 70.5, so
  // the central line used to cover the other 10.5.
  const { stage, books, own } = recalculated(560, 440);
  assert.ok(near(own.asked, 70.5), `PLC3 asks ${own.asked}`);
  assert.equal(row(stage, OWN_INGOT)!.machines, 3);
  assert.ok(own.made >= own.asked, `PLC3's line makes ${own.made} of ${own.asked}`);
  assert.equal(books.offered['Iron Ingot'], undefined, 'nothing offered');
  // From 560 to 520 the 3 Smelters stay, and the books agree too.
  const fall = recalculated(560, 520);
  assert.ok(near(fall.own.asked, 70.5));
  assert.equal(row(fall.stage, OWN_INGOT)!.machines, 3);
  assert.equal(fall.books.offered['Iron Ingot'], undefined);
});

// The profiles the random configurations start from: the start phase, whole machines or not,
// and the storage rate, so the rows' totals differ from configuration to configuration. All on
// the standard recipes as they were before #1040 (with Pure Aluminum Ingot), so the seeds draw
// the configurations they always drew: the standard recipes since #1040 draw others, and seed 34
// then hits #1043 (a group's own line offering its rounding excess), which main has too.
const STARTS = [
  { phase: '2', wholeMachines: true, limitsConfirmed: true },
  { phase: '3', wholeMachines: true, limitsConfirmed: true },
  { phase: '3', wholeMachines: true, limitsConfirmed: true, storageRate: 2 },
  { phase: '4', wholeMachines: true, limitsConfirmed: true },
  { phase: '3', wholeMachines: false, limitsConfirmed: true },
].map(start => ({ ...start, ...STANDARD_BEFORE_1040 }));
const starts = new Map<number, CurrentCalculatedPlan>();
const startPlan = (index: number) => {
  if (!starts.has(index)) starts.set(index, calculate(STARTS[index]!));
  return starts.get(index)!;
};

// A random configuration: two or three groups holding random rows of the plan, wholly or split
// with another group, each membership with a fixed rate (a part of the row's total in one of
// its phases, sometimes all of it) or none; each group marks one or two items its rows use and
// the plan makes. Then the plan recalculated with those marks, the groups unchanged.
function configuration(seed: number) {
  const { next, pick } = random(seed);
  const start = Math.floor(next() * STARTS.length);
  const before = startPlan(start);
  const totals = new Map<string, number[]>();
  for (const stage of Object.values(before.stages))
    for (const line of rowsOf(stage))
      if (!line.id.startsWith('power-'))
        totals.set(line.id, [...(totals.get(line.id) || []), Object.values(line.outputs)[0] || 0]);
  const groups: FactoryGroups['groups'] = Array.from(
    { length: 2 + Math.floor(next() * 2) },
    (_, i) => ({ id: `fg-rate${i}`, name: `Group ${i}` }),
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
    if (roll < 0.3) continue;
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
  // Half the recalculations also change the storage rate, as the issue's example does, so more
  // rows change their total.
  const storageRate = next() < 0.5 ? { storageRate: pick([0.5, 1, 2, 3]) } : {};
  const plan = calculate({ ...STARTS[start]!, ...storageRate, onSite });
  return {
    before,
    plan,
    groups: marking,
    fixed: Object.values(assignments)
      .flat()
      .filter(membership => membership.rate !== null),
  };
}

test('right after a recalculation with fixed and open memberships, each own line matches the books (#984)', () => {
  const problems: string[] = [];
  let phases = 0,
    lines = 0,
    fixed = 0,
    changed = 0,
    short = 0;
  const left = { count: 0 };
  for (let seed = 1; seed <= 40; seed++) {
    const { before, plan, groups, fixed: rates } = configuration(seed);
    fixed += rates.length;
    for (const [phase, stage] of Object.entries(plan.stages) as [StageKey, StoredStage][]) {
      if (!stage.feasible || stage.onSiteDropped) continue;
      const own = rowsOf(stage).filter(line => line.onSite).length;
      if (!own) continue;
      phases++;
      lines += own;
      const label = `seed ${seed}, phase ${phase}`;
      problems.push(...lineProblems(stage, groups, label, left));
      // The parts that follow a row's total: rows whose total the recalculation changed, and
      // rows that make less than the fixed rates (sized by rowShares' shares at their total).
      const total = (from: StoredStage, id: string) => {
        const line = row(from, id);
        return line ? Object.values(line.outputs)[0] || 0 : 0;
      };
      for (const entry of Object.values(plan.settings.onSite || {}))
        for (const [id, part] of Object.entries(entry.rates?.[phase] || {})) {
          if (total(stage, id) !== total(before.stages[phase], id)) changed++;
          if (total(stage, id) < part.after + part.rate) short++;
        }
    }
  }
  assert.deepEqual(problems.slice(0, 20), [], `${problems.length} problems`);
  assert.ok(phases >= 120, `${phases} phases with own lines checked`);
  assert.ok(lines >= 250, `${lines} own lines checked`);
  assert.ok(fixed >= 1000, `${fixed} fixed-rate memberships`);
  assert.ok(changed >= 30, `${changed} rows with a fixed rate changed their total`);
  assert.ok(short >= 40, `${short} rows make less than their fixed rates`);
  assert.ok(left.count * 10 <= lines, `${left.count} fluids left out`);
});
