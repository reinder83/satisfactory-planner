// Somersloop pins per production line (#1235, slice 10 of #1079): settings.sloopPins fixes how many
// somersloops a line of a phase takes, chosen in the progress state's sloopPins (state version 24).
// The solve keeps a pin exactly, or plans the phase without it and records why
// (sloopPinsDropped); a plan without pins calculates exactly as before. The progress side covers
// both editions: the Docker server (createApp, workspace.json) and the browser edition
// (createBrowserApi over openBrowserStore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { calculate, catalog, DATA, run, settings } from '../planner.ts';
import { amplifySlots, pinReasonWords } from '../public/somersloops.ts';
import {
  droppedPinNames,
  pinNote,
  pinsOverBudget,
  samePins,
  sloopPinsChange,
  sloopPinsSettings,
  validPin,
  wantedPins,
  withPin,
} from '../public/app/sloop-pins.ts';
import { settingsChanges } from '../public/app/profile-edit.ts';
import { checkBase, mutate, newProfileState, shareState, validateState } from '../public/state.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { propertyCount } from './helpers/properties.ts';
import { states, version22, version23, version24 } from './types/fixtures.ts';
import type {
  ProgressState,
  SaveExport,
  SloopPins,
  StoredCalculatedPlan,
  WorkspaceSummary,
} from '../public/types/index.ts';
import type { RunResult } from '../planner/types.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
// A Phase 3 plan on whole machines with 20 somersloops for amplification.
const BASE = {
  phase: '3',
  recipes: 'standard',
  somersloops: 40,
  amplifySloops: 20,
  wholeMachines: true,
  storageFromSurplus: true,
};
const solved = (result: RunResult) => {
  assert.ok(result.feasible, 'the phase fits');
  return result;
};
// The somersloops on each line of a phase's result, by recipe: its amplified twin's.
const sloopsOf = (result: RunResult): Record<string, number> =>
  Object.fromEntries(
    solved(result)
      .rows.filter(row => row.id.startsWith('amp:'))
      .map(row => [row.id.slice(4), row.sloops ?? 0]),
  );
const phase = (extra: object, number = 3) => run(settings({ ...BASE, ...extra }), number);
let plainCache: RunResult | undefined;
const plain = () => (plainCache ??= phase({}));

test('settings keep pins whole and sorted, drop an empty map and refuse anything else', () => {
  assert.equal('sloopPins' in settings({}), false, 'absent by default');
  assert.equal('sloopPins' in settings({ sloopPins: {} }), false, 'an empty map is dropped');
  assert.equal('sloopPins' in settings({ sloopPins: { '3': {} } }), false);
  assert.deepEqual(
    settings({
      sloopPins: { '4': { Recipe_ModularFrameHeavy_C: 8, Recipe_IronRod_C: 0 }, '3': {} },
    }).sloopPins,
    { '4': { Recipe_IronRod_C: 0, Recipe_ModularFrameHeavy_C: 8 } },
  );
  for (const bad of [
    [],
    { post: { Recipe_IronRod_C: 1 } },
    { '3': [] },
    { '3': { Recipe_Nothing_C: 1 } },
    // Not amplifiable: a Packager has no slots; a pin names the recipe, never its twin.
    { '3': { Recipe_PackagedWater_C: 1 } },
    { '3': { 'amp:Recipe_IronRod_C': 1 } },
    { '3': { Recipe_IronRod_C: 1.5 } },
    { '3': { Recipe_IronRod_C: -1 } },
    { '3': { Recipe_IronRod_C: 107 } },
    { '3': { Recipe_IronRod_C: '1' } },
  ])
    assert.throws(
      () => settings({ sloopPins: bad }),
      /Invalid somersloop pins/,
      JSON.stringify(bad),
    );
  assert.throws(
    () => settings({ sloopPins: { '4': { Recipe_ModularFrameHeavy_C: 6 } } }),
    /^Error: A somersloop pin fills whole machines: Heavy Modular Frame takes 4 per Manufacturer, so pin a multiple of 4\.$/,
  );
});

