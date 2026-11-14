// PRO-3 (#1350): the copy a recalculation or a restore keeps is named short, "Oct 7 · backup 1",
// unique among the save's profiles, and a name already stored (the old
// "<name> (before edit, Oct 7, 2:05 PM)" or one the user typed) is never changed.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { nameDate } from '../../public/app/profile-edit.ts';
import { keptName } from '../../public/app/recalculate.ts';
import { restoreKeptName } from '../../public/app/restore-version.ts';
import { render } from '../../public/app/shell.ts';
import { $, go, open, page } from './setup.ts';

const today = nameDate();
const profile = (id: string, name: string) => ({
  id,
  name,
  kind: 'calculated' as const,
  completed: 0,
  phase: '1' as const,
});

test('a new copy is short, numbered past the names the save has, and old names stay', () => {
  page();
  const oldName = 'Balanced (before edit, Oct 7, 2:05 PM)';
  open({
    workspace: {
      saves: [
        {
          id: 's',
          name: 'World',
          activeProfile: 'p',
          profiles: [
            profile('p', 'Balanced · Oct 7'),
            profile('b0', oldName),
            profile('b1', `${today} · backup 1`),
          ],
        },
      ],
    },
  });
  assert.equal(keptName('s'), `${today} · backup 2`, 'two copies on one day are told apart');
  assert.equal(restoreKeptName('s'), `${today} · restore backup 1`);
  assert.equal(keptName('other'), `${today} · backup 1`, 'another save counts on its own');
  go('profiles');
  render();
  // The old name is still the card's name.
  assert.ok(
    [...document.querySelectorAll('#main h3, #main h2')].some(el =>
      el.textContent?.includes(oldName),
    ),
    'a stored name is shown as it was',
  );
  assert.ok($('#main')!.textContent!.includes(`${today} · backup 1`));
});
