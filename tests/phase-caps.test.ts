// The caps per phase (#1221, slice 8 of #1079): settings.phaseCaps, at most `buildings` buildings
// and at most `mw` MW per phase. Every phase is planned without them first; only a phase whose
// plan is over one, as the plan counts them, is planned again with them in its model (holdToCaps
// in planner/calculate.ts, addPhaseCaps in planner/model.ts). A phase that cannot keep within a
// cap is a draft whose reason names the cap and what the phase needs, never more than its plan
// without the cap (capReason in planner/draft.ts; tests/phase-caps-property.test.ts checks both
// over many settings). The caps belong to the plan snapshot, like the objective: absent without one,
// so such a plan, and every plan stored before them, calculates, loads, imports and exports exactly
// as before, in both editions.
import './helpers/en-us-numbers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { calculate, catalog, settings } from '../planner.ts';
import { draftStage } from '../planner/draft.ts';
import type { Solved } from '../planner/types.ts';
import { PHASE_CAP_LIMITS, phaseCapAmount, phaseCapWords } from '../public/preferences.ts';
import { initialState, validateState } from '../public/state.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { loadWorkspace } from '../server/persistence.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { settingsChanges } from '../public/app/profile-edit.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { browserProfile, dockerProfile, newSaveRequest } from './helpers/editions.ts';
import type {
  CurrentCalculatedPlan,
  SaveExport,
  StoredCalculatedPlan,
  StoredStage,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
// A plan without the time it was made, which is all that differs between two calculations.
const timeless = (plan: CurrentCalculatedPlan | StoredCalculatedPlan) =>
  JSON.stringify({ ...plan, createdAt: '' });
const REFUSAL =
  'Give the caps per phase as whole numbers: buildings from 1 to 100,000, MW from 1 to 10,000,000.';
// The fixed case: every alternate from Phase 3, at exact clocks. Phase 3 plans 52 buildings and
// 921 MW without caps.
const CASE = { phase: '3', recipes: 'all' } as const;
const buildingsOf = (stage: StoredStage) =>
  (stage.rows || []).reduce((sum, row) => sum + row.machines, 0);
const needOf = (stage: StoredStage) => stage.grid!.needMW;

test('settings keep whole caps from 1, in a fixed order, leave out none, and refuse any other value', () => {
  assert.equal('phaseCaps' in settings({}), false, 'absent unless set');
  assert.equal('phaseCaps' in settings({ phaseCaps: {} }), false, 'no cap: absent');
  assert.deepEqual(settings({ phaseCaps: { mw: 250 } }).phaseCaps, { mw: 250 });
  assert.equal(
    JSON.stringify(settings({ phaseCaps: { mw: 250, buildings: 120 } }).phaseCaps),
    '{"buildings":120,"mw":250}',
  );
  assert.deepEqual(
    settings({ phaseCaps: { buildings: PHASE_CAP_LIMITS.buildings, mw: PHASE_CAP_LIMITS.mw } })
      .phaseCaps,
    { buildings: 100000, mw: 10000000 },
  );
  for (const wrong of [
    null,
    0,
    '250',
    [250],
    { mw: 0 },
    { mw: -1 },
    { mw: 2.5 },
    { mw: '250' },
    { mw: Number.NaN },
    { mw: Infinity },
    { mw: 10000001 },
    { buildings: 100001 },
    { buildings: null },
    { mw: 250, drives: 3 },
  ])
    assert.throws(
      () => settings({ phaseCaps: wrong }),
      (error: Error & { status?: number }) => error.status === 400 && error.message === REFUSAL,
      JSON.stringify(wrong),
    );
});

test('the caps in words', () => {
  assert.equal(phaseCapWords(undefined), '');
  assert.equal(phaseCapWords({}), '');
  assert.equal(phaseCapWords({ mw: 2500 }), 'at most 2,500 MW per phase');
  assert.equal(
    phaseCapWords({ buildings: 120, mw: 250 }),
    'at most 120 buildings and 250 MW per phase',
  );
  assert.equal(phaseCapAmount('buildings', 1), '1 building');
});

test('without caps every plan is the plan it was, byte for byte', () => {
  for (const base of [CASE, { ...CASE, wholeMachines: true, storageFromSurplus: true }]) {
    const plain = calculate(base);
    for (const absent of [undefined, {}]) {
      const again = calculate({ ...base, phaseCaps: absent });
      assert.equal('phaseCaps' in again.settings, false);
      assert.equal(timeless(again), timeless(plain));
    }
  }
});

test('a cap that binds and still fits: the phase keeps within it, by other means', () => {
  const plain = calculate(CASE);
  assert.equal(buildingsOf(plain.stages['3']), 52);
  assert.ok(needOf(plain.stages['3']) > 900);
  // At most 900 MW: Phase 3 picks lines that draw less, with a few more buildings.
  const power = calculate({ ...CASE, phaseCaps: { mw: 900 } });
  const three = power.stages['3'];
  assert.equal(three.feasible, true);
  assert.ok(needOf(three) <= 900, String(needOf(three)));
  assert.ok(buildingsOf(three) > 52, 'it pays in buildings');
  assert.deepEqual(Object.keys(three.delivery!), Object.keys(plain.stages['3'].delivery!));
  // The earlier phases need less than the cap, so it changes nothing there.
  for (const phase of ['1', '2'] as const)
    assert.equal(JSON.stringify(power.stages[phase]), JSON.stringify(plain.stages[phase]));
  // At most 50 buildings at exact clocks: the cap counts each line's last, underclocked machine
  // as a building, as the plan does, so Phase 3 runs fewer lines rather than fewer machine-
  // equivalents.
  const fewer = calculate({ ...CASE, phaseCaps: { buildings: 50 } }).stages['3'];
  assert.equal(fewer.feasible, true);
  assert.ok(buildingsOf(fewer) <= 50, String(buildingsOf(fewer)));
});

test('a cap that the phase cannot keep: its draft names the cap and what the phase needs', () => {
  const plain = calculate(CASE);
  const plan = calculate({ ...CASE, phaseCaps: { mw: 700 } });
  const three = plan.stages['3'];
  assert.equal(three.feasible, false);
  // The model counts power in each line's linear share, so its least power is no lower bound on
  // what the plan counts: the draft gives the plan's own need without the cap, rounded down.
  assert.equal(Math.floor(needOf(plain.stages['3']) * 10) / 10, 920.5);
  assert.deepEqual(three.capShortfalls, [{ name: 'mw', needed: 920.5, cap: 700 }]);
  assert.equal(three.minHours, 10.5);
  assert.equal(
    three.reason,
    "Without the cap, this phase's plan needs 920.5 MW; the cap is 700 MW. The planner found no plan within the cap. Raise the cap (Goals), or give the phase more time: it may fit within the cap from about 10 h 30 min for this phase.",
  );
  assert.equal(three.shortfalls, undefined, 'no budget runs short');
  // The draft still shows what the goal needs, without the cap.
  assert.ok(three.rows!.length > 0);
  // With the cap raised to that need, the phase is its plan without the cap.
  const raised = calculate({ ...CASE, phaseCaps: { mw: 921 } }).stages['3'];
  assert.equal(JSON.stringify(raised), JSON.stringify(plain.stages['3']));
  // A cap on buildings is named in buildings. Without amplification the least machine-
  // equivalents is a lower bound on the buildings, so that one says "at least".
  const built = calculate({ ...CASE, phaseCaps: { buildings: 50, mw: 900 } }).stages['4'];
  assert.equal(built.feasible, false);
  assert.equal(buildingsOf(plain.stages['4']), 138);
  assert.deepEqual(built.capShortfalls, [
    { name: 'buildings', needed: 102, cap: 50 },
    { name: 'mw', needed: 4141.4, cap: 900 },
  ]);
  assert.equal(
    built.reason,
    "This phase needs at least 102 buildings; the cap is 50 buildings. Without the caps, this phase's plan needs 4,141.4 MW; the cap is 900 MW. The planner found no plan within the caps. Raise the caps (Goals).",
  );
});

test('a cap only whole machines break says so, and keeps the whole-machine option', () => {
  const three = calculate({ ...CASE, wholeMachines: true, phaseCaps: { buildings: 100 } }).stages[
    '3'
  ];
  assert.equal(three.feasible, false);
  assert.equal(three.wholeMachinesOnly, true);
  assert.deepEqual(three.capShortfalls, [{ name: 'buildings', needed: 104, cap: 100 }]);
  assert.equal(
    three.reason,
    "Without the cap, this phase's plan needs 104 buildings; the cap is 100 buildings. The planner found no plan within the cap. At exact clocks this phase's plan keeps within the cap, with 52 buildings and 920.5 MW: turn off whole-machine production for this profile, or raise the cap (Goals).",
  );
});

test('a search within a cap that stops at its limit says so, and claims no need', () => {
  // Every alternate at exact clocks, at most 263 buildings: Phase 5 plans 272 without the cap, and
  // a whole-number search within it can stop at its limit (CAP_SEARCH_MS in
  // planner/calculate.ts). Where it stops depends on the machine's speed, so the draft is made
  // from a stopped result directly.
  const free = calculate(CASE).stages['5'] as Solved;
  assert.equal(buildingsOf(free), 272);
  const five = draftStage(
    settings({ ...CASE, phaseCaps: { buildings: 263 } }),
    5,
    { feasible: false, solverStatus: 'Time limit reached' },
    undefined,
    free,
  );
  assert.equal(five.feasible, false);
  assert.deepEqual(five.capShortfalls, [{ name: 'buildings', needed: 272, cap: 263 }]);
  assert.equal(
    five.reason,
    "Without the cap, this phase's plan needs 272 buildings; the cap is 263 buildings. The search for a plan within the cap stopped at its limit before it found one, so whether one exists has not been checked. Raise the cap (Goals).",
  );
});

test('storage-only lines keep within the caps: storage then takes only the surplus', () => {
  const base = { phase: '1', wholeMachines: true, storageFromSurplus: true } as const;
  const open = calculate(base).stages['1'],
    capped = calculate({ ...base, phaseCaps: { buildings: 20 } }).stages['1'];
  const stock = (stage: StoredStage) => (stage.rows || []).filter(row => row.id.endsWith(':stock'));
  assert.ok(stock(open).length > 0 && buildingsOf(open) > 20, 'the lines take it over the cap');
  assert.equal(capped.feasible, true);
  assert.equal(stock(capped).length, 0);
  assert.ok(buildingsOf(capped) <= 20);
  assert.deepEqual(capped.storageAsked, open.storageAsked, 'storage still asks what it asked');
  assert.ok(
    Object.values(capped.storage!).some(rate => rate === 0),
    'and gets less',
  );
});

test('Review names a change of the caps, absent as none', () => {
  const change = (before: object, after: object) =>
    settingsChanges(before, after, []).changes.filter(entry => entry.label === 'Caps per phase');
  assert.deepEqual(change({}, { phaseCaps: { mw: 250 } }), [
    { label: 'Caps per phase', before: 'None', after: 'At most 250 MW per phase' },
  ]);
  assert.deepEqual(change({ phaseCaps: { buildings: 120, mw: 250 } }, {}), [
    {
      label: 'Caps per phase',
      before: 'At most 120 buildings and 250 MW per phase',
      after: 'None',
    },
  ]);
  assert.deepEqual(change({ phaseCaps: { mw: 250 } }, { phaseCaps: { mw: 250 } }), []);
  assert.equal(settingsChanges({}, { phaseCaps: { mw: 250 } }, []).others, 0, 'named once');
});

// A full export of one save holding `plan`.
const exported = (plan: StoredCalculatedPlan): SaveExport => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt: '2026-10-23T08:00:00.000Z',
  saves: [
    {
      id: 's1',
      name: 'World',
      activeProfile: 'p1',
      profiles: [{ id: 'p1', name: 'Stored', kind: 'calculated', plan, state: initialState() }],
    },
  ],
});
const fixture = (name: string): StoredCalculatedPlan => {
  const file = JSON.parse(
    fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'),
  ) as { plan?: StoredCalculatedPlan } & StoredCalculatedPlan;
  return file.plan ?? file;
};
const before = fixture('plan-before-1065.json');
const cappedPlan = (): StoredCalculatedPlan =>
  json(calculate({ ...CASE, phaseCaps: { buildings: 120, mw: 700 } }));

