// Shared by the tests of the handbook migration's re-keying (import-migration.test.ts,
// backup-restore.test.ts).
import assert from 'node:assert/strict';
import type { HandbookConversion } from '../../public/handbook-migration.ts';
import type { ProgressState, SavedState } from '../../public/types/index.ts';

// Checks, independently of migrateHandbookState, that every record of `before` is in `after`:
// under its own key, re-keyed to its factory's row, or kept for review in unmapped.
export function everyRecordKept(
  before: SavedState,
  after: ProgressState,
  { rows }: Pick<HandbookConversion, 'rows'>,
) {
  const unmapped = after.handbookOrigin!.unmapped;
  const rowsOf = (factoryId: string) =>
    [...new Set(['3', '4', '5'].map(phase => rows[phase]?.[factoryId]))].filter(
      (row): row is string => !!row,
    );
  for (const [key, ticked] of Object.entries(before.checks)) {
    const factory = /^factory-([345])-(.+)$/.exec(key);
    const row = factory && rows[factory[1]!]?.[factory[2]!];
    if (row) assert.equal(after.checks[`calc-${factory[1]}-${row}`], ticked, key);
    else if (factory) assert.equal(unmapped.checks[key], ticked, key + ' is kept for review');
    else assert.equal(after.checks[key], ticked, key);
  }
  for (const [key, note] of Object.entries(before.notes)) {
    const targets = key.startsWith('factory-') ? rowsOf(key.slice('factory-'.length)) : [key];
    if (targets.length)
      for (const target of targets)
        assert.equal(
          after.notes[key.startsWith('factory-') ? 'factory-' + target : target],
          note,
          key,
        );
    else assert.equal(unmapped.notes[key], note, key + ' is kept for review');
  }
  for (const [id, count] of Object.entries(before.deliveries))
    assert.equal(after.deliveries[id], count, id);
  assert.deepEqual(after.customTasks, before.customTasks);
  assert.equal(after.settings.phase, before.settings.phase);
}