test('a pin is kept exactly; a pin of 0 takes the somersloops off the line', () => {
  const own = sloopsOf(plain());
  const [amplified] = Object.keys(own);
  assert.ok(amplified, 'the planner amplifies some line of its own');
  const result = phase({
    sloopPins: { '3': { Recipe_IronRod_C: 4, Recipe_ModularFrameHeavy_C: 4, [amplified]: 0 } },
  });
  const sloops = sloopsOf(result);
  assert.equal(sloops.Recipe_IronRod_C, 4, 'four amplified Constructors');
  assert.equal(sloops.Recipe_ModularFrameHeavy_C, 4, 'one amplified Manufacturer');
  assert.equal(sloops[amplified], undefined, 'no somersloops where the pin is 0');
  assert.equal(solved(result).sloopPinsDropped, undefined);
  assert.ok(solved(result).sloopsUsed! <= BASE.amplifySloops, 'the budget holds');
  const twin = solved(result).rows.find(row => row.id === 'amp:Recipe_ModularFrameHeavy_C')!;
  assert.equal(twin.machines, 1);
  assert.match(
    calculate({ ...BASE, sloopPins: { '3': { Recipe_IronRod_C: 4 } } }).warnings.join('\n'),
    /One production line has the somersloops you pinned, which the plan keeps exactly: Iron Rod in Phase 3 \(4 somersloops\)\./,
  );
});

test('no pins change nothing: the plan is byte for byte the plan without the field', () => {
  const plan = calculate(BASE),
    empty = calculate({ ...BASE, sloopPins: {} });
  assert.deepEqual({ ...empty, createdAt: '' }, { ...plan, createdAt: '' });
  assert.equal('sloopPins' in plan.settings, false);
  for (const stage of Object.values(plan.stages)) assert.equal('sloopPinsDropped' in stage, false);
  // Pins in another phase leave this one as it was.
  assert.deepEqual(phase({ sloopPins: { '5': { Recipe_IronRod_C: 2 } } }), plain());
});

test('a pin the phase cannot keep is reported with why, and the phase planned without it', () => {
  const cases: [string, object, number, object][] = [
    ['research', { sloopPins: { '2': { Recipe_IronRod_C: 1 } } }, 2, {}],
    [
      'budget',
      { sloopPins: { '3': { Recipe_IronRod_C: 16, Recipe_ModularFrameHeavy_C: 8 } } },
      3,
      {},
    ],
    [
      'budget',
      { amplifySloops: 0, sloopPins: { '3': { Recipe_IronRod_C: 4 } } },
      3,
      { amplifySloops: 0 },
    ],
    ['unavailable', { sloopPins: { '3': { Recipe_Alternate_Wire_1_C: 2 } } }, 3, {}],
  ];
  for (const [reason, extra, number, without] of cases) {
    const result = solved(phase(extra, number));
    const pins = (settings({ ...BASE, ...extra }).sloopPins as SloopPins)[String(number) as '3'];
    assert.deepEqual(
      result.sloopPinsDropped,
      Object.entries(pins!).map(([recipe, sloops]) => ({ recipe, sloops, reason })),
      reason,
    );
    // Planned exactly as without the pins: nothing is half kept.
    const { sloopPinsDropped: _dropped, ...rest } = result;
    assert.deepEqual(rest, phase(without, number), reason + ': the plan without the pins');
  }
  // A pin of 0 needs nothing, so it holds before the research too.
  assert.equal(
    solved(phase({ sloopPins: { '2': { Recipe_IronRod_C: 0 } } }, 2)).sloopPinsDropped,
    undefined,
  );
  // No plan fits with 100 somersloops on the Nobelisk line: the planner places them itself.
  const fit = solved(
    phase({
      recipes: 'all',
      somersloops: 106,
      amplifySloops: 100,
      sloopPins: { '3': { Recipe_Nobelisk_C: 100 } },
    }),
  );
  assert.deepEqual(fit.sloopPinsDropped, [
    { recipe: 'Recipe_Nobelisk_C', sloops: 100, reason: 'fit' },
  ]);
  assert.notEqual(sloopsOf(fit).Recipe_Nobelisk_C, 100);
  assert.equal(fit.amplificationDropped, undefined, 'amplification itself still fits');
  // The plan's warning names each dropped pin, why and what to change.
  const warnings = calculate({
    ...BASE,
    sloopPins: { '2': { Recipe_IronRod_C: 1 }, '3': { Recipe_IronRod_C: 16, Recipe_Screw_C: 8 } },
  }).warnings.join('\n');
  assert.match(
    warnings,
    /Phase 2 could not keep the somersloops pinned on Iron Rod \(1\): machines take somersloops only once the MAM research Production Amplifier is done, from Phase 3 on\. That phase is planned without that pin\. Change or clear the pin in the production line’s dialog\./,
  );
  assert.match(
    warnings,
    /Phase 3 could not keep the somersloops pinned on Iron Rod \(16\) and Screws \(8\): the phase’s pins add up to more than the 20 somersloops production amplification may place in a phase\. That phase is planned without those pins\. Raise the amplification budget on step 2 of Edit settings, or lower or clear the pins in the production line’s dialog\./,
  );
  assert.equal(
    pinReasonWords('budget', 0),
    'production amplification has no somersloops to place in this plan',
  );
});

