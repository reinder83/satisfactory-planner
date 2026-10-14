// Co-op progress (#1160): the ticks-only export and merging a friend's progress from a file
// (public/app/progress-merge.ts). A merge is a union of ticks: it ticks the steps the file ticks
// that this plan lists and has not ticked yet, never unticks one, skips and lists the ids this plan
// does not list, and refuses a file that is not a progress export without changing anything. It is
// stored as ordinary `checks` updates, so both editions keep it as they keep any tick: tested here
// through mutate, the browser edition's API and the Docker server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { calculate } from '../planner.ts';
import { mutate, planStepIds, validateState } from '../public/state.ts';
import {
  MERGE_CHUNK,
  mergeChunks,
  mergedMessage,
  mergePreview,
  mergeQuestion,
  NOT_PROGRESS,
  nothingToMerge,
  readProgressFile,
  ticksExport,
  ticksFileName,
  TICKS_FORMAT,
  type MergeGroup,
  type ProgressSource,
} from '../public/app/progress-merge.ts';
import type {
  BrowserWorkspace,
  Catalog,
  ProgressState,
  Progression,
  StageKey,
  StoredCalculatedPlan,
} from '../public/types/index.ts';

const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const settings = { phase: '1', goal: 'timed', hours: 8, multiplier: 1, storage: 'none' };
const plan = calculate(settings);
const blank = (checks: Record<string, boolean> = {}): ProgressState =>
  validateState({
    version: 1,
    settings: { phase: '1' },
    checks,
    notes: {},
    deliveries: {},
    customTasks: [],
  });
// The plan's step ids per phase, as the Backup page groups them (planStepIds lists them as the
// build plan does; the page also counts removed steps, and this progress has none).
const groupsOf = (stored: StoredCalculatedPlan, state: ProgressState): MergeGroup[] =>
  (['1', '2', '3', '4', '5'] as StageKey[]).map(phase => ({
    label: 'Phase ' + phase,
    unit: 'step',
    ids: planStepIds(stored, state, data, phase),
  }));
const groups = groupsOf(plan, blank());
const phaseOne = groups[0]!.ids,
  phaseTwo = groups[1]!.ids;
const ticksFile = (ticks: unknown[], extra: object = {}) => ({
  format: TICKS_FORMAT,
  version: 1,
  exportedAt: '2026-10-14T12:00:00.000Z',
  saveName: 'Coop world',
  profileName: 'Anna',
  ticks,
  ...extra,
});
const source = (ticks: string[]): ProgressSource => readProgressFile(ticksFile(ticks));

test('the plan has steps in Phase 1 and Phase 2 to merge', () => {
  assert.ok(phaseOne.length > 5 && phaseTwo.length > 5);
});

test('a ticks export holds only the ticked step ids, sorted, with the names and the time', () => {
  const file = ticksExport(
    { 'b-step': true, 'a-step': true, unticked: false },
    'Coop world',
    'Anna',
    new Date('2026-10-14T12:00:00Z'),
  );
  assert.deepEqual(file, {
    format: 'satisfactory-planner-ticks',
    version: 1,
    exportedAt: '2026-10-14T12:00:00.000Z',
    saveName: 'Coop world',
    profileName: 'Anna',
    ticks: ['a-step', 'b-step'],
  });
  assert.deepEqual(readProgressFile(file).ticks, ['a-step', 'b-step'], 'it reads back');
  assert.equal(ticksFileName('Anna’s Base #2'), 'satisfactory-ticks-anna-s-base-2.json');
  assert.equal(ticksFileName('★'), 'satisfactory-ticks-profile.json');
});

test('a merge ticks only steps the plan lists and has not ticked: a union that never unticks', () => {
  const here = { [phaseOne[0]!]: true, [phaseOne[1]!]: false, [phaseTwo[0]!]: true };
  const ticks = [phaseOne[0]!, phaseOne[1]!, phaseOne[2]!, phaseTwo[1]!];
  const preview = mergePreview(ticks, here, groups);
  assert.deepEqual(preview.newIds, [phaseOne[1], phaseOne[2], phaseTwo[1]]);
  assert.equal(preview.already, 1);
  assert.deepEqual(preview.skipped, []);
  assert.deepEqual(preview.perGroup, [
    { label: 'Phase 1', unit: 'step', count: 2 },
    { label: 'Phase 2', unit: 'step', count: 1 },
  ]);
  const merged = mergeChunks(preview.newIds, here).reduce(
    (state, keys) => mutate(state, { type: 'checks', keys, value: true }),
    blank(here),
  );
  assert.deepEqual(
    Object.keys(merged.checks)
      .filter(id => merged.checks[id])
      .sort(),
    [phaseOne[0]!, phaseTwo[0]!, phaseOne[1]!, phaseOne[2]!, phaseTwo[1]!].sort(),
    'ticked here stays ticked, the unticked step the file ticks is ticked, nothing else changes',
  );
});

