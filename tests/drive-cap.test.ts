// The cap on hard drives (#1233, slice of #1079): settings.driveCap, at most N hard-drive
// alternates over the whole plan, beyond the ones the player owns (ownedAlternates) and the ones a
// MAM node or a milestone unlocks. The plan is made without the cap first and kept byte for byte
// when it counts on N or fewer; otherwise one integer search on the last planned phase picks the
// set (planner/drive-cap.ts) and every phase is planned from it, a phase that does not fit then a
// draft that names the cap. It belongs to the plan snapshot, like beltCap: a plan without it, and
// every plan stored before it, calculates, loads, imports and exports exactly as before, in both
// editions.
import './helpers/en-us-numbers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate, catalog, settings } from '../planner.ts';
import { DRIVE_CAP_MAX, driveCapWords } from '../public/preferences.ts';
import { phaseSteps } from '../public/progression.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { initialState } from '../public/state.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { settingsChanges } from '../public/app/profile-edit.ts';
import { draftAdvice } from '../public/app/draft-advice.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { browserProfile, dockerProfile, newSaveRequest } from './helpers/editions.ts';
import { driveless, huntedAlternates } from './helpers/drive-cap.ts';
import type {
  CurrentCalculatedPlan,
  Progression,
  SaveExport,
  StageKey,
  StoredCalculatedPlan,
} from '../public/types/index.ts';

const PHASES: StageKey[] = ['1', '2', '3', '4', '5'];
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const REFUSAL = `Give the cap on hard drives as a whole number from 0 to ${DRIVE_CAP_MAX}, or leave it blank for no cap.`;

test('settings keep a whole cap on hard drives from 0 and refuse anything else', () => {
  for (const cap of [0, 1, 3, DRIVE_CAP_MAX])
    assert.equal(settings({ driveCap: cap }).driveCap, cap);
  for (const absent of [undefined, null])
    assert.equal('driveCap' in settings({ driveCap: absent }), false, String(absent));
  assert.equal('driveCap' in settings({}), false, 'absent unless chosen');
  for (const wrong of [-1, 2.5, DRIVE_CAP_MAX + 1, '3', [3], { cap: 3 }, Number.NaN, true])
    assert.throws(
      () => settings({ driveCap: wrong }),
      (error: Error & { status?: number }) => error.status === 400 && error.message === REFUSAL,
      JSON.stringify(wrong),
    );
  // Only the planner sets the set it picked; settings never keep one.
  assert.equal('driveSet' in settings({ driveSet: ['Alternate_SteelRod_C'] }), false);
  assert.equal(driveCapWords(3), 'at most 3 hard-drive alternates');
  assert.equal(driveCapWords(1), 'at most 1 hard-drive alternate');
  assert.equal(driveCapWords(0), 'no hard-drive alternates');
  assert.equal(driveCapWords(undefined), '');
  assert.equal(driveCapWords(2.5), '');
});

// Every alternate, from Phase 3: the plan without the cap counts on 51 hard-drive alternates.
const ALL = { phase: '3', recipes: 'all' };
let freeAll: CurrentCalculatedPlan | undefined;
const free = () => (freeAll ??= calculate(ALL));

