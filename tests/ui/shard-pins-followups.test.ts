// Follow-ups to the Power Shard pins per line (#1239, review of #1268): a line of one machine that
// runs below the line's clock is worded for that machine (no "Insert 2 … 0 in total"), the recipe
// panel and the flow page say the line's clock instead of 100%, and the flow bar's per-machine rate
// is "at 250%" for such a line.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { calcFlowModel } from '../../public/app/flow.ts';
import * as model from '../../public/app/group-flow.ts';
import { flowRoute, setQuery, setWizard, viewOf } from '../../public/app/session.ts';
import { setBeginnerMode } from '../../public/app/beginner.ts';
import { render } from '../../public/app/shell.ts';
import { machineLine } from '../../public/app/views/factories.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { $, $$, catalog, generatedWith, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan } from '../../public/types/index.ts';

const BASE = { phase: '3', recipes: 'standard', storageFromSurplus: true };
const ROD = 'Recipe_IronRod_C';
const RUBBER = 'Recipe_Rubber_C';
const RESIDUAL = 'Recipe_ResidualPlastic_C';
const cache = new Map<string, CurrentCalculatedPlan>();
const planWith = (lineClocks: Record<string, Record<string, number>>, whole = false) => {
  const key = JSON.stringify([lineClocks, whole]);
  if (!cache.has(key)) cache.set(key, generatedWith({ ...BASE, wholeMachines: whole, lineClocks }));
  return structuredClone(cache.get(key)!);
};
const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const text = (selector: string) => ($(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
const open3 = (plan: CurrentCalculatedPlan) => {
  page();
  open({ calculated: plan, phase: '3', workspace: { catalog: catalog() } });
  go('plan');
  render();
};

beforeEach(() => {
  setWizard(null);
  setBeginnerMode(false);
  setQuery('');
});

test('a clocked line of one machine below 100% takes no Power Shards, and says so', async () => {
  // An exact plan: Rubber is one machine at 87.5%, which needs no Power Shards at all.
  const plan = planWith({ '3': { [RUBBER]: 250 } });
  const rubber = plan.stages['3'].rows!.find(row => row.id === RUBBER)!;
  assert.equal(rubber.machines, 1);
  assert.ok(rubber.lastClock < 100 && rubber.clock === 250 && rubber.shards! > 0);
  open3(plan);
  await settle();
  const step = text(`[data-task="calc-3-${RUBBER}"]`);
  assert.match(
    step,
    /Its one machine runs at 87\.5%, which needs no Power Shards, so the 250% you pinned changes nothing here\./,
  );
  assert.doesNotMatch(step, /Insert \d|in total|0 Power Shards/);
  openCalculatedFactory(RUBBER);
  await settle();
  assert.equal(
    text('[data-shard-pin-now]'),
    `This plan pins this line at 250%, but its one ${rubber.machine} runs at 87.5%, which needs no Power Shards.`,
  );
  // The card: "1 × Refinery at 87.5%", not "at 250% · at 87.5%".
  assert.equal(machineLine(1, rubber.machine, 87.5, 250), `1 × ${rubber.machine} at 87.5%`);
  assert.equal(
    machineLine(2, rubber.machine, 87.5, 250),
    `2 × ${rubber.machine} at 250% · last at 87.5%`,
  );
  // A line at 100% is worded as before.
  assert.equal(machineLine(1, 'Refinery', 62), '1 × Refinery · at 62%');
  assert.equal(machineLine(30, 'Refinery', 62), '30 × Refinery · last at 62%');
});

test('a clocked line of one machine above 100% takes the shards for its own clock', async () => {
  // Residual Plastic: one machine at 141.63%, 1 Power Shard (not 3, the line's 250%).
  const plan = planWith({ '3': { [RESIDUAL]: 250 } });
  const row = plan.stages['3'].rows!.find(line => line.id === RESIDUAL)!;
  assert.equal(row.machines, 1);
  assert.ok(row.lastClock > 100 && row.lastClock <= 150);
  open3(plan);
  await settle();
  const step = text(`[data-task="calc-3-${RESIDUAL}"]`);
  assert.match(
    step,
    /Insert 1 Power Shard in the machine, to run it at 141\.63%, once the MAM research Overclock Production is done\./,
  );
  assert.doesNotMatch(step, /in each machine|in total/);
  openCalculatedFactory(RESIDUAL);
  await settle();
  assert.equal(
    text('[data-shard-pin-now]'),
    `This plan runs this line’s one ${row.machine} at 141.63% with 1 Power Shard.`,
  );
});

test('the recipe panel and the flow bar name the line’s clock, not 100%', async () => {
  const clocked = planWith({ '3': { [ROD]: 250 } }, true);
  open3(clocked);
  openCalculatedFactory(ROD);
  await settle();
  assert.match(text('.rail-recipe-head'), /makes @ 250% · per minute$/);
  const row = clocked.stages['3'].rows!.find(line => line.id === ROD)!;
  const flow = calcFlowModel(row);
  assert.equal(flow.recipe?.clock, 250);
  // The words already say "all at 250%", so the rate adds no clock of its own, and never 100%.
  assert.match(flow.bar!.sub, /all at 250% · 37\.5 Iron Rod\/min out per machine( ·|$)/);
  assert.doesNotMatch(flow.bar!.sub, /100%/);
  // An unclocked line, and a clocked line whose clock is not in the words yet.
  const plain = planWith({}, true);
  open3(plain);
  openCalculatedFactory(ROD);
  await settle();
  assert.match(text('.rail-recipe-head'), /makes @ 100% · per minute$/);
  const mixed = calcFlowModel({ ...row, equivalent: row.machines - 0.5, lastClock: 125 });
  assert.match(mixed.bar!.sub, /at 250% \+ 1 at 125%/);
  assert.match(mixed.bar!.sub, /out per machine at 250%/);
  assert.doesNotMatch(mixed.bar!.sub, /100%/);
});

test('the flow page’s line cards say the line’s clock', async () => {
  const plan = planWith({ '3': { [ROD]: 250 } }, true);
  const groups = defaultFactoryGroups(plan);
  const group = 'fg-iron01';
  const flow = model.groupFlow(plan.stages['3'], groups, group, () => '')!;
  const line = flow.lines.find(entry => entry.id === ROD)!;
  assert.equal(line.clock, 250);
  const rod = plan.stages['3'].rows!.find(entry => entry.id === ROD)!;
  open({ calculated: plan, phase: '3', state: { factoryGroups: groups } });
  location.hash = '#' + flowRoute(group);
  go(viewOf(location.hash.slice(1)));
  render();
  await settle();
  const card = $$('.gf-card').find(node => node.getAttribute('data-line') === ROD)!;
  assert.match(card.textContent!, new RegExp(`${rod.machines} × Constructor at 250%`));
  // Any line at 100% has no clock.
  const plainPlan = planWith({}, true);
  const plainFlow = model.groupFlow(
    plainPlan.stages['3'],
    defaultFactoryGroups(plainPlan),
    group,
    () => '',
  )!;
  assert.ok(plainFlow.lines.every(entry => entry.clock === undefined));
});