test('ids the plan does not list are skipped and listed, unsafe ones too', () => {
  const ticks = [phaseOne[0]!, 'calc-3-Recipe_Gone_C', 'custom-anna-1', '__proto__', 'a b'];
  const preview = mergePreview(ticks, {}, groups);
  assert.deepEqual(preview.newIds, [phaseOne[0]]);
  assert.deepEqual(preview.skipped, ['calc-3-Recipe_Gone_C', 'custom-anna-1', '__proto__', 'a b']);
  const question = mergeQuestion('anna.json', source(ticks), preview, () => '14/10/2026, 14:00');
  assert.deepEqual(question.folded, {
    summary: 'Skipped: 4 steps not in this plan',
    items: ['calc-3-Recipe_Gone_C', 'custom-anna-1', '__proto__', 'a b'],
  });
  assert.equal(
    mergeChunks(preview.newIds, {}).flat().includes('__proto__'),
    false,
    'a skipped id is never sent',
  );
});

test('an id two phases list counts once, under the first; a duplicate in the file counts once', () => {
  const shared: MergeGroup[] = [
    { label: 'Phase 4', unit: 'step', ids: ['space-elevator', 'calc-4-a'] },
    { label: 'Phase 5', unit: 'step', ids: ['space-elevator', 'calc-5-a'] },
    { label: 'Storage room', unit: 'container step', ids: ['slot-A01-built'] },
  ];
  const preview = mergePreview(
    ['space-elevator', 'space-elevator', 'calc-5-a', 'slot-A01-built'],
    {},
    shared,
  );
  assert.deepEqual(preview.perGroup, [
    { label: 'Phase 4', unit: 'step', count: 1 },
    { label: 'Phase 5', unit: 'step', count: 1 },
    { label: 'Storage room', unit: 'container step', count: 1 },
  ]);
  assert.equal(preview.newIds.length, 3);
});

test('the preview says what the file is, what it ticks per phase, what is ticked and what is skipped', () => {
  const ticks = [phaseOne[0]!, phaseOne[1]!, phaseTwo[0]!, 'calc-9-x'];
  const preview = mergePreview(ticks, { [phaseOne[0]!]: true }, groups);
  assert.deepEqual(
    mergeQuestion('anna.json', source(ticks), preview, iso => (iso ? 'the date' : '')),
    {
      title: 'Merge this progress?',
      body: '“anna.json” is a ticks export of Coop world / Anna, exported the date. Merging ticks 2 steps here that are not ticked yet. Nothing is unticked, and the plan stays as it is.',
      list: ['Phase 1: 1 step', 'Phase 2: 1 step'],
      note: 'Already ticked here: 1 step.',
      folded: { summary: 'Skipped: 1 step not in this plan', items: ['calc-9-x'] },
      confirmLabel: 'Merge 2 ticks',
    },
  );
  // With nothing ticked already and nothing skipped, the question has no note and no fold.
  const clean = mergeQuestion(
    'a.json',
    source([phaseOne[0]!]),
    mergePreview([phaseOne[0]!], {}, groups),
  );
  assert.equal(clean.note, undefined);
  assert.equal(clean.folded, undefined);
  assert.equal(clean.confirmLabel, 'Merge 1 tick');
  assert.equal(mergedMessage(1, 'a.json'), 'Merged 1 tick from “a.json”. Nothing was unticked.');
});

test('a long skipped list names the first fifty and counts the rest', () => {
  const unknown = Array.from({ length: 60 }, (_, i) => 'gone-' + i);
  const folded = mergeQuestion(
    'a.json',
    source([phaseOne[0]!, ...unknown]),
    mergePreview([phaseOne[0]!, ...unknown], {}, groups),
  ).folded!;
  assert.equal(folded.items.length, 51);
  assert.equal(folded.items.at(-1), 'and 10 more');
});

