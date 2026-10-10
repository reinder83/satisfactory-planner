// The build-plan step of a factory group's own line made on site (siteLineText in
// views/calculated.ts) says that only what the plan makes on site for the group feeds it first: a
// byproduct of the line goes to the rest of the plan, like any line's (#1001, the Logistics books'
// rule, siteItems in group-links.ts). The plans are the planner's own (generatedWith), the
// fixtures of on-site-dialog-notes.test.ts: "Plastic for Group 2" with its Heavy Oil Residue, and
// "Aluminum Scrap for Group 1" with its Water (a raw resource, never made on site).
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { onSiteSettings } from '../../public/app/on-site.ts';
import { render } from '../../public/app/shell.ts';
import { calcTasks } from '../../public/app/views/calculated.ts';
import { generatedWith, open, page } from './setup.ts';
import type { FactoryGroups, Phase, StoredCalculatedPlan } from '../../public/types/index.ts';
import { STANDARD_BEFORE_1040 } from '../helpers/standard-before-1040.ts';

const G1 = 'fg-rand1',
  G2 = 'fg-rand2';

// The made-on-site sentences that open the step of row `id` in `phase`, with `calculated` open.
function siteSentence(
  calculated: StoredCalculatedPlan,
  factoryGroups: FactoryGroups,
  phase: Phase,
  id: string,
): string {
  open({ calculated: structuredClone(calculated), phase, state: { factoryGroups } });
  render();
  const step = calcTasks(phase).find(task => task.id === `calc-${phase}-${id}`);
  assert.ok(step, `the build plan has the step of ${id}`);
  const body = step.body.replace(/ /g, ' ');
  const match = /^Made on site for .*? Sink\.(?: Its [^.]*\.)?/.exec(body);
  assert.ok(match, body);
  return match[0];
}

beforeEach(() => page());

// Group 2 builds Computer and marks Plastic; Group 1 builds Rubber (on coal power, as in
// on-site-dialog-notes.test.ts).
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
const COAL = { phase: '3', wholeMachines: true, limitsConfirmed: true, mainPower: 'coal' };
const plasticPlan = generatedWith({
  ...COAL,
  onSite: onSiteSettings(generatedWith(COAL), plasticGroups),
});
const OWN_PLASTIC = `Recipe_Plastic_C:${G2}`;

test('the step of "Plastic for Group 2" sends its Heavy Oil Residue to the rest of the plan (#1001)', () => {
  const own = plasticPlan.stages['3'].rows!.find(row => row.id === OWN_PLASTIC)!;
  assert.deepEqual(Object.keys(own.outputs), ['Plastic', 'Heavy Oil Residue']);
  assert.deepEqual(plasticPlan.settings.onSite?.[G2]?.items, ['Plastic']);
  assert.equal(
    siteSentence(plasticPlan, plasticGroups, '3', OWN_PLASTIC),
    "Made on site for Group 2: its Plastic feeds that factory's own lines first, and what they do not use goes to any other line that still needs it, then to the AWESOME Sink. Its Heavy Oil Residue goes to the rest of the plan, like any line's byproduct.",
  );
});

test('a byproduct the plan makes on site for the group feeds it first, as the books keep it', () => {
  // The plan as if Group 2 had Heavy Oil Residue made on site too (settings.onSite's items, which
  // the Logistics books read): the line's every output stays in Group 2 first, so the sentence is
  // the one a line without a byproduct has.
  const both = structuredClone(plasticPlan);
  both.settings.onSite![G2]!.items = ['Heavy Oil Residue', 'Plastic'];
  assert.equal(
    siteSentence(both, plasticGroups, '3', OWN_PLASTIC),
    "Made on site for Group 2: it feeds that factory's own lines first, and what they do not use goes to any other line that still needs it, then to the AWESOME Sink.",
  );
});

test('the step of "Aluminum Scrap for Group 1" sends its Water to the rest of the plan, though the group marks Water (#1003)', () => {
  const scrapGroups: FactoryGroups = {
    groups: [{ id: G1, name: 'Group 1' }],
    assignments: {
      Recipe_PureAluminumIngot_C: [{ group: G1, rate: null }],
      Recipe_Alternate_Turbofuel_C: [{ group: G1, rate: null }],
      Recipe_NitricAcid_C: [{ group: G1, rate: null }],
    },
    local: { [G1]: ['Aluminum Scrap', 'Compacted Coal', 'Water'] },
  };
  const PHASE4 = {
    phase: '4',
    wholeMachines: true,
    limitsConfirmed: true,
    ...STANDARD_BEFORE_1040,
  };
  const scrapPlan = generatedWith({
    ...PHASE4,
    onSite: onSiteSettings(generatedWith(PHASE4), scrapGroups),
  });
  const id = `Recipe_AluminumScrap_C:${G1}`;
  assert.equal(scrapPlan.stages['4'].rows!.find(row => row.id === id)!.outputs.Water, 240);
  assert.equal(
    siteSentence(scrapPlan, scrapGroups, '4', id),
    "Made on site for Group 1: its Aluminum Scrap feeds that factory's own lines first, and what they do not use goes to any other line that still needs it, then to the AWESOME Sink. Its Water goes to the rest of the plan, like any line's byproduct.",
  );
});

test('a line made on site without a byproduct keeps its sentence', () => {
  // Alpha builds Stator and marks Wire: its own Wire line makes only Wire.
  const wireGroups: FactoryGroups = {
    groups: [{ id: G1, name: 'Alpha' }],
    assignments: { Recipe_Stator_C: [{ group: G1, rate: null }] },
    local: { [G1]: ['Wire'] },
  };
  const BASE = { phase: '3', wholeMachines: true, limitsConfirmed: true };
  const wirePlan = generatedWith({
    ...BASE,
    onSite: onSiteSettings(generatedWith(BASE), wireGroups),
  });
  assert.equal(
    siteSentence(wirePlan, wireGroups, '3', `Recipe_Wire_C:${G1}`),
    "Made on site for Alpha: it feeds that factory's own lines first, and what they do not use goes to any other line that still needs it, then to the AWESOME Sink.",
  );
});