// Property check: pinning lines to what the planner itself chose (a feasible pin by construction)
// keeps them exactly, over phases, budgets, recipe access and whole or precise machines, and a pin
// of 0 on another line takes its somersloops off. Random pins that the phase keeps hold exactly.
// 12 rounds with PLANNER_FULL_PROPERTIES=1 (nightly, #1274), otherwise the first 6 (propertyCount
// in tests/helpers/properties.ts), which draw from the sequence as they always did (every round
// keeps its random pins today).
test('a feasible pin is always kept exactly (property check over many settings)', () => {
  let seed = 1235;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)]!;
  let kept = 0;
  const rounds = propertyCount(12, 6);
  for (let round = 0; round < rounds; round++) {
    const config = {
      ...BASE,
      recipes: pick(['standard', 'all'] as const),
      amplifySloops: pick([8, 20, 40]),
      somersloops: 106,
      wholeMachines: random() < 0.75,
    };
    const number = pick([3, 4, 5]);
    const key = String(number) as '3';
    const own = sloopsOf(run(settings(config), number));
    const ownPins = Object.entries(own).filter(() => random() < 0.6);
    const result = run(
      settings({ ...config, sloopPins: { [key]: Object.fromEntries(ownPins) } }),
      number,
    );
    const sloops = sloopsOf(result);
    for (const [recipe, count] of ownPins)
      assert.equal(sloops[recipe], count, `${round}: ${recipe}`);
    assert.equal(solved(result).sloopPinsDropped, undefined, `round ${round}`);
    // Random pins on lines the phase has: kept exactly, or reported, never half kept.
    const lines = solved(result).rows.filter(
      row => !row.id.startsWith('amp:') && !row.onSite && !row.stock && amplifySlots(row) > 0,
    );
    // Within the budget, so the phase can only give them up when no plan fits with them.
    const pins: Record<string, number> = {};
    let total = 0;
    for (const row of lines.filter(() => random() < 0.2)) {
      const sloops = amplifySlots(row) * pick([0, 1, 2]);
      if (total + sloops > config.amplifySloops) continue;
      pins[row.id] = sloops;
      total += sloops;
    }
    const pinned = solved(run(settings({ ...config, sloopPins: { [key]: pins } }), number));
    const placed = sloopsOf(pinned);
    if (!pinned.sloopPinsDropped) {
      kept++;
      for (const [recipe, count] of Object.entries(pins))
        assert.equal(placed[recipe] ?? 0, count, `${round}: random pin on ${recipe}`);
    } else
      for (const drop of pinned.sloopPinsDropped) {
        assert.ok(drop.sloops > 0, 'a pin of 0 is always kept');
        assert.equal(drop.reason, 'fit');
      }
  }
  assert.ok(kept >= propertyCount(6, 3), `most random pins are kept (${kept} of ${rounds})`);
});

