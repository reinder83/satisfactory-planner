// profileLabel (public/app/profile-edit.ts, #1355): a kept version's name followed by the profile
// it is a version of, for the switcher and the compare pickers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { profileLabel } from '../public/app/profile-edit.ts';

const profiles = [
  { id: 'p', name: 'Iron run' },
  { id: 'b', name: 'Nov 14 · backup 2', backupOf: 'p' },
  { id: 'c', name: 'Nov 14 · backup 2', backupOf: 'gone' },
];

test('a kept version names the profile it belongs to; others read as their own name', () => {
  assert.equal(profileLabel(profiles, 'b'), 'Nov 14 · backup 2 (of Iron run)');
  assert.equal(profileLabel(profiles, 'p'), 'Iron run');
  assert.equal(profileLabel(profiles, 'c'), 'Nov 14 · backup 2', 'its profile is gone');
  assert.equal(profileLabel(profiles, 'none'), '');
});
