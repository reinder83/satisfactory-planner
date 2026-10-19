// Shrunk, switched and removed production lines (#1175, slice 2 of #1172): when a new profile
// carries progress, or a plan is recalculated in place, a line ticked as built that the new plan
// changed keeps the machines that stand on it in `builtMachines` (state version 19, no new field):
// - shrunk (same row, fewer machines): stays ticked, with its built count, so its step says how
//   many are spare and never to build them again;
// - switched (the plan makes its product with another recipe in that phase): its machines are
//   kept under its own key, unticked, and the successor's step says what to switch and add;
// - removed (nothing in the phase makes its product): kept ticked under its own key, and the
//   build plan lists it as one that can be dismantled or kept.
// Ticks and notes survive, a second carry keeps the facts straight, and both editions (the Docker
// server over workspace.json, the browser edition over IndexedDB) keep it all through a reload, a
// full export and an import, and leave it out of a share.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { calculate, catalog } from '../planner.ts';
import {
  initialState,
  mutate,
  newProfileState,
  recalculatedProfile,
  recipeBook,
  shareState,
  validateState,
} from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import {
  changedIntro,
  changedNote,
  changedTable,
  formerTable,
  phaseChanges,
  spareIntro,
  spareLine,
  spareNote,
  spareTable,
} from '../public/app/built-lines.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import type {
  CalcRow,
  ContextReply,
  SaveExport,
  StoredCalculatedPlan,
  StoredProfile,
} from '../public/types/index.ts';

const book = recipeBook(catalog());

// Synthetic lines on a real plan (the default settings): Phase 4's own rows, given other machine
// counts, and two alternates of its recipes.
const base = calculate({});
const baseRow = (id: string): CalcRow => {
  const row = base.stages['4'].rows!.find(candidate => candidate.id === id);
  assert.ok(row, id + ' is a row of the default plan');
  return structuredClone(row);
};
const sized = (row: CalcRow, machines: number): CalcRow => {
  const scale = machines / row.equivalent;
  const times = (rates: Record<string, number>) =>
    Object.fromEntries(Object.entries(rates).map(([item, rate]) => [item, rate * scale]));
  return {
    ...row,
    inputs: times(row.inputs),
    outputs: times(row.outputs),
    equivalent: machines,
    machines,
    lastClock: 100,
  };
};
const REFINERY = 'Recipe_ResidualFuel_C';
const SCREWS = 'Recipe_Screw_C';
const CAST = 'Recipe_Alternate_Screw_C';
const PLATE = 'Recipe_IronPlate_C';
const COATED = 'Recipe_Alternate_CoatedIronPlate_C';
const TURBO = 'Recipe_Alternate_Turbofuel_C';
const refinery = (machines: number) => sized(baseRow(REFINERY), machines);
const screws = (machines: number) => sized(baseRow(SCREWS), machines);
const plate = (machines: number) => sized(baseRow(PLATE), machines);
const turbo = (machines: number) => sized(baseRow(TURBO), machines);
// Cast Screws: Constructors making Screws from Iron Ingot, named as a custom plan names it.
const cast = (machines: number): CalcRow => ({
  ...screws(machines),
  id: CAST,
  name: 'Alternate: Cast Screws',
  alternate: true,
  inputs: { 'Iron Ingot': 12.5 * machines },
  outputs: { Screws: 50 * machines },
});
// Coated Iron Plate: Assemblers making Iron Plate.
const coated = (machines: number): CalcRow => ({
  ...plate(machines),
  id: COATED,
  name: 'Coated Iron Plate',
  machine: 'Assembler',
  alternate: true,
  inputs: { 'Iron Ingot': 37.5 * machines, Plastic: 7.5 * machines },
  outputs: { 'Iron Plate': 75 * machines },
});
// The default plan with these rows in Phase 4.
const planWith = (rows: CalcRow[]): StoredCalculatedPlan => ({
  ...structuredClone(base),
  stages: { ...structuredClone(base.stages), '4': { ...base.stages['4'], rows } },
});
const key = (id: string) => 'calc-4-' + id;
const rowOf = (plan: StoredCalculatedPlan, id: string) =>
  plan.stages['4'].rows!.find(row => row.id === id)!;