test('a pin counts built amplified machines; a pin of 0 counts them as plain capacity', () => {
  const builtLines = { '3': { 'amp:Recipe_IronRod_C': 6 } };
  const more = sloopsOf(phase({ builtLines, sloopPins: { '3': { Recipe_IronRod_C: 4 } } }));
  assert.equal(more.Recipe_IronRod_C, 4, 'the pin holds, so two of the six built are spare');
  const none = solved(phase({ builtLines, sloopPins: { '3': { Recipe_IronRod_C: 0 } } }));
  assert.equal(
    none.rows.some(row => row.id === 'amp:Recipe_IronRod_C'),
    false,
  );
  assert.equal(none.sloopPinsDropped, undefined);
});

test('the pins are state version 24; every released format loads unchanged without them', () => {
  for (const [state, version] of states) {
    const clean = validateState(json(state));
    assert.equal(clean.version, version);
    if (version < 24) assert.equal('sloopPins' in clean, false);
  }
  const clean = validateState(json(version24));
  assert.equal(clean.version, 24);
  assert.deepEqual(clean.sloopPins, version24.sloopPins);
  // An empty map is still a choice: it asks for no pins where the plan has some.
  assert.equal(validateState(json({ ...version23, sloopPins: {} })).version, 24);
  for (const bad of [
    [],
    { post: { a: 1 } },
    { '3': [] },
    { '3': { 'amp:Recipe_Wire_C': 1 } },
    { '3': { Recipe_Wire_C: 1.5 } },
    { '3': { Recipe_Wire_C: 107 } },
    { '3': { 'bad key': 1 } },
  ])
    assert.throws(
      () => validateState(json({ ...version22, sloopPins: bad })),
      /Invalid somersloop pins/,
    );
  assert.throws(() => validateState({ ...json(clean), version: 31 }), /newer planner version/);
  // From version 23 (#1231): the pins come on top, and the flow graph's tags stay as they were.
  const upgraded = validateState(
    json({ ...version23, sloopPins: { '4': { Recipe_IronRod_C: 2 } } }),
  );
  assert.equal(upgraded.version, 24);
  assert.deepEqual(upgraded.factoryGroups, validateState(json(version23)).factoryGroups);
  // The update saves the whole map; null forgets it and the state goes back to its version.
  const asked = mutate(json(version23), {
    type: 'sloopPins',
    value: { '4': { b: 4, a: 0 } },
  });
  assert.deepEqual(asked.sloopPins, { '4': { a: 0, b: 4 } });
  assert.equal(asked.version, 24);
  const forgotten = mutate(json(asked), { type: 'sloopPins', value: null });
  assert.equal('sloopPins' in forgotten, false);
  assert.equal(forgotten.version, 23);
  assert.throws(
    () => mutate(json(version22), { type: 'sloopPins', value: { '9': { a: 1 } } as SloopPins }),
    /Invalid somersloop pins/,
  );
  // It sends a whole map, so a tab that has not seen another's change is refused.
  const update = { type: 'sloopPins', value: {} };
  assert.throws(() => checkBase({ ...clean, revision: 3 }, update, '2'), /changed in another tab/);
  assert.doesNotThrow(() => checkBase({ ...clean, revision: 3 }, update, '3'));
});

test('a new profile starts without the pins asked for; a share and a transfer keep them', () => {
  const source = validateState(json(version24));
  // A recalculation freezes the pins in the new plan's settings, so its state needs none.
  const carried = newProfileState(null, json(source), null, { planEdits: true }, undefined).state;
  assert.equal('sloopPins' in carried, false);
  assert.deepEqual(shareState(json(source)).sloopPins, version24.sloopPins);
});

