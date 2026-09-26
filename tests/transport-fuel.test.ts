// Recalculate with transport fuel (#206, part 3 of #68): the links' vehicle fuel per phase
// (public/app/logistics.ts transportFuel), the planner setting that plans it as extra demand, and
// a new profile revision that carries it while the old profile stays as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { calculate, catalog, settings } from '../planner.ts';
import { createApp } from '../server.ts';
import { transportFuel } from '../public/app/logistics.ts';
import recipes from '../recipes.json' with { type: 'json' };
import { OUTSIDE, groupLinks } from '../public/app/group-links.ts';
import { mutate, newProfileState, validateState } from '../public/state.ts';
import type { ContextReply, FactoryGroups, StoredCalculatedPlan } from '../public/types/index.ts';

// The items that travel by pipe, as flow.ts lists them (it cannot load outside the page).
const FLUIDS = new Set(
  Object.entries(recipes.items)
    .filter(([, i]) => i.fluid)
    .map(([n]) => n),
);
const made = (plan: StoredCalculatedPlan, phase: '3', item: string) =>
  (plan.stages[phase].rows || []).reduce((t, r) => t + (r.outputs[item] || 0), 0);

test('the transport fuel setting is normalised and planned as extra demand where it can be made', () => {
  assert.deepEqual(settings({}).transportFuel, {}, 'plans without it are unchanged');
  assert.deepEqual(
    settings({ transportFuel: { '3': { 'Packaged Fuel': 12, Coal: 0 }, '4': {} } }).transportFuel,
    { '3': { 'Packaged Fuel': 12 } },
    'zero rates and empty phases are dropped',
  );
  for (const transportFuel of [
    [],
    { post: { Coal: 1 } },
    { '3': { 'Iron Plate': 5 } },
    { '3': { Coal: -1 } },
    { '3': 'Coal' },
  ])
    assert.throws(() => settings({ transportFuel }), JSON.stringify(transportFuel));
  const base = calculate({});
  const plan = calculate({
    transportFuel: { '1': { 'Packaged Fuel': 3 }, '3': { 'Packaged Fuel': 12 } },
  });
  assert.deepEqual(plan.stages['3'].transport, { 'Packaged Fuel': 12 });
  assert.ok(made(plan, '3', 'Packaged Fuel') >= 12 - 1e-6, 'the plan makes the fuel');
  assert.equal(made(base, '3', 'Packaged Fuel'), 0);
  // Phase 1 cannot make Packaged Fuel: left out there, and the assumptions say so.
  assert.deepEqual(plan.stages['1'].transport, {});
  assert.ok(plan.warnings.some(w => /Fuel for the vehicles on your factory-group links/.test(w)));
  assert.ok(plan.warnings.some(w => /cannot make Packaged Fuel in Phase 1/.test(w)));
  assert.ok(!base.warnings.some(w => /vehicle/i.test(w)));
  // The fuel shows in "Between groups" as going to the vehicles.
  const groups = validateState({
    ...newProfileState(plan, null, null, undefined, undefined).state,
  }).factoryGroups;
  assert.ok(
    groupLinks(plan.stages['3'], groups).some(
      l => l.to === OUTSIDE.transport && l.items.some(x => x.item === 'Packaged Fuel'),
    ),
  );
});

test("transportFuel adds up each phase's fuelled links from the start phase on", () => {
  const plan = calculate({ phase: '3' });
  let state = newProfileState(plan, null, null, undefined, undefined).state;
  const links = groupLinks(plan.stages['3'], state.factoryGroups).filter(
    l => l.from.startsWith('fg-') && l.to.startsWith('fg-'),
  );
  const [a, b] = links;
  state = mutate(state, {
    type: 'factoryLinkTransport',
    from: a!.from,
    to: a!.to,
    mode: 'truck',
    roundTripMin: 6,
    fuel: 'Packaged Fuel',
  });
  state = mutate(state, {
    type: 'factoryLinkTransport',
    from: b!.from,
    to: b!.to,
    mode: 'train',
    roundTripMin: 6,
  });
  const c = catalog();
  const fuel = transportFuel(plan, state.factoryGroups, c, FLUIDS);
  assert.deepEqual(Object.keys(fuel).sort(), ['3', '4', '5'], 'from the start phase on');
  // Only the truck burns: its trucks × 75 MW × 60 ÷ 750 MJ, rounded up to hundredths.
  assert.deepEqual(Object.keys(fuel['3']!), ['Packaged Fuel']);
  assert.ok(fuel['3']!['Packaged Fuel']! >= 6, JSON.stringify(fuel));
  const none: FactoryGroups = { groups: state.factoryGroups.groups, assignments: {} };
  assert.deepEqual(transportFuel(plan, none, c, FLUIDS), {});
});

test('a revision with transport fuel carries it and the progress, and the old profile is untouched', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-transport-'));
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const post = async (endpoint: string, body: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(url + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
      body: JSON.stringify(body),
    });
    assert.ok(r.ok, await r.clone().text());
    return r.json();
  };
  const context = async (h: Record<string, string>): Promise<ContextReply> =>
    (await fetch(url + '/api/context', { headers: h })).json();
  try {
    const a = await post('/api/profiles', { saveName: 'Trucks', name: 'Base', settings: {} });
    const ah = { 'X-Save-Id': a.saveId, 'X-Profile-Id': a.profileId };
    await post('/api/update', { type: 'check', key: 'unlock-Schematic_1-1_C', value: true }, ah);
    const before = await context(ah);
    const b = await post('/api/profiles', {
      saveId: a.saveId,
      name: 'Base · transport fuel',
      settings: { ...before.plan!.settings, transportFuel: { '3': { 'Packaged Fuel': 8 } } },
      carryFrom: a.profileId,
    });
    const next = await context({ 'X-Save-Id': b.saveId, 'X-Profile-Id': b.profileId });
    assert.deepEqual(next.plan!.settings.transportFuel, { '3': { 'Packaged Fuel': 8 } });
    assert.deepEqual(next.plan!.stages['3'].transport, { 'Packaged Fuel': 8 });
    assert.equal(next.state.checks['unlock-Schematic_1-1_C'], true, 'progress carried');
    const after = await context(ah);
    assert.deepEqual(after.plan, before.plan, 'the previous profile is untouched');
    assert.deepEqual(after.state, before.state);
  } finally {
    await new Promise(r => server.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
