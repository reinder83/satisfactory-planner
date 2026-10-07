// Edit settings (#1071): one name for the open profile in the top bar, the switcher and the plan
// page; "Edit settings" from the switcher and from a profile card opens All settings on that
// profile's settings without recalculating anything; Review lists what changes; and only the
// "Recalculate in place" button sends /api/recalculate, naming the plan the edit started from.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setWorkspace, view, wizard, workspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import type { StoredCalculatedPlan } from '../../public/types/index.ts';
import { $, catalog, evil, generated, go, open, page, stubFetch } from './setup.ts';

const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const click = async (selector: string) => {
  const el = $(selector);
  assert.ok(el, selector + ' is on screen');
  el.click();
  await settle();
};
const text = (selector: string) => ($(selector)?.textContent || '').replace(/\s+/g, ' ').trim();

let plan: StoredCalculatedPlan;
beforeEach(() => {
  page();
  plan = generated();
  open({ name: 'Minimal construction · Oct 7', calculated: plan });
  setWorkspace({ ...workspace, catalog: catalog() });
  // happy-dom counts 1 as a step mismatch for step="0.1", which browsers do not.
  HTMLFormElement.prototype.reportValidity = () => true;
  go('plan');
  render();
});

test('the top bar, the switcher and the plan page name the open profile alike', async () => {
  open({ name: evil, calculated: plan });
  render();
  await settle();
  assert.equal($('.breadcrumbs a')!.textContent, evil, 'the save stays first');
  assert.equal($('[data-crumb-profile]')!.textContent, evil, 'then the profile, in full');
  assert.equal($('[data-crumb-profile]')!.getAttribute('title'), evil);
  assert.equal($('.profile-switcher-name')!.textContent, evil, 'the switcher says the same');
  assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');
});

test('Edit settings opens the open profile’s settings and recalculates only when asked', async () => {
  const calls = stubFetch<Record<string, unknown>>({
    '/api/preview': generated(),
    '/api/recalculate': {
      workspace,
      saveId: 's',
      profileId: 'p',
      backupId: 'b',
      reviewCount: 2,
      carriedChecks: 4,
    },
    '/api/context': {
      save: { id: 's', name: 'World' },
      profile: { id: 'p', kind: 'calculated', name: 'Edited' },
      state: { settings: { phase: '3' }, checks: {}, notes: {}, deliveries: {}, customTasks: [] },
      plan: generated(),
    },
  });
  await click('button[data-profile-switcher]');
  await click('[data-edit-open-profile]');
  assert.equal(view, 'wizard');
  render();
  await settle();
  assert.equal(wizard!.edit!.profileId, 'p');
  assert.equal(wizard!.mode, 'advanced');
  assert.equal(wizard!.step, 1);
  assert.equal(wizard!.name, 'Minimal construction · Oct 7', 'named as it is');
  assert.deepEqual(calls, [], 'the open profile’s plan is at hand: nothing is requested');
  assert.match(text('#main h1'), /^Edit the settings of Minimal construction · Oct 7/);

  await click('[data-wizard-step="5"]');
  assert.deepEqual(
    calls.map(([path]) => path),
    ['/api/preview'],
    'Review calculates a preview only',
  );
  assert.ok($('[data-edit-diff]'), 'Review lists what changes');
  assert.ok(phaseRows() > 0, 'with a row per phase');
  assert.match(text('[data-edit-intro]'), /^Nothing has changed yet\./);
  assert.equal(text('#wizard-form button[type="submit"]'), 'Recalculate in place');
  assert.equal($('select[name=carryFrom]'), null, 'it carries from itself');

  calls.length = 0;
  $('#wizard-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  await settle();
  const sent = calls.find(([path]) => path === '/api/recalculate');
  assert.ok(sent, 'the button recalculates');
  assert.equal(sent[1].planCreatedAt, plan.createdAt, 'naming the plan the edit started from');
  assert.equal(sent[1].name, 'Minimal construction · Oct 7');
  assert.match(String(sent[1].backupName), /^Minimal construction · Oct 7 \(before edit, .+\)$/);
  const headers = calls.headers[calls.indexOf(sent)]!;
  assert.equal(headers['X-Profile-Id'], 'p');
  assert.equal(wizard, null);
  assert.equal(view, 'plan');
  assert.match(
    $('#toast')!.textContent,
    /^Recalculated in place\. 2 production lines left unticked for review\. The previous version is kept as “Minimal construction · Oct 7 \(before edit, .+\)” under Profiles\.$/,
  );
});

// The rows of Review's "What changes" table.
const phaseRows = () => document.querySelectorAll('[data-edit-phase]').length;

test('a profile card’s Edit settings reads that profile’s plan first, and nothing more', async () => {
  const other = generated();
  const calls = stubFetch({
    '/api/workspace': workspace,
    '/api/context': {
      save: { id: 's', name: 'World' },
      profile: { id: 'original', kind: 'calculated', name: 'Old one' },
      state: { settings: { phase: '3' }, checks: {}, notes: {}, deliveries: {}, customTasks: [] },
      plan: other,
    },
  });
  go('profiles');
  render();
  await settle();
  await click('[data-edit-profile="original"]');
  await settle();
  const read = calls.findIndex(([path]) => path === '/api/context');
  assert.ok(read >= 0);
  assert.equal(calls.headers[read]!['X-Profile-Id'], 'original');
  assert.deepEqual(
    calls.map(([path]) => path).filter(path => path !== '/api/workspace'),
    ['/api/context'],
    'reading only',
  );
  assert.equal(wizard!.edit!.profileId, 'original');
  assert.equal(wizard!.name, 'Old one');
  assert.equal(wizard!.edit!.plan.createdAt, other.createdAt);
});