// The source: 6 Refineries, 4 Screw Constructors, 4 Iron Plate Constructors and 3 Turbofuel
// Refineries, all ticked as built, with notes.
const source = () => {
  const state = initialState();
  for (const id of [REFINERY, SCREWS, PLATE, TURBO]) state.checks[key(id)] = true;
  state.notes = {
    global: 'Keep me',
    [key(SCREWS)]: 'By the iron field',
    [key(TURBO)]: 'Three by the oil',
  };
  return {
    plan: planWith([refinery(6), screws(4), plate(4), turbo(3)]),
    state: validateState(state),
  };
};
// The new plan: 5 Refineries, Cast Screws for Screws (5 Constructors), Coated Iron Plate for Iron
// Plate (3 Assemblers), and no Turbofuel.
const changedPlan = () => planWith([refinery(5), cast(5), coated(3)]);

test('a shrunk line stays ticked and keeps its machines: 6 built, 5 needed, 1 spare', () => {
  const from = source();
  const started = newProfileState(changedPlan(), from.state, from.plan, undefined, undefined, book);
  assert.equal(started.state.checks[key(REFINERY)], true, 'still ticked');
  assert.equal(started.state.builtMachines?.[key(REFINERY)], 6, 'all 6 stand');
  const line = spareLine(started.state.builtMachines, started.state.checks, '4', refinery(5))!;
  assert.deepEqual(line, { built: 6, needed: 5, spare: 1, ticked: true });
  assert.equal(
    spareIntro(line, 'Refinery'),
    '6 Refineries built, 5 needed: 1 is spare. Switch it off or dismantle it, or underclock all ' +
      '6 to share the work.',
  );
  assert.doesNotMatch(spareIntro(line, 'Refinery'), /build|add/i, 'never to build them again');
  assert.equal(spareNote(line), '6 built, 1 spare');
  const table = spareTable(line, 'Refinery', 'Residual Fuel', 'The rest.');
  assert.deepEqual(table.columns, ['Machines', 'Built', 'Needed', 'Spare']);
  assert.deepEqual(table.rows, [['Refineries', '6', '5', '1']]);
  assert.equal(table.after, 'The rest.');
  // Unticked by the user, it says when to tick it again; the count stays.
  const unticked = mutate(structuredClone(started.state), {
    type: 'check',
    key: key(REFINERY),
    value: false,
  });
  const open = spareLine(unticked.builtMachines, unticked.checks, '4', refinery(5))!;
  assert.match(spareIntro(open, 'Refinery'), / Tick this step once the 5 needed run\.$/);
  // At the plan's count and ticked, there is nothing to say.
  assert.equal(
    spareLine({ [key(REFINERY)]: 5 }, { [key(REFINERY)]: true }, '4', refinery(5)),
    null,
  );
  // The unchanged plan stores nothing new.
  const same = newProfileState(from.plan, from.state, from.plan, undefined, undefined, book);
  assert.equal(same.state.builtMachines, undefined);
  assert.equal(same.changedCount, 0);
});

