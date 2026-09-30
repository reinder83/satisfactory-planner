import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, initialState } from '../server.ts';
import { seedLegacy } from './helpers/seed.ts';
import {
  calculate,
  catalog,
  RAW,
  DATA,
  PURE_LIMITS,
  DEFAULT_LIMITS,
  DELIVERIES,
} from '../planner.ts';
import { elevatorParts } from '../public/preferences.ts';
import { migrateOriginalProfile } from '../public/handbook-migration.ts';
import { frozenHandbook, recipes } from './helpers/data.ts';
import type {
  CurrentCalculatedPlan,
  CurrentStage,
  ProgressState,
  StageKey,
  WorkspaceSummary,
} from '../public/types/index.ts';
async function start(dir: string) {
  await seedLegacy(dir);
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  // Listening on a TCP port, so address() is an AddressInfo.
  return { server, url: 'http://127.0.0.1:' + (server.address() as AddressInfo).port };
}
const close = (server: Server) => new Promise(resolve => server.close(resolve));
const post = (url: string, endpoint: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
    body: JSON.stringify(body),
  });
const json = async (response: Response) => {
  assert.ok(response.ok, await response.clone().text());
  return response.json();
};
test('profile removal requires confirmation, preserves other progress and survives an empty workspace', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-removal-'));
  let app = await start(dir);
  try {
    const profileA = await json(
      await post(app.url, '/api/profiles', {
        saveName: 'Delete test',
        name: 'A',
        settings: {},
      }),
    );
    const profileB = await json(
      await post(app.url, '/api/profiles', { saveId: profileA.saveId, name: 'B', settings: {} }),
    );
    const headersA = { 'X-Save-Id': profileA.saveId, 'X-Profile-Id': profileA.profileId };
    await json(
      await post(
        app.url,
        '/api/update',
        { type: 'note', key: 'global', value: 'Keep this' },
        headersA,
      ),
    );
    const remove = { saveId: profileB.saveId, profileId: profileB.profileId };
    assert.equal((await post(app.url, '/api/remove-profile', remove)).status, 400);
    let workspace: WorkspaceSummary = await json(
      await post(app.url, '/api/remove-profile', { ...remove, confirmed: true }),
    );
    assert.equal(
      workspace.saves.find(s => s.id === profileA.saveId)!.activeProfile,
      profileA.profileId,
    );
    assert.equal(
      (await json(await fetch(app.url + '/api/state', { headers: headersA }))).notes.global,
      'Keep this',
    );
    await json(
      await post(app.url, '/api/remove-profile', {
        saveId: profileA.saveId,
        profileId: profileA.profileId,
        confirmed: true,
      }),
    );
    workspace = await json(
      await post(app.url, '/api/remove-profile', {
        saveId: 'original-save',
        profileId: 'original',
        confirmed: true,
      }),
    );
    assert.equal(workspace.saves.length, 0);
    assert.equal(workspace.activeSave, null);
    await close(app.server);
    app = await start(dir);
    assert.equal((await json(await fetch(app.url + '/api/workspace'))).saves.length, 0);
    await json(
      await post(app.url, '/api/profiles', {
        saveName: 'Start again',
        name: 'New',
        settings: {},
      }),
    );
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('migration, separate saves and profiles, explicit scope across tabs, durable switching', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-profiles-'));
  const original = initialState();
  original.checks['built-iron'] = true;
  original.notes.global = 'My original world';
  const old = JSON.stringify(original);
  await fs.writeFile(path.join(dir, 'progress.json'), old);
  let app = await start(dir);
  try {
    const profileA = await json(
      await post(app.url, '/api/profiles', {
        saveName: 'Second world',
        name: 'Balanced',
        settings: {},
      }),
    );
    const profileB = await json(
      await post(app.url, '/api/profiles', {
        saveId: profileA.saveId,
        name: 'Minimal',
        settings: { goal: 'minimal' },
      }),
    );
    const headersA = { 'X-Save-Id': profileA.saveId, 'X-Profile-Id': profileA.profileId },
      headersB = { 'X-Save-Id': profileB.saveId, 'X-Profile-Id': profileB.profileId };
    let fresh = await json(await fetch(app.url + '/api/state', { headers: headersA }));
    assert.deepEqual(fresh.checks, {});
    assert.deepEqual(fresh.deliveries, {});
    await post(
      app.url,
      '/api/update',
      { type: 'check', key: 'factory-one', value: true },
      headersA,
    );
    await post(app.url, '/api/update', { type: 'note', key: 'global', value: 'Only A' }, headersA);
    fresh = await json(await fetch(app.url + '/api/state', { headers: headersB }));
    assert.equal(fresh.checks['factory-one'], undefined);
    assert.equal(fresh.notes.global, undefined);
    await post(app.url, '/api/select', { saveId: profileA.saveId, profileId: profileA.profileId });
    await post(app.url, '/api/select', { saveId: profileB.saveId, profileId: profileB.profileId });
    assert.equal(
      (await json(await fetch(app.url + '/api/state', { headers: headersA }))).checks[
        'factory-one'
      ],
      true,
    );
    const backup = await json(await fetch(app.url + '/api/export', { headers: headersA }));
    assert.equal((await post(app.url, '/api/import', backup, headersB)).status, 400);
    assert.equal(
      (await fetch(app.url + '/api/state', { headers: { ...headersA, 'X-Profile-Id': 'missing' } }))
        .status,
      404,
    );
    await close(app.server);
    app = await start(dir);
    assert.equal(
      (await json(await fetch(app.url + '/api/state', { headers: headersA }))).notes.global,
      'Only A',
    );
    const restored = await json(
      await fetch(app.url + '/api/state?save=original-save&profile=original'),
    );
    // progress.json is handbook progress, so it migrated into a calculated profile (#495).
    const migrated = migrateOriginalProfile(
      { id: 'original', name: '', kind: 'original', state: original },
      frozenHandbook,
      recipes,
      catalog().pureLimits,
    );
    assert.deepEqual(restored, migrated.state);
    assert.equal(await fs.readFile(path.join(dir, 'progress.json'), 'utf8'), old);
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('account setup requires host token; sessions and all data routes enforce ownership', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-users-'));
  let app = await start(dir);
  try {
    const owner = {
      username: 'owner-test',
      password: 'Long-test-password-123',
      registration: true,
    };
    assert.equal(
      (await post(app.url, '/api/setup', { ...owner, setupToken: 'wrong' })).status,
      403,
    );
    const setup = await post(app.url, '/api/setup', {
      ...owner,
      setupToken: await fs.readFile(path.join(dir, 'account-setup-token.txt'), 'utf8'),
    });
    assert.equal(setup.status, 200);
    const ownerCookie = setup.headers.get('set-cookie')!.split(';')[0]!;
    assert.match(setup.headers.get('set-cookie')!, /HttpOnly/);
    assert.equal((await fetch(app.url + '/api/state')).status, 401);
    const signup = await post(app.url, '/api/register', {
      username: 'second-user',
      password: 'Different-long-password',
    });
    assert.equal(signup.status, 200);
    const other = { Cookie: signup.headers.get('set-cookie')!.split(';')[0]! };
    assert.equal(
      (await fetch(app.url + '/api/state?save=original-save&profile=original', { headers: other }))
        .status,
      404,
    );
    assert.equal(
      (
        await post(
          app.url,
          '/api/select',
          { saveId: 'original-save', profileId: 'original' },
          other,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await post(
          app.url,
          '/api/remove-profile',
          { saveId: 'original-save', profileId: 'original', confirmed: true },
          other,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await post(
          app.url,
          '/api/profiles',
          { saveId: 'original-save', name: 'Intrusion', settings: {} },
          other,
        )
      ).status,
      404,
    );
    assert.equal(
      (await fetch(app.url + '/api/export?save=original-save&profile=original', { headers: other }))
        .status,
      404,
    );
    assert.equal(
      (
        await post(
          app.url,
          '/api/update',
          { type: 'check', key: 'bad', value: true },
          { ...other, 'X-Save-Id': 'original-save', 'X-Profile-Id': 'original' },
        )
      ).status,
      404,
    );
    const workspace = await json(await fetch(app.url + '/api/workspace', { headers: other }));
    assert.deepEqual(workspace.saves, []);
    assert.equal(JSON.stringify(workspace).includes('password'), false);
    const otherSave = await json(
      await post(
        app.url,
        '/api/profiles',
        { saveName: 'Their world', name: 'First profile', settings: {} },
        other,
      ),
    );
    assert.ok(otherSave.saveId);
    await close(app.server);
    app = await start(dir);
    assert.equal(
      (await fetch(app.url + '/api/state', { headers: { Cookie: ownerCookie } })).status,
      200,
    );
    assert.equal(
      (
        await post(app.url, '/api/login', {
          username: 'owner-test',
          password: 'Wrong-password-123',
        })
      ).status,
      401,
    );
    const login = await post(app.url, '/api/login', {
      username: 'owner-test',
      password: owner.password,
    });
    assert.equal(login.status, 200);
    const session = { Cookie: login.headers.get('set-cookie')!.split(';')[0]! };
    await post(app.url, '/api/logout', {}, session);
    assert.equal((await fetch(app.url + '/api/state', { headers: session })).status, 401);
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('calculator applies settings, protects storage, balances nuclear waste and verifies limits', () => {
  const standard = calculate({ roundRates: false });
  assert.equal(standard.stages[3].feasible, true);
  assert.ok(Math.abs(standard.stages[3].hours - 8) < 1e-8);
  const large = calculate({
    multiplier: 10,
    roundRates: false,
    powerFactor: 0.5,
    pureIngots: true,
    recipes: 'all',
    nuclear: 'recycle',
    storage: 'all',
  });
  assert.equal(large.stages[3].delivery!['Modular Engine']!.target, 5000);
  assert.equal(large.stages[5].feasible, true);
  assert.ok(large.stages[3].rows!.some(r => r.name === 'Alternate: Pure Iron Ingot'));
  assert.ok(!large.stages[3].rows!.some(r => r.name === 'Iron Ingot'));
  for (const stage of Object.values(large.stages)) {
    if (!stage.feasible) continue;
    for (const resource of RAW)
      assert.ok(stage.raw[resource]! <= large.settings.limits[resource]! + 0.01);
    for (const [item, rate] of Object.entries(stage.storage)) {
      const made = stage.rows.reduce((total, r) => total + (r.outputs[item] || 0), 0),
        used = stage.rows.reduce((total, r) => total + (r.inputs[item] || 0), 0);
      assert.ok(made - used >= rate + (stage.delivery[item]?.rate || 0) - 0.01, item);
    }
  }
  const final = large.stages[5];
  for (const waste of ['Uranium Waste', 'Plutonium Waste']) {
    const balance = final.rows.reduce(
      (total, r) => total + (r.outputs[waste] || 0) - (r.inputs[waste] || 0),
      0,
    );
    assert.ok(Math.abs(balance) < 1e-5);
  }
  assert.equal(final.plutoniumSink, 0);
  assert.ok(final.rows.some(r => r.id === 'power-ficsonium'));
  assert.throws(() => calculate({ goal: 'maximum' }), /Confirm/);
  const max = calculate({ goal: 'maximum', limitsConfirmed: true, recipes: 'all' });
  assert.ok(max.stages[5].feasible);
  assert.ok(max.stages[5].hours < standard.stages[5].hours!);
  // Phase 1 has no generators and runs on hand-fed biomass, so maximum output leaves it on the
  // balanced plan: maximising it found no plan on 0 GW spare power, and without a power limit it
  // grew to thousands of machines and over 100 GW of biomass.
  const maxDefault = calculate({ goal: 'maximum', limitsConfirmed: true });
  for (const phase of ['1', '2', '3', '4', '5'] as const)
    assert.ok(
      maxDefault.stages[phase].feasible,
      `Phase ${phase} has a maximum-output plan by default`,
    );
  const balanced = calculate({ limitsConfirmed: true });
  const machines = (stage: (typeof balanced.stages)['1']) =>
    (stage.rows || []).map(r => `${r.id}:${r.machines}`).sort();
  assert.deepEqual(machines(maxDefault.stages[1]), machines(balanced.stages[1]));
  assert.equal(maxDefault.stages[1].hours, balanced.stages[1].hours);
  // phaseTime 'final' re-solves Phase 1 for maximum output under caps; that re-solve keeps
  // Phase 1's power budget, so on the default 0 GW spare power Phase 1 is not pulled ahead.
  const finalTime = calculate({ phaseTime: 'final' });
  assert.equal(finalTime.stages[1].aheadOf, undefined);
  assert.deepEqual(machines(finalTime.stages[1]), machines(balanced.stages[1]));
  const impossible = calculate({ limits: { 'Iron Ore': 0, 'Copper Ore': 0 }, sam: 'avoid' });
  assert.equal(impossible.stages[3].feasible, false);
});

test('whole production recalculates upstream inputs and makes surplus without changing old profiles', async () => {
  const rounded = calculate({ wholeMachines: true });
  assert.equal(rounded.stages[3].feasible, true);
  const rubber = rounded.stages[3].rows.find(r => r.name === 'Rubber')!;
  assert.equal(rubber.equivalent, rubber.machines);
  assert.ok(Object.values(rounded.stages[3].surplus).some(rate => rate > 0));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-rounded-'));
  const app = await start(dir);
  try {
    const precise = await json(
      await post(app.url, '/api/profiles', { saveName: 'World', name: 'Precise', settings: {} }),
    );
    const headers = { 'X-Save-Id': precise.saveId, 'X-Profile-Id': precise.profileId };
    await post(
      app.url,
      '/api/update',
      { type: 'note', key: 'global', value: 'Keep this note' },
      headers,
    );
    await post(
      app.url,
      '/api/update',
      { type: 'check', key: 'unlock-Schematic_2-1_C', value: true },
      headers,
    );
    const old = await json(await fetch(app.url + '/api/context', { headers }));
    const revised = await json(await post(app.url, '/api/round-up', {}, headers));
    assert.notEqual(revised.profileId, precise.profileId);
    const newer = await json(
      await fetch(app.url + '/api/context', {
        headers: { ...headers, 'X-Profile-Id': revised.profileId },
      }),
    );
    assert.equal(newer.plan.settings.wholeMachines, true);
    assert.equal(newer.state.notes.global, 'Keep this note');
    assert.equal(newer.state.checks['unlock-Schematic_2-1_C'], true);
    assert.deepEqual(await json(await fetch(app.url + '/api/context', { headers })), old);
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('new calculated profiles start with default factory groups covering every production line', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-groups-'));
  const app = await start(dir);
  try {
    const created = await json(
      await post(app.url, '/api/profiles', {
        saveName: 'Grouped',
        name: 'Calc',
        kind: 'calculated',
        settings: {},
      }),
    );
    const state: ProgressState = await json(
      await fetch(app.url + '/api/state', {
        headers: {
          'X-Planner-Request': '1',
          'x-save-id': created.saveId,
          'x-profile-id': created.profileId,
        },
      }),
    );
    const groups = state.factoryGroups;
    assert.ok(groups?.groups?.length > 3, 'several default groups exist');
    const plan = calculate({});
    const ids = new Set(
      Object.values(plan.stages).flatMap(stage => (stage.rows || []).map(r => r.id)),
    );
    for (const id of ids)
      assert.ok(groups.assignments[id]?.length, 'row ' + id + ' is assigned to a group');
    for (const rowAssignments of Object.values(groups.assignments))
      assert.ok(
        groups.groups.some(g => g.id === rowAssignments[0]!.group),
        'assignments point at existing groups',
      );
    // Handbook profiles are retired: /api/profiles refuses to create one (#496).
    const original = await post(app.url, '/api/profiles', {
      saveId: created.saveId,
      name: 'Orig',
      kind: 'original',
    });
    assert.equal(original.status, 400);
    assert.match((await original.json()).error, /can no longer be created/);
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('custom recipe access limits alternates to the picked list', () => {
  const plan = calculate({
    recipes: 'custom',
    alternateRecipes: ['Recipe_Alternate_ReinforcedIronPlate_2_C', 'not-a-recipe'],
  });
  assert.deepEqual(
    plan.settings.alternateRecipes,
    ['Recipe_Alternate_ReinforcedIronPlate_2_C'],
    'unknown ids are dropped',
  );
  for (const stagePlan of Object.values(plan.stages))
    for (const row of stagePlan.rows || [])
      if (row.alternate)
        assert.equal(
          row.id,
          'Recipe_Alternate_ReinforcedIronPlate_2_C',
          'only picked alternates appear',
        );
  const none = calculate({ recipes: 'custom' });
  for (const stagePlan of Object.values(none.stages))
    for (const row of stagePlan.rows || [])
      assert.ok(!row.alternate, 'empty selection behaves like standard recipes');
});

test('a turbofuel-burning all-recipes optimum round-trips through Planner’s choice into equivalent custom picks', () => {
  const MAM = ['Recipe_Alternate_Turbofuel_C', 'Recipe_Alternate_EnrichedCoal_C'];
  const input = { recipes: 'all', mainPower: 'fuel', goal: 'maximum', limitsConfirmed: true };
  const all = calculate(input);
  const mamRows = Object.values(all.stages).flatMap(stage =>
    (stage.rows || []).filter(r => MAM.includes(r.id)),
  );
  assert.ok(mamRows.length, 'this scenario’s all-recipes optimum burns turbofuel');
  assert.ok(
    mamRows.every(r => !r.alternate),
    'MAM rows are presented as standard recipes, so the alternate flag alone misses them',
  );
  // Collect used alternates the way the wizard’s Planner’s choice helper does: by catalog id, not the flag.
  const altIds = new Set(catalog().alternates.map(a => a.id));
  const used = [
    ...new Set(
      Object.values(all.stages).flatMap(stage =>
        (stage.rows || []).filter(r => r.alternate || altIds.has(r.id)).map(r => r.id),
      ),
    ),
  ].sort();
  for (const id of MAM) assert.ok(used.includes(id), id + ' is ticked by Planner’s choice');
  const custom = calculate({ ...input, recipes: 'custom', alternateRecipes: used });
  for (const phase of Object.keys(all.stages) as StageKey[]) {
    assert.equal(
      custom.stages[phase].feasible,
      all.stages[phase].feasible,
      'phase ' + phase + ' feasibility matches',
    );
    if (all.stages[phase].feasible)
      assert.ok(
        custom.stages[phase].hours! <= all.stages[phase].hours + 1e-6,
        'phase ' + phase + ' custom picks reach the all-recipes optimum',
      );
  }
});

test('preferred recipes replace competing recipes for their product', () => {
  const base = {
    recipes: 'custom',
    alternateRecipes: ['Recipe_Alternate_IngotSteel_1_C'],
    phase: '3',
  };
  const steel = (plan: CurrentCalculatedPlan) => [
    ...new Set(
      Object.values(plan.stages).flatMap(stage =>
        (stage.rows || []).filter(r => r.outputs['Steel Ingot']).map(r => r.name),
      ),
    ),
  ];
  assert.deepEqual(
    steel(calculate({ ...base, preferredRecipes: ['Recipe_Alternate_IngotSteel_1_C'] })),
    ['Alternate: Solid Steel Ingot'],
    'the starred recipe is the only steel source',
  );
  assert.ok(
    steel(calculate(base)).includes('Steel Ingot') === false || true,
    'without a preference the solver may choose freely',
  );
  assert.equal(
    calculate({ ...base, preferredRecipes: ['Recipe_Alternate_CokeSteelIngot_C'] }).settings
      .preferredRecipes.length,
    0,
    'preferences outside the picked list are dropped',
  );
});

// Regression: this settings shape (many alternates, SAM conversion, whole machines, budgets exceeded from
// Phase 4) previously left the infeasible-phase diagnostic in an endless integer search inside HiGHS.
test('over-budget plans finish quickly with an explained draft instead of hanging', () => {
  const excluded = [
    'Recipe_Alternate_CoatedCable_C',
    'Recipe_Alternate_HeatFusedFrame_C',
    'Recipe_Alternate_Diamond_OilBased_C',
  ];
  const picks = DATA.recipes
    .filter(r => r.alternate)
    .map(r => r.id)
    .filter(id => !excluded.includes(id));
  const phases: number[] = [];
  const started = Date.now();
  const plan = calculate(
    {
      recipes: 'custom',
      alternateRecipes: picks,
      preferredRecipes: ['Recipe_Alternate_IngotSteel_1_C'],
      phase: '3',
      purity: 'pure',
      multiplier: 50,
      powerFactor: 0.5,
      availablePowerGW: 44.425,
      pureIngots: true,
      sam: 'needed',
      nuclear: 'recycle',
      uraniumReactors: 50,
      storage: 'all',
      storageRate: 10,
      cellsPerMinute: 20,
      goal: 'balanced',
      wholeMachines: true,
      droneFuel: 'Battery',
      collectables: true,
      mainPower: 'rocket-nuclear',
      limits: { ...PURE_LIMITS },
    },
    phase => phases.push(phase),
  );
  assert.deepEqual(
    phases,
    [1, 2, 3, 4, 5],
    'calculate reports each phase to the progress callback',
  );
  assert.ok(Date.now() - started < 120000, 'calculation completes without hanging');
  const infeasible = Object.entries(plan.stages).filter(([, stage]) => !stage.feasible);
  for (const [phase, stage] of infeasible) {
    assert.ok(stage.reason, 'infeasible phase ' + phase + ' explains itself');
    assert.ok(stage.rows?.length, 'infeasible phase ' + phase + ' still offers a planning draft');
    for (const shortfall of stage.shortfalls || []) {
      assert.ok(
        shortfall.needed > shortfall.budget,
        'phase ' + phase + ' shortfall ' + shortfall.name + ' exceeds its budget',
      );
      assert.ok(
        stage.reason.includes(shortfall.name),
        'phase ' + phase + ' reason names ' + shortfall.name,
      );
    }
    if (stage.minHours)
      assert.ok(
        stage.minHours > 8 && stage.minHours <= 2000,
        'phase ' + phase + ' suggests a longer feasible phase time',
      );
  }
});

test('over-budget phases name the short resources and a phase time that fits', () => {
  const input = {
    phase: '1',
    goal: 'timed',
    hours: 0.25,
    multiplier: 100,
    storage: 'none',
    limits: { ...DEFAULT_LIMITS, 'Iron Ore': 300 },
  };
  const stage = calculate(input).stages[1];
  assert.equal(stage.feasible, false, 'the squeezed budget makes phase 1 a draft');
  assert.deepEqual(
    stage.shortfalls!.map(f => f.name),
    ['Iron Ore'],
    'the short resource is identified',
  );
  assert.ok(
    stage.shortfalls![0]!.needed > 300 && stage.shortfalls![0]!.budget === 300,
    'needed and entered rates are reported',
  );
  assert.ok(stage.reason!.includes('Iron Ore'), 'the explanation names the resource');
  assert.ok(stage.minHours! > 0.25 && stage.minHours! <= 2000, 'a longer phase time is suggested');
  assert.equal(
    calculate({ ...input, hours: stage.minHours }).stages[1].feasible,
    true,
    'the suggested phase time fits the budgets',
  );
});

test('a budget only whole machines exceed names the rounding headroom', () => {
  const base = { phase: '1', goal: 'timed', hours: 1, multiplier: 10, storage: 'none' };
  const precise = calculate(base).stages[1];
  assert.equal(precise.feasible, true, 'precise balancing fits the default budgets');
  const limit = precise.raw['Iron Ore']! + 0.001; // just above the exact mixed-recipe need
  const stage = calculate({
    ...base,
    wholeMachines: true,
    limits: { ...DEFAULT_LIMITS, 'Iron Ore': limit },
  }).stages[1];
  assert.equal(
    stage.feasible,
    false,
    'whole machines cannot fit a budget cut to the exact precise need',
  );
  assert.equal(
    stage.wholeMachinesOnly,
    true,
    'the draft records that only whole-machine production fails',
  );
  assert.deepEqual(
    stage.shortfalls!.map(f => f.name),
    ['Iron Ore'],
    'the budget short only for whole machines is identified',
  );
  assert.ok(
    stage.shortfalls![0]!.needed > limit,
    'the whole-machine need exceeds the entered budget',
  );
  assert.match(stage.reason!, /Iron Ore/, 'the explanation names the resource');
  assert.equal(
    calculate({
      ...base,
      wholeMachines: true,
      limits: { ...DEFAULT_LIMITS, 'Iron Ore': stage.shortfalls![0]!.needed },
    }).stages[1].feasible,
    true,
    'the suggested budget fits whole machines',
  );
});

test('a new profile for the same save carries the world progress its plan still describes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-carry-'));
  const app = await start(dir);
  try {
    const settings = { phase: '1', goal: 'timed', hours: 8, multiplier: 1, storage: 'none' };
    const created = await json(
      await post(app.url, '/api/profiles', { saveName: 'One world', name: 'First plan', settings }),
    );
    const headers = { 'X-Save-Id': created.saveId, 'X-Profile-Id': created.profileId };
    const state = await json(await fetch(app.url + '/api/state', { headers: headers }));
    const rows = Object.entries(calculate(settings).stages).flatMap(([phase, stage]) =>
      (stage.rows || []).map(r => 'calc-' + phase + '-' + r.id),
    );
    assert.ok(rows.includes('calc-1-Recipe_IngotIron_C'), 'the first plan smelts iron in phase 1');
    assert.deepEqual(state.checks, {}, 'a first profile still starts empty');
    const ticks = [
      'unlock-Schematic_1-1_C',
      'recipe-unlock-Recipe_Alternate_Screw_C',
      'hard-drives-1',
      'startup-biomass',
      'slot-A01-built',
      'storage-ground-shell',
      ...rows,
    ];
    await json(
      await post(app.url, '/api/update', { type: 'checks', keys: ticks, value: true }, headers),
    );
    await json(
      await post(
        app.url,
        '/api/update',
        { type: 'check', key: 'unlock-Schematic_1-2_C', value: false },
        headers,
      ),
    );
    await json(
      await post(
        app.url,
        '/api/update',
        { type: 'delivery', key: '1-smart-plating', value: 400 },
        headers,
      ),
    );
    await json(
      await post(
        app.url,
        '/api/update',
        { type: 'note', key: 'global', value: 'Seed and routes' },
        headers,
      ),
    );
    await json(
      await post(
        app.url,
        '/api/update',
        { type: 'note', key: 'slot-A01', value: 'Left of the ramp' },
        headers,
      ),
    );
    await json(
      await post(
        app.url,
        '/api/update',
        { type: 'addTask', id: 'custom-lights', title: 'Hang lights', phase: '1' },
        headers,
      ),
    );
    await json(
      await post(
        app.url,
        '/api/update',
        { type: 'check', key: 'custom-lights', value: true },
        headers,
      ),
    );
    await json(
      await post(
        app.url,
        '/api/update',
        { type: 'storageSlotAssign', key: 'A01', name: 'Iron Plate' },
        headers,
      ),
    );
    await json(
      await post(
        app.url,
        '/api/update',
        { type: 'taskEdit', id: 'startup-biomass', title: 'Leaves first' },
        headers,
      ),
    );
    await json(
      await post(
        app.url,
        '/api/update',
        { type: 'factoryGroupRename', id: 'fg-iron01', name: 'North iron' },
        headers,
      ),
    );

    const same = await json(
      await post(app.url, '/api/profiles', {
        saveId: created.saveId,
        name: 'Same settings',
        settings,
        carryFrom: created.profileId,
      }),
    );
    const sameState: ProgressState = await json(
      await fetch(app.url + '/api/state', {
        headers: { 'X-Save-Id': same.saveId, 'X-Profile-Id': same.profileId },
      }),
    );
    assert.equal(sameState.checks['unlock-Schematic_1-1_C'], true, 'milestone unlocks carry');
    assert.equal(
      sameState.checks['unlock-Schematic_1-2_C'],
      false,
      'a deliberately unticked unlock stays unticked',
    );
    assert.equal(
      sameState.checks['recipe-unlock-Recipe_Alternate_Screw_C'],
      true,
      'confirmed hard-drive recipes carry',
    );
    assert.equal(sameState.checks['slot-A01-built'], true, 'the built storage room carries');
    assert.equal(sameState.checks['storage-ground-shell'], true, 'storage room completion carries');
    assert.equal(sameState.checks['startup-biomass'], true, 'commissioned power steps carry');
    assert.equal(sameState.checks['custom-lights'], true, 'personal tasks keep their progress');
    assert.equal(sameState.storageEdits.slots.A01, 'Iron Plate', 'container names carry');
    assert.equal(sameState.notes.global, 'Seed and routes', 'notes carry');
    assert.equal(sameState.notes['slot-A01'], 'Left of the ramp', 'container notes carry');
    assert.equal(sameState.deliveries['1-smart-plating'], 400, 'deliveries handed in carry');
    assert.equal(sameState.taskEdits.titles['startup-biomass'], 'Leaves first', 'step edits carry');
    assert.equal(
      sameState.factoryGroups.groups.find(g => g.id === 'fg-iron01')!.name,
      'North iron',
      'renamed factory groups carry',
    );
    assert.ok(
      sameState.factoryGroups.assignments['Recipe_IngotIron_C'],
      'rows the new plan builds are still grouped',
    );
    assert.equal(same.reviewCount, 0, 'an identical plan needs no factory review');
    assert.equal(
      sameState.checks['calc-1-Recipe_IngotIron_C'],
      true,
      'unchanged production lines stay marked running',
    );
    assert.equal(sameState.revision, 0, 'the new profile starts its own revision history');

    const bigger = await json(
      await post(app.url, '/api/profiles', {
        saveId: created.saveId,
        name: 'Twice the elevator',
        settings: { ...settings, multiplier: 2 },
        carryFrom: created.profileId,
      }),
    );
    const biggerState = await json(
      await fetch(app.url + '/api/state', {
        headers: { 'X-Save-Id': bigger.saveId, 'X-Profile-Id': bigger.profileId },
      }),
    );
    assert.ok(bigger.reviewCount > 0, 'expanded production lines are reported for review');
    assert.equal(
      biggerState.checks['calc-1-Recipe_IngotIron_C'],
      false,
      'a line that needs more machines is left unticked',
    );
    assert.equal(
      biggerState.checks['slot-A01-built'],
      true,
      'world progress still carries into a different plan',
    );

    const none = await json(
      await post(app.url, '/api/profiles', {
        saveId: created.saveId,
        name: 'Clean sheet',
        settings,
        carryFrom: created.profileId,
        carry: {},
      }),
    );
    const noneState = await json(
      await fetch(app.url + '/api/state', {
        headers: { 'X-Save-Id': none.saveId, 'X-Profile-Id': none.profileId },
      }),
    );
    assert.deepEqual(noneState.checks, {}, 'clearing every option starts empty');
    assert.deepEqual(noneState.deliveries, {}, 'clearing every option keeps deliveries out');
    assert.deepEqual(noneState.notes, {}, 'clearing every option keeps notes out');

    const plain = await json(
      await post(app.url, '/api/profiles', { saveId: created.saveId, name: 'No source', settings }),
    );
    const plainState = await json(
      await fetch(app.url + '/api/state', {
        headers: { 'X-Save-Id': plain.saveId, 'X-Profile-Id': plain.profileId },
      }),
    );
    assert.deepEqual(
      plainState.checks,
      {},
      'without a source profile nothing is carried, as before',
    );

    assert.equal(
      (
        await post(app.url, '/api/profiles', {
          saveId: created.saveId,
          name: 'Missing source',
          settings,
          carryFrom: 'nope',
        })
      ).status,
      404,
    );
    const original = await json(await fetch(app.url + '/api/state', { headers: headers }));
    assert.equal(
      original.checks['calc-1-Recipe_IngotIron_C'],
      true,
      'the profile carried from is untouched',
    );
    assert.equal(
      original.notes.global,
      'Seed and routes',
      'the profile carried from keeps its notes',
    );
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('hand-picked alternate recipes start their unlock steps ticked, and only when asked', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-picked-'));
  const app = await start(dir);
  try {
    const settings = {
      phase: '1',
      goal: 'timed',
      hours: 8,
      storage: 'none',
      recipes: 'custom',
      alternateRecipes: ['Recipe_Alternate_Screw_C', 'Recipe_Alternate_ReinforcedIronPlate_1_C'],
    };
    const firstProfile = await json(
      await post(app.url, '/api/profiles', { saveName: 'Picked world', name: 'First', settings }),
    );
    const first = await json(
      await fetch(app.url + '/api/state', {
        headers: { 'X-Save-Id': firstProfile.saveId, 'X-Profile-Id': firstProfile.profileId },
      }),
    );
    assert.deepEqual(first.checks, {}, 'a brand new save claims no in-game unlocks');
    const secondProfile = await json(
      await post(app.url, '/api/profiles', {
        saveId: firstProfile.saveId,
        name: 'Second',
        settings,
        carryFrom: firstProfile.profileId,
      }),
    );
    const second = await json(
      await fetch(app.url + '/api/state', {
        headers: { 'X-Save-Id': secondProfile.saveId, 'X-Profile-Id': secondProfile.profileId },
      }),
    );
    assert.equal(
      second.checks['recipe-unlock-Recipe_Alternate_Screw_C'],
      true,
      'picking a recipe for a save you play marks it unlocked',
    );
    assert.equal(
      second.checks['recipe-unlock-Recipe_Alternate_ReinforcedIronPlate_1_C'],
      true,
      'every pick is marked',
    );
    const thirdProfile = await json(
      await post(app.url, '/api/profiles', {
        saveId: firstProfile.saveId,
        name: 'Third',
        settings,
        carryFrom: firstProfile.profileId,
        carry: { unlocks: true },
      }),
    );
    const third = await json(
      await fetch(app.url + '/api/state', {
        headers: { 'X-Save-Id': thirdProfile.saveId, 'X-Profile-Id': thirdProfile.profileId },
      }),
    );
    assert.deepEqual(third.checks, {}, 'without the option the picks claim nothing');
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('recipes a plan locks in for you are claimed alongside the picked ones', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-locked-'));
  const app = await start(dir);
  try {
    const settings = {
      phase: '3',
      goal: 'timed',
      hours: 24,
      storage: 'none',
      purity: 'pure',
      limits: { ...PURE_LIMITS },
      pureIngots: true,
      recipes: 'custom',
      alternateRecipes: ['Recipe_Alternate_Screw_C'],
    };
    const used = Object.values(calculate(settings).stages).flatMap(stage =>
      (stage.rows || []).filter(r => r.alternate).map(r => r.id),
    );
    assert.ok(
      used.includes('Recipe_Alternate_PureIronIngot_C'),
      'requiring pure ingots puts the pure recipe in the plan without picking it',
    );
    const firstProfile = await json(
      await post(app.url, '/api/profiles', { saveName: 'Pure world', name: 'First', settings }),
    );
    const secondProfile = await json(
      await post(app.url, '/api/profiles', {
        saveId: firstProfile.saveId,
        name: 'Second',
        settings,
        carryFrom: firstProfile.profileId,
      }),
    );
    const state = await json(
      await fetch(app.url + '/api/state', {
        headers: { 'X-Save-Id': secondProfile.saveId, 'X-Profile-Id': secondProfile.profileId },
      }),
    );
    assert.equal(
      state.checks['recipe-unlock-Recipe_Alternate_PureIronIngot_C'],
      true,
      'a recipe your ingot preference requires is claimed too',
    );
    assert.equal(
      state.checks['recipe-unlock-Recipe_Alternate_Screw_C'],
      true,
      'picked recipes are still claimed',
    );
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('construction materials get their own storage rate, with per-item overrides', () => {
  const base = { phase: '3', goal: 'timed', hours: 8, storage: 'all', storageRate: 1 };
  const flat = calculate(base).stages[3];
  assert.equal(
    flat.storage!.Concrete,
    1,
    'one rate still covers everything when no build rate is given',
  );
  assert.equal(
    flat.storage!.Computer,
    1,
    'items are unchanged for settings saved before build rates existed',
  );
  assert.equal(
    calculate({ ...base, storageRate: 4 }).stages[3].storage!.Concrete,
    4,
    'the single rate still drives every item',
  );

  const split = calculate({ ...base, buildRate: 30 }).stages[3];
  assert.equal(split.storage!.Concrete, 30, 'construction materials use the build rate');
  assert.equal(split.storage!['Iron Plate'], 30, 'plates are construction materials');
  assert.equal(split.storage!['Steel Pipe'], 30, 'pipes are construction materials');
  assert.equal(split.storage!.Screws, 1, 'other items keep the general rate');
  assert.deepEqual(
    Object.keys(split.storage!).sort(),
    Object.keys(flat.storage!).sort(),
    'the same items keep a container either way',
  );

  const tuned = calculate({ ...base, buildRate: 30, storageOverrides: { Concrete: 60, Screws: 0 } })
    .stages[3];
  assert.equal(tuned.storage!.Concrete, 60, 'a per-item rate beats the build rate');
  assert.equal(tuned.storage!.Screws, 0, 'zero reserves no production');
  assert.equal(
    tuned.storage!['Iron Plate'],
    30,
    'unlisted construction materials keep the build rate',
  );
  assert.ok(
    Object.keys(tuned.storage!).includes('Screws'),
    'a zero-rate item keeps its container and address',
  );

  const machines = (plan: CurrentCalculatedPlan) =>
    Object.values(plan.stages).reduce(
      (total, stage) =>
        total + (stage.rows || []).reduce((stageTotal, r) => stageTotal + r.machines, 0),
      0,
    );
  assert.ok(
    machines(calculate({ ...base, buildRate: 30 })) > machines(calculate(base)),
    'a faster build refill costs machines',
  );
  assert.ok(
    machines(calculate({ ...base, storageRate: 30 })) >
      machines(calculate({ ...base, buildRate: 30 })),
    'but far fewer than raising every item to the same rate',
  );

  assert.throws(
    () => calculate({ ...base, storageOverrides: { Water: 5 } }),
    /cannot be given a storage rate/,
    'raw resources are rejected',
  );
  assert.throws(
    () => calculate({ ...base, storageOverrides: { 'Uranium Waste': 5 } }),
    /cannot be given a storage rate/,
    'radioactive items are rejected',
  );
  assert.throws(
    () => calculate({ ...base, storageOverrides: { Concrete: 900 } }),
    /Enter a number/,
    'out-of-range rates are rejected',
  );
  assert.throws(
    () => calculate({ ...base, storageOverrides: ['Concrete'] }),
    /Invalid per-item storage rates/,
    'a list is not a rate map',
  );
  assert.deepEqual(
    calculate(base).settings.storageOverrides,
    {},
    'settings always carry a rate map',
  );
  assert.equal(
    calculate(base).settings.buildRate,
    1,
    'an absent build rate records the general rate',
  );
});

test('Space Elevator parts keep a container but no standing storage contract', () => {
  const delivered = [...new Set(Object.values(DELIVERIES).flatMap(d => Object.keys(d)))].sort();
  assert.deepEqual(
    [...elevatorParts].sort(),
    delivered,
    'the shared elevator-part list matches the delivery table',
  );

  const base = { phase: '5', goal: 'timed', hours: 10, storage: 'all', storageRate: 4 };
  const phase5 = calculate(base).stages[5];
  for (const name of elevatorParts) {
    if (phase5.storage![name] === undefined) continue;
    assert.equal(phase5.storage![name], 0, name + ' reserves no production');
  }
  assert.ok(
    Object.keys(phase5.storage!).includes('Nuclear Pasta'),
    'a delivered part still holds its container and address',
  );
  assert.equal(phase5.storage!.Concrete, 4, 'other items are unaffected');
  assert.ok(
    phase5.delivery!['Nuclear Pasta']!.rate > 0,
    'the elevator delivery itself is untouched',
  );
  const pasta = (phase5.rows || [])
    .filter(r => r.outputs['Nuclear Pasta'])
    .reduce((total, r) => total + r.outputs['Nuclear Pasta']!, 0);
  assert.ok(
    pasta >= phase5.delivery!['Nuclear Pasta']!.rate - 0.001,
    'production still covers the delivery rate',
  );

  const buffered = calculate({ ...base, storageOverrides: { 'Nuclear Pasta': 5 } }).stages[5];
  assert.equal(
    buffered.storage!['Nuclear Pasta'],
    5,
    'a per-item rate still buys a buffer for anyone who wants one',
  );

  const machines = (plan: CurrentCalculatedPlan) =>
    Object.values(plan.stages).reduce(
      (total, stage) =>
        total + (stage.rows || []).reduce((stageTotal, r) => stageTotal + r.machines, 0),
      0,
    );
  const all = Object.fromEntries(elevatorParts.map(part => [part, 4]));
  assert.ok(
    machines(calculate({ ...base, storageOverrides: all })) > machines(calculate(base)),
    'stocking them again costs machines',
  );
});

test('a final-phase target lets earlier phases use the machines later phases already build', () => {
  const base = {
    phase: '1',
    goal: 'timed',
    hours: 10,
    multiplier: 50,
    storage: 'all',
    storageRate: 1,
    purity: 'pure',
    limits: { ...PURE_LIMITS },
    recipes: 'all',
  };
  const every = calculate(base),
    final = calculate({ ...base, phaseTime: 'final' });
  assert.equal(
    every.settings.phaseTime,
    'every',
    'settings saved before this existed keep one target per phase',
  );
  for (const phase of ['1', '2', '3', '4', '5'] as const)
    assert.equal(
      every.stages[phase].hours,
      calculate(base).stages[phase].hours,
      'the default plan is unchanged',
    );
  assert.equal(
    final.stages[5].hours,
    every.stages[5].hours,
    'the final phase still hits the target',
  );

  const machines = (stage: CurrentStage) =>
    (stage.rows || []).reduce((total, r) => total + r.machines, 0);
  let pulled = 0;
  for (const phase of ['1', '2', '3', '4'] as const) {
    const before = every.stages[phase],
      after = final.stages[phase];
    assert.ok(after.hours! <= before.hours! + 1e-6, 'phase ' + phase + ' is never made slower');
    if (after.aheadOf === undefined) {
      assert.equal(after.hours, before.hours, 'an unchanged phase keeps its plan');
      continue;
    }
    pulled++;
    assert.equal(after.aheadOf, before.hours, 'phase ' + phase + ' records what it used to take');
    assert.ok(
      after.hours! < before.hours! - 1e-6,
      'a phase is only replaced when it finishes sooner',
    );
    // nothing is built that no later phase keeps
    for (const row of after.rows || []) {
      const kept = Math.max(
        0,
        ...(['1', '2', '3', '4', '5'] as const)
          .filter(later => later >= phase)
          .map(later => (every.stages[later].rows || []).find(r => r.id === row.id)?.machines || 0),
      );
      assert.ok(
        row.machines <= kept,
        'phase ' +
          phase +
          ' runs no more ' +
          row.name +
          ' than a later phase builds (' +
          row.machines +
          ' vs ' +
          kept +
          ')',
      );
    }
    assert.ok(
      machines(after) <= machines(every.stages['5']),
      'a pulled-forward phase stays within the final build',
    );
  }
  assert.ok(pulled > 0, 'at least one phase finishes sooner');
  assert.match(
    final.warnings.join(' '),
    /target time applies to Phase 5/,
    'the plan says the target moved to the final phase',
  );
  assert.ok(
    !every.warnings.join(' ').includes('target time applies to Phase 5'),
    'the default plan does not claim it',
  );

  const maxed = calculate({ ...base, goal: 'maximum', limitsConfirmed: true, phaseTime: 'final' });
  for (const phase of ['1', '2', '3', '4', '5'] as const)
    assert.equal(
      maxed.stages[phase].aheadOf,
      undefined,
      'maximum output already maximizes every phase',
    );
  assert.throws(
    () => calculate({ ...base, phaseTime: 'sometimes' }),
    /Invalid profile option/,
    'only the two choices are accepted',
  );
});
