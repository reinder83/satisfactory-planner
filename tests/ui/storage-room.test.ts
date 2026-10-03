// The printed storage room moved from plan.json into storage-room.ts (#388). Every profile builds
// its room from it, so the room must come out exactly as before: this golden test compares the
// bays, the hidden bays, the floors and their counts with a snapshot taken on main before the
// move (tests/fixtures/storage-room-golden.json). Its "original" entries are the printed room as
// the retired handbook profile drew it, plain and with layout edits; a profile migrated from the
// handbook (#387) now draws them (#798). The calculated entries are with and without the
// collectables bays.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'vitest';
import {
  floorProgress,
  hiddenStorageBays,
  storageBays,
  storageFloors,
} from '../../public/app/views/storage.ts';
import { migrateHandbookState } from '../../public/handbook-migration.ts';
import * as session from '../../public/app/session.ts';
import { planTasks } from '../../public/app/tasks.ts';
import {
  $,
  $$,
  generated,
  generatedWith,
  go,
  handbook,
  migratedPlan,
  open,
  openMigrated,
  page,
  transcribed,
} from './setup.ts';
import { nextTick } from 'vue';
import { render } from '../../public/app/shell.ts';
import type { Phase, StorageEdits } from '../../public/types/index.ts';

const golden = 'tests/fixtures/storage-room-golden.json';
// A partial test fixture: the page reads only the layout edits a test gives it.
const layoutEdits = (edits: Partial<StorageEdits>) => edits as StorageEdits;

const room = () => ({
  bays: storageBays(),
  hidden: hiddenStorageBays(),
  floors: storageFloors(),
  progress: [...floorProgress()],
});

function snapshot() {
  const out: Record<string, unknown> = {};
  openMigrated();
  out.original = room();
  openMigrated({
    state: {
      checks: { 'slot-A01-built': true, 'slot-C02-verified': true },
      storageEdits: layoutEdits({
        hiddenBays: ['Q'],
        bayFloors: { C: 'upper' },
        bayNames: { B: 'Renamed' },
        clearedSlots: ['A03'],
      }),
    },
  });
  out.originalEdited = room();
  open({ calculated: generated() });
  out.calculated = room();
  open({ calculated: generatedWith({ collectables: true }) });
  out.calculatedCollectables = room();
  open({ calculated: generatedWith({ collectables: false }) });
  out.calculatedNoCollectables = room();
  return JSON.parse(JSON.stringify(out));
}

test('the storage room is drawn exactly as before the move out of plan.json (#388)', () => {
  const now = snapshot();
  if (process.env.WRITE_STORAGE_GOLDEN)
    fs.writeFileSync(golden, JSON.stringify(now, null, 1) + '\n');
  assert.deepEqual(now, JSON.parse(fs.readFileSync(golden, 'utf8')));
});

// A handbook profile migrated to a calculated one (#487) keeps its storage room exactly: the
// transcribed plan (engine 'handbook-…') shows the whole printed room, and the migration leaves
// every slot record, layout edit and storage task tick as it was, so the room drawn from the
// migrated state is the one drawn from the state before. Its plan steps keep their ids and order.
test('a migrated handbook profile has the same storage room and plan steps', async () => {
  page();
  const state = {
    checks: {
      'slot-A01-built': true,
      'slot-C02-verified': true,
      'phase-3-survey': true,
      // The ground-floor moves' step: an ordinary storage task now (decision 3B on #387).
      'storage-filter-moves': true,
    },
    storageEdits: layoutEdits({
      hiddenBays: ['Q'],
      bayFloors: { C: 'upper' },
      bayNames: { B: 'Renamed' },
      clearedSlots: ['A03'],
      slots: { A09: 'Hard Drive' },
    }),
  };
  const steps = () => planTasks().map(t => t.id);
  const before: Record<string, unknown> = {};
  for (const phase of ['3', '4', '5', 'post'] as Phase[]) {
    open({ phase, state: structuredClone(state) });
    const handbookSteps = steps();
    openMigrated({ phase, state: structuredClone(state) });
    before[phase] = { room: room(), steps: handbookSteps };
  }
  // The original profile's whole saved state, as the session holds it, is what migrates.
  open({ phase: '3', state: structuredClone(state) });
  const migrated = migrateHandbookState(structuredClone(session.state), handbook, transcribed());
  assert.equal(migrated.checks['storage-filter-moves'], true, 'the moves’ tick is kept');
  for (const phase of ['3', '4', '5', 'post'] as Phase[]) {
    open({
      calculated: migratedPlan(),
      phase,
      state: { ...structuredClone(migrated), settings: { phase } },
    });
    assert.deepEqual(
      JSON.parse(JSON.stringify({ room: room(), steps: steps() })),
      JSON.parse(JSON.stringify(before[phase])),
      phase,
    );
    // No template notice and no built-room notice (decision 3B); the moves' step is ticked.
    if (phase === '3') {
      session.setFloor('ground');
      go('storage');
      render();
      await nextTick();
      // (Hidden bay Q's items draw their own warning.)
      assert.ok(
        !$$('#main .notice').some(notice =>
          /Optional storage template|Ground floor is built|Moved in this plan/.test(
            notice.textContent!,
          ),
        ),
        'no template or built-room notice',
      );
      assert.equal($('[data-ground-floor]'), null);
      assert.equal(
        $<HTMLInputElement>('#main .checklist [data-check="storage-filter-moves"]')!.checked,
        true,
      );
    }
  }
});
