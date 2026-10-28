// Power Shard pins per production line (#1239, slice 2): the progress state's `lineClocks` (state
// version 26) saves a clock above 100% per line, which only a recalculation the user starts plans
// (settings.lineClocks, slice 1 in planner/clocks.ts). Like somersloop pins (tests/sloop-pins.test.ts):
// every released format loads unchanged without the field, a pin is never changed silently (the
// plan's warnings, the dialog note and ADA name a clock a phase could not keep), the recalculation
// offers and Edit settings carry it, a recalculation in place keeps a pin it was not calculated with
// (keepAsked), and a plan without pins calculates exactly as before. The progress side covers both
// editions: the Docker server (createApp, workspace.json) and the browser edition
// (createBrowserApi over openBrowserStore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { calculate, catalog, DATA, settings } from '../planner.ts';
import {
  clockable,
  shardPinNote,
  droppedClockNames,
  lineClocksChange,
  lineClocksSettings,
  sameClocks,
  wantedClocks,
  withClock,
} from '../public/app/shard-pins.ts';
import { settingsChanges } from '../public/app/profile-edit.ts';
import { adaRemarks } from '../public/ada.ts';
import { gameShards } from '../public/shards.ts';
import { finalPhaseWarning } from '../planner/adjustments.ts';
import { phaseSteps } from '../public/progression.ts';
import { checkBase, mutate, newProfileState, shareState, validateState } from '../public/state.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { states, version1, version24, version25, version26 } from './types/fixtures.ts';
import type {
  LineClocks,
  ProgressState,
  Progression,
  SaveExport,
  StoredCalculatedPlan,
  WorkspaceSummary,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
// A Phase 3 plan on whole machines, as tests/line-clocks.test.ts plans it.
const BASE = { phase: '3', recipes: 'standard', wholeMachines: true, storageFromSurplus: true };
const ROD = 'Recipe_IronRod_C';
const PINS: LineClocks = { '3': { [ROD]: 250 } };
let plainCache: StoredCalculatedPlan | undefined;
const plain = () => (plainCache ??= json(calculate(BASE)) as StoredCalculatedPlan);
let pinnedCache: StoredCalculatedPlan | undefined;
const pinned = () =>
  (pinnedCache ??= json(
    calculate(lineClocksSettings(settings(BASE), PINS)),
  ) as StoredCalculatedPlan);

test('the pins are state version 26; every released format loads unchanged without them', () => {
  for (const [state, version] of states) {
    const clean = validateState(json(state));
    assert.equal(clean.version, version);
    if (version < 26) assert.equal('lineClocks' in clean, false, `version ${version}`);
  }
  const clean = validateState(json(version26));
  assert.equal(clean.version, 26);
  assert.deepEqual(clean.lineClocks, version26.lineClocks);
  // From version 25 (#1240) and 24 (#1235): the pins come on top, everything else as it was.
  for (const older of [version25, version24, version1]) {
    const before = validateState(json(older));
    const upgraded = validateState(json({ ...older, lineClocks: PINS }));
    assert.equal(upgraded.version, 26);
    assert.deepEqual(
      { ...upgraded, version: before.version, lineClocks: undefined },
      {
        ...before,
        lineClocks: undefined,
      },
    );
  }
  // An empty map is still a choice: it asks for no clocks where the plan has some.
  assert.equal(validateState(json({ ...version25, lineClocks: {} })).version, 26);
  // Repeated loads change nothing.
  assert.deepEqual(validateState(json(clean)), clean);
  for (const bad of [
    [],
    { post: { [ROD]: 150 } },
    { '3': [] },
    { '3': { ['amp:' + ROD]: 150 } },
    { '3': { [ROD + ':fg-abcd']: 150 } },
    { '3': { [ROD]: 100 } },
    { '3': { [ROD]: 250.5 } },
    { '3': { [ROD]: 150.00001 } },
    { '3': { [ROD]: '150' } },
    { '3': { 'bad key': 150 } },
  ])
    assert.throws(
      () => validateState(json({ ...version25, lineClocks: bad })),
      /Invalid line clocks/,
      JSON.stringify(bad),
    );
  assert.throws(() => validateState({ ...json(clean), version: 29 }), /newer planner version/);
  // The update saves the whole map; null forgets it and the state goes back to its version.
  const asked = mutate(json(version25), {
    type: 'lineClocks',
    value: { '4': { b: 200, a: 150.5 } },
  });
  assert.deepEqual(asked.lineClocks, { '4': { a: 150.5, b: 200 } });
  assert.equal(asked.version, 26);
  const forgotten = mutate(json(asked), { type: 'lineClocks', value: null });
  assert.equal('lineClocks' in forgotten, false);
  assert.equal(forgotten.version, 25);
  assert.deepEqual(forgotten, validateState(json(version25)));
  assert.throws(
    () => mutate(json(version24), { type: 'lineClocks', value: { '3': { a: 300 } } }),
    /Invalid line clocks/,
  );
  // It sends a whole map, so a tab that has not seen another's change is refused.
  const update = { type: 'lineClocks', value: {} };
  assert.throws(() => checkBase({ ...clean, revision: 3 }, update, '2'), /changed in another tab/);
  assert.doesNotThrow(() => checkBase({ ...clean, revision: 3 }, update, '3'));
});

test('a new profile starts without the pins asked for; a share and a transfer keep them', () => {
  const source = validateState(json(version26));
  // A recalculation freezes the pins in the new plan's settings, so its state needs none.
  const carried = newProfileState(null, json(source), null, { planEdits: true }, undefined).state;
  assert.equal('lineClocks' in carried, false);
  assert.deepEqual(shareState(json(source)).lineClocks, version26.lineClocks);
});

test('a plan without pins is the same plan; a pin plans the line clocked', () => {
  // No pins asked for leaves the settings and the plan exactly as they were.
  const base = settings(BASE);
  assert.deepEqual(lineClocksSettings(base, {}), base);
  assert.equal(
    JSON.stringify({ ...calculate(lineClocksSettings(base, {})), createdAt: '' }),
    JSON.stringify({ ...plain(), createdAt: '' }),
  );
  assert.ok(
    !plain().warnings.some(warning => /Power Shard pin|pinned with Power Shards/.test(warning)),
  );
  // A pin of 3 shards (250%): every machine of the line at 250%, fewer of them.
  const rod = pinned().stages['3']!.rows!.find(row => row.id === ROD)!;
  const before = plain().stages['3']!.rows!.find(row => row.id === ROD)!;
  assert.equal(rod.clock, 250);
  assert.equal(rod.shards, rod.machines * 3);
  assert.ok(rod.machines < before.machines, `${rod.machines} < ${before.machines}`);
  assert.ok(
    pinned().warnings.some(warning =>
      warning.startsWith(
        `One production line runs at the clock you pinned with Power Shards: Iron Rod in Phase 3 (250%, ${rod.shards} Power Shards).`,
      ),
    ),
  );
});

test('a pin the plan cannot keep is reported, never silent', () => {
  // Phase 1 without "I can overclock": the MAM research is not planned yet.
  const early = json(
    calculate({ ...BASE, phase: '1', lineClocks: { '1': { [ROD]: 200 } } }),
  ) as StoredCalculatedPlan;
  assert.deepEqual(early.stages['1']!.lineClocksDropped, [
    { recipe: ROD, clock: 200, reason: 'research' },
  ]);
  assert.ok(
    early.warnings.some(warning =>
      warning.startsWith(
        'Phase 1 could not keep the Power Shards pinned on Iron Rod (200%): machines take Power Shards only once the MAM research Overclock Production is done',
      ),
    ),
  );
  assert.deepEqual(droppedClockNames(early), ['Iron Rod in Phase 1']);
  assert.match(
    shardPinNote(early, {}, '1', ROD),
    /^Pinned to 200% with 2 Power Shards in each machine, but Phase 1 could not keep the pin: .*The phase runs the line at 100%\. Tick “I can overclock”/,
  );
  // The planner only offers the pin where it can keep it: from Phase 2, or with overclock.
  const row = early.stages['1']!.rows!.find(line => line.id === ROD)!;
  assert.equal(clockable(row, '1', early.settings), false);
  assert.equal(clockable(row, '1', { overclock: true }), true);
  assert.equal(clockable(row, '2', early.settings), true);
  assert.equal(
    clockable({ ...row, id: ROD + ':fg-abcd', onSite: { group: 'fg-abcd', recipe: ROD } }, '3', {}),
    false,
  );
  assert.equal(clockable({ ...row, power: -250 }, '3', {}), false);
  // The budget: more shards than the plan allows the lines.
  const budget = json(
    calculate({ ...BASE, lineClocks: PINS, lineShardBudget: 1 }),
  ) as StoredCalculatedPlan;
  assert.equal(budget.stages['3']!.lineClocksDropped?.[0]?.reason, 'budget');
  assert.ok(
    budget.warnings.some(warning =>
      /^Phase 3 could not keep the Power Shards pinned on Iron Rod \(250%\): the phase’s overclocked production lines would hold more than the 1 Power Shard this plan allows them\. That phase runs that line at 100%\./.test(
        warning,
      ),
    ),
  );
  // ADA says so, as a warning.
  const ada = adaRemarks({
    view: 'plan',
    shardPinsDropped: { count: 1, lines: 'Iron Rod in Phase 1' },
  });
  const dropped = ada.find(remark => remark.id === 'shard-pins-dropped')!;
  assert.equal(dropped.tone, 'warn');
  assert.match(
    dropped.text,
    /^This plan could not keep the Power Shards you pinned on Iron Rod in Phase 1, so it runs that line at 100%\./,
  );
  const pending = adaRemarks({ view: 'plan', shardPinsPending: 2 }).find(
    remark => remark.id === 'shard-pins-pending',
  )!;
  assert.equal(pending.tone, 'calm');
  assert.match(pending.text, /^You pinned the Power Shards of 2 production lines differently/);
});

test('the pages’ helpers: a change, its settings, the dialog note and Review', () => {
  const plan = plain();
  assert.equal(lineClocksChange(plan, {}), null, 'no pins asked for');
  const wanted = withClock({}, '3', ROD, 250);
  const change = lineClocksChange(plan, { lineClocks: wanted })!;
  assert.deepEqual(change.lines, [
    { phase: '3', recipe: ROD, name: 'Iron Rod', before: undefined, after: 250 },
  ]);
  assert.deepEqual(lineClocksSettings(plan.settings, wanted).lineClocks, wanted);
  assert.equal(
    'lineClocks' in lineClocksSettings({ ...plan.settings, lineClocks: wanted }, {}),
    false,
  );
  const recalculated = pinned();
  assert.equal(lineClocksChange(recalculated, { lineClocks: wanted }), null);
  assert.match(
    shardPinNote(plan, { lineClocks: wanted }, '3', ROD),
    /^Saved: 250% with 3 Power Shards in each machine after a recalculation\./,
  );
  assert.match(shardPinNote(plan, {}, '3', ROD), /^The planner runs this line at 100%\./);
  assert.equal(
    shardPinNote(recalculated, {}, '3', ROD),
    'Pinned to 250% with 3 Power Shards in each machine: the plan keeps it exactly.',
  );
  assert.deepEqual(wantedClocks(recalculated, {}), wanted, 'without a choice the plan’s clocks');
  assert.ok(sameClocks({ '3': { b: 150, a: 200 } }, { '3': { a: 200, b: 150 }, '4': {} }));
  assert.equal(withClock(wanted, '3', ROD, undefined)['3'], undefined);
  // A pin back to 100% while the plan has it: the change says so.
  assert.deepEqual(
    lineClocksChange(recalculated, { lineClocks: {} })!.lines.map(line => [
      line.before,
      line.after,
    ]),
    [[250, undefined]],
  );
  // Edit settings' Review names a change of the pins.
  const { changes } = settingsChanges(
    plan.settings,
    lineClocksSettings(plan.settings, { '3': { [ROD]: 250, Recipe_Screw_C: 150 } }),
    [],
  );
  assert.deepEqual(
    changes.find(entry => entry.label === 'Power Shard pins'),
    { label: 'Power Shard pins', before: 'None', after: '2 lines at 150–250%' },
  );
});

test('the build plan lists the Power Shards research before the first clocked lines', () => {
  const research = (plan: StoredCalculatedPlan) =>
    phaseSteps(plan, { checks: {} }, data, '3').find(step => step.id.startsWith('power-shards-'));
  assert.equal(research(plain()), undefined, 'no clocked lines and no shards for the nodes');
  const step = research(pinned())!;
  const rod = pinned().stages['3']!.rows!.find(row => row.id === ROD)!;
  assert.equal(step.id, 'power-shards-3');
  assert.equal(step.title, 'Research Power Shards before building the overclocked lines');
  assert.match(
    step.body,
    new RegExp(
      `^Phase 3 runs a production line overclocked at the clock you pinned, whose machines hold ${rod.shards} Power Shards\\. Research Power Shards in the MAM first`,
    ),
  );
  // Done once Overclock Production is ticked, as for the nodes.
  const done = phaseSteps(
    pinned(),
    { checks: { 'unlock-Research_PowerSlugs_2_C': true } },
    data,
    '3',
  ).find(entry => entry.id === 'power-shards-3')!;
  assert.match(done.satisfied ?? '', /^Done: /);
});

// A stored plan keeps its numbers until the user recalculates (AGENTS.md): saving a pin changes the
// progress state only, in both editions, and a recalculation the user starts plans it.
async function checkEdition(
  request: (route: string, body?: unknown) => Promise<unknown>,
  reload: () => Promise<void>,
) {
  type Context = { profile: { id: string }; plan: StoredCalculatedPlan; state: ProgressState };
  const context = async () => (await request('/api/context')) as Context;
  await request('/api/profiles', { saveName: 'World', name: 'Shards', settings: BASE });
  const before = await context();
  await request('/api/update', { type: 'lineClocks', value: PINS });
  await reload();
  const after = await context();
  assert.deepEqual(after.plan, before.plan, 'the stored plan is not recalculated');
  assert.equal(after.state.version, 26);
  assert.deepEqual(after.state.lineClocks, PINS);
  const change = lineClocksChange(after.plan, after.state)!;
  assert.equal(change.lines.length, 1);
  // A full export carries it and passes the import's check.
  const exported = (await request('/api/export-saves')) as SaveExport;
  assert.deepEqual(validateTransfer(exported).saves[0]!.profiles[0]!.state.lineClocks, PINS);
  // "Recalculate in place with Power Shard pins": this profile, with the pins in its settings.
  const done = (await request('/api/recalculate', {
    name: 'Shards',
    backupName: 'Shards (before edit)',
    settings: lineClocksSettings(after.plan.settings, change.wanted),
    planCreatedAt: after.plan.createdAt,
  })) as { profileId: string; backupId: string };
  assert.equal(done.profileId, after.profile.id, 'recalculated in place');
  const recalculated = await context();
  assert.deepEqual(recalculated.plan.settings.lineClocks, PINS);
  assert.equal('lineClocks' in recalculated.state, false);
  assert.equal(lineClocksChange(recalculated.plan, recalculated.state), null);
  const rod = recalculated.plan.stages['3']!.rows!.find(row => row.id === ROD);
  assert.equal(rod?.clock, 250, 'the new plan keeps the pin');
  const summary = (await request('/api/workspace')) as WorkspaceSummary;
  assert.deepEqual(
    summary.saves[0]!.profiles.map(p => [p.id, p.name]),
    [
      [after.profile.id, 'Shards'],
      [done.backupId, 'Shards (before edit)'],
    ],
    'the version without the pin is kept',
  );
  // A pin the new plan is not calculated with (saved after Edit settings started its draft, or
  // sent by an older page) stays asked for through a recalculation in place (keepAsked, #1258).
  const recalculateWithPlan = async (backupName: string) => {
    const shown = await context();
    await request('/api/recalculate', {
      name: 'Shards',
      backupName,
      settings: shown.plan.settings,
      planCreatedAt: shown.plan.createdAt,
    });
    const next = await context();
    assert.notEqual(next.plan.createdAt, shown.plan.createdAt, 'recalculated');
    assert.deepEqual(next.plan.settings.lineClocks, PINS, 'the plan keeps its own clocks');
    return next;
  };
  const lower = { '3': { [ROD]: 150 } };
  await request('/api/update', { type: 'lineClocks', value: lower });
  const differing = await recalculateWithPlan('Shards (before edit 2)');
  assert.deepEqual(differing.state.lineClocks, lower, 'the pin asked for is kept');
  assert.deepEqual(
    lineClocksChange(differing.plan, differing.state)?.lines.map(line => [line.before, line.after]),
    [[250, 150]],
    'and still offered',
  );
  await request('/api/update', { type: 'lineClocks', value: {} });
  const forgotten = await recalculateWithPlan('Shards (before edit 3)');
  assert.deepEqual(forgotten.state.lineClocks, {}, 'the ask for no pins is kept');
  // Pins the plan was calculated with are dropped, as before.
  await request('/api/update', { type: 'lineClocks', value: PINS });
  const same = await recalculateWithPlan('Shards (before edit 4)');
  assert.equal('lineClocks' in same.state, false, 'the same pins are planned, not asked');
}

test('the Docker server saves a Power Shard pin without recalculating the plan', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'satisfactory-shards-'));
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
    assert.ok(res.ok, route + ' ' + res.status);
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
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition saves a Power Shard pin without recalculating the plan', async () => {
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

