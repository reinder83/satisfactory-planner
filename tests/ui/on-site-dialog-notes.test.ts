// The factory dialog's bank note for lines made on site says only what is true (#1001, #1002), on
// the planner's own plans (generatedWith), as in on-site-flow-dialog.test.ts:
// - an own line whose recipe has a byproduct (Plastic for Group 2, with Heavy Oil Residue) speaks
//   of "the group's other lines" only when the group has another own line for the item it marks,
//   and words the byproduct, which goes to the whole plan's demand for it, in a sentence of its
//   own (#1001);
// - the central Wire line, after Stator moves out of Alpha, names the line made on site for Alpha
//   whose leftover meets a part of the demand its deliveries leave out, rather than calling it
//   another recipe (#1002);
// - an own line whose group asks for none of the item after a group edit, all of it sunk, says so
//   rather than "Demand of Beta's lines" (#1002);
// - a plan without lines made on site, and one whose groups were not edited, read as before;
// - an own line's byproduct of an item its group marks but the plan did not make on site for it
//   (Water from Group 1's Aluminum Scrap line) goes to the whole plan's demand like any other
//   byproduct, and an edit to the marks after the recalculation changes no note (#1003).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { beforeEach, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { calcFlowModel } from '../../public/app/flow.ts';
import type { FlowModel } from '../../public/app/flow.ts';
import { onSiteSettings } from '../../public/app/on-site.ts';
import { calcStage } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, generatedWith, open, page } from './setup.ts';
import type { FactoryGroups, StageKey, StoredCalculatedPlan } from '../../public/types/index.ts';

const BASE = { phase: '3', wholeMachines: true, limitsConfirmed: true };
const plain = generatedWith(BASE);

// Opens `calculated` at `phase` with `factoryGroups`, and returns the flow model of row `id` and
// the text of the note its dialog draws under the destinations.
function dialogOf(
  calculated: StoredCalculatedPlan,
  factoryGroups: FactoryGroups,
  id: string,
  phase: StageKey = '3',
): { model: FlowModel; note: string } {
  open({ calculated: structuredClone(calculated), phase, state: { factoryGroups } });
  render();
  const row = calcStage()!.rows!.find(candidate => candidate.id === id);
  assert.ok(row, `the phase has row ${id}`);
  openCalculatedFactory(id);
  const note = $('#detail .rail-rows ~ p');
  assert.ok(note, `${id}'s dialog has a note under its destinations`);
  return {
    model: calcFlowModel(row),
    note: (note.textContent || '').replace(/\s+/g, ' ').trim(),
  };
}

beforeEach(() => page());

// #1001: Group 2 builds Computer and marks Plastic, so the recalculation gives it a Plastic line of
// its own, "Plastic for Group 2", which also makes Heavy Oil Residue. Group 1 builds Rubber, which
// makes Heavy Oil Residue too. Group 2 has no other Plastic line.
const G1 = 'fg-rand1',
  G2 = 'fg-rand2';
const plasticGroups: FactoryGroups = {
  groups: [
    { id: G1, name: 'Group 1' },
    { id: G2, name: 'Group 2' },
  ],
  assignments: {
    Recipe_Rubber_C: [{ group: G1, rate: null }],
    Recipe_Computer_C: [{ group: G2, rate: null }],
  },
  local: { [G2]: ['Plastic'] },
};
const plasticPlan = generatedWith({ ...BASE, onSite: onSiteSettings(plain, plasticGroups) });
const OWN_PLASTIC = `Recipe_Plastic_C:${G2}`;

