// The import confirm (#1217, the last slice of #1077): before "Import saves…" or "Restore this
// profile…" changes anything, the Backup page checks the file as the import checks it and asks
// with what the file holds and what will happen (public/app/import-summary.ts). A file the import
// would refuse is refused with the import's own message, and nothing is asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import {
  backupQuestion,
  OTHER_PROFILE_BACKUP,
  profileProgressText,
  savesImportQuestion,
  WRONG_BACKUP_FORMAT,
} from '../public/app/import-summary.ts';
import { milestoneOnlyPhases } from '../public/progression.ts';
import { phaseProgress, planStepIds, validateState } from '../public/state.ts';
import { localStamp, validateTransfer } from '../public/transfer.ts';
import { seedLegacy } from './helpers/seed.ts';
import { saveExport, version21 } from './types/fixtures.ts';
import type {
  Phase,
  Progression,
  SaveExport,
  SavedState,
  StoredCalculatedPlan,
  WorkspaceSummary,
} from '../public/types/index.ts';

const progression: Progression = JSON.parse(
  readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const phaseLabel = (phase: string) => (phase === 'post' ? 'Post Phase 5' : 'Phase ' + phase);
const context = (fileName = 'anna.json') => ({ fileName, progression, phaseLabel });
// The frozen first-release plan the saveExport fixture carries (start phase 3).
const plan = saveExport.saves[0]!.profiles[0]!.plan as StoredCalculatedPlan;

// Every build-plan step id the plan lists, counted here without profilePhases: the milestone-only
// phases before its start phase, then each phase it plans.
function allSteps(state: SavedState): string[] {
  const phases = [
    ...milestoneOnlyPhases(plan),
    ...(phaseProgress(plan, state.checks) || []).map(entry => entry.phase),
  ];
  return phases.flatMap(phase => planStepIds(plan, state, progression, phase));
}
// A state of the newest version on `phase` with the first `count` steps of the plan ticked, and
// nothing else.
function ticking(count: number, phase: Phase = '3'): SavedState {
  const base = { ...structuredClone(version21), checks: {}, tickedBy: {} };
  const ids = allSteps(base).slice(0, count);
  return { ...base, settings: { phase }, checks: Object.fromEntries(ids.map(id => [id, true])) };
}
const total = allSteps(ticking(0)).length;

const profile = (id: string, name: string, state: SavedState) => ({
  id,
  name,
  kind: 'calculated' as const,
  plan,
  state,
});
const exportOf = (saves: SaveExport['saves'], exportedAt = '2026-10-21T12:05:00.000Z') => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt,
  saves,
});
const oneSave = () =>
  exportOf([
    {
      id: 's1',
      name: 'Coop world',
      activeProfile: 'p1',
      profiles: [profile('p1', 'Main', ticking(12)), profile('p2', 'Co-op', ticking(3, '4'))],
    },
  ]);
// A workspace summary of saves with these profile counts.
const workspaceOf = (...counts: number[]): Pick<WorkspaceSummary, 'saves'> => ({
  saves: counts.map((count, index) => ({
    id: 'own-' + index,
    name: 'Own ' + index,
    activeProfile: 'own-' + index + '-0',
    profiles: Array.from({ length: count }, (_, i) => ({
      id: `own-${index}-${i}`,
      name: 'Profile ' + i,
      kind: 'calculated' as const,
      completed: 0,
      phase: '3' as const,
    })),
  })),
});

test('the fixture plan has steps to count', () => {
  assert.ok(total > 20, total + ' steps');
});

