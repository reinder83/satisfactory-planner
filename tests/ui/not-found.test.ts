// An address that names no page opens a not-found page, not the build plan without a word
// (#1330). The bare address still opens the plan and every route keeps its page.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { render } from '../../public/app/shell.ts';
import { viewOf } from '../../public/app/session.ts';
import { pageTitle } from '../../public/app/page-title.ts';
import { $, $$, go, open, page } from './setup.ts';

beforeEach(() => {
  page();
  open();
});

test('only an unknown address is not found: the bare address and every route keep their page', () => {
  assert.equal(viewOf(''), 'plan', 'the bare address opens the plan');
  for (const route of [
    'plan',
    'factories',
    'logistics',
    'map',
    'storage',
    'resources',
    'notes',
    'session',
    'backup',
    'profiles',
    'wizard',
    'account',
  ])
    assert.equal(viewOf(route), route);
  assert.equal(viewOf('factories/fg-1/flow?phase=3'), 'factories', 'a group’s flow page');
  for (const unknown of ['nowhere', 'Plan', 'plan/', 'plan?x=1', 'factories/x', 'acount', '#plan'])
    assert.equal(viewOf(unknown), 'notfound', unknown);
});

test('the not-found page says so, with ADA’s line and links to Build plan and Saves & profiles', async () => {
  go(viewOf('nowhere'));
  render();
  await nextTick();
  assert.equal($('h1')!.textContent, 'Page not found');
  assert.match($('[data-not-found]')!.textContent!, /That sector is not on any FICSIT map\./);
  const plan = $('[data-not-found] a[data-not-found-plan]')!;
  assert.equal(plan.getAttribute('href'), '#plan');
  assert.equal(plan.textContent!.trim(), 'Build plan');
  const profiles = $('[data-not-found] a[data-not-found-profiles]')!;
  assert.equal(profiles.getAttribute('href'), '#profiles');
  assert.equal(profiles.textContent!.trim(), 'Saves & profiles');
  assert.equal($$('.nav a.active').length, 0, 'the sidebar marks no page');
  assert.equal(document.title, pageTitle('Page not found', 'notfound'));
  assert.match(document.title, /^Page not found · Not found · /);
});

test('a known route still draws its own page, not the not-found page', async () => {
  go(viewOf('plan'));
  render();
  await nextTick();
  assert.equal($('[data-not-found]'), null);
  assert.ok($('.nav a.active')!.textContent!.includes('Build plan'));
  go(viewOf('profiles'));
  render();
  await nextTick();
  assert.equal($('[data-not-found]'), null);
  assert.equal($('h1')!.textContent, 'Saves & profiles');
});
