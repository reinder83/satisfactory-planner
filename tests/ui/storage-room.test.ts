// The printed storage room moved from plan.json into storage-room.ts (#388). Every profile builds
// its room from it, so the room must come out exactly as before: this golden test compares the
// bays, the hidden bays, the floors and their counts with a snapshot taken on main before the
// move (tests/fixtures/storage-room-golden.json), for the original profile, with layout edits,
// and for calculated profiles with and without the collectables bays.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'vitest';
import {
  floorProgress,
  hiddenStorageBays,
  storageBays,
  storageFloors,
} from '../../public/app/views/storage.ts';
import handbookJson from '../../public/plan.json' with { type: 'json' };
import recipesJson from '../../recipes.json' with { type: 'json' };
import { handbookToPlan, migrateHandbookState } from '../../public/handbook-migration.ts';
import * as session from '../../public/app/session.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { $$, catalog, generated, generatedWith, go, open, page } from './setup.ts';
import { nextTick } from 'vue';
import { render } from '../../public/app/shell.ts';
import type { Handbook, Phase, Recipe, StorageEdits } from '../../public/types/index.ts';

const golden = 'tests/fixtures/storage-room-golden.json';

const room = () => ({
  bays: storageBays(),
  hidden: hiddenStorageBays(),
  floors: storageFloors(),
  progress: [...floorProgress()],
});

function snapshot() {
  const out: Record<string, unknown> = {};
  open();
  out.original = room();
  open({
    state: {
      checks: { 'slot-A01-built': true, 'slot-C02-verified': true },
      storageEdits: {
        hiddenBays: ['Q'],
        bayFloors: { C: 'upper' },
        bayNames: { B: 'Renamed' },
        clearedSlots: ['A03'],
      } as unknown as StorageEdits,
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
// every slot record and layout edit as it was. Its plan steps keep their ids and order too.
test('a migrated handbook profile has the same storage room and plan steps', async () => {
  page();
  const handbook = handbookJson as unknown as Handbook;
  const conversion = handbookToPlan(
    handbook,
    (recipesJson as unknown as { recipes: Recipe[] }).recipes,
    catalog().pureLimits,
  );
  const state = {
    checks: { 'slot-A01-built': true, 'slot-C02-verified': true, 'phase-3-survey': true },
    storageEdits: {
      hiddenBays: ['Q'],
      bayFloors: { C: 'upper' },
      bayNames: { B: 'Renamed' },
      clearedSlots: ['A03'],
      slots: { A09: 'Hard Drive' },
    } as unknown as StorageEdits,
  };
  const steps = () => planTasks().map(t => t.id);
  const before: Record<string, unknown> = {};
  for (const phase of ['3', '4', '5', 'post'] as Phase[]) {
    open({ phase, state: structuredClone(state) });
    before[phase] = { room: room(), steps: steps() };
  }
  // The original profile's whole saved state, as the session holds it, is what migrates.
  open({ phase: '3', state: structuredClone(state) });
  const migrated = migrateHandbookState(structuredClone(session.state), handbook, conversion);
  for (const phase of ['3', '4', '5', 'post'] as Phase[]) {
    open({
      calculated: structuredClone(conversion.plan),
      phase,
      state: { ...structuredClone(migrated), settings: { phase } },
    });
    assert.deepEqual(
      JSON.parse(JSON.stringify({ room: room(), steps: steps() })),
      JSON.parse(JSON.stringify(before[phase])),
      phase,
    );
    // Neither the template notice nor the built-room one (decision 3B).
    if (phase === '3') {
      session.setFloor('ground');
      go('storage');
      render();
      await nextTick();
      assert.ok(
        !$$('#main .notice').some(notice =>
          /Optional storage template|Ground floor is built/.test(notice.textContent!),
        ),
        'no template or built-room notice',
      );
    }
  }
});