test('a save export with one save lists its profiles, their phase and steps done, and says it adds a copy', () => {
  const data = oneSave();
  const before = structuredClone(data);
  const question = savesImportQuestion(data, workspaceOf(3, 1), context());
  assert.equal(question.title, 'Import this save?');
  assert.equal(
    question.body,
    `anna.json holds the save “Coop world” with 2 profiles, exported ${localStamp(data.exportedAt)}:`,
  );
  assert.deepEqual(question.list, [
    `Main: Phase 3, 12 of ${total} steps done`,
    `Co-op: Phase 4, 3 of ${total} steps done`,
  ]);
  assert.equal(
    question.note,
    `Importing adds it as a new copy, “Coop world (from anna.json, exported ${localStamp(data.exportedAt)})”, next to your 4 profiles. Nothing you have is replaced, and you stay on the profile you have open.`,
  );
  assert.equal(question.confirmLabel, 'Import saves');
  assert.equal(question.danger, undefined, 'adding copies is not destructive');
  assert.deepEqual(data, before, 'the file as read is not changed: the import labels it itself');
});

test('a save export with several saves names each profile with its save', () => {
  const data = exportOf([
    { id: 'a', name: 'North', activeProfile: 'a1', profiles: [profile('a1', 'Main', ticking(1))] },
    { id: 'b', name: 'South', activeProfile: 'b1', profiles: [profile('b1', 'Main', ticking(0))] },
  ]);
  const question = savesImportQuestion(data, workspaceOf(1), context());
  assert.equal(question.title, 'Import these saves?');
  assert.match(question.body, /^anna\.json holds 2 saves with 2 profiles, exported /);
  assert.deepEqual(question.list, [
    `North · Main: Phase 3, 1 of ${total} steps done`,
    `South · Main: Phase 3, 0 of ${total} steps done`,
  ]);
  assert.match(
    question.note!,
    /^Importing adds them as new copies named after the file, next to your 1 profile\./,
  );
});

test('into an empty workspace the question says the copy opens', () => {
  const question = savesImportQuestion(oneSave(), workspaceOf(), context());
  assert.match(
    question.note!,
    /^Importing adds it as a new copy, “Coop world \(from anna\.json, exported .*\)”, and opens it, since you have no saves yet\.$/,
  );
});

test('a one-profile export and a share read as a save with one profile', () => {
  const shared = exportOf([
    { id: 's', name: 'Shared', activeProfile: 'p', profiles: [profile('p', 'Plan', ticking(0))] },
  ]);
  const question = savesImportQuestion(shared, workspaceOf(2), context('share.json'));
  assert.match(question.body, /^share\.json holds the save “Shared” with 1 profile, exported/);
  assert.deepEqual(question.list, [`Plan: Phase 3, 0 of ${total} steps done`]);
});

test('an old export with an original profile counts its ticks, and a file without a date says none', () => {
  const old = JSON.parse(
    readFileSync(new URL('./fixtures/export-2026-09-13.json', import.meta.url), 'utf8'),
  );
  delete old.exportedAt;
  const question = savesImportQuestion(old, workspaceOf(1), context('old.json'));
  const state = old.saves[0].profiles[0].state;
  const ticked = Object.values(validateState(state).checks).filter(Boolean).length;
  assert.equal(question.body, 'old.json holds the save “My Satisfactory save” with 1 profile:');
  assert.match(question.list![0]!, new RegExp(`: Phase \\d, ${ticked} ticked$`));
});

test('more than twelve profiles fold the rest under a count', () => {
  const profiles = Array.from({ length: 15 }, (_, i) => profile('p' + i, 'P' + i, ticking(0)));
  const data = exportOf([{ id: 's', name: 'Big', activeProfile: 'p0', profiles }]);
  const question = savesImportQuestion(data, workspaceOf(1), context());
  assert.equal(question.list!.length, 12);
  assert.equal(question.folded!.summary, '3 more profiles');
  assert.equal(question.folded!.items.length, 3);
});

test('without progression.json the profiles show their ticks', () => {
  const question = savesImportQuestion(oneSave(), workspaceOf(1), {
    ...context(),
    progression: undefined,
  });
  assert.deepEqual(question.list, ['Main: Phase 3, 12 ticked', 'Co-op: Phase 4, 3 ticked']);
});

