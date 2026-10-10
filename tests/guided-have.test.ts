// The guided start's "What you already have" (#1068, ui/guided/GuidedHave.vue) sends what All
// settings and Review send: settings.ownedMiner, ownedBelt and ownedAlternates, and the steps
// "Everything before Phase N is done" and the owned alternates tick as the new profile's `built`
// work. Nothing new is stored, so both editions must create the same profile from the same
// answers, and a skipped screen leaves every field absent in both, as before the screen existed.
// The screen itself is covered in tests/ui/guided-have.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate } from '../planner.ts';
import { alternateHunts, ownedAlternateKeys, stepsBeforeStart } from '../public/progression.ts';
import {
  browserProfile,
  createdProfile as created,
  dockerProfile,
  newSaveRequest as request,
} from './helpers/editions.ts';
import type { Progression } from '../public/types/index.ts';

const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
// A hard-drive alternate available from Phase 2 that a Phase 3 plan uses once it may.
const SCREW = 'Recipe_Alternate_Screw_2_C';
// A new save's guided start for Phase 3, as freshSettings starts it (mining per phase on).
const GUIDED = { phase: '3', goal: 'minimal', phaseMining: true };
// The same start with every "What you already have" answer given.
const ANSWERED = { ...GUIDED, ownedMiner: 3, ownedBelt: 5, ownedAlternates: [SCREW] };

// What createProfile sends as `built` for those answers (alreadyHaveKeys in wizard/wizard.ts):
// the steps before the start phase, and the owned recipe's unlock step with any hunt it empties.
function builtFor(settings: typeof GUIDED | typeof ANSWERED, earlierDone: boolean) {
  const plan = calculate(settings);
  const owned = new Set(
    ('ownedAlternates' in settings ? settings.ownedAlternates : []).map(
      id => `recipe-unlock-${id}`,
    ),
  );
  return [
    ...(earlierDone ? stepsBeforeStart(plan, { checks: {} }, data) : []),
    ...(owned.size ? ownedAlternateKeys(alternateHunts(plan, data), owned) : []),
  ];
}

test('the guided answers create the same profile in both editions', async () => {
  const built = builtFor(ANSWERED, true);
  assert.ok(built.length >= 17, 'the earlier steps and the owned recipe');
  assert.ok(built.includes(`recipe-unlock-${SCREW}`));
  const docker = await dockerProfile(request(ANSWERED, built));
  const browser = await browserProfile(request(ANSWERED, built));
  assert.deepEqual(created(browser), created(docker));
  const { settings, checks } = created(docker);
  assert.equal(settings.ownedMiner, 3);
  assert.equal(settings.ownedBelt, 5);
  assert.deepEqual(settings.ownedAlternates, [SCREW]);
  assert.equal(settings.phaseMining, true);
  for (const key of built) assert.equal(checks[key], true, key);
  // The plan mines Phase 3 with what was owned: Miner Mk.3 and Mk.5 belts.
  assert.equal(docker.plan!.stages['3']!.mining!.miner.mark, 3);
  assert.equal(docker.plan!.stages['3']!.mining!.belt.mark, 'Mk.5');
});

test('a skipped "What you already have" creates the profile it made before, in both editions', async () => {
  const docker = await dockerProfile(request(GUIDED, []));
  const browser = await browserProfile(request(GUIDED, []));
  assert.deepEqual(created(browser), created(docker));
  for (const field of ['ownedMiner', 'ownedBelt', 'ownedAlternates'])
    assert.equal(field in docker.plan!.settings, false, field);
  assert.deepEqual(docker.state.checks, {});
  assert.equal(docker.plan!.stages['3']!.mining!.miner.mark, 2, 'Phase 3’s own Miner Mk.2');
  assert.equal(docker.plan!.stages['3']!.mining!.belt.mark, 'Mk.4');
});