test('a line switched to another recipe gets an adjust task naming both recipes', () => {
  const from = source(),
    plan = changedPlan();
  const started = newProfileState(plan, from.state, from.plan, undefined, undefined, book);
  const { state } = started;
  // The Screws line is kept unticked with its 4 Constructors, the Iron Plate line with its 4.
  assert.equal(state.checks[key(SCREWS)], undefined);
  assert.equal(state.builtMachines?.[key(SCREWS)], 4);
  assert.equal(state.checks[key(PLATE)], undefined);
  assert.equal(state.builtMachines?.[key(PLATE)], 4);
  assert.equal(state.checks[key(CAST)], undefined, 'the new line is not ticked');
  const changes = phaseChanges(state.builtMachines, state.checks, '4', plan, book);
  // Same machine: switch the 4 Constructors and add 1.
  const toCast = changes.changed.get(CAST)!;
  assert.deepEqual(toCast, {
    needed: 5,
    standing: 0,
    from: [
      {
        key: key(SCREWS),
        name: 'Screws',
        machine: 'Constructor',
        built: 4,
        switched: 4,
        left: 0,
        sameMachine: true,
      },
    ],
    add: 1,
  });
  assert.equal(
    changedIntro(toCast, rowOf(plan, CAST)),
    'Switch 4 Constructors from Screws to Cast Screws, and add 1. Tick this step once all 5 run ' +
      'Cast Screws.',
  );
  assert.equal(changedNote(toCast), '4 to switch from Screws, 1 to add');
  const table = changedTable(toCast, rowOf(plan, CAST), 'Cast Screws', 'The rest.');
  assert.deepEqual(table.columns, ['Production line', 'Machines', 'Built', 'Needed', 'Change']);
  assert.deepEqual(table.rows, [
    ['Screws', 'Constructors', '4', '0', 'switch 4 to Cast Screws'],
    ['Cast Screws', 'Constructors', '0', '5', 'add 1'],
  ]);
  // Another machine: build the Assemblers, and the Constructors can be dismantled or kept.
  const toCoated = changes.changed.get(COATED)!;
  assert.equal(
    changedIntro(toCoated, rowOf(plan, COATED)),
    'Build 3 Assemblers for Coated Iron Plate. Coated Iron Plate replaces Iron Plate on ' +
      'Assemblers: the 4 Constructors built for Iron Plate can be dismantled or kept. Tick this ' +
      'step once all 3 run Coated Iron Plate.',
  );
  assert.equal(changedNote(toCoated), '3 to add');
  // More built than the new line needs: the rest are spare.
  const few = planWith([refinery(5), cast(3), coated(3)]);
  const fewer = newProfileState(few, from.state, from.plan, undefined, undefined, book).state;
  const three = phaseChanges(fewer.builtMachines, fewer.checks, '4', few, book).changed.get(CAST)!;
  assert.equal(
    changedIntro(three, rowOf(few, CAST)),
    'Switch 3 Constructors from Screws to Cast Screws. The other 1 Constructor on Screws is ' +
      'spare: switch it off or dismantle it. Tick this step once all 3 run Cast Screws.',
  );
  // Once the new line is ticked, the switch is done and nothing is left to say.
  const done = mutate(structuredClone(state), { type: 'check', key: key(CAST), value: true });
  const after = phaseChanges(done.builtMachines, done.checks, '4', plan, book);
  assert.equal(after.changed.has(CAST), false);
  assert.deepEqual(
    after.removed.map(line => line.key),
    [key(TURBO)],
    'the switched line is not "no longer needed"',
  );
});

test('a line the plan no longer has is kept as no longer needed, never dropped', () => {
  const from = source(),
    plan = changedPlan();
  const started = newProfileState(plan, from.state, from.plan, undefined, undefined, book);
  assert.equal(started.state.checks[key(TURBO)], true, 'its tick survives');
  assert.equal(started.state.builtMachines?.[key(TURBO)], 3);
  const { removed } = phaseChanges(
    started.state.builtMachines,
    started.state.checks,
    '4',
    plan,
    book,
  );
  assert.deepEqual(removed, [
    { key: key(TURBO), name: 'Turbofuel', machine: 'Refinery', built: 3 },
  ]);
  const table = formerTable(removed, 'Phase 4');
  assert.equal(
    table.intro,
    'This production line you built under an earlier plan is not in the plan for Phase 4 any ' +
      'more. It can be dismantled or kept: nothing in this plan counts on what it makes.',
  );
  assert.deepEqual(table.columns, ['Production line', 'Machines', 'Built', 'Needed']);
  assert.deepEqual(table.rows, [['Turbofuel', 'Refineries', '3', '0']]);
  // Without the catalog it is still kept as a line no longer needed, named by the row of
  // another phase that has its recipe (Phase 5's Turbofuel).
  const bare = newProfileState(plan, from.state, from.plan, undefined, undefined);
  assert.equal(bare.state.builtMachines?.[key(TURBO)], 3);
  assert.deepEqual(
    phaseChanges(bare.state.builtMachines, bare.state.checks, '4', plan, undefined).removed.map(
      line => line.name,
    ),
    ['Turbofuel'],
  );
  // A phase the new plan does not build has nothing to change: its lines are not kept.
  const noFour = { ...plan, stages: { ...plan.stages, '4': { ...plan.stages['4'], rows: [] } } };
  assert.equal(
    newProfileState(noFour, from.state, from.plan, undefined, undefined, book).state
      .builtMachines?.[key(TURBO)],
    undefined,
  );
});

