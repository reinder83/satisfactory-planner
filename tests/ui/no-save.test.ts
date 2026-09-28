// The empty workspace (#281, #360): before any save exists the save status claims nothing, and
// the pages that show a save's plan give way to one "Create a save" action (NoSavePage.vue)
// instead of a dashboard of zeros or an empty <main>.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setContext, setWorkspace, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { initialState } from '../../public/state.ts';
import { $, $$, go, handbook, open, page } from './setup.ts';
import type { View } from '../../public/app/session.ts';
import type { Catalog, ProgressState } from '../../public/types/index.ts';

// What boot() sets up for an empty workspace: a placeholder save and profile with empty ids.
function emptyWorkspace() {
  setWorkspace({
    user: { id: 'owner', username: 'Pioneer' },
    accountsEnabled: false,
    catalog: {} as Catalog,
    saves: [],
  });
  setContext({
    save: { id: '', name: 'New save' },
    profile: { id: '', kind: 'original', name: 'Choose a profile' },
    state: { ...initialState(), settings: { phase: '3' } } as ProgressState,
    plan: null,
    handbook,
  });
}

// What Tab reaches first inside <main>.
const firstTabStop = () =>
  $$<HTMLElement>('#main button, #main a[href], #main input, #main select, #main summary').find(
    e => e.tabIndex >= 0 && !(e as HTMLButtonElement).disabled,
  );

beforeEach(() => {
  page();
  emptyWorkspace();
});

const NEEDS_SAVE: View[] = ['plan', 'factories', 'logistics', 'storage', 'resources', 'notes'];

for (const view of NEEDS_SAVE)
  test(`with no save, #${view} offers one "Create a save" and no zeroed plan`, () => {
    go(view);
    render();
    assert.ok($('#main [data-no-save]'), 'the empty state');
    assert.equal($('#main h1')!.getAttribute('tabindex'), '-1', 'a heading that can take focus');
    const primary = $$('#main .btn.primary');
    assert.equal(primary.length, 1, 'one primary action');
    assert.equal(primary[0]!.textContent!.trim(), 'Create a save');
    assert.equal(firstTabStop(), primary[0], 'the first thing Tab reaches');
    assert.equal($('#main .stat'), null, 'no summary tiles');
    assert.equal($('#main .checklist'), null, 'no checklist');
    assert.equal($('#main a[href="#backup"]')!.textContent, 'Import saves on the Backup page');
  });

test('"Create a save" opens the guided start', async () => {
  go('plan');
  render();
  $('#main [data-new-save]')!.click();
  await nextTick();
  assert.equal(wizard?.mode, 'guided');
});

test('Saves & profiles and Backup still open without a save', () => {
  for (const view of ['profiles', 'backup'] as View[]) {
    go(view);
    render();
    assert.equal($('#main [data-no-save]'), null, view);
  }
});

test('with no save the status claims nothing, and its dot is left out', async () => {
  go('plan');
  render();
  assert.equal($('#saved')!.textContent, 'Nothing saved yet');
  assert.equal($('#saved-short')!.textContent, 'No save yet');
  assert.equal($$('.save-status .dot').length, 0);
  // An open save reads as before.
  open();
  render();
  await nextTick();
  assert.equal($('#saved')!.textContent, 'Saved on server');
  assert.equal($('#saved-short')!.textContent, 'Saved');
  assert.equal($$('.save-status .dot').length, 2);
  assert.equal($('#main [data-no-save]'), null, 'the plan opens as before');
  assert.ok($('#main .checklist'));
});
