// PRO-2 (#1350): the three ways to make a variant each say in one line what they do.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { render } from '../../public/app/shell.ts';
import { $, go, open, page } from './setup.ts';

test('Create a save, Try another profile and Duplicate each explain themselves', () => {
  page();
  open({
    workspace: {
      saves: [
        {
          id: 's',
          name: 'World',
          activeProfile: 'p',
          profiles: [{ id: 'p', kind: 'calculated', name: 'One', completed: 0, phase: '1' }],
        },
      ],
    },
  });
  go('profiles');
  render();
  assert.match($('[data-new-save]')!.getAttribute('title')!, /new world/i);
  assert.match(
    $('[data-new-profile="s"]')!.getAttribute('title')!,
    /another profile in this save/i,
  );
  assert.match($('[data-duplicate-profile="p"]')!.getAttribute('title')!, /Copy this profile/);
});
