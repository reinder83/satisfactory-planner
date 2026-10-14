// "New to Satisfactory" (#1076) changes no setting the planner does not already know: a new save
// started in it is the guided start's "Nothing — just the elevator" with the standard recipes and
// whole machines, which both editions create alike, and which keeps Phase 1 to a few biomass
// burners (the build plan's burner bank). The mode itself is never stored in a profile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate } from '../planner.ts';
import { phaseSteps } from '../public/progression.ts';
import { guidedQuestions } from '../public/preferences.ts';
import {
  browserProfile,
  createdProfile,
  dockerProfile,
  newSaveRequest,
} from './helpers/editions.ts';
import type { Progression } from '../public/types/index.ts';

const progression: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const option = (question: string, value: string) =>
  guidedQuestions.find(q => q.id === question)!.options!.find(o => o.value === value)!.set;
// A fresh plan's settings (freshSettings in public/app/wizard/wizard.ts) as the wizard sends
// them, with the guided defaults and the stock beginner mode starts at.
const FRESH = {
  phase: '1',
  goal: 'balanced',
  hours: 8,
  recipes: 'standard',
  wholeMachines: true,
  phaseMining: true,
  storageFromSurplus: true,
};
const BEGINNER = { ...FRESH, ...option('stock', 'none'), storageOverrides: {} };
const DEFAULT = {
  ...FRESH,
  ...option('stock', 'construction'),
  storageOverrides: { Concrete: 20 },
};

const burners = (settings: object) => {
  const plan = calculate(settings);
  const bank = phaseSteps(plan, { checks: {} }, progression, '1').find(
    step => step.id === 'startup-burner-bank-1',
  )!;
  return Number(/about (\d+) standalone burners/.exec(bank.body!)![1]);
};

test('a beginner’s new save is created alike in both editions, with nothing stocked', async () => {
  const docker = await dockerProfile(newSaveRequest(BEGINNER));
  const browser = await browserProfile(newSaveRequest(BEGINNER));
  assert.deepEqual(createdProfile(browser), createdProfile(docker));
  const settings = docker.plan!.settings;
  assert.equal(settings.storage, 'none');
  assert.deepEqual(settings.storageOverrides ?? {}, {});
  assert.equal('beginner' in settings, false, 'the mode is not a setting');
  assert.deepEqual(settings, calculate(BEGINNER).settings);
});

test('Phase 1 of a beginner’s plan needs only a few biomass burners, fewer than the default', () => {
  const beginner = burners(BEGINNER),
    usual = burners(DEFAULT);
  assert.ok(beginner <= 5, `${beginner} burners`);
  assert.ok(beginner < usual, `${beginner} is fewer than ${usual}`);
});
