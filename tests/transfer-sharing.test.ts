// The full-save export selection and the import id remapping both editions share (#522):
// selectForExport and remapImportedIds in public/transfer.ts. The routes that call them are
// covered end to end in server.test.ts, browser-api.test.ts and sharing.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, shareState } from '../public/state.ts';
import {
  exportQuery,
  remapImportedIds,
  selectForExport,
  transferFormat,
  transferImportLimit,
} from '../public/transfer.ts';
import type { ProgressState } from '../public/types/index.ts';

// A state with progress, so a share visibly strips it.
const progress = (note: string): ProgressState => ({
  ...initialState(),
  checks: { 'calc-1-iron-ingot': true },
  notes: { global: note },
});
// Saves in an edition's stored shape, with keys out of the usual order, an unknown key and a
// payoff ranking, which the export must leave as they are, apart from the payoff.
const stored = () => [
  {
    id: 'save-a',
    name: 'World A',
    legacy: 'kept',
    activeProfile: 'a1',
    profiles: [
      { state: progress('a1 notes'), id: 'a1', name: 'First', kind: 'calculated' as const },
      {
        id: 'a2',
        name: 'Second',
        kind: 'calculated' as const,
        payoff: { planCreatedAt: 'x' },
        state: progress('a2 notes'),
      },
    ],
  },
  {
    id: 'save-b',
    name: 'World B',
    activeProfile: 'b1',
    profiles: [{ id: 'b1', name: 'Only', kind: 'calculated' as const, state: progress('b1') }],
  },
];
const query = (search: string) => exportQuery(new URLSearchParams(search));
// notFound must throw; this one throws the message with a marker, so a test sees it was used.
const notFound = (message: string): never => {
  throw new Error('refused: ' + message);
};

test('exportQuery reads the scope and the share flag as both routes do', () => {
  assert.deepEqual(query(''), { chosen: undefined, saveId: null, profileId: null, share: false });
  assert.deepEqual(query('saves=a,,b&save=s&profile=p&share=1'), {
    chosen: ['a', 'b'],
    saveId: 's',
    profileId: 'p',
    share: true,
  });
  // An empty selection selects no saves rather than all of them.
  assert.deepEqual(query('saves=').chosen, []);
  assert.equal(query('share=true').share, false);
});

test('an unscoped export keeps every save as stored, drops payoff and counts as a backup', () => {
  const saves = stored();
  const before = structuredClone(saves);
  const { exported, countsAsBackup } = selectForExport(saves, query(''), notFound);
  assert.equal(exported.format, transferFormat);
  assert.equal(exported.version, 1);
  assert.ok(!Number.isNaN(Date.parse(exported.exportedAt)));
  assert.deepEqual(Object.keys(exported), ['format', 'version', 'exportedAt', 'saves']);
  assert.deepEqual(Object.keys(exported.saves[0]!), [
    'id',
    'name',
    'legacy',
    'activeProfile',
    'profiles',
  ]);
  assert.deepEqual(Object.keys(exported.saves[0]!.profiles[0]!), ['state', 'id', 'name', 'kind']);
  assert.deepEqual(Object.keys(exported.saves[0]!.profiles[1]!), ['id', 'name', 'kind', 'state']);
  assert.deepEqual(exported.saves[0]!.profiles[1]!.state, before[0]!.profiles[1]!.state);
  assert.equal(countsAsBackup(), true);
  assert.deepEqual(saves, before, 'the stored saves are not changed');
});

test('a selection keeps the stored order, refuses an unknown id and is not a backup', () => {
  const both = selectForExport(stored(), query('saves=save-b,save-a'), notFound);
  assert.deepEqual(
    both.exported.saves.map(s => s.id),
    ['save-a', 'save-b'],
  );
  assert.equal(both.countsAsBackup(), false);
  const none = selectForExport(stored(), query('saves='), notFound);
  assert.deepEqual(none.exported.saves, []);
  assert.equal(none.countsAsBackup(), false);
  assert.throws(
    () => selectForExport(stored(), query('saves=save-a,missing'), notFound),
    /^Error: refused: Save not found\.$/,
  );
  assert.throws(
    () => selectForExport(stored(), query('save=missing'), notFound),
    /^Error: refused: Save not found\.$/,
  );
  assert.throws(
    () => selectForExport(stored(), query('save=save-a&profile=b1'), notFound),
    /^Error: refused: Profile not found\.$/,
  );
  assert.equal(selectForExport(stored(), query('save=save-b'), notFound).countsAsBackup(), false);
});

test('one profile is exported alone and becomes its save’s active profile', () => {
  const { exported, countsAsBackup } = selectForExport(stored(), query('profile=a2'), notFound);
  assert.equal(exported.saves.length, 1);
  const [save] = exported.saves;
  assert.equal(save!.activeProfile, 'a2');
  assert.deepEqual(
    save!.profiles.map(p => p.id),
    ['a2'],
  );
  assert.equal('payoff' in save!.profiles[0]!, false);
  assert.equal(countsAsBackup(), false);
  // An active profile that is kept stays active.
  const first = selectForExport(stored(), query('profile=a1'), notFound).exported.saves[0]!;
  assert.equal(first.activeProfile, 'a1');
});

test('a share strips progress with shareState and is never a backup', () => {
  const saves = stored();
  const { exported, countsAsBackup } = selectForExport(
    saves,
    query('save=save-a&profile=a1&share=1'),
    notFound,
  );
  const state = exported.saves[0]!.profiles[0]!.state;
  assert.deepEqual(state, shareState(saves[0]!.profiles[0]!.state));
  assert.deepEqual(state.checks, {});
  assert.deepEqual(state.notes, {});
  assert.equal((saves[0]!.profiles[0]!.state as ProgressState).notes.global, 'a1 notes');
  assert.equal(countsAsBackup(), false);
  assert.equal(selectForExport(stored(), query('share=1'), notFound).countsAsBackup(), false);
});

test('an unscoped export past the import limit does not count as a backup', () => {
  const saves = stored();
  saves[1]!.name = 'x'.repeat(transferImportLimit);
  assert.equal(selectForExport(saves, query(''), notFound).countsAsBackup(), false);
});

test('remapImportedIds gives every profile, then its save, a new id and keeps activeProfile', () => {
  const imported = {
    saves: [
      { id: 'old-a', activeProfile: 'p2', profiles: [{ id: 'p1' }, { id: 'p2' }] },
      // The same ids as another save's: an import never relies on them being unique.
      { id: 'old-b', activeProfile: 'p1', profiles: [{ id: 'p1' }] },
    ],
  };
  const saves = imported.saves;
  let count = 0;
  const remapped = remapImportedIds(imported, () => 'new-' + ++count);
  assert.equal(remapped, saves, 'the saves are changed in place');
  assert.deepEqual(remapped, [
    { id: 'new-3', activeProfile: 'new-2', profiles: [{ id: 'new-1' }, { id: 'new-2' }] },
    { id: 'new-5', activeProfile: 'new-4', profiles: [{ id: 'new-4' }] },
  ]);
});