// The browser edition serves stored progress without validateState (AGENTS.md): a version-26 record
// keeps its pins and a version-25 one loads as it was, without them. (The server's reload is in
// checkEdition.)
test('the browser edition loads stored progress of version 25 and 26 unchanged', async () => {
  for (const state of [version25, version26]) {
    const records = new Map<string, unknown>();
    const store = () =>
      createBrowserApi(
        openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
          throw Error('not needed');
        }),
        calculate,
        catalog(),
      );
    let api = store();
    await api('/api/profiles', {
      body: JSON.stringify({ saveName: 'World', name: 'Old', settings: BASE }),
    });
    // The record as an earlier release left it: this profile's progress is the fixture.
    const main = records.get('main') as {
      saves: { profiles: { state: unknown }[] }[];
    };
    main.saves[0]!.profiles[0]!.state = json(state);
    api = store();
    const loaded = (await api('/api/context')) as { state: ProgressState };
    assert.deepEqual(loaded.state, validateState(json(state)));
    assert.equal(loaded.state.version, state.version);
  }
});

// A hand-edited file with a clock on a recipe the game data does not have made every
// recalculation of the profile fail ("Invalid line clocks."). An import drops those pins, from the
// progress and the plan's settings, and keeps the rest.
test('an import drops Power Shard pins on unknown recipes and keeps the rest', async () => {
  const plan = plain();
  const file = (state: object, settingsClocks?: LineClocks): SaveExport => ({
    format: 'satisfactory-planner-saves',
    version: 1,
    exportedAt: '2026-10-27T08:00:00.000Z',
    saves: [
      {
        id: 's1',
        name: 'World',
        activeProfile: 'p1',
        profiles: [
          {
            id: 'p1',
            name: 'Pinned',
            kind: 'calculated',
            plan: { ...plan, settings: { ...plan.settings, lineClocks: settingsClocks } },
            state: { ...json(version26), ...state },
          },
        ],
      },
    ],
  });
  const recipes = async () => ({ recipes: DATA.recipes, pureLimits: catalog().pureLimits });
  const edited = file(
    { lineClocks: { '3': { Recipe_Hand_Edited_C: 150, [ROD]: 200 } } },
    { '3': { Recipe_Hand_Edited_C: 150 }, '4': { [ROD]: 250 } },
  );
  const imported = (await importableTransfer(json(edited), recipes)).saves[0]!.profiles[0]!;
  assert.deepEqual(imported.state.lineClocks, { '3': { [ROD]: 200 } });
  assert.deepEqual(imported.plan!.settings.lineClocks, { '4': { [ROD]: 250 } });
  // The somersloop pins of the same file are as they were.
  assert.deepEqual(imported.state.sloopPins, version26.sloopPins);
  const unknownOnly = file(
    { lineClocks: { '3': { Recipe_Hand_Edited_C: 150 } } },
    {
      '5': { Recipe_Hand_Edited_C: 150 },
    },
  );
  const cleared = (await importableTransfer(json(unknownOnly), recipes)).saves[0]!.profiles[0]!;
  assert.deepEqual(cleared.state.lineClocks, {});
  assert.equal('lineClocks' in cleared.plan!.settings, false);
  // Pins it knows import as they are.
  const known = (await importableTransfer(json(file({})), recipes)).saves[0]!.profiles[0]!;
  assert.deepEqual(known.state.lineClocks, version26.lineClocks);
});