test('an empty file, a file with nothing new and a file of unknown steps merge nothing, and say why', () => {
  assert.equal(
    nothingToMerge(source([]), mergePreview([], {}, groups)),
    'This file has no ticked steps, so there is nothing to merge.',
  );
  const ticked = { [phaseOne[0]!]: true, [phaseOne[1]!]: true };
  assert.equal(
    nothingToMerge(source(Object.keys(ticked)), mergePreview(Object.keys(ticked), ticked, groups)),
    'Nothing new to merge: 2 steps it ticks are ticked here already.',
  );
  assert.equal(
    nothingToMerge(source(['gone']), mergePreview(['gone'], {}, groups)),
    'Nothing new to merge: 1 step is not in this plan.',
  );
  assert.equal(
    nothingToMerge(
      source([phaseOne[0]!, 'gone']),
      mergePreview([phaseOne[0]!, 'gone'], { [phaseOne[0]!]: true }, groups),
    ),
    'Nothing new to merge: 1 step it ticks is ticked here already, and 1 step is not in this plan.',
  );
  assert.equal(
    nothingToMerge(source([phaseOne[0]!]), mergePreview([phaseOne[0]!], {}, groups)),
    null,
  );
});

test('a file that is not a progress export is refused with a clear message', () => {
  for (const file of [null, 'text', 42, [], {}, { format: 'something-else', ticks: [] }])
    assert.throws(() => readProgressFile(file), { message: NOT_PROGRESS });
  assert.throws(() => readProgressFile(ticksFile([], { version: 2 })), {
    message:
      'This progress file was made by a newer planner version, so nothing was merged. Update the app to merge it.',
  });
  for (const damaged of [
    ticksFile([1]),
    ticksFile([], { version: '1' }),
    { format: TICKS_FORMAT, version: 1 },
  ])
    assert.throws(() => readProgressFile(damaged), /This progress file is damaged/);
  assert.throws(
    () => readProgressFile({ format: 'satisfactory-planner-backup', state: { version: 99 } }),
    /made by a newer planner version/,
  );
  assert.throws(() => readProgressFile({ format: 'satisfactory-planner-saves', version: 1 }), {
    message: 'Choose a full planner save export.',
  });
});

test('a progress backup gives its ticks, old unlock keys merged as an import merges them', () => {
  const read = readProgressFile({
    format: 'satisfactory-planner-backup',
    profileId: 'p',
    saveName: 'Coop world',
    profileName: 'Anna',
    state: {
      version: 1,
      settings: { phase: '1' },
      checks: {
        'recipe-unlock-amp:Recipe_Alternate_Screw_C': true,
        'early-base-hub': true,
        x: false,
      },
      notes: {},
      deliveries: {},
      customTasks: [],
    },
  });
  assert.equal(read.kind, 'backup');
  assert.deepEqual(read.ticks, ['early-base-hub', 'recipe-unlock-Recipe_Alternate_Screw_C']);
});

// Both editions: tick some steps in one profile, export its ticks (the ticks file, the progress
// backup and the one-profile save export), and merge each into a second profile of the same plan
// that has ticks of its own, through the edition's own /api/update.
const firstTicks = () => [phaseOne[0]!, phaseOne[1]!, phaseTwo[0]!];
const secondTicks = () => ({ [phaseOne[1]!]: true, [phaseOne[3]!]: true, [phaseTwo[2]!]: false });
function checkUnion(state: ProgressState) {
  const ticked = Object.keys(state.checks)
    .filter(id => state.checks[id])
    .sort();
  assert.deepEqual(ticked, [phaseOne[0]!, phaseOne[1]!, phaseOne[3]!, phaseTwo[0]!].sort());
  assert.equal(state.checks[phaseTwo[2]!], false, 'a step only this profile unticked stays so');
}
async function mergeInto(
  update: (body: unknown) => Promise<unknown>,
  state: () => Promise<ProgressState>,
  file: unknown,
  stored: StoredCalculatedPlan,
) {
  const here = await state();
  const read = readProgressFile(JSON.parse(JSON.stringify(file)));
  const preview = mergePreview(read.ticks, here.checks, groupsOf(stored, here));
  assert.deepEqual(preview.newIds.sort(), [phaseOne[0]!, phaseTwo[0]!].sort());
  assert.equal(preview.already, 1);
  for (const keys of mergeChunks(preview.newIds, here.checks))
    await update({ type: 'checks', keys, value: true });
  return state();
}