test('a cap the plan keeps within changes nothing; one it is over holds every phase to a set', () => {
  const hunted = huntedAlternates(free());
  assert.ok(hunted.size > 10, String(hunted.size));
  for (const driveCap of [hunted.size, hunted.size + 4]) {
    const plan = calculate({ ...ALL, driveCap });
    assert.equal(plan.settings.driveCap, driveCap);
    assert.equal(driveless(plan), driveless(free()), String(driveCap));
  }
  const plan = calculate({ ...ALL, driveCap: 3 });
  const set = huntedAlternates(plan);
  assert.ok(set.size <= 3, [...set].join());
  assert.equal('driveSet' in plan.settings, false, 'the set is never stored');
  for (const phase of PHASES) assert.ok(plan.stages[phase].feasible, phase);
  const warning = plan.warnings.find(entry => entry.startsWith('Cap on hard drives:'));
  assert.match(
    warning!,
    new RegExp(
      `^Cap on hard drives: the plan counts on at most 3 hard-drive alternates, where it would use ${hunted.size} without the cap\\. The search on Phase 5 picked .+, and every phase plans from these\\.$`,
    ),
  );
  assert.equal(
    free().warnings.some(entry => entry.startsWith('Cap on hard drives')),
    false,
  );
  // A cap of 0: the standard recipes only, as a Standard plan without MAM recipes off.
  const none = calculate({ ...ALL, driveCap: 0 });
  assert.equal(huntedAlternates(none).size, 0);
  assert.ok(
    none.warnings.includes(
      `Cap on hard drives: the plan counts on no hard-drive alternates, where it would use ${hunted.size} without the cap. Every phase plans without them.`,
    ),
  );
  // The plan's hard-drive steps list only the set, and the hunt step names the cap.
  const unlocks = PHASES.filter(phase => Number(phase) >= 3).flatMap(phase =>
    phaseSteps(plan, { checks: {} }, data, phase).filter(step =>
      step.id.startsWith('recipe-unlock-'),
    ),
  );
  assert.deepEqual(
    unlocks.map(step => step.id.slice('recipe-unlock-'.length)).sort(),
    [...set].sort(),
  );
  const hunt = PHASES.flatMap(phase => phaseSteps(plan, { checks: {} }, data, phase)).find(step =>
    step.id.startsWith('hard-drives-'),
  );
  assert.match(
    hunt!.body!,
    / Your cap on hard drives holds the whole plan to at most 3 hard-drive alternates beyond the ones you own, and these steps stay within it\.$/,
  );
  const plain = phaseSteps(free(), { checks: {} }, data, '3').find(step =>
    step.id.startsWith('hard-drives-'),
  );
  assert.doesNotMatch(plain!.body!, /cap on hard drives/);
});

test('the alternates the player owns are not counted, and the plan keeps using them', () => {
  const hunted = [...huntedAlternates(free())];
  const owned = hunted.slice(0, 4).sort();
  const plan = calculate({ ...ALL, ownedAlternates: owned, driveCap: 1 });
  assert.ok(huntedAlternates(plan).size <= 1);
  const used = new Set(PHASES.flatMap(phase => (plan.stages[phase].rows || []).map(row => row.id)));
  assert.ok(
    owned.some(id => used.has(id)),
    'the owned alternates stay in the pool beside the set',
  );
  assert.match(
    plan.warnings.find(entry => entry.startsWith('Cap on hard drives:'))!,
    /^Cap on hard drives: the plan counts on at most 1 hard-drive alternate beyond the ones you own, where/,
  );
  // A cap the hunted alternates already keep within, with the owned ones beside it: no change.
  const ownedFree = calculate({ ...ALL, ownedAlternates: owned });
  const within = calculate({
    ...ALL,
    ownedAlternates: owned,
    driveCap: huntedAlternates(ownedFree).size,
  });
  assert.equal(driveless(within), driveless(ownedFree));
});

// Every budget 5% above what the plan without the cap draws: Phases 4 and 5 fit only with
// alternates the cap leaves out.
const tight = () => {
  const need: Record<string, number> = {};
  for (const phase of PHASES)
    for (const [item, rate] of Object.entries(free().stages[phase].raw || {}))
      need[item] = Math.max(need[item] ?? 0, rate);
  return {
    ...ALL,
    limits: Object.fromEntries(
      Object.entries(need).map(([item, rate]) => [item, Math.ceil(rate * 1.05)]),
    ),
  };
};

test('a phase that does not fit from the set is a draft that names the cap, with its lever', () => {
  const base = tight();
  const without = calculate(base);
  for (const phase of PHASES) assert.ok(without.stages[phase].feasible, phase);
  const plan = calculate({ ...base, driveCap: 2 });
  assert.ok(huntedAlternates(plan).size <= 2);
  const drafts = PHASES.filter(phase => !plan.stages[phase].feasible);
  assert.ok(drafts.includes('5'), drafts.join());
  for (const phase of drafts) {
    const stage = plan.stages[phase];
    assert.deepEqual(stage.driveCap, { cap: 2 });
    assert.match(
      stage.reason!,
      / With your cap on hard drives \(at most 2 hard-drive alternates over the whole plan\), this phase may use only these hard-drive alternates: .+; without the cap it fits\.$/,
    );
    const levers = draftAdvice(stage, plan.settings, { phase: Number(phase) }).levers;
    assert.deepEqual(
      levers.find(lever => lever.id === 'driveCap'),
      {
        id: 'driveCap',
        text: 'Raise or clear the cap on hard drives (Goals): the plan may count on at most 2 hard-drive alternates over all its phases, and without the cap this phase fits.',
        step: 3,
        label: 'Change the cap on hard drives in Edit settings →',
      },
    );
    assert.equal(
      levers.find(lever => lever.id === 'alternates'),
      undefined,
    );
  }
  for (const phase of PHASES.filter(phase => plan.stages[phase].feasible))
    assert.equal('driveCap' in plan.stages[phase], false, phase);
  // With no cap, no lever.
  const stage = { ...plan.stages['5'], driveCap: undefined };
  assert.equal(
    draftAdvice(stage, plan.settings, { phase: 5 }).levers.some(lever => lever.id === 'driveCap'),
    false,
  );
});