// Review of #1266: the pages count the shards the game needs (a last machine at the remainder
// takes fewer), a draft over the Power Shard budget names the shards, and the final-phase target
// says when only the budget keeps a phase from finishing sooner.
test('the game’s shard count, a draft over the shard budget, and the final-phase target', () => {
  assert.equal(gameShards({ clock: 250, machines: 3, lastClock: 57.75 }), 6);
  assert.equal(gameShards({ clock: 250, machines: 3, lastClock: 250 }), 9);
  assert.equal(gameShards({ clock: 150, machines: 1, lastClock: 120 }), 1);
  assert.equal(gameShards({ machines: 3, lastClock: 100 }), 0);
  // A phase that fits only with its clocks (a building cap between the two plans) and only over
  // the shard budget: the draft names the shards instead of the recipes.
  const clocks = { '3': { [ROD]: 250, Recipe_Screw_C: 250 } };
  const count = (plan: StoredCalculatedPlan) =>
    plan.stages['3']!.rows!.reduce((total, row) => total + row.machines, 0);
  const withClocks = json(calculate({ ...BASE, lineClocks: clocks })) as StoredCalculatedPlan;
  const cap = Math.floor((count(plain()) + count(withClocks)) / 2);
  const capped = { ...BASE, phaseCaps: { buildings: cap }, lineClocks: clocks };
  assert.ok(calculate(capped).stages['3']!.feasible, 'fits with the clocks');
  const refused = calculate({ ...capped, lineShardBudget: 1 }).stages['3']!;
  assert.equal(refused.feasible, false);
  assert.match(
    refused.reason ?? '',
    /^This phase fits only with more Power Shards on its overclocked production lines than the 1 this plan allows them: at the clocks you pinned they would hold \d+\. Lower or clear the Power Shard pins/,
  );
  assert.match(
    finalPhaseWarning([], [], [2], 16),
    /Phase 2 could finish sooner, but only with more Power Shards on its overclocked production lines than the 16 this plan allows them, so it keeps its own target time\.$/,
  );
  assert.equal(finalPhaseWarning([], []), finalPhaseWarning([], [], [], 0), 'unchanged without');
});
