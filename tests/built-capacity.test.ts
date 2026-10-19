// Built-aware solving (#1176, slice 3 of #1172): a recalculation that carries progress on
// production lines sends the lines that stand in the profile it carries from (builtLinesOf in
// public/state/carry.ts) as `settings.builtLines`, and the solve counts them as existing capacity
// (addBuiltLines in planner/model.ts): what they make is credited, their ore and power stay in the
// budgets, and the solve keeps and extends them rather than switching them for a few buildings.
// The somersloops stay on a built amplified line. A plan without the field, and every plan
// stored before it, calculates exactly as before. Both editions store the field as part of the
// plan's settings, through a reload, an export and an import.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { calculate, catalog, settings } from '../planner.ts';
import { builtLinesOf, initialState, recipeBook } from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
// The settings as the interface sends them (withBuiltLines in public/app/built-capacity.ts).
const withBuiltLines = (settings: object, lines: BuiltLines | undefined) =>
  lines ? { ...settings, builtLines: lines } : settings;
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import type {
  BuiltLines,
  CalcRow,
  ContextReply,
  SaveExport,
  StoredCalculatedPlan,
} from '../public/types/index.ts';

const book = recipeBook(catalog());
const REFINERY = 'Recipe_ResidualFuel_C';
const SCREWS = 'Recipe_Screw_C';
const CAST = 'Recipe_Alternate_Screw_C';
const ROD = 'Recipe_IronRod_C';
const RIP = 'Recipe_IronPlateReinforced_C';
const key = (id: string, phase = '4') => `calc-${phase}-${id}`;

// The default plan, and the same world recalculated with Cast Screws allowed: on its own, that
// solve switches the 35 Constructors on Screws to 28 on Cast Screws and drops most Iron Rods.
const FROM = {};
const TO = { recipes: 'custom', alternateRecipes: [CAST] };
const machinesOf = (plan: Pick<StoredCalculatedPlan, 'stages'>, phase = '4') =>
  Object.fromEntries(
    (plan.stages[phase as '4']?.rows || []).map((row: CalcRow) => [row.id, row.machines]),
  );
// The machines a plan adds to what stands: per line, beyond its built count.
const added = (machines: Record<string, number>, built: Record<string, number>) =>
  Object.entries(machines).reduce(
    (sum, [id, count]) => sum + Math.max(0, count - (built[id] ?? 0)),
    0,
  );

const base = calculate(FROM);
// Every Phase 4 line of the default plan ticked as built.
const allTicked = Object.fromEntries(
  (base.stages['4'].rows || []).map(row => [key(row.id), true] as [string, boolean]),
);
const builtAll = builtLinesOf({ checks: allTicked }, base, book)!;

test('the lines that stand become the planner’s built lines, with partly built ones', () => {
  assert.equal(builtLinesOf(initialState(), base, book), undefined, 'nothing ticked: none');
  const lines = builtLinesOf(
    {
      checks: { [key(SCREWS)]: true, [key(REFINERY)]: false },
      builtMachines: { [key(REFINERY)]: 3, [key(SCREWS)]: 40, [key('Recipe_Gone_C', '3')]: 2 },
    },
    base,
    book,
  );
  assert.deepEqual(lines, {
    '3': { Recipe_Gone_C: 2 },
    '4': { [REFINERY]: 3, [SCREWS]: 40 },
  });
  assert.deepEqual(Object.keys(builtAll), ['4']);
  assert.equal(builtAll['4']![SCREWS], 35);
  // The settings keep them, sorted, and refuse anything that is not a whole count of a row.
  const kept = settings({ builtLines: { '4': { b: 2, a: 1 } } }).builtLines!;
  assert.deepEqual(Object.keys(kept['4']!), ['a', 'b']);
  assert.equal(settings({ builtLines: {} }).builtLines, undefined);
  assert.equal(settings({ builtLines: { '4': {} } }).builtLines, undefined);
  for (const bad of [
    [],
    { '6': { a: 1 } },
    { '4': { a: 0 } },
    { '4': { a: 1.5 } },
    { '4': { a: 100001 } },
    { '4': { 'a b': 1 } },
    { '4': [1] },
  ])
    assert.throws(() => settings({ builtLines: bad }), /Invalid built production lines\./);
});