test('ticks and notes survive, the count says what changed, and the source is only read', () => {
  const from = source(),
    before = structuredClone(from.state);
  const started = newProfileState(changedPlan(), from.state, from.plan, undefined, undefined, book);
  // Shrunk Refineries, Screws and Iron Plate switched, Turbofuel no longer needed.
  assert.equal(started.changedCount, 4);
  assert.equal(started.reviewCount, 0);
  assert.equal(started.grownCount, 0);
  assert.equal(started.state.version, 19, 'builtMachines keeps its version: no new one');
  assert.equal(started.state.notes.global, 'Keep me');
  assert.equal(started.state.notes[key(SCREWS)], 'By the iron field');
  assert.equal(started.state.notes[key(TURBO)], 'Three by the oil');
  assert.deepEqual(from.state, before);
  // Without "Progress on production lines" nothing of the lines is carried.
  const none = newProfileState(changedPlan(), from.state, from.plan, { notes: true }, undefined);
  assert.equal(none.state.builtMachines, undefined);
  assert.equal(none.changedCount, 0);
  // validateState keeps it all, and a share drops it with the rest of the progress.
  assert.deepEqual(validateState(structuredClone(started.state)), started.state);
  assert.equal(shareState(started.state).builtMachines, undefined);
});

test('a recalculation in place keeps the changes, the backup keeps the ticks, and a later carry follows them', () => {
  const from = source();
  const previous: StoredProfile = {
    id: 'p',
    name: 'Before',
    kind: 'calculated',
    plan: from.plan,
    state: from.state,
  };
  const plan = changedPlan();
  const done = recalculatedProfile(
    previous,
    plan,
    'After',
    undefined,
    undefined,
    'b',
    'Before (before edit)',
    undefined,
    book,
  );
  const state = done.profile.state;
  assert.equal(done.changedCount, 4);
  assert.deepEqual(state.builtMachines, {
    [key(REFINERY)]: 6,
    [key(SCREWS)]: 4,
    [key(PLATE)]: 4,
    [key(TURBO)]: 3,
  });
  assert.equal(state.checks[key(REFINERY)], true);
  assert.equal(state.checks[key(TURBO)], true);
  assert.equal(state.notes[key(SCREWS)], 'By the iron field');
  for (const id of [REFINERY, SCREWS, PLATE, TURBO])
    assert.equal(done.backup.state.checks[key(id)], true, 'the backup keeps ' + id);
  assert.equal(done.backup.state.builtMachines, undefined);

  // Recalculated again, nothing ticked since: the switch is still to do, Turbofuel still not
  // needed, and the spare Refineries still stand.
  const again = newProfileState(plan, state, plan, undefined, undefined, book).state;
  assert.deepEqual(again.builtMachines, state.builtMachines);
  assert.equal(again.checks[key(TURBO)], true);
  assert.equal(again.checks[key(SCREWS)], undefined);
  // Cast Screws ticked: the switch is done, so its Constructors stand on Cast Screws, and the
  // next carry no longer offers to switch them.
  const switched = mutate(structuredClone(state), { type: 'check', key: key(CAST), value: true });
  const later = newProfileState(plan, switched, plan, undefined, undefined, book).state;
  assert.equal(later.builtMachines?.[key(SCREWS)], undefined);
  assert.equal(later.checks[key(CAST)], true);
  // Back to the first plan: the lines no longer needed or still to switch are there again, with
  // their machines and unticked. The shrunk line needs its 6 again: all of them stand, but they
  // ran at 5's rates, so it is unticked with its 6 and its step says to tick it once they run.
  const back = newProfileState(from.plan, state, plan, undefined, undefined, book);
  assert.equal(back.state.builtMachines?.[key(TURBO)], 3);
  assert.equal(back.state.checks[key(TURBO)], undefined);
  assert.equal(back.state.builtMachines?.[key(SCREWS)], 4);
  assert.equal(back.state.checks[key(REFINERY)], false);
  assert.equal(back.state.builtMachines?.[key(REFINERY)], 6);
  const all = spareLine(back.state.builtMachines, back.state.checks, '4', refinery(6))!;
  assert.equal(
    spareIntro(all, 'Refinery'),
    'All 6 Refineries this line needs are built. Tick this step once they run.',
  );
});

