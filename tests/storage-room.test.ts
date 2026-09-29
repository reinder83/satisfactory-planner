// The printed storage room (public/storage-room.ts, #388) is the storage section plan.json has
// always had: every released plan.json carries the same bays, so a profile with its own copy of
// the handbook sees the same room. While plan.json exists the two must stay equal.
import test from 'node:test';
import assert from 'node:assert/strict';
import plan from '../public/plan.json' with { type: 'json' };
import { STORAGE_ROOM } from '../public/storage-room.ts';

test("the printed storage room equals plan.json's storage section", () => {
  assert.deepEqual(STORAGE_ROOM, plan.storage);
  assert.equal(STORAGE_ROOM.flatMap(b => b.items).filter(x => x.name).length, 132);
});