test('a plan with nothing built calculates exactly as before', () => {
  // Byte for byte, but for the time it was made.
  const bytes = (plan: object) => JSON.stringify({ ...plan, createdAt: undefined });
  const plain = calculate(TO);
  assert.equal(bytes(calculate({ ...TO, builtLines: {} })), bytes(plain));
  assert.equal(bytes(calculate(withBuiltLines(TO, undefined))), bytes(plain));
  assert.equal(plain.settings.builtLines, undefined);
  assert.equal(bytes(calculate({ builtLines: undefined })), bytes(base));
});

test('a recalculation keeps and extends the built lines instead of switching them', () => {
  const plain = machinesOf(calculate(TO));
  const credited = calculate({ ...TO, builtLines: builtAll });
  const kept = machinesOf(credited);
  // Without the credit the solve switches Screws to Cast Screws (#1175's change task).
  assert.equal(plain[SCREWS], undefined);
  assert.equal(plain[CAST], 28);
  // With it the 35 Constructors stay on Screws, with their Iron Rods, and no Cast Screws line.
  assert.equal(kept[SCREWS], 35, 'same recipe, at least the built count');
  assert.equal(kept[CAST], undefined);
  assert.ok(kept[ROD]! >= builtAll['4']![ROD]!, 'the Iron Rod line stays too');
  for (const [id, count] of Object.entries(builtAll['4']!))
    if (kept[id] !== undefined) assert.ok(kept[id]! >= Math.min(count, kept[id]!));
  // What they make is credited: far fewer new machines than the plan without the credit.
  const built = builtAll['4']!;
  assert.ok(
    added(kept, built) < added(plain, built) * 0.75,
    `${added(kept, built)} new machines with the built lines, ${added(plain, built)} without`,
  );
  assert.deepEqual(credited.settings.builtLines, builtAll, 'the plan keeps what it counted');
  assert.equal(credited.stages['4'].builtDropped, undefined);
});

test('a built line the new plan has no use for is not run for nothing', () => {
  // Built far beyond what the plan needs: the line keeps only what it needs.
  const credited = machinesOf(calculate({ builtLines: { '4': { [SCREWS]: 200 } } }));
  assert.equal(credited[SCREWS], machinesOf(base)[SCREWS]);
});

test('the somersloops stay on the built amplified line', () => {
  const W = { wholeMachines: true, storageFromSurplus: true, somersloops: 40, amplifySloops: 20 };
  const first = calculate(W);
  const ticks = Object.fromEntries(
    (first.stages['4'].rows || []).map(row => [key(row.id), true] as [string, boolean]),
  );
  const built: BuiltLines = builtLinesOf({ checks: ticks }, first, book)!;
  assert.equal(built['4']!['amp:' + RIP], 2, 'Reinforced Iron Plate is amplified in Phase 4');
  const NEW = { ...W, ...TO, storageRate: 3 };
  const plain = machinesOf(calculate(NEW));
  const kept = machinesOf(calculate({ ...NEW, builtLines: built }));
  assert.equal(plain['amp:' + RIP], undefined, 'on its own the solve moves them');
  assert.equal(kept['amp:' + RIP], 2, 'with the built lines they stay');
  assert.equal(kept[SCREWS], built['4']![SCREWS]);
});

