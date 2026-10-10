// The build status with a factory group's own line made on site (#907, public/app/build-status.ts):
// the line feeds its own group's consumers first, as the planner sized it and the Logistics
// page's books share it (itemBooks), and never another group's; the central line serves the
// rest. So the held-back reason, the delivery and the step to build next follow where a belt
// really brings the item. A plan without such lines is counted exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStatus, siteRouting } from '../public/app/build-status.ts';
import { onSiteSettings } from '../public/app/on-site.ts';
import { calculate } from '../planner.ts';
import type { CalcRow, FactoryGroups, StoredStage } from '../public/types/index.ts';

const ALPHA = 'fg-alpha1',
  BETA = 'fg-beta22';
const OWN = 'wire:' + ALPHA;

// A row with only what buildStatus reads; the rest are the neutral values a real row carries.
const row = (id: string, inputs: CalcRow['inputs'], outputs: CalcRow['outputs'], extra = {}) => ({
  id,
  name: id,
  phase: 1,
  machine: 'Constructor',
  power: 4,
  inputs,
  outputs,
  equivalent: 1,
  machines: 1,
  lastClock: 100,
  peakMW: 4,
  generationMW: 0,
  ...extra,
});
// The central Wire line, Alpha's own Wire line (made on site), Alpha's Stator and Beta's Cable.
// The own line makes exactly what Stator uses, the central one what Cable uses.
const stage: StoredStage = {
  feasible: true,
  rows: [
    row('wire', { Ore: 30 }, { Wire: 30 }),
    row(OWN, { Ore: 20 }, { Wire: 20 }, { onSite: { group: ALPHA, recipe: 'wire' } }),
    row('stator', { Wire: 20 }, { Stator: 5 }),
    row('cable', { Wire: 30 }, { Cable: 15 }),
  ],
  raw: { Ore: 50 },
  supplied: {},
  storage: {},
  drone: {},
  delivery: { Stator: { target: 100, rate: 5 }, Cable: { target: 300, rate: 15 } },
};
const groups: FactoryGroups = {
  groups: [
    { id: ALPHA, name: 'Alpha' },
    { id: BETA, name: 'Beta' },
  ],
  assignments: {
    stator: [{ group: ALPHA, rate: null }],
    cable: [{ group: BETA, rate: null }],
  },
  local: { [ALPHA]: ['Wire'] },
};
const ticked = (...ids: string[]) => Object.fromEntries(ids.map(id => ['calc-1-' + id, true]));
const close = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${what}: ${actual} is not ${expected}`);
const status = (checks: Record<string, boolean>, sites = siteRouting(stage, groups)) =>
  buildStatus(stage, checks, '1', 0, stage.rows, new Map(), sites);
const shareOf = (result: ReturnType<typeof status>, id: string) =>
  result.rows.find(entry => entry.id === id)!;

test("a group's own line runs its group's consumers, never another group's", () => {
  const result = status(ticked(OWN, 'stator', 'cable'));
  close(shareOf(result, 'stator').share, 1, "Alpha's Stator runs on Alpha's Wire");
  close(shareOf(result, 'cable').share, 0, "no belt brings Alpha's Wire to Beta's Cable");
  assert.equal(shareOf(result, 'cable').shortOf, 'Wire');
  assert.equal(shareOf(result, 'stator').shortOf, undefined);
  assert.deepEqual(
    result.delivery.map(part => [part.item, part.now]),
    [
      ['Stator', 5],
      ['Cable', 0],
    ],
  );
  // Pooled over the phase, as before #907, both got 20 of the 50 Wire they ask for.
  const pooled = status(ticked(OWN, 'stator', 'cable'), { inputs: new Map(), outputs: new Map() });
  close(shareOf(pooled, 'stator').share, 0.4, 'pooled Stator');
  close(shareOf(pooled, 'cable').share, 0.4, 'pooled Cable');
});

test("the central line does not run the part of a group's consumers its own line is for", () => {
  const result = status(ticked('wire', 'stator', 'cable'));
  close(shareOf(result, 'cable').share, 1, "Beta's Cable runs on the central Wire");
  close(shareOf(result, 'stator').share, 0, "Alpha's Stator waits for Alpha's own line");
  assert.equal(shareOf(result, 'stator').shortOf, 'Wire');
  // Everything Wire made and used counts once, whichever pool it is in.
  close(result.produced.Wire!, 30, 'the Wire made');
});

test('everything built delivers the plan in full, with the lines made on site', () => {
  const result = status(ticked('wire', OWN, 'stator', 'cable'));
  for (const entry of result.rows) close(entry.share, 1, entry.id);
  close(result.deliveryShare, 1, 'delivery');
  assert.equal(result.next, null);
});

test("the step to build next is the group's own line its built consumer waits for", () => {
  // Only Alpha's Stator is built: the central line would not feed it, Alpha's own line would.
  const result = status(ticked('stator'));
  assert.equal(result.next?.id, OWN);
  close(result.next!.gain, 0.5, 'the Stator half of the delivery');
  // Pooled, either line fed Stator, and build order picked the central one first.
  const pooled = status(ticked('stator'), { inputs: new Map(), outputs: new Map() });
  assert.equal(pooled.next?.id, 'wire');
});

test("what a group's own line makes beyond the group's demand reaches the others only as the books offer it", () => {
  // After a group edit Alpha holds half of Stator (#918): the own line still makes 20 Wire, the
  // group asks for 10, and the plan sinks none, so the books offer the other 10 to the rest of
  // the plan, which shares them with the central line's Wire.
  const edited: FactoryGroups = {
    ...groups,
    assignments: { ...groups.assignments, stator: [{ group: ALPHA, rate: 2.5 }] },
  };
  const result = status(ticked(OWN, 'stator', 'cable'), siteRouting(stage, edited));
  // The common pool has the offered 10 for the 40 Stator's other half and Cable ask for.
  close(shareOf(result, 'cable').share, 0.25, 'Cable gets a share of the offered Wire');
  close(shareOf(result, 'stator').share, 0.25, "Stator's other half waits for the same pool");
  // With no group's own line there is nothing to route: every item is the phase's.
  const plain: StoredStage = { ...stage, rows: stage.rows!.filter(entry => entry.id !== OWN) };
  assert.deepEqual(siteRouting(plain, groups), { inputs: new Map(), outputs: new Map() });
});

test("a real plan with lines made on site: fully built it runs every line, and a group's own line feeds only its group", () => {
  const base = { phase: '3', wholeMachines: true, limitsConfirmed: true };
  const plain = calculate(base);
  const rows = plain.stages['3']!.rows || [];
  const cable = rows.find(entry => entry.id === 'Recipe_Cable_C')!.outputs.Cable!;
  const marking: FactoryGroups = {
    ...groups,
    assignments: {
      Recipe_Stator_C: [{ group: ALPHA, rate: null }],
      Recipe_Cable_C: [{ group: BETA, rate: cable / 2 }],
    },
    local: { [ALPHA]: ['Wire'] },
  };
  const plan = calculate({ ...base, onSite: onSiteSettings(plain, marking) });
  const onSite = plan.stages['3']!;
  const own = (onSite.rows || []).find(entry => entry.onSite?.group === ALPHA)!;
  assert.ok(own, "the plan has Alpha's own Wire line");
  const sites = siteRouting(onSite, marking, plan.settings.onSite);
  const all = Object.fromEntries((onSite.rows || []).map(entry => ['calc-3-' + entry.id, true]));
  const full = buildStatus(onSite, all, '3', 0, onSite.rows, new Map(), sites);
  for (const entry of full.rows) close(entry.share, 1, entry.id);
  close(full.deliveryShare, 1, 'delivery');
  // Alpha's own Wire line and every line but the central Wire line: Stator runs in full on
  // Alpha's Wire, Cable (half in Beta, half Ungrouped) waits for the central line.
  const central = (onSite.rows || []).find(entry => entry.id === 'Recipe_Wire_C')!;
  const allButCentral = { ...all, ['calc-3-' + central.id]: false };
  const half = buildStatus(onSite, allButCentral, '3', 0, onSite.rows, new Map(), sites);
  const entry = (id: string) => half.rows.find(candidate => candidate.id === id)!;
  close(entry('Recipe_Stator_C').share, 1, "Stator on Alpha's own Wire");
  assert.ok(entry('Recipe_Cable_C').share < 1e-6, 'Cable has no Wire without the central line');
  assert.equal(entry('Recipe_Cable_C').shortOf, 'Wire');
});