test('a damaged or newer save export is refused with the import’s own message, before any question', () => {
  const refusal = (data: unknown) => {
    try {
      validateTransfer(data);
    } catch (error) {
      return (error as Error).message;
    }
    return '';
  };
  const noProfiles = exportOf([{ id: 's', name: 'Empty', activeProfile: 'p', profiles: [] }]);
  // The file as JSON reads it, so its state can carry a version no release has.
  const newer: { saves: { profiles: { state: Record<string, unknown> }[] }[] } = JSON.parse(
    JSON.stringify(oneSave()),
  );
  newer.saves[0]!.profiles[0]!.state.version = 99;
  const damaged = oneSave();
  (damaged.saves[0]!.profiles[0]!.state as { checks: unknown }).checks = 'all of them';
  for (const data of [noProfiles, newer, damaged, { format: 'other' }, null]) {
    const message = refusal(data);
    assert.ok(message, 'the import refuses it');
    assert.throws(() => savesImportQuestion(data, workspaceOf(1), context()), { message });
  }
  assert.match(refusal(newer), /newer planner/);
});

test('a save name the import would shorten is accepted, as the import accepts it', () => {
  const data = oneSave();
  data.saves[0]!.name = 'W'.repeat(120);
  assert.throws(() => validateTransfer(data), 'too long on its own');
  const question = savesImportQuestion(data, workspaceOf(1), context());
  assert.equal(question.title, 'Import this save?');
});

const target = (state: SavedState) => ({
  id: 'original',
  name: 'Main',
  plan,
  state: validateState(structuredClone(state)),
});
const backupFile = (state: unknown, extra: object = {}) => ({
  format: 'satisfactory-planner-backup',
  exportedAt: '2026-10-21T12:05:00.000Z',
  saveName: 'Coop world',
  profileName: 'Main',
  profileId: 'original',
  state,
  ...extra,
});

test('a progress backup says it replaces the progress, with the steps done now and in the file', () => {
  const question = backupQuestion(backupFile(ticking(9)), target(ticking(14)), context('b.json'));
  assert.equal(question.title, 'Restore this backup?');
  assert.equal(
    question.body,
    `This replaces the progress of “Main”: 14 of ${total} steps done now, 9 in the file.`,
  );
  assert.equal(
    question.note,
    `The file is a backup of “Coop world / Main”, exported ${localStamp('2026-10-21T12:05:00.000Z')}. Its notes, deliveries and personal tasks replace this profile’s too. The plan stays as it is.`,
  );
  assert.equal(question.confirmLabel, 'Replace progress');
  assert.equal(question.danger, true);
});

test('a backup on another phase says so, and a bare state reads without a source', () => {
  const question = backupQuestion(ticking(2, '4'), target(ticking(5)), context());
  assert.equal(
    question.note,
    'It works on Phase 4, this profile now on Phase 3. Its notes, deliveries and personal tasks replace this profile’s too. The plan stays as it is.',
  );
  assert.equal(
    profileProgressText(plan, ticking(2, '4'), context()),
    `Phase 4, 2 of ${total} steps done`,
  );
});

test('a refused backup reads exactly as the Docker server refuses it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'import-summary-'));
  await seedLegacy(dir);
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  try {
    const before = await (await fetch(url + '/api/state')).json();
    const files = [
      backupFile(ticking(1), { format: 'satisfactory-planner-ticks' }),
      backupFile(ticking(1), { profileId: 'someone-else' }),
      backupFile({ ...ticking(1), version: 99 }),
      backupFile({ ...ticking(1), checks: 'all' }),
    ];
    const messages: string[] = [];
    for (const file of files) {
      const reply = await fetch(url + '/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
        body: JSON.stringify(file),
      });
      assert.equal(reply.status, 400);
      const { error } = (await reply.json()) as { error: string };
      messages.push(error);
      assert.throws(() => backupQuestion(file, target(before), context()), { message: error });
    }
    assert.equal(messages[0], WRONG_BACKUP_FORMAT);
    assert.equal(messages[1], OTHER_PROFILE_BACKUP);
    assert.match(messages[2]!, /newer planner/);
    assert.deepEqual(await (await fetch(url + '/api/state')).json(), before, 'nothing changed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
