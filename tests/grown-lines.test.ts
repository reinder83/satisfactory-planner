// Grown production lines keep their progress (#1174, slice 1 of #1172): when a new profile carries
// progress, or a plan is recalculated in place, a production line ticked as built that now needs
// more machines (same row, more machines) is unticked but keeps the machines that stand, in the
// progress state's `builtMachines` (version 19), so its step reads "5 Refineries built, so add 1"
// instead of the whole line again. An unchanged line stays ticked, a shrunk one keeps today's
// rule (ticked), any other change is unticked for review as before. Old saves load unchanged, and
// both editions (the Docker server over workspace.json, the browser edition over IndexedDB) keep
// the new field through a reload, a full export and an import, and leave it out of a share.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { calculate } from '../planner.ts';
import {
  initialState,
  mutate,
  newProfileState,
  recalculatedProfile,
  roundUpState,
  shareState,
  validateState,
} from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { builtLine, builtShare, builtTable } from '../public/app/built-lines.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { states, version17, version19 } from './types/fixtures.ts';
import type {
  CalcRow,
  Catalog,
  ContextReply,
  SaveExport,
  StoredCalculatedPlan,
  StoredProfile,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
// The settings of the plans both editions calculate below: the default ones build 5 Refineries for
// Phase 4's Residual Fuel line, and a storage rate of 5/min 6.
const FIVE_SETTINGS = {};
const SIX_SETTINGS = { storageRate: 5 };

// Synthetic lines on a real plan (the default settings): Phase 4's own rows, given other
// machine counts. A Refinery line of `machines` Refineries for `equivalent` machine-equivalents
// takes 60 m³/min of Heavy Oil Residue each at 100%.
const base = calculate(FIVE_SETTINGS);
const baseRow = (id: string): CalcRow => {
  const row = base.stages['4'].rows!.find(candidate => candidate.id === id);
  assert.ok(row, id + ' is a row of the default plan');
  return structuredClone(row);
};
const REFINERY = 'Recipe_ResidualFuel_C';
const refinery = (machines: number, equivalent = machines, id = REFINERY): CalcRow => ({
  ...baseRow(REFINERY),
  id,
  inputs: { 'Heavy Oil Residue': 60 * equivalent },
  equivalent,
  machines,
  lastClock: Math.round((equivalent - machines + 1) * 10000) / 100,
});
const SMELTER = 'Recipe_IngotIron_C';
const smelter = (machines: number, equivalent = machines): CalcRow => ({
  ...baseRow(SMELTER),
  inputs: { 'Iron Ore': 30 * equivalent },
  equivalent,
  machines,
});
const PLASTIC = 'Recipe_Plastic_C';
const plastic = (machines: number, oil: number): CalcRow => ({
  ...baseRow(PLASTIC),
  inputs: { 'Crude Oil': oil },
  equivalent: machines,
  machines,
});
// The default plan with these rows in Phase 4.
const planWith = (rows: CalcRow[]): StoredCalculatedPlan => ({
  ...structuredClone(base),
  stages: { ...structuredClone(base.stages), '4': { ...base.stages['4'], rows } },
});
const key = (id: string) => 'calc-4-' + id;

// The source: 5 Refineries, 4 Smelters and 2 Plastic Refineries, all ticked as built, with notes.
const source = () => {
  const state = initialState();
  state.checks = { [key(REFINERY)]: true, [key(SMELTER)]: true, [key(PLASTIC)]: true };
  state.notes = { global: 'Keep me', ['factory-' + REFINERY]: 'Five stand by the oil field' };
  return {
    plan: planWith([refinery(5, 4.6), smelter(4), plastic(2, 60)]),
    state: validateState(state),
  };
};

test('a ticked line that needs more machines keeps its built machines (new profile)', () => {
  const from = source();
  // 5 → 6 Refineries; the Smelters shrink from 4 to 3; the Plastic line keeps its 2 machines but
  // takes more Crude Oil (a clock change), which stays a review case.
  const next = planWith([refinery(6, 5.5), smelter(3), plastic(2, 90)]);
  const started = newProfileState(next, from.state, from.plan, undefined, undefined);
  assert.equal(started.state.checks[key(REFINERY)], false, 'the grown line is unticked');
  assert.deepEqual(
    started.state.builtMachines,
    { [key(REFINERY)]: 5, [key(SMELTER)]: 4 },
    'its 5 Refineries stand, and so do the 4 Smelters of the shrunk line (#1175)',
  );
  assert.equal(started.grownCount, 1);
  assert.equal(started.state.checks[key(SMELTER)], true, 'a shrunk line stays ticked');
  assert.equal(started.state.checks[key(PLASTIC)], false, 'more input alone: left for review');
  assert.equal(started.reviewCount, 1, 'only the changed line is left for review');
  assert.equal(started.state.version, 19);
  // Notes are carried as before.
  assert.equal(started.state.notes.global, 'Keep me');
  assert.equal(started.state.notes['factory-' + REFINERY], 'Five stand by the oil field');
  // The source is only read.
  assert.deepEqual(from.state, source().state);
});

test('an unchanged plan keeps every tick and stores nothing new', () => {
  const from = source();
  const started = newProfileState(from.plan, from.state, from.plan, undefined, undefined);
  for (const id of [REFINERY, SMELTER, PLASTIC]) assert.equal(started.state.checks[key(id)], true);
  assert.equal(started.state.builtMachines, undefined);
  assert.equal(started.grownCount, 0);
  assert.equal(started.reviewCount, 0);
  assert.equal(started.state.version, 3, 'the lowest version the content needs: its factories');
});

test('grown lines follow the carry picks, the lines made on site and a partly built source', () => {
  const from = source(),
    next = planWith([refinery(6, 5.5), smelter(4), plastic(2, 60)]);
  // Without "Progress on production lines" nothing of the lines is carried.
  const none = newProfileState(next, from.state, from.plan, { notes: true }, undefined);
  assert.equal(none.state.checks[key(REFINERY)], undefined);
  assert.equal(none.state.builtMachines, undefined);
  // A line the old plan lacked is not grown: it is left for review, as before.
  const fresh = newProfileState(next, from.state, planWith([smelter(4)]), undefined, undefined);
  assert.equal(fresh.state.checks[key(REFINERY)], false);
  assert.equal(fresh.state.builtMachines, undefined);
  assert.equal(fresh.reviewCount, 2);
  // A central line that a group's own line made on site now splits stays a review case (#876).
  const split = planWith([
    refinery(6, 5.5),
    { ...refinery(1, 1, REFINERY + ':fg-oil1'), onSite: { group: 'fg-oil1', recipe: REFINERY } },
  ]);
  const site = newProfileState(split, from.state, from.plan, undefined, undefined);
  // The Smelter and Plastic lines this plan no longer has are kept as no longer needed (#1175).
  assert.deepEqual(site.state.builtMachines, { [key(SMELTER)]: 4, [key(PLASTIC)]: 2 });
  assert.deepEqual(site.state.onSiteReview, { checks: { [key(REFINERY)]: true } });
  // A line still partly built in the source keeps its count while the plan needs more. Once the
  // plan needs no more than stand, all its machines stand, so it comes out ticked (#1181), with
  // any beyond the plan's kept as spare (#1175); it is never dropped.
  const partly = newProfileState(next, from.state, from.plan, undefined, undefined).state;
  const bigger = planWith([refinery(8, 7.5), smelter(4), plastic(2, 60)]);
  assert.deepEqual(
    newProfileState(bigger, partly, next, undefined, undefined).state.builtMachines,
    {
      [key(REFINERY)]: 5,
    },
  );
  const smaller = planWith([refinery(5), smelter(4), plastic(2, 60)]);
  const back = newProfileState(smaller, partly, next, undefined, undefined).state;
  assert.equal(back.checks[key(REFINERY)], true, 'all 5 stand: ticked');
  assert.equal(back.builtMachines, undefined, 'exactly as many as needed: nothing to say');
  const fewer = planWith([refinery(4), smelter(4), plastic(2, 60)]);
  const spare = newProfileState(fewer, partly, next, undefined, undefined).state;
  assert.equal(spare.checks[key(REFINERY)], true);
  assert.deepEqual(spare.builtMachines, { [key(REFINERY)]: 5 }, 'one of the 5 is spare');
  // Ticked again, all its machines stand: the next growth counts from all of them.
  const ticked = mutate(partly, { type: 'check', key: key(REFINERY), value: true });
  assert.deepEqual(
    newProfileState(bigger, ticked, next, undefined, undefined).state.builtMachines,
    {
      [key(REFINERY)]: 6,
    },
  );
});

test('grown lines recalculated back to the earlier plan come out ticked, never dropped (#1181)', () => {
  // The default plan with every production line of Phases 2-4 ticked.
  const first = calculate({});
  const state = initialState();
  for (const phase of ['2', '3', '4'] as const)
    for (const row of first.stages[phase].rows || [])
      state.checks['calc-' + phase + '-' + row.id] = true;
  const profile = (plan: StoredCalculatedPlan, progress: typeof state): StoredProfile => ({
    id: 'p',
    name: 'World',
    kind: 'calculated',
    plan,
    state: progress,
  });
  // Recalculated in place with a storage rate of 5/min and every alternate: lines grow.
  const bigger = calculate({ storageRate: 5, recipes: 'all' });
  const grown = recalculatedProfile(
    profile(first, validateState(state)),
    bigger,
    'World',
    undefined,
    undefined,
    'b1',
    'World (before)',
  );
  const counted = Object.keys(grown.profile.state.builtMachines || {}).filter(
    check => grown.profile.state.checks[check] === false,
  );
  assert.equal(grown.grownCount, 11, 'the repro of #1181: 11 lines grow');
  assert.equal(counted.length, 11);
  // Recalculated back to the default settings, nothing ticked since: every one of them needs no
  // more machines than stand, so all of them come out ticked.
  const back = recalculatedProfile(
    profile(bigger, grown.profile.state),
    calculate({}),
    'World',
    undefined,
    undefined,
    'b2',
    'World (before, 2)',
  );
  for (const check of counted) {
    assert.equal(back.profile.state.checks[check], true, check + ' is ticked again');
    const row = check.match(/^calc-([1-5])-(.+)$/)!;
    const machines = back.profile.plan.stages[row[1] as '2' | '3' | '4'].rows!.find(
      line => line.id === row[2],
    )!.machines;
    const kept = back.profile.state.builtMachines?.[check];
    // Exactly as many as needed: nothing to keep; more: the spare ones are kept.
    assert.ok(kept === undefined || kept > machines, check + ' keeps only spare machines');
  }
});

test('a recalculation in place keeps the built machines and the backup keeps the ticks', () => {
  const from = source();
  const previous: StoredProfile = {
    id: 'p',
    name: 'Five',
    kind: 'calculated',
    plan: from.plan,
    state: from.state,
  };
  const next = planWith([refinery(6, 5.5), smelter(4), plastic(2, 60)]);
  const done = recalculatedProfile(
    previous,
    next,
    'Six',
    undefined,
    undefined,
    'b',
    'Five (before)',
  );
  assert.equal(done.profile.state.checks[key(REFINERY)], false);
  assert.deepEqual(done.profile.state.builtMachines, { [key(REFINERY)]: 5 });
  assert.equal(done.profile.state.checks[key(SMELTER)], true, 'an unchanged line stays ticked');
  assert.equal(done.grownCount, 1);
  assert.equal(done.reviewCount, 0);
  assert.equal(done.profile.state.notes['factory-' + REFINERY], 'Five stand by the oil field');
  // The previous version is kept whole, ticked, with no built count.
  assert.equal(done.backup.state.checks[key(REFINERY)], true);
  assert.equal(done.backup.state.builtMachines, undefined);
  // Round-up still copies the progress as it is (a whole-machine copy is out of #1174's scope).
  const rounded = roundUpState(done.profile.state, next, next);
  assert.deepEqual(rounded.state.builtMachines, { [key(REFINERY)]: 5 });
});

test('the step reads built, needed and to add, with the extra input the added machines take', () => {
  const row = refinery(6, 5.5);
  const checks = { [key(REFINERY)]: false };
  const line = builtLine({ [key(REFINERY)]: 5 }, checks, '4', row)!;
  assert.deepEqual(line, { built: 5, needed: 6, add: 1 });
  const rate = (_item: string, value: number) => `${Math.round(value * 100) / 100} m³/min`;
  const table = builtTable(line, row, rate, 'Residual Fuel', 'The rest.');
  assert.equal(
    table.intro,
    '5 Refineries built, so add 1, which takes 30 m³/min more Heavy Oil Residue. Tick this step ' +
      'once all 6 stand.',
  );
  assert.deepEqual(table.columns, ['Machines and inputs', 'Built', 'Needed', 'To add']);
  assert.deepEqual(table.rows, [
    ['Refineries', '5', '6', '1'],
    ['Heavy Oil Residue', '300 m³/min', '330 m³/min', '30 m³/min'],
  ]);
  assert.equal(table.after, 'The rest.');
  // The built machines make 5 of the line's 5.5 machine-equivalents.
  assert.equal(builtShare(line, row), 5 / 5.5);
  // Ticked, all of them stand; at or above the plan's count it is no grown line.
  assert.equal(builtLine({ [key(REFINERY)]: 5 }, { [key(REFINERY)]: true }, '4', row), null);
  assert.equal(builtLine({ [key(REFINERY)]: 6 }, checks, '4', row), null);
  assert.equal(builtLine(undefined, checks, '4', row), null);
});

test('builtMachines is version 19, checked, and older releases are told to update', () => {
  for (const [state, version] of states) {
    const clean = validateState(json(state));
    assert.equal(clean.version, version, 'every released state keeps its version');
    assert.deepEqual(clean.checks, state.checks, 'and its ticks');
    assert.deepEqual(clean.notes, state.notes, 'and its notes');
    if (version < 19) assert.equal(clean.builtMachines, undefined);
  }
  assert.deepEqual(validateState(json(version19)).builtMachines, version19.builtMachines);
  // A version-17 state given a built count is marked 19; one without keeps its version.
  const marked = validateState({ ...json(version17), builtMachines: { [key(REFINERY)]: 2 } });
  assert.equal(marked.version, 19);
  assert.equal(validateState({ ...json(version17), builtMachines: {} }).version, 17);
  for (const bad of [
    { [key(REFINERY)]: 0 },
    { [key(REFINERY)]: 1.5 },
    { [key(REFINERY)]: '5' },
    { 'unlock-Schematic_1-1_C': 5 },
    { 'calc-post-x': 5 },
    [],
  ])
    assert.throws(
      () => validateState({ ...json(version19), builtMachines: bad }),
      /Invalid count of built machines/,
    );
  assert.throws(() => validateState({ ...json(version19), version: 27 }), /newer planner version/);
  // A share leaves it out with the rest of the progress.
  assert.equal(shareState(validateState(json(version19))).builtMachines, undefined);
});

test('a state with a Fluid Truck link and built machines is 19, and drops as each goes', () => {
  // version19 holds both: version18's link on Fluid Trucks (#1177) and a built count (#1174).
  const FLUID = 'supply/Crude Oil:fg-plates1';
  assert.equal(version19.factoryGroups.links[FLUID].mode, 'fluidTruck');
  assert.equal(validateState(json(version19)).version, 19);
  // Without the built count, the Fluid Truck link alone needs 18.
  const { builtMachines: _built, ...linkOnly } = json(version19);
  assert.equal(validateState(linkOnly).version, 18);
  assert.equal(validateState({ ...json(version19), builtMachines: {} }).version, 18);
  // Without both, the state needs only what its other content needs: 17 or lower (here 17, for
  // version17's link burning a later fuel).
  const { [FLUID]: _fluid, ...otherLinks } = linkOnly.factoryGroups.links;
  const neither = { ...linkOnly, factoryGroups: { ...linkOnly.factoryGroups, links: otherLinks } };
  const version = validateState(neither).version;
  assert.ok(version <= 17, `version ${version}`);
  assert.equal(version, 17);
});

// Both editions, through their own API: a profile of a real plan with its Residual Fuel line
// ticked at 5 Refineries is carried into a new profile, then recalculated in place, with a plan
// that needs 6; then reloaded, exported, imported and shared, and old saves imported.
const FIVE = FIVE_SETTINGS;
const SIX = SIX_SETTINGS;
const GROWN = key(REFINERY);

type Request = (
  route: string,
  body?: unknown,
  headers?: Record<string, string>,
) => Promise<unknown>;
async function checkEdition(request: Request, reload: () => Promise<void>) {
  const scoped = (saveId: string, profileId: string) => ({
    'X-Save-Id': saveId,
    'X-Profile-Id': profileId,
  });
  const context = async (headers: Record<string, string>) =>
    (await request('/api/context', undefined, headers)) as ContextReply;
  const first = (await request('/api/profiles', {
    saveName: 'World',
    name: 'Five',
    settings: FIVE,
  })) as { saveId: string; profileId: string };
  const own = scoped(first.saveId, first.profileId);
  const before = await context(own);
  const row = before.plan!.stages['4']!.rows!.find(candidate => candidate.id === REFINERY)!;
  assert.equal(row.machines, 5, 'the first plan builds 5 Refineries for Residual Fuel');
  await request('/api/update', { type: 'check', key: GROWN, value: true }, own);
  await request('/api/update', { type: 'note', key: 'global', value: 'Keep me' }, own);
  await request(
    '/api/update',
    { type: 'note', key: 'factory-' + REFINERY, value: 'Five stand' },
    own,
  );
  const ticked = await context(own);

  // "Try another profile" carried from it.
  const sibling = (await request('/api/profiles', {
    saveId: first.saveId,
    name: 'Six',
    settings: SIX,
    carryFrom: first.profileId,
  })) as { profileId: string; grownCount: number; reviewCount: number };
  const carried = await context(scoped(first.saveId, sibling.profileId));
  const six = carried.plan!.stages['4']!.rows!.find(candidate => candidate.id === REFINERY)!;
  assert.equal(six.machines, 6, 'the second plan needs 6');
  assert.equal(sibling.grownCount, 1);
  assert.equal(carried.state.checks[GROWN], false);
  assert.deepEqual(carried.state.builtMachines, { [GROWN]: 5 });
  assert.equal(carried.state.version, 19);
  assert.equal(carried.state.notes['factory-' + REFINERY], 'Five stand');
  assert.deepEqual((await context(own)).state, ticked.state, 'the source is untouched');

  // Recalculated in place.
  const done = (await request(
    '/api/recalculate',
    {
      name: 'Five, grown',
      backupName: 'Five (before edit)',
      settings: SIX,
      planCreatedAt: before.plan!.createdAt,
    },
    own,
  )) as { backupId: string; grownCount: number; reviewCount: number };
  assert.equal(done.grownCount, 1);
  await reload();
  const after = await context(own);
  assert.equal(after.state.checks[GROWN], false);
  assert.deepEqual(after.state.builtMachines, { [GROWN]: 5 });
  assert.equal(after.state.notes.global, 'Keep me');
  assert.equal(after.state.notes['factory-' + REFINERY], 'Five stand');
  const backup = await context(scoped(first.saveId, done.backupId));
  assert.equal(backup.state.checks[GROWN], true, 'the backup keeps the tick');
  assert.equal(backup.state.builtMachines, undefined);
  assert.equal(backup.state.version, ticked.state.version);

  // A full export carries it; the import makes a copy that keeps it.
  const exported = (await request('/api/export-saves')) as SaveExport;
  const profileOf = (data: SaveExport, name: string) =>
    data.saves.flatMap(save => save.profiles).find(profile => profile.name === name)!;
  assert.deepEqual(validateTransfer(exported).saves[0]!.profiles[0]!.state.builtMachines, {
    [GROWN]: 5,
  });
  // A share leaves it out with the rest of the progress.
  const share = (await request(
    `/api/export-saves?save=${first.saveId}&profile=${first.profileId}&share=1`,
  )) as SaveExport;
  assert.equal(share.saves[0]!.profiles[0]!.state.builtMachines, undefined);
  assert.deepEqual(share.saves[0]!.profiles[0]!.state.checks, {});

  // Saves from before: a version-17 and a version-1 profile import exactly as they were.
  const template = profileOf(exported, 'Five, grown');
  const old: SaveExport = {
    format: 'satisfactory-planner-saves',
    version: 1,
    exportedAt: '2026-10-18T10:00:00.000Z',
    saves: [
      {
        id: 'old',
        name: 'Old world',
        activeProfile: 'v17',
        profiles: [
          { ...template, id: 'v17', name: 'Seventeen', state: json(version17) },
          { ...template, id: 'v1', name: 'One', state: json(states[0]![0]) },
        ],
      },
    ],
  };
  await request('/api/import-saves', old);
  await request('/api/import-saves', exported);
  await reload();
  const all = (await request('/api/export-saves')) as SaveExport;
  const seventeen = profileOf(all, 'Seventeen').state;
  assert.equal(seventeen.version, 17);
  assert.deepEqual(seventeen.checks, version17.checks);
  assert.deepEqual(seventeen.notes, version17.notes);
  assert.equal(seventeen.builtMachines, undefined);
  assert.equal(profileOf(all, 'One').state.version, 1);
  const copies = all.saves
    .flatMap(save => save.profiles)
    .filter(profile => profile.name === 'Five, grown');
  assert.equal(copies.length, 2, 'the profile and its imported copy');
  for (const copy of copies) assert.deepEqual(copy.state.builtMachines, { [GROWN]: 5 });

  // Ticking the step says all 6 stand; the built count stays for an untick.
  await request('/api/update', { type: 'check', key: GROWN, value: true }, own);
  const all6 = await context(own);
  assert.equal(all6.state.checks[GROWN], true);
  assert.deepEqual(all6.state.builtMachines, { [GROWN]: 5 });
}

test('the Docker server carries a grown line and keeps its built machines', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-1174-'));
  let server: Awaited<ReturnType<typeof createApp>> | undefined;
  let url = '';
  const listen = async () => {
    server = await createApp({ dataDir: dir, password: '' });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  };
  const close = () => new Promise<void>(resolve => server!.close(() => resolve()));
  const request: Request = async (route, body, headers = {}) => {
    const res = await fetch(url + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(res.ok, route + ' ' + res.status + ' ' + (await res.clone().text()));
    return res.json();
  };
  await listen();
  try {
    await checkEdition(request, async () => {
      await close();
      await listen();
    });
  } finally {
    await close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition carries a grown line and keeps its built machines', async () => {
  const records = new Map<string, unknown>();
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      {} as Catalog,
    );
  let api = open();
  await checkEdition(
    (route, body, headers) =>
      api(route, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(headers ? { headers } : {}),
      }),
    async () => {
      api = open();
    },
  );
});
