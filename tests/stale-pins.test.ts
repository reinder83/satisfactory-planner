// Pins on a recipe the game data no longer has (#1271): a Power Shard pin (`lineClocks`) or a
// somersloop pin (`sloopPins`) stored on a recipe a later game-data update removes (or, for
// somersloops, whose machine can no longer take them) made every recalculation fail with "Invalid
// line clocks." / "Invalid somersloop pins.", and no line's dialog could clear it. Every
// recalculation now leaves such pins out, the notice names them, and a recalculation in place
// drops them from the progress and says so in the new plan's warnings, in both editions. A plan
// without such pins is planned exactly as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { calculate, catalog, DATA, settings } from '../planner.ts';
import { lineClocksChange, lineClocksSettings, wantedClocks } from '../public/app/shard-pins.ts';
import { sloopPinsChange, sloopPinsSettings, wantedPins } from '../public/app/sloop-pins.ts';
import { knownPins, recipeBook, stalePinWarnings } from '../public/state.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import type {
  LineClocks,
  ProgressState,
  SaveExport,
  SloopPins,
  StoredCalculatedPlan,
} from '../public/types/index.ts';

const BASE = {
  phase: '3',
  recipes: 'standard',
  somersloops: 40,
  amplifySloops: 20,
  wholeMachines: true,
  storageFromSurplus: true,
};
const ROD = 'Recipe_IronRod_C';
// A recipe no game data has: as if an update removed it after the pin was saved.
const GONE = 'Recipe_RemovedByAnUpdate_C';
// A recipe the game data has whose machine takes no somersloops.
const PACKAGER = DATA.recipes.find(recipe => recipe.machine === 'Packager' && !recipe.alternate)!;
const book = recipeBook(catalog());
const CLOCKS: LineClocks = { '3': { [ROD]: 250, [GONE]: 200 } };
const SLOOPS: SloopPins = { '3': { [GONE]: 2, [PACKAGER.id]: 2 } };
// The stale somersloop pins in the order they are named: by recipe id.
const STALE_SLOOPS = [GONE, PACKAGER.id].sort();
const nameOf = (id: string) => (id === GONE ? GONE : PACKAGER.name);

test('pins the game data still takes are kept as they are; the others are named', () => {
  const known: LineClocks = { '3': { [ROD]: 250 } };
  assert.equal(knownPins(known, book, 'lineClocks').kept, known, 'the same map');
  assert.deepEqual(knownPins(known, book, 'lineClocks').stale, []);
  assert.deepEqual(knownPins(CLOCKS, book, 'lineClocks'), {
    kept: { '3': { [ROD]: 250 } },
    stale: [['3', GONE]],
  });
  // A Packager recipe exists, so it keeps a Power Shard pin, but takes no somersloops.
  assert.deepEqual(knownPins(SLOOPS, book, 'sloopPins'), {
    kept: {},
    stale: STALE_SLOOPS.map(id => ['3', id]),
  });
  // Without a catalog nothing is dropped for want of one.
  assert.equal(knownPins(CLOCKS, new Map(), 'lineClocks').kept, CLOCKS);
  // Settings without such pins are the same settings, so the plan is the same plan.
  const base = settings(BASE);
  const pins: SloopPins = { '3': { [ROD]: 4 } };
  assert.deepEqual(lineClocksSettings(base, known, book), lineClocksSettings(base, known));
  assert.deepEqual(sloopPinsSettings(base, pins, book), sloopPinsSettings(base, pins));
  // With them, the settings leave them out, and the planner takes them.
  assert.deepEqual(lineClocksSettings(base, CLOCKS, book).lineClocks, known);
  assert.equal('sloopPins' in sloopPinsSettings(base, SLOOPS, book), false);
  assert.throws(() => calculate(lineClocksSettings(base, CLOCKS)), /Invalid line clocks/);
  assert.throws(() => calculate(sloopPinsSettings(base, SLOOPS)), /Invalid somersloop pins/);
});

test('a plan calculated with such a pin: the recalculation’s warning names it by its row', () => {
  // A plan calculated when the game data still had the recipe: its row names it.
  const plan = JSON.parse(JSON.stringify(calculate(settings(BASE)))) as StoredCalculatedPlan;
  plan.settings.lineClocks = { '3': { [GONE]: 250 } };
  const rows = plan.stages['3']!.rows!;
  rows.push({ ...rows.find(row => row.id === ROD)!, id: GONE, name: 'Removed Rod' });
  assert.deepEqual(stalePinWarnings({ state: {}, plan }, book), [
    'This recalculation dropped the Power Shard pin on Removed Rod in Phase 3, because this planner has no such recipe any more.',
  ]);
  // The progress state's pins are the ones asked for once it has them.
  assert.deepEqual(stalePinWarnings({ state: { lineClocks: {} }, plan }, book), []);
  assert.deepEqual(stalePinWarnings({ state: {}, plan }, undefined), [], 'no book, no warning');
});

