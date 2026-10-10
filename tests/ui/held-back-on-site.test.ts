// The open plan's build status with a factory group's own line made on site (#907,
// currentBuildStatus and heldBack in public/app/views/calculated.ts): the profile's groups decide
// where that line's item goes, so a line of another group is held back for the item until its
// own supplier runs, and the group's consumer is not, as the Factories page's Held back chip and
// the cards show it.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { currentBuildStatus, heldBack } from '../../public/app/views/calculated.ts';
import { generated, open, page } from './setup.ts';
import type { CalcRow, CurrentStage, FactoryGroups } from '../../public/types/index.ts';

beforeEach(() => page());

const ALPHA = 'fg-alpha1',
  BETA = 'fg-beta22';
const OWN = 'wire:' + ALPHA;
const row = (id: string, inputs: CalcRow['inputs'], outputs: CalcRow['outputs'], extra = {}) => ({
  id,
  name: id,
  phase: 3,
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
const factoryGroups: FactoryGroups = {
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

// A plan whose Phase 3 is the central Wire line, Alpha's own Wire line, Alpha's Stator and Beta's
// Cable, with `ticked` marked running.
function openWith(...ticked: string[]) {
  const plan = generated();
  plan.stages['3'] = {
    ...plan.stages['3'],
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
    surplus: {},
    delivery: { Stator: { target: 100, rate: 5 }, Cable: { target: 300, rate: 15 } },
  } as CurrentStage;
  plan.settings.onSite = { [ALPHA]: { name: 'Alpha', items: ['Wire'], shares: {} } };
  open({
    calculated: plan,
    state: {
      factoryGroups,
      checks: Object.fromEntries(ticked.map(id => ['calc-3-' + id, true])),
    },
  });
}

test("a line of another group is held back for Wire while only a group's own Wire line runs", () => {
  openWith(OWN, 'stator', 'cable');
  assert.equal(heldBack('stator'), null, "Alpha's Stator runs on Alpha's own Wire");
  assert.deepEqual(heldBack('cable'), { share: 0, shortOf: 'Wire' });
});

test("a group's consumer waits for its own line, whatever the central line makes", () => {
  openWith('wire', 'stator', 'cable');
  assert.equal(heldBack('cable'), null, "Beta's Cable runs on the central Wire");
  assert.deepEqual(heldBack('stator'), { share: 0, shortOf: 'Wire' });
  assert.equal(currentBuildStatus()?.next?.id, OWN, 'the step to build next is the own line');
});
