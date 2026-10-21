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
import { solve } from '../optimizer.ts';
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

// #1188: the issue's world under every objective (#1180). Under the raw resources objective a
// machine costs only TIE_BUILDING, so the few machines a switch to Cast Screws saves were worth
// less than the Crude Oil their power burns: the solve switched the built Screws, while Review
// said they were kept. Their raw resources and power are already spent too (#1172), so under
// every objective the built lines stay unless a switch saves clearly more than it builds.
const OBJECTIVES: [string, object][] = [
  ['the fewest buildings', {}],
  ['least power', { objective: 'power' }],
  ['least raw resources', { objective: 'raw' }],
  ['raw resources weighted alone', { objective: { buildings: 0, power: 0, raw: 1 } }],
  ['an even mix', { objective: { buildings: 1, power: 1, raw: 1 } }],
];
const SCREW_LINES: BuiltLines = { '4': { [SCREWS]: 35, [ROD]: 38 } };

test('every objective keeps the built Screws rather than switching to Cast Screws', () => {
  for (const [name, objective] of OBJECTIVES) {
    const plain = machinesOf(calculate({ ...TO, ...objective }));
    assert.equal(plain[CAST], 28, `${name}: on its own the solve switches`);
    const kept = calculate({ ...TO, ...objective, builtLines: SCREW_LINES });
    const machines = machinesOf(kept);
    assert.equal(machines[SCREWS], 35, `${name}: the Screws line is kept`);
    assert.equal(machines[CAST], undefined, `${name}: no Cast Screws line`);
    assert.equal(machines[ROD], 38, `${name}: the Iron Rods stay`);
    assert.equal(kept.stages['4'].builtDropped, undefined, name);
    // With only the Screws built, the Iron Rods they take are new machines, as is the power that
    // runs them; the built Screws stay all the same, as under the fewest buildings. Under least
    // power the Screws were switched, since the fuel lines behind their power draw power too.
    const alone = machinesOf(
      calculate({ ...TO, ...objective, builtLines: { '4': { [SCREWS]: 35 } } }),
    );
    assert.equal(alone[SCREWS], 35, `${name}: the Screws line alone is kept`);
    assert.equal(alone[CAST], undefined, `${name}: no Cast Screws beside it`);
  }
});

test('under every objective a switch that saves clearly more still wins', () => {
  // Steel Screws make 260 Screws a minute in one Constructor from 5 Steel Beams: the 35 built
  // Screws and most of the 38 Iron Rods give way to 6 Steel Screws under every objective, as in
  // the plan with nothing built (#1175's change task carries the Constructors).
  const STEEL = 'Recipe_Alternate_Screw_2_C';
  const NEW = { recipes: 'custom', alternateRecipes: [STEEL] };
  for (const [name, objective] of OBJECTIVES) {
    const plain = machinesOf(calculate({ ...NEW, ...objective }));
    const switched = machinesOf(calculate({ ...NEW, ...objective, builtLines: SCREW_LINES }));
    assert.equal(switched[SCREWS], undefined, `${name}: the Screws line is switched`);
    assert.equal(switched[STEEL], plain[STEEL], `${name}: to the Steel Screws of the plain plan`);
    assert.ok(switched[ROD]! < 38, `${name}: and the Iron Rods shrink`);
  }
});

test('the solver gives the shadow price the credit reads, only when asked', () => {
  // Make 10 widgets at 2 each from a line that also draws 3 MW of the 'power' row, whose 5 MW
  // more come from a generator at 0.5 a MW: a MW drawn costs 0.5, so the power row's price is -0.5.
  const model = {
    optimize: 'cost',
    opType: 'min' as const,
    constraints: { widgets: { min: 10 }, power: { max: 0 } },
    variables: {
      line: { cost: 2, widgets: 1, power: 3 },
      generator: { cost: 0.5, power: -1 },
    },
  };
  assert.equal(solve(model).duals, undefined);
  const priced = solve(model, { duals: true });
  assert.ok(Math.abs(priced.duals!.power! + 0.5) < 1e-9, String(priced.duals!.power));
  assert.ok(Math.abs(priced.duals!.widgets! - 3.5) < 1e-9, String(priced.duals!.widgets));
  assert.equal(solve({ ...model, ints: { line: 1 } }, { duals: true }).duals, undefined);
});