// Both editions, through their own API: the default plan's Phase 4 with Residual Fuel and Screws
// ticked, recalculated in place (and into a new profile carried from it) with Cast Screws, sending
// the built lines as the interface does (builtLinesOf on the profile's context).
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
  // Nothing ticked: a new profile carried from it is the plain plan.
  const untouched = await context(own);
  assert.equal(builtLinesOf(untouched.state, untouched.plan, book), undefined);
  const plainProfile = (await request('/api/profiles', {
    saveId: first.saveId,
    name: 'Plain',
    settings: withBuiltLines(TO, builtLinesOf(untouched.state, untouched.plan, book)),
    carryFrom: first.profileId,
  })) as { profileId: string };
  const plain = await context(scoped(first.saveId, plainProfile.profileId));
  assert.equal(plain.plan!.settings.builtLines, undefined);
  assert.equal(machinesOf(plain.plan!)[CAST], 28);

  for (const id of [REFINERY, SCREWS])
    await request('/api/update', { type: 'check', key: key(id), value: true }, own);
  const ticked = await context(own);
  const lines = builtLinesOf(ticked.state, ticked.plan, book)!;
  assert.deepEqual(lines, { '4': { [REFINERY]: 5, [SCREWS]: 35 } });
  const checkKept = (reply: ContextReply) => {
    const machines = machinesOf(reply.plan!);
    assert.equal(machines[SCREWS], 35, 'Screws stay on their recipe');
    assert.equal(machines[CAST], undefined);
    assert.equal(machines[REFINERY], 5);
    assert.equal(reply.state.checks[key(SCREWS)], true, 'and stay ticked');
    assert.equal(reply.state.checks[key(REFINERY)], true);
    assert.equal(reply.state.builtMachines, undefined, 'nothing to switch or spare');
    assert.deepEqual(reply.plan!.settings.builtLines, lines);
  };

  // A new profile carried from it.
  const sibling = (await request('/api/profiles', {
    saveId: first.saveId,
    name: 'Cast',
    settings: withBuiltLines(TO, lines),
    carryFrom: first.profileId,
  })) as { profileId: string; changedCount: number; reviewCount: number };
  assert.equal(sibling.changedCount, 0);
  assert.equal(sibling.reviewCount, 0);
  checkKept(await context(scoped(first.saveId, sibling.profileId)));
  assert.deepEqual((await context(own)).state, ticked.state, 'the source is untouched');

  // Recalculated in place.
  const done = (await request(
    '/api/recalculate',
    {
      name: 'Standard, cast',
      backupName: 'Standard (before edit)',
      settings: withBuiltLines(TO, lines),
      planCreatedAt: ticked.plan!.createdAt,
    },
    own,
  )) as { backupId: string; changedCount: number };
  assert.equal(done.changedCount, 0);
  await reload();
  checkKept(await context(own));
  const backup = await context(scoped(first.saveId, done.backupId));
  assert.deepEqual(backup.plan!.stages, ticked.plan!.stages, 'the backup keeps its numbers');
  assert.equal(backup.plan!.settings.builtLines, undefined);

  // A full export carries the plan's built lines, and the import makes a copy that keeps them.
  const exported = (await request('/api/export-saves')) as SaveExport;
  const named = (data: SaveExport, name: string) =>
    data.saves.flatMap(save => save.profiles).filter(profile => profile.name === name);
  const valid = validateTransfer(exported)
    .saves.flatMap(save => save.profiles)
    .find(profile => profile.name === 'Standard, cast');
  assert.deepEqual((valid?.plan as StoredCalculatedPlan | undefined)?.settings.builtLines, lines);
  await request('/api/import-saves', exported);
  await reload();
  const copies = named((await request('/api/export-saves')) as SaveExport, 'Standard, cast');
  assert.equal(copies.length, 2, 'the profile and its imported copy');
  for (const copy of copies)
    assert.deepEqual((copy.plan as StoredCalculatedPlan).settings.builtLines, lines);
  // A malformed field is refused, and nothing changes.
  const now = await context(own);
  await assert.rejects(
    request(
      '/api/recalculate',
      {
        name: 'Bad',
        backupName: 'Bad (before edit)',
        settings: { ...TO, builtLines: { '4': { [SCREWS]: -1 } } },
        planCreatedAt: now.plan!.createdAt,
      },
      own,
    ),
    /Invalid built production lines\./,
  );
  assert.deepEqual(await context(own), now);
}

test('the Docker server stores the built lines a recalculation counted', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-1176-'));
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
    if (!res.ok) throw new Error(route + ' ' + res.status + ' ' + (await res.text()));
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

test('the browser edition stores the built lines a recalculation counted', async () => {
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