test('the browser edition stores a merge as it stores any tick', async () => {
  let workspace: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  const store = {
    async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(workspace);
      if (!change) return copy as T;
      const result = change(copy);
      workspace = copy;
      return structuredClone(result);
    },
  };
  const api = createBrowserApi(store, calculate, {} as Catalog);
  const call = (route: string, scope: object, body?: unknown) =>
    api(route, {
      headers: scope as Record<string, string>,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const first = (await api('/api/profiles', {
    body: JSON.stringify({ saveName: 'Coop world', name: 'Anna', settings }),
  })) as { saveId: string; profileId: string };
  const anna = { 'X-Save-Id': first.saveId, 'X-Profile-Id': first.profileId };
  await call('/api/update', anna, { type: 'checks', keys: firstTicks(), value: true });
  const second = (await api('/api/profiles', {
    body: JSON.stringify({ saveId: first.saveId, name: 'Ben', settings }),
  })) as { saveId: string; profileId: string };
  const ben = { 'X-Save-Id': second.saveId, 'X-Profile-Id': second.profileId };
  await call('/api/update', ben, {
    type: 'checks',
    keys: Object.keys(secondTicks()).slice(0, 2),
    value: true,
  });
  await call('/api/update', ben, { type: 'check', key: phaseTwo[2]!, value: false });
  const annaState = (await call('/api/state', anna)) as ProgressState;
  const benPlan = workspace.saves[0]!.profiles[1]!.plan as StoredCalculatedPlan;
  const files = [
    ticksExport(annaState.checks, 'Coop world', 'Anna'),
    await call('/api/export', anna),
    await api(`/api/export-saves?save=${first.saveId}&profile=${first.profileId}`, {}),
  ];
  for (const file of files) {
    const before = structuredClone(workspace.saves[0]!.profiles[1]!.state);
    const merged = await mergeInto(
      body => call('/api/update', ben, body),
      async () => (await call('/api/state', ben)) as ProgressState,
      file,
      benPlan,
    );
    checkUnion(merged);
    assert.deepEqual(
      (await call('/api/state', anna)) as ProgressState,
      annaState,
      'the profile the file came from is untouched',
    );
    // Back to Ben's progress before this file, for the next one.
    workspace.saves[0]!.profiles[1]!.state = before;
  }
});

test('the Docker server stores a merge as it stores any tick', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-merge-'));
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const send = async (route: string, scope: object, body?: unknown) => {
    const response = await fetch(url + route, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Planner-Request': '1',
        ...(scope as Record<string, string>),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  try {
    const first = await send(
      '/api/profiles',
      {},
      { saveName: 'Coop world', name: 'Anna', settings },
    );
    const anna = { 'X-Save-Id': first.saveId, 'X-Profile-Id': first.profileId };
    await send('/api/update', anna, { type: 'checks', keys: firstTicks(), value: true });
    const second = await send('/api/profiles', {}, { saveId: first.saveId, name: 'Ben', settings });
    const ben = { 'X-Save-Id': second.saveId, 'X-Profile-Id': second.profileId };
    const annaState: ProgressState = await send('/api/state', anna);
    const benPlan: StoredCalculatedPlan = (await send('/api/context', ben)).plan;
    const files = [
      ticksExport(annaState.checks, 'Coop world', 'Anna'),
      await send('/api/export', anna),
      await send(`/api/export-saves?save=${first.saveId}&profile=${first.profileId}`, {}),
    ];
    for (const file of files) {
      // Ben's own progress before each merge: two ticks, one of them a step Anna ticked too, and
      // a step only Ben unticked.
      await send('/api/update', ben, { type: 'checks', keys: firstTicks(), value: false });
      await send('/api/update', ben, {
        type: 'checks',
        keys: Object.keys(secondTicks()).slice(0, 2),
        value: true,
      });
      await send('/api/update', ben, { type: 'check', key: phaseTwo[2]!, value: false });
      const merged = await mergeInto(
        body => send('/api/update', ben, body),
        () => send('/api/state', ben),
        file,
        benPlan,
      );
      // Unticked before each merge, so the steps unticked here are only Ben's own.
      const ticked = Object.keys(merged.checks)
        .filter(id => merged.checks[id])
        .sort();
      assert.deepEqual(ticked, [phaseOne[0]!, phaseOne[1]!, phaseOne[3]!, phaseTwo[0]!].sort());
      assert.deepEqual(
        await send('/api/state', anna),
        annaState,
        'the source profile is untouched',
      );
    }
    // Saved to disk, so it survives a restart.
    const stored = JSON.parse(await fsp.readFile(path.join(dir, 'workspace.json'), 'utf8'));
    const benStored = stored.saves[0].profiles.find(
      (p: { id: string }) => p.id === second.profileId,
    );
    assert.equal(benStored.state.checks[phaseTwo[0]!], true);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('a merge larger than one update is sent in updates of at most a thousand ids', () => {
  const ids = Array.from({ length: 2500 }, (_, i) => 'slot-A' + i + '-built');
  const chunks = mergeChunks(ids, { [ids[0]!]: true });
  assert.deepEqual(
    chunks.map(chunk => chunk.length),
    [MERGE_CHUNK, MERGE_CHUNK, 499],
  );
  const state = chunks.reduce(
    (current, keys) => mutate(current, { type: 'checks', keys, value: true }),
    blank(),
  );
  assert.equal(Object.keys(state.checks).length, 2499);
});