test('the pages’ helpers: a change, its settings, the dialog note and Review', () => {
  const plan = { settings: settings(BASE), stages: calculate(BASE).stages };
  assert.equal(sloopPinsChange(plan, {}), null, 'no pins asked for');
  const wanted = withPin({}, '3', 'Recipe_IronRod_C', 4);
  const change = sloopPinsChange(plan, { sloopPins: wanted })!;
  assert.deepEqual(change.lines, [
    { phase: '3', recipe: 'Recipe_IronRod_C', name: 'Iron Rod', before: undefined, after: 4 },
  ]);
  const next = sloopPinsSettings(plan.settings, wanted);
  assert.deepEqual(next.sloopPins, wanted);
  assert.equal(
    'sloopPins' in sloopPinsSettings({ ...plan.settings, sloopPins: wanted }, {}),
    false,
  );
  const recalculated = { ...plan, settings: next };
  assert.equal(sloopPinsChange(recalculated, { sloopPins: wanted }), null);
  assert.match(
    pinNote(plan, { sloopPins: wanted }, '3', 'Recipe_IronRod_C'),
    /^Saved: 4 somersloops after a recalculation\./,
  );
  assert.match(
    pinNote(recalculated, {}, '3', 'Recipe_IronRod_C'),
    /^Pinned to 4 somersloops: the plan keeps it exactly/,
  );
  assert.deepEqual(wantedPins(recalculated, {}), wanted, 'without a choice the plan’s pins');
  assert.ok(samePins({ '3': { b: 1, a: 2 } }, { '3': { a: 2, b: 1 }, '4': {} }));
  assert.equal(withPin(wanted, '3', 'Recipe_IronRod_C', undefined)['3'], undefined);
  assert.deepEqual(pinsOverBudget(plan, { '3': { a: 12, b: 12 } }), [['3', 24]]);
  assert.ok(validPin(8, 4) && validPin(0, 4) && !validPin(6, 4) && !validPin(108, 4));
  // A pin the plan could not keep: the dialog and ADA name it.
  const over = calculate({ ...BASE, sloopPins: { '3': { Recipe_IronRod_C: 24 } } });
  assert.deepEqual(droppedPinNames(over), ['Iron Rod in Phase 3']);
  assert.match(
    pinNote(over, {}, '3', 'Recipe_IronRod_C'),
    /^Pinned to 24 somersloops, but Phase 3 could not keep the pin: the phase’s pins add up to more than the 20 somersloops/,
  );
  // Edit settings' Review names a change of the pins.
  const { changes } = settingsChanges(plan.settings, next, []);
  assert.deepEqual(
    changes.find(entry => entry.label === 'Somersloop pins'),
    {
      label: 'Somersloop pins',
      before: 'None',
      after: '1 line, 4 somersloops',
    },
  );
});

