// The printed storage room (public/storage-room.ts, #388) is the storage section the retired
// handbook (plan.json, removed in #397) always had: every released handbook carries the same
// bays, so a profile migrated with its own copy sees the same room. The server's frozen copy of
// the handbook (migrations/) and the room must stay equal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { frozenHandbook as plan } from './helpers/data.ts';
import { STORAGE_ROOM } from '../public/storage-room.ts';

test("the printed storage room equals the frozen handbook's storage section", () => {
  assert.deepEqual(STORAGE_ROOM, plan.storage);
  assert.equal(STORAGE_ROOM.flatMap(b => b.items).filter(x => x.name).length, 132);
});