test('migration: plans stored before the caps recalculate unchanged, without a cap', () => {
  for (const plan of [before, fixture('calculated-plan-2026-09-12.json')]) {
    assert.equal('phaseCaps' in plan.settings, false);
    assert.equal('phaseCaps' in settings(plan.settings), false);
  }
  assert.equal(JSON.stringify(calculate(before.settings).stages), JSON.stringify(before.stages));
});

test('migration: plans with and without caps load, import and export unchanged (Docker)', async () => {
  for (const plan of [before, cappedPlan()]) {
    const file = exported(plan);
    const checked = validateTransfer(json(file)).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(checked), JSON.stringify(plan));
    const imported = (await importableTransfer(json(file))).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(imported), JSON.stringify(plan));
    const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-caps-'));
    try {
      const workspace = await loadWorkspace(dataDir, validateState);
      workspace.saves.push({
        id: 's1',
        name: 'World',
        userId: 'owner',
        activeProfile: 'p1',
        profiles: [{ id: 'p1', name: 'Stored', kind: 'calculated', plan, state: initialState() }],
      });
      await fsp.writeFile(path.join(dataDir, 'workspace.json'), JSON.stringify(workspace));
      const loaded = await loadWorkspace(dataDir, validateState);
      assert.equal(JSON.stringify(loaded.saves[0]!.profiles[0]!.plan), JSON.stringify(plan));
    } finally {
      await fsp.rm(dataDir, { recursive: true, force: true });
    }
  }
});