// A stored plan keeps its numbers until the user recalculates (AGENTS.md): saving a pin changes the
// progress state only, in both editions, and a recalculation the user starts plans it.
async function checkEdition(
  request: (route: string, body?: unknown) => Promise<unknown>,
  reload: () => Promise<void>,
) {
  type Context = {
    profile: { id: string };
    plan: StoredCalculatedPlan;
    state: ProgressState;
  };
  const context = async () => (await request('/api/context')) as Context;
  await request('/api/profiles', { saveName: 'World', name: 'Sloops', settings: BASE });
  const before = await context();
  const pins = { '3': { Recipe_IronRod_C: 4 } };
  await request('/api/update', { type: 'sloopPins', value: pins });
  await reload();
  const after = await context();
  assert.deepEqual(after.plan, before.plan, 'the stored plan is not recalculated');
  assert.equal(after.state.version, 24);
  assert.deepEqual(after.state.sloopPins, pins);
  const change = sloopPinsChange(after.plan, after.state)!;
  assert.equal(change.lines.length, 1);
  // A full export carries it and passes the import's check.
  const exported = (await request('/api/export-saves')) as SaveExport;
  assert.deepEqual(validateTransfer(exported).saves[0]!.profiles[0]!.state.sloopPins, pins);
  // "Recalculate in place with somersloop pins": this profile, with the pins in its settings.
  const done = (await request('/api/recalculate', {
    name: 'Sloops',
    backupName: 'Sloops (before edit)',
    settings: sloopPinsSettings(after.plan.settings, change.wanted),
    planCreatedAt: after.plan.createdAt,
  })) as { profileId: string; backupId: string };
  assert.equal(done.profileId, after.profile.id, 'recalculated in place');
  const recalculated = await context();
  assert.deepEqual(recalculated.plan.settings.sloopPins, pins);
  assert.equal('sloopPins' in recalculated.state, false);
  assert.equal(sloopPinsChange(recalculated.plan, recalculated.state), null);
  const twin = recalculated.plan.stages['3']!.rows!.find(row => row.id === 'amp:Recipe_IronRod_C');
  assert.equal(twin?.sloops, 4, 'the new plan keeps the pin');
  const summary = (await request('/api/workspace')) as WorkspaceSummary;
  assert.deepEqual(
    summary.saves[0]!.profiles.map(p => [p.id, p.name]),
    [
      [after.profile.id, 'Sloops'],
      [done.backupId, 'Sloops (before edit)'],
    ],
    'the version without the pin is kept',
  );
  // A pin the new plan is not calculated with (saved after Edit settings started its draft, or
  // sent by an older page) stays asked for through a recalculation in place (#1258): a different
  // count, then the line asked back to the planner's choice, each recalculated with the plan's
  // own settings, which keep the pin it was calculated with.
  const recalculateWithPlan = async (backupName: string) => {
    const shown = await context();
    await request('/api/recalculate', {
      name: 'Sloops',
      backupName,
      settings: shown.plan.settings,
      planCreatedAt: shown.plan.createdAt,
    });
    const next = await context();
    assert.notEqual(next.plan.createdAt, shown.plan.createdAt, 'recalculated');
    assert.deepEqual(next.plan.settings.sloopPins, pins, 'the plan keeps its own pins');
    return next;
  };
  const eight = { '3': { Recipe_IronRod_C: 8 } };
  await request('/api/update', { type: 'sloopPins', value: eight });
  const differing = await recalculateWithPlan('Sloops (before edit 2)');
  assert.deepEqual(differing.state.sloopPins, eight, 'the pin asked for is kept');
  assert.deepEqual(
    sloopPinsChange(differing.plan, differing.state)?.lines.map(line => [line.before, line.after]),
    [[4, 8]],
    'and still offered',
  );
  await request('/api/update', { type: 'sloopPins', value: {} });
  const forgotten = await recalculateWithPlan('Sloops (before edit 3)');
  assert.deepEqual(forgotten.state.sloopPins, {}, 'the ask for no pins is kept');
  assert.deepEqual(
    sloopPinsChange(forgotten.plan, forgotten.state)?.lines.map(line => [line.before, line.after]),
    [[4, undefined]],
    'and still offered',
  );
  // Pins the plan was calculated with are dropped, as before.
  await request('/api/update', { type: 'sloopPins', value: pins });
  const same = await recalculateWithPlan('Sloops (before edit 4)');
  assert.equal('sloopPins' in same.state, false, 'the same pins are planned, not asked');
}