test('a plan with nothing built is the plan it was under every objective', () => {
  const bytes = (plan: object) => JSON.stringify({ ...plan, createdAt: undefined });
  for (const [name, objective] of OBJECTIVES) {
    const plain = bytes(calculate({ ...TO, ...objective }));
    assert.equal(bytes(calculate({ ...TO, ...objective, builtLines: {} })), plain, name);
    assert.equal(bytes(calculate(withBuiltLines({ ...TO, ...objective }, undefined))), plain, name);
  }
});

test('a built line the new plan has no use for is not run for nothing', () => {
  // Built far beyond what the plan needs: the line keeps only what it needs.
  const credited = machinesOf(calculate({ builtLines: { '4': { [SCREWS]: 200 } } }));
  assert.equal(credited[SCREWS], machinesOf(base)[SCREWS]);
  // Also where the built line's power is credited (#1188): the credit never pays for running it.
  for (const [name, objective] of OBJECTIVES.slice(1)) {
    const run = machinesOf(calculate({ ...objective, builtLines: { '4': { [SCREWS]: 200 } } }));
    assert.equal(run[SCREWS], machinesOf(calculate(objective))[SCREWS], name);
  }
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
// the built lines as the interface does (builtLinesOf on the profile's context). `to` is what it
// recalculates to and `ticked` the lines ticked: under another objective (#1188), the issue's
// Screws and Iron Rods.
type Request = (
  route: string,
  body?: unknown,
  headers?: Record<string, string>,
) => Promise<unknown>;
interface EditionCase {
  to?: object;
  ticked?: string[];
}
async function checkEdition(
  request: Request,
  reload: () => Promise<void>,
  { to = TO, ticked: tickedIds = [REFINERY, SCREWS] }: EditionCase = {},
) {
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
    settings: withBuiltLines(to, builtLinesOf(untouched.state, untouched.plan, book)),
    carryFrom: first.profileId,
  })) as { profileId: string };
  const plain = await context(scoped(first.saveId, plainProfile.profileId));
  assert.equal(plain.plan!.settings.builtLines, undefined);
  assert.equal(machinesOf(plain.plan!)[CAST], 28);

  for (const id of tickedIds)
    await request('/api/update', { type: 'check', key: key(id), value: true }, own);
  const ticked = await context(own);
  const lines = builtLinesOf(ticked.state, ticked.plan, book)!;
  const standing = machinesOf(ticked.plan!);
  assert.deepEqual(lines, { '4': Object.fromEntries(tickedIds.map(id => [id, standing[id]])) });
  assert.equal(lines['4']![SCREWS], 35);
  const checkKept = (reply: ContextReply) => {
    const machines = machinesOf(reply.plan!);
    assert.equal(machines[SCREWS], 35, 'Screws stay on their recipe');
    assert.equal(machines[CAST], undefined);
    for (const id of tickedIds) {
      assert.equal(machines[id], lines['4']![id], id + ' keeps its machines');
      assert.equal(reply.state.checks[key(id)], true, id + ' stays ticked');
    }
    assert.equal(reply.state.builtMachines, undefined, 'nothing to switch or spare');
    assert.deepEqual(reply.plan!.settings.builtLines, lines);
  };

  // A new profile carried from it.
  const sibling = (await request('/api/profiles', {
    saveId: first.saveId,
    name: 'Cast',
    settings: withBuiltLines(to, lines),
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
      settings: withBuiltLines(to, lines),
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
        settings: { ...to, builtLines: { '4': { [SCREWS]: -1 } } },
        planCreatedAt: now.plan!.createdAt,
      },
      own,
    ),
    /Invalid built production lines\./,
  );
  assert.deepEqual(await context(own), now);
}

async function dockerEdition(edition: EditionCase = {}) {
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
    await checkEdition(
      request,
      async () => {
        await close();
        await listen();
      },
      edition,
    );
  } finally {
    await close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}
test('the Docker server stores the built lines a recalculation counted', () => dockerEdition());

async function browserEdition(edition: EditionCase = {}) {
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
    edition,
  );
}
test('the browser edition stores the built lines a recalculation counted', () => browserEdition());

// #1188: under the raw resources objective the recalculation in place switched the built Screws
// to Cast Screws and cut the Iron Rods from 38 to 15, while Review said they were kept. Both
// editions now keep them, as under the fewest buildings.
const RAW_CASE: EditionCase = { to: { ...TO, objective: 'raw' }, ticked: [SCREWS, ROD] };
test('the Docker server keeps the built lines under the raw resources objective', () =>
  dockerEdition(RAW_CASE));
test('the browser edition keeps the built lines under the raw resources objective', () =>
  browserEdition(RAW_CASE));