// The browser edition over a fake IndexedDB that keeps `records` between opens.
const browserApi = (records: Map<string, unknown>) =>
  createBrowserApi(
    openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
      throw Error('not needed');
    }),
    calculate,
    catalog(),
  );

test('migration: the browser edition keeps the plans unchanged across a reload', async () => {
  const records = new Map<string, unknown>();
  const plans = [before, cappedPlan()];
  let api = browserApi(records);
  for (const plan of plans)
    await api('/api/import-saves', { body: JSON.stringify(exported(plan)) });
  api = browserApi(records);
  const out = (await api('/api/export-saves')) as SaveExport;
  assert.deepEqual(
    out.saves.map(save => JSON.stringify(save.profiles[0]!.plan)),
    plans.map(plan => JSON.stringify(plan)),
  );
});

// The Docker server's answer to Create profile with `body`: its status and message.
async function dockerRefusal(body: object): Promise<{ status: number; text: string }> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-caps-'));
  const server: Server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    const reply = await fetch(url + '/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      body: JSON.stringify(body),
    });
    return { status: reply.status, text: await reply.text() };
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test('both editions create the same plan from the same request, and refuse invalid caps', async () => {
  const body = newSaveRequest({ ...CASE, phaseCaps: { mw: 700 } });
  const docker = await dockerProfile(body),
    browser = await browserProfile(body);
  assert.deepEqual(docker.plan!.settings.phaseCaps, { mw: 700 });
  assert.equal(JSON.stringify(browser.plan!.settings), JSON.stringify(docker.plan!.settings));
  assert.equal(JSON.stringify(browser.plan!.stages), JSON.stringify(docker.plan!.stages));
  assert.deepEqual(docker.plan!.stages['3'].capShortfalls, [
    { name: 'mw', needed: 920.5, cap: 700 },
  ]);
  for (const phaseCaps of [{ mw: 0 }, { buildings: 1.5 }, 'none']) {
    const wrong = newSaveRequest({ phase: '2', phaseCaps });
    const refused = await dockerRefusal(wrong);
    assert.equal(refused.status, 400, JSON.stringify(phaseCaps));
    assert.ok(refused.text.includes(REFUSAL), refused.text);
    await assert.rejects(browserProfile(wrong), (error: Error & { status?: number }) => {
      assert.equal(error.message, REFUSAL);
      assert.equal(error.status, 400);
      return true;
    });
  }
});