test('an own line whose recipe has a byproduct does not claim the group’s other lines (#1001)', () => {
  const rows = plasticPlan.stages['3'].rows!;
  const own = rows.find(row => row.id === OWN_PLASTIC);
  assert.deepEqual(own?.onSite, { group: G2, recipe: 'Recipe_Plastic_C' });
  assert.deepEqual(Object.keys(own.outputs), ['Plastic', 'Heavy Oil Residue']);
  // Group 2 has no other Plastic line; Rubber (Group 1) and the central Plastic line make Heavy
  // Oil Residue too.
  assert.deepEqual(
    rows.filter(row => row.outputs.Plastic && row.onSite?.group === G2).map(row => row.id),
    [OWN_PLASTIC],
  );
  assert.ok(rows.some(row => row.id === 'Recipe_Rubber_C' && row.outputs['Heavy Oil Residue']));
  const { model, note } = dialogOf(plasticPlan, plasticGroups, OWN_PLASTIC);
  assert.deepEqual(model.bankNote, {
    shared: false,
    ownLine: 'Group 2',
    // Heavy Oil Residue goes to the whole plan's demand for it, which the central Plastic line,
    // of the same recipe, and Rubber supply with it.
    planWide: { items: ['Heavy Oil Residue'], shared: true, sameRecipe: true },
  });
  assert.equal(
    note,
    "Demand of Group 2's lines, which this line makes the item for on site; what it makes beyond that goes to the AWESOME Sink. Heavy Oil Residue goes to the demand for it across this phase's whole plan, supplied together with the other lines making it.",
  );
  assert.doesNotMatch(note, /group’s other lines/);
});

test('a line sharing a byproduct with a group’s copy of its recipe says "other lines", not "other recipes" (#1002)', () => {
  // The central Plastic line shares Plastic with Residual Plastic, another recipe, and Heavy Oil
  // Residue with Rubber and "Plastic for Group 2", a copy of its own recipe.
  const { model, note } = dialogOf(plasticPlan, plasticGroups, 'Recipe_Plastic_C');
  assert.deepEqual(model.bankNote, { shared: true, sameRecipe: true, lessOnSite: true });
  assert.equal(
    note,
    "Demand for the item across this phase's whole plan, less what factory groups make on site, supplied together with the other lines making it.",
  );
  // Rubber shares Heavy Oil Residue with lines of other recipes only.
  assert.equal(
    dialogOf(plasticPlan, plasticGroups, 'Recipe_Rubber_C').note,
    "Demand for the item across this phase's whole plan, supplied together with the other recipes producing it.",
  );
});

// #1002 point 1: Alpha builds Stator and Beta half of Cable, both marking Wire; Gamma holds the
// rest of Cable and the central Wire line (the plan of on-site-flow-dialog.test.ts). After the
// recalculation Stator moves from Alpha to Gamma, so Alpha's own Wire line offers what the sink
// has no room for to the other places (#918), which the central line also delivers to.
const ALPHA = 'fg-alpha1',
  BETA = 'fg-beta22',
  GAMMA = 'fg-gamma3';
const cableRate = plain.stages['3'].rows!.find(row => row.id === 'Recipe_Cable_C')!.outputs.Cable!;
const wireGroups: FactoryGroups = {
  groups: [
    { id: ALPHA, name: 'Alpha' },
    { id: BETA, name: 'Beta' },
    { id: GAMMA, name: 'Gamma' },
  ],
  assignments: {
    Recipe_Stator_C: [{ group: ALPHA, rate: null }],
    Recipe_Cable_C: [
      { group: BETA, rate: cableRate / 2 },
      { group: GAMMA, rate: null },
    ],
    Recipe_Wire_C: [{ group: GAMMA, rate: null }],
  },
  local: { [ALPHA]: ['Wire'], [BETA]: ['Wire'] },
};
const wirePlan = generatedWith({ ...BASE, onSite: onSiteSettings(plain, wireGroups) });
const movedStator: FactoryGroups = {
  ...wireGroups,
  assignments: { ...wireGroups.assignments, Recipe_Stator_C: [{ group: GAMMA, rate: null }] },
};

test('after a group edit the central line names the line whose leftover meets part of the demand, not "other recipes" (#1002)', () => {
  const { model, note } = dialogOf(wirePlan, movedStator, 'Recipe_Wire_C');
  // It shares Stator and Gamma's half of Cable with "Wire for Alpha" alone, of the same recipe,
  // and delivers them what Alpha's leftover leaves.
  const stator = model.outputs.find(output => output.link?.calcFactory === 'Recipe_Stator_C')!;
  const statorWire = wirePlan.stages['3'].rows!.find(row => row.id === 'Recipe_Stator_C')!.inputs
    .Wire!;
  assert.ok(stator.rate! < statorWire - 1, `${stator.rate} of Stator's ${statorWire}`);
  assert.deepEqual(model.bankNote, {
    shared: false,
    lessOnSite: true,
    leftover: { groups: ['Alpha'], lines: 1 },
  });
  assert.equal(
    note,
    "Demand for the item across this phase's whole plan, less what factory groups make on site, including what is left over from the line made on site for Alpha.",
  );
  assert.doesNotMatch(note, /other recipes/);
  // Alpha's own line keeps the #918 sentence.
  assert.match(
    dialogOf(wirePlan, movedStator, `Recipe_Wire_C:${ALPHA}`).note,
    /^Made on site for Alpha's lines, which now ask for less than it makes: the AWESOME Sink takes what the plan sinks, and the rest goes to the other places that ask for it\.$/,
  );
});