const NOTICE_CLOCKS =
  'A recalculation drops the Power Shard pin on Recipe_RemovedByAnUpdate_C in Phase 3, because this planner has no such recipe any more.';
const WARNING_CLOCKS =
  'This recalculation dropped the Power Shard pin on Recipe_RemovedByAnUpdate_C in Phase 3, because this planner has no such recipe any more.';
const WARNING_SLOOPS = `This recalculation dropped the somersloop pins on ${STALE_SLOOPS.map(nameOf).join(' in Phase 3 and ')} in Phase 3, because this planner has no such recipe any more, or its machine can no longer take somersloops.`;

// The progress keeps the pins as saved until the user recalculates; then every offer leaves them
// out (as recalculateOffer builds its settings), the recalculation succeeds, the new plan says
// which it dropped, and the progress no longer asks for them, so nothing offers a recalculation
// any more. The kept version keeps them, whole.
async function checkEdition(
  request: (route: string, body?: unknown) => Promise<unknown>,
  reload: () => Promise<void>,
) {
  type Context = { profile: { id: string }; plan: StoredCalculatedPlan; state: ProgressState };
  const context = async () => (await request('/api/context')) as Context;
  await request('/api/profiles', { saveName: 'World', name: 'Stale', settings: BASE });
  await request('/api/update', { type: 'lineClocks', value: CLOCKS });
  await request('/api/update', { type: 'sloopPins', value: SLOOPS });
  await reload();
  const before = await context();
  assert.deepEqual(before.state.lineClocks, CLOCKS, 'saved as asked');
  assert.deepEqual(before.state.sloopPins, SLOOPS);
  // The notice: the Power Shard pin that can still be planned, and the one a recalculation drops.
  const clocks = lineClocksChange(before.plan, before.state, book)!;
  assert.deepEqual(
    clocks.lines.map(line => [line.recipe, line.after]),
    [[ROD, 250]],
  );
  assert.equal(clocks.stale, NOTICE_CLOCKS);
  // Somersloop pins that are all stale offer no recalculation.
  assert.equal(sloopPinsChange(before.plan, before.state, book), null);
  const done = (await request('/api/recalculate', {
    name: 'Stale',
    backupName: 'Stale (before)',
    settings: lineClocksSettings(
      sloopPinsSettings(before.plan.settings, wantedPins(before.plan, before.state), book),
      wantedClocks(before.plan, before.state),
      book,
    ),
    planCreatedAt: before.plan.createdAt,
  })) as { profileId: string; backupId: string };
  assert.equal(done.profileId, before.profile.id, 'recalculated in place');
  await reload();
  const after = await context();
  assert.deepEqual(after.plan.settings.lineClocks, { '3': { [ROD]: 250 } });
  assert.equal('sloopPins' in after.plan.settings, false);
  assert.equal('lineClocks' in after.state, false, 'the progress asks for no stale pin');
  assert.equal('sloopPins' in after.state, false);
  assert.deepEqual(
    after.plan.warnings.filter(warning => warning.startsWith('This recalculation dropped')),
    [WARNING_SLOOPS, WARNING_CLOCKS],
    'never silently',
  );
  assert.equal(lineClocksChange(after.plan, after.state, book), null, 'no offer left');
  assert.equal(sloopPinsChange(after.plan, after.state, book), null);
  const exported = (await request('/api/export-saves')) as SaveExport;
  const backup = exported.saves[0]!.profiles.find(profile => profile.id === done.backupId)!;
  assert.deepEqual(backup.state.lineClocks, CLOCKS, 'the kept version keeps them');
  assert.deepEqual(backup.state.sloopPins, SLOOPS);
}

test('the Docker server recalculates a profile with stale pins and drops them', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'satisfactory-stale-pins-'));
  let server: Awaited<ReturnType<typeof createApp>> | undefined;
  let url = '';
  const listen = async () => {
    server = await createApp({ dataDir: dir, password: '' });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  };
  const close = () => new Promise<void>(resolve => server!.close(() => resolve()));
  const request = async (route: string, body?: unknown) => {
    const res = await fetch(url + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const reply = await res.json();
    assert.ok(res.ok, `${route} ${res.status} ${JSON.stringify(reply)}`);
    return reply;
  };
  await listen();
  try {
    await checkEdition(request, async () => {
      await close();
      await listen();
    });
  } finally {
    await close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition recalculates a profile with stale pins and drops them', async () => {
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
    (route, body) => api(route, body === undefined ? undefined : { body: JSON.stringify(body) }),
    async () => {
      api = open();
    },
  );
});