// Both editions, through their own API, on real plans: the default plan's Phase 4 with Residual
// Fuel (5 Refineries), Screws (35 Constructors) and Turbofuel (4 Refineries) ticked, carried into
// a plan with Cast Screws, which needs 4 Refineries for Residual Fuel, 28 Constructors on Cast
// Screws and no Turbofuel; then recalculated in place, reloaded, exported, imported and shared.
const FROM = {};
const TO = { recipes: 'custom', alternateRecipes: [CAST] };

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
    name: 'Standard',
    settings: FROM,
  })) as { saveId: string; profileId: string };
  const own = scoped(first.saveId, first.profileId);
  const before = await context(own);
  const machines = (reply: ContextReply, id: string) =>
    reply.plan!.stages['4']!.rows!.find(row => row.id === id)?.machines;
  assert.equal(machines(before, REFINERY), 5);
  assert.equal(machines(before, SCREWS), 35);
  assert.equal(machines(before, TURBO), 4);
  for (const id of [REFINERY, SCREWS, TURBO])
    await request('/api/update', { type: 'check', key: key(id), value: true }, own);
  await request('/api/update', { type: 'note', key: key(TURBO), value: 'Four stand' }, own);
  const ticked = await context(own);
  const expected = { [key(REFINERY)]: 5, [key(SCREWS)]: 35, [key(TURBO)]: 4 };
  const checkChanged = (reply: ContextReply) => {
    assert.equal(machines(reply, REFINERY), 4);
    assert.equal(machines(reply, SCREWS), undefined);
    assert.equal(machines(reply, CAST), 28);
    assert.equal(machines(reply, TURBO), undefined);
    assert.deepEqual(reply.state.builtMachines, expected);
    assert.equal(reply.state.checks[key(REFINERY)], true, 'shrunk: still ticked');
    assert.equal(reply.state.checks[key(SCREWS)], undefined, 'to switch: not ticked');
    assert.equal(reply.state.checks[key(TURBO)], true, 'no longer needed: still ticked');
    assert.equal(reply.state.notes[key(TURBO)], 'Four stand');
    assert.equal(reply.state.version, 19);
    // The build plan's view of it, named by the catalog.
    const changes = phaseChanges(
      reply.state.builtMachines,
      reply.state.checks,
      '4',
      reply.plan!,
      book,
    );
    const cast = reply.plan!.stages['4']!.rows!.find(row => row.id === CAST)!;
    assert.match(
      changedIntro(changes.changed.get(CAST)!, cast),
      /^Switch 28 Constructors from Screws to Cast Screws\. The other 7 Constructors on Screws are spare/,
    );
    assert.deepEqual(
      changes.removed.map(line => line.name),
      ['Turbofuel'],
    );
  };

  // A new profile carried from it.
  const sibling = (await request('/api/profiles', {
    saveId: first.saveId,
    name: 'Cast',
    settings: TO,
    carryFrom: first.profileId,
  })) as { profileId: string; changedCount: number; reviewCount: number };
  assert.equal(sibling.changedCount, 3);
  assert.equal(sibling.reviewCount, 0);
  checkChanged(await context(scoped(first.saveId, sibling.profileId)));
  assert.deepEqual((await context(own)).state, ticked.state, 'the source is untouched');

  // Recalculated in place.
  const done = (await request(
    '/api/recalculate',
    {
      name: 'Standard, cast',
      backupName: 'Standard (before edit)',
      settings: TO,
      planCreatedAt: before.plan!.createdAt,
    },
    own,
  )) as { backupId: string; changedCount: number };
  assert.equal(done.changedCount, 3);
  await reload();
  checkChanged(await context(own));
  const backup = await context(scoped(first.saveId, done.backupId));
  assert.deepEqual(backup.state.checks, ticked.state.checks, 'the backup keeps the ticks');
  assert.equal(backup.state.builtMachines, undefined);

  // A full export carries it; the import makes a copy that keeps it; a share leaves it out.
  const exported = (await request('/api/export-saves')) as SaveExport;
  const profileOf = (data: SaveExport, name: string) =>
    data.saves.flatMap(save => save.profiles).filter(profile => profile.name === name);
  const valid = validateTransfer(exported)
    .saves.flatMap(save => save.profiles)
    .find(profile => profile.name === 'Standard, cast');
  assert.deepEqual(valid?.state.builtMachines, expected);
  const share = (await request(
    `/api/export-saves?save=${first.saveId}&profile=${first.profileId}&share=1`,
  )) as SaveExport;
  assert.equal(share.saves[0]!.profiles[0]!.state.builtMachines, undefined);
  assert.deepEqual(share.saves[0]!.profiles[0]!.state.checks, {});
  await request('/api/import-saves', exported);
  await reload();
  const copies = profileOf((await request('/api/export-saves')) as SaveExport, 'Standard, cast');
  assert.equal(copies.length, 2, 'the profile and its imported copy');
  for (const copy of copies) {
    assert.deepEqual(copy.state.builtMachines, expected);
    assert.equal(copy.state.checks[key(TURBO)], true);
  }
}

test('the Docker server keeps shrunk, switched and removed lines', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-1175-'));
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

test('the browser edition keeps shrunk, switched and removed lines', async () => {
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