// #1002 point 2: Beta builds 10 of the 150 Steel Pipe/min and marks Steel Ingot, so the
// recalculation gives it one Foundry of Steel Ingot of its own (45/min), most of it beyond Beta's
// demand. Then Beta's share of Steel Pipe moves to Gamma: Beta asks for no Steel Ingot, and the
// plan's surplus takes all its line makes, so nothing is offered.
const steelGroups: FactoryGroups = {
  groups: [
    { id: BETA, name: 'Beta' },
    { id: GAMMA, name: 'Gamma' },
  ],
  assignments: {
    Recipe_SteelPipe_C: [
      { group: BETA, rate: 10 },
      { group: GAMMA, rate: null },
    ],
  },
  local: { [BETA]: ['Steel Ingot'] },
};
const steelPlan = generatedWith({ ...BASE, onSite: onSiteSettings(plain, steelGroups) });
const movedPipe: FactoryGroups = {
  ...steelGroups,
  assignments: { Recipe_SteelPipe_C: [{ group: GAMMA, rate: null }] },
};
const OWN_STEEL = `Recipe_IngotSteel_C:${BETA}`;

test('an own line whose group asks for none of the item says so, not "Demand of Beta’s lines" (#1002)', () => {
  const { model, note } = dialogOf(steelPlan, movedPipe, OWN_STEEL);
  // All of it goes to the sink.
  assert.deepEqual(
    model.outputs.map(output => output.kind),
    ['sink'],
  );
  assert.equal(
    model.outputs[0]!.rate,
    steelPlan.stages['3'].rows!.find(row => row.id === OWN_STEEL)!.outputs['Steel Ingot'],
  );
  assert.deepEqual(model.bankNote, { shared: false, ownLine: 'Beta', asksNone: true });
  assert.equal(
    note,
    "Made on site for Beta's lines, which now ask for none of it: all of it goes to the AWESOME Sink.",
  );
  assert.doesNotMatch(note, /Demand of/);
  // Before the edit Beta asks for some of it, and the note is #965's.
  assert.equal(
    dialogOf(steelPlan, steelGroups, OWN_STEEL).note,
    "Demand of Beta's lines, which this line makes the item for on site; what it makes beyond that goes to the AWESOME Sink.",
  );
});

test('the notes of a plan without lines made on site, and of groups not edited, read as before', () => {
  // A plan a released planner froze, without lines made on site.
  const frozen: StoredCalculatedPlan = JSON.parse(
    fs.readFileSync('tests/fixtures/calculated-plan-2026-09-12.json', 'utf8'),
  );
  const none: FactoryGroups = { groups: [], assignments: {} };
  const plastic = dialogOf(frozen, none, 'Recipe_Plastic_C');
  assert.deepEqual(plastic.model.bankNote, { shared: true });
  assert.equal(
    plastic.note,
    "Demand for the item across this phase's whole plan, supplied together with the other recipes producing it.",
  );
  const wire = dialogOf(frozen, none, 'Recipe_Wire_C');
  assert.deepEqual(wire.model.bankNote, { shared: false });
  assert.equal(wire.note, "Demand for the item across this phase's whole plan.");
  // The Wire plan with its groups as calculated: Alpha's own line and the central line.
  const alpha = dialogOf(wirePlan, wireGroups, `Recipe_Wire_C:${ALPHA}`);
  assert.deepEqual(alpha.model.bankNote, { shared: false, ownLine: 'Alpha' });
  assert.equal(
    alpha.note,
    "Demand of Alpha's lines, which this line makes the item for on site; what it makes beyond that goes to the AWESOME Sink.",
  );
  const central = dialogOf(wirePlan, wireGroups, 'Recipe_Wire_C');
  assert.deepEqual(central.model.bankNote, { shared: false, lessOnSite: true });
  assert.equal(
    central.note,
    "Demand for the item across this phase's whole plan, less what factory groups make on site.",
  );
});