test('Review names a change of the cap on hard drives, absent as no cap and 0 as a cap', () => {
  const change = (before: object, after: object) =>
    settingsChanges(before, after, []).changes.filter(
      entry => entry.label === 'Cap on hard drives',
    );
  assert.deepEqual(change({}, { driveCap: 3 }), [
    { label: 'Cap on hard drives', before: 'No cap', after: 'At most 3 hard-drive alternates' },
  ]);
  assert.deepEqual(change({ driveCap: 0 }, {}), [
    { label: 'Cap on hard drives', before: 'No hard-drive alternates', after: 'No cap' },
  ]);
  assert.deepEqual(change({ driveCap: 2 }, { driveCap: 2 }), []);
  assert.equal(settingsChanges({}, { driveCap: 2 }, []).others, 0, 'named once');
});

// A full export of one save holding `plan`.
const exported = (plan: StoredCalculatedPlan): SaveExport => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt: '2026-10-26T08:00:00.000Z',
  saves: [
    {
      id: 's1',
      name: 'World',
      activeProfile: 'p1',
      profiles: [{ id: 'p1', name: 'Stored', kind: 'calculated', plan, state: initialState() }],
    },
  ],
});
const before = (
  JSON.parse(
    fs.readFileSync(new URL('./fixtures/plan-before-1065.json', import.meta.url), 'utf8'),
  ) as { plan: StoredCalculatedPlan }
).plan;

test('migration: plans stored before the cap recalculate unchanged, without one', () => {
  assert.equal('driveCap' in before.settings, false);
  assert.equal('driveCap' in settings(before.settings), false);
  assert.equal(JSON.stringify(calculate(before.settings).stages), JSON.stringify(before.stages));
});

test('migration: plans with and without the cap import, export and reload unchanged', async () => {
  const capped: StoredCalculatedPlan = json(calculate({ phase: '4', recipes: 'all', driveCap: 2 }));
  assert.ok(huntedAlternates(capped).size <= 2);
  // A stored capped plan recalculated with its own settings is the plan it was.
  assert.deepEqual(json(calculate(capped.settings).stages), capped.stages);
  const plans = [before, capped];
  for (const plan of plans) {
    const file = exported(plan);
    assert.equal(
      JSON.stringify(validateTransfer(json(file)).saves[0]!.profiles[0]!.plan),
      JSON.stringify(plan),
    );
    assert.equal(
      JSON.stringify((await importableTransfer(json(file))).saves[0]!.profiles[0]!.plan),
      JSON.stringify(plan),
    );
  }
  const records = new Map<string, unknown>();
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
    );
  let api = open();
  for (const plan of plans)
    await api('/api/import-saves', { body: JSON.stringify(exported(plan)) });
  api = open();
  const out = (await api('/api/export-saves')) as SaveExport;
  assert.deepEqual(
    out.saves.map(save => JSON.stringify(save.profiles[0]!.plan)),
    plans.map(plan => JSON.stringify(plan)),
  );
});

test('both editions create the same capped plan, and refuse an invalid cap', async () => {
  const body = newSaveRequest({ phase: '4', recipes: 'all', driveCap: 2 });
  const docker = await dockerProfile(body),
    browser = await browserProfile(body);
  assert.equal(docker.plan!.settings.driveCap, 2);
  assert.equal(JSON.stringify(browser.plan!.settings), JSON.stringify(docker.plan!.settings));
  assert.equal(JSON.stringify(browser.plan!.stages), JSON.stringify(docker.plan!.stages));
  assert.ok(huntedAlternates(docker.plan!).size <= 2);
  for (const driveCap of [-1, 'three', 1.5]) {
    const wrong = newSaveRequest({ phase: '2', driveCap });
    await assert.rejects(dockerProfile(wrong), (error: Error & { status?: number }) => {
      assert.ok(error.message.includes(REFUSAL), error.message);
      return true;
    });
    await assert.rejects(browserProfile(wrong), (error: Error & { status?: number }) => {
      assert.equal(error.message, REFUSAL);
      assert.equal(error.status, 400);
      return true;
    });
  }
});
