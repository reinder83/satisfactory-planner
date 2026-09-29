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
import { generated, generatedWith, open } from './setup.ts';
import type { StorageEdits } from '../../public/types/index.ts';

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