// #1003: Group 1 builds Pure Aluminum Ingot, Turbofuel and Nitric Acid in Phase 4, and marks
// Aluminum Scrap, Compacted Coal and Water. The recalculation leaves Water out (a raw resource,
// #921), so the plan makes no Water on site for Group 1, but its own Aluminum Scrap line makes 240
// Water/min beside the scrap.
const scrapGroups = (local: string[]): FactoryGroups => ({
  groups: [{ id: G1, name: 'Group 1' }],
  assignments: {
    Recipe_PureAluminumIngot_C: [{ group: G1, rate: null }],
    Recipe_Alternate_Turbofuel_C: [{ group: G1, rate: null }],
    Recipe_NitricAcid_C: [{ group: G1, rate: null }],
  },
  local: { [G1]: local },
});
const scrapMarks = scrapGroups(['Aluminum Scrap', 'Compacted Coal', 'Water']);
const PHASE4 = { phase: '4', wholeMachines: true, limitsConfirmed: true };
const scrapPlan = generatedWith({
  ...PHASE4,
  onSite: onSiteSettings(generatedWith(PHASE4), scrapMarks),
});
const OWN_SCRAP = `Recipe_AluminumScrap_C:${G1}`;
const SCRAP_NOTE =
  "Demand of Group 1's lines, which this line makes the item for on site; what it makes beyond that goes to the AWESOME Sink. Water goes to the demand for it across this phase's whole plan, supplied together with the other lines making it.";

test('an own line’s byproduct its group marks but the plan did not make on site goes to the whole plan (#1003)', () => {
  assert.deepEqual(scrapPlan.settings.onSite?.[G1]?.items, ['Aluminum Scrap', 'Compacted Coal']);
  const own = scrapPlan.stages['4'].rows!.find(row => row.id === OWN_SCRAP)!;
  assert.equal(own.outputs.Water, 240);
  const { model, note } = dialogOf(scrapPlan, scrapMarks, OWN_SCRAP, '4');
  // Water is a byproduct like Heavy Oil Residue above, not Water made on site for Group 1.
  assert.deepEqual(model.bankNote, {
    shared: false,
    ownLine: 'Group 1',
    planWide: { items: ['Water'], shared: true, sameRecipe: true },
  });
  assert.equal(note, SCRAP_NOTE);
  assert.doesNotMatch(note, /ask for less/);
  // Its Water goes to every line using Water in the phase, Group 1's Nitric Acid among them.
  const water = model.outputs.filter(output => output.pre === 'Water');
  assert.ok(water.some(output => output.link?.calcFactory === 'Recipe_NitricAcid_C'));
  assert.ok(water.some(output => output.link?.calcFactory === 'Recipe_AluminaSolution_C'));
  assert.ok(water.every(output => output.kind !== 'sink'));
});

test('marks edited after the recalculation leave the notes as the plan was calculated (#1003)', () => {
  // Group 1 clears Aluminum Scrap and marks Rocket Fuel, which the plan makes on a central line (a
  // group never copies Rocket Fuel for its Compacted Coal byproduct, #1012).
  const edited = scrapGroups(['Compacted Coal', 'Rocket Fuel', 'Water']);
  const { model, note } = dialogOf(scrapPlan, edited, OWN_SCRAP, '4');
  assert.equal(note, SCRAP_NOTE);
  assert.equal(model.bankNote?.ownLine, 'Group 1');
  assert.deepEqual(model.bankNote, dialogOf(scrapPlan, scrapMarks, OWN_SCRAP, '4').model.bankNote);
  const rocket = dialogOf(scrapPlan, edited, 'Recipe_RocketFuel_C', '4');
  assert.ok(rocket.model.outputs.some(output => output.pre === 'Rocket Fuel'));
  assert.deepEqual(
    rocket.model.bankNote,
    dialogOf(scrapPlan, scrapMarks, 'Recipe_RocketFuel_C', '4').model.bankNote,
  );
});