test('the Docker server saves a pin without recalculating the plan', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-pins-'));
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
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition saves a pin without recalculating the plan', async () => {
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

// The recipes a pin may name are the ones the planner can amplify: the same rule in both places.
test('every amplifiable recipe takes a pin of one machine, and no other recipe does', () => {
  for (const recipe of DATA.recipes) {
    const slots = amplifySlots(recipe);
    const pin = () => settings({ sloopPins: { '3': { [recipe.id]: slots || 1 } } });
    if (slots) assert.deepEqual(pin().sloopPins, { '3': { [recipe.id]: slots } }, recipe.id);
    else assert.throws(pin, /Invalid somersloop pins/, recipe.id);
  }
});

// A hand-edited file with a pin on a recipe the game data does not have (or one production
// amplification cannot amplify) made every recalculation of the profile fail until the pin was
// cleared, which no line offers. An import drops those pins, from the progress and the plan's
// settings, and keeps the rest; a file without pins never loads the recipes.
test('an import drops pins on unknown or unamplifiable recipes and keeps the rest', async () => {
  const plan = json(
    JSON.parse(
      await fs.readFile(
        new URL('./fixtures/calculated-plan-2026-09-12.json', import.meta.url),
        'utf8',
      ),
    ) as StoredCalculatedPlan,
  );
  const SMELTER = 'Recipe_IngotIron_C';
  assert.equal(amplifySlots(DATA.recipes.find(recipe => recipe.id === SMELTER)!), 1);
  // A Packager recipe: its machine takes no somersloops.
  const UNAMPLIFIED = DATA.recipes.find(recipe => !amplifySlots(recipe))!.id;
  const file = (state: object, settingsPins?: SloopPins): SaveExport => ({
    format: 'satisfactory-planner-saves',
    version: 1,
    exportedAt: '2026-10-26T08:00:00.000Z',
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
            plan: { ...plan, settings: { ...plan.settings, sloopPins: settingsPins } },
            state: { ...json(version24), ...state },
          },
        ],
      },
    ],
  });
  const recipes = async () => ({ recipes: DATA.recipes, pureLimits: catalog().pureLimits });
  const edited = file(
    {
      sloopPins: {
        '3': { Recipe_Hand_Edited_C: 4 },
        '4': { Recipe_ModularFrameHeavy_C: 4, [UNAMPLIFIED]: 0, Recipe_Hand_Edited_C: 2 },
      },
    },
    { '3': { Recipe_Hand_Edited_C: 1 }, '4': { [SMELTER]: 2 } },
  );
  const imported = (await importableTransfer(json(edited), recipes)).saves[0]!.profiles[0]!;
  assert.deepEqual(imported.state.sloopPins, { '4': { Recipe_ModularFrameHeavy_C: 4 } });
  assert.deepEqual(imported.plan!.settings.sloopPins, { '4': { [SMELTER]: 2 } });
  // Nothing known left: the progress keeps an empty map (no pins asked for), the plan no field.
  const unknownOnly = file(
    { sloopPins: { '3': { Recipe_Hand_Edited_C: 4 } } },
    {
      '5': { Recipe_Hand_Edited_C: 4 },
    },
  );
  const cleared = (await importableTransfer(json(unknownOnly), recipes)).saves[0]!.profiles[0]!;
  assert.deepEqual(cleared.state.sloopPins, {});
  assert.equal('sloopPins' in cleared.plan!.settings, false);
  // Pins it knows import as they are; a file without pins never loads the recipes.
  const known = (await importableTransfer(json(file({})), recipes)).saves[0]!.profiles[0]!;
  assert.deepEqual(known.state.sloopPins, version24.sloopPins);
  const unpinned = file({ sloopPins: undefined });
  const kept = await importableTransfer(json(unpinned), async () => {
    throw Error('not needed');
  });
  assert.equal('sloopPins' in kept.saves[0]!.profiles[0]!.state, false);
  // The browser edition's import goes the same way.
  const records = new Map<string, unknown>();
  const api = createBrowserApi(
    openBrowserStore(fakeIndexedDB(2, records), undefined, recipes),
    calculate,
    catalog(),
    undefined,
    recipes,
  );
  const summary = (await api('/api/import-saves', {
    body: JSON.stringify(edited),
  })) as WorkspaceSummary;
  const stored = (
    records.get('main') as {
      saves: { profiles: { state: ProgressState; plan: StoredCalculatedPlan }[] }[];
    }
  ).saves.at(-1)!.profiles[0]!;
  assert.ok(summary.saves.length);
  assert.deepEqual(stored.state.sloopPins, { '4': { Recipe_ModularFrameHeavy_C: 4 } });
  assert.deepEqual(stored.plan.settings.sloopPins, { '4': { [SMELTER]: 2 } });
});
