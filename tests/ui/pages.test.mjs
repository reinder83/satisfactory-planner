// The pages that are Vue components (public/app/ui/pages/), mounted through render() the way
// the app mounts them, in happy-dom.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { currentSave } from '../../public/app/session.js';
import { render } from '../../public/app/shell.js';
import { openCalculatedFactory } from '../../public/app/factory-detail.js';
import { invalidate } from '../../public/app/ui/bridge.js';
import { showSignedOut } from '../../public/app/ui/mount.js';
import { vuePage } from '../../public/app/ui/pages.js';
import { $, $$, evil, generated, go, handbook, open, page, stubFetch } from './setup.mjs';

// User text inserted as markup would create an <x-evil> element. (innerHTML cannot tell:
// a textarea's contents are serialised unescaped.)
const noMarkup = () =>
  assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');

beforeEach(() => {
  page();
  open();
});

test('Saves & profiles lists every profile, escaped, with its actions', () => {
  go('profiles');
  render();
  noMarkup();
  assert.equal($('.save-panel h2').textContent, evil);
  const cards = $$('.profile-card');
  assert.equal(cards.length, 2);
  assert.ok(cards[0].classList.contains('selected'), 'the open profile is marked');
  assert.equal(cards[0].querySelector('.eyebrow').textContent, 'PRESERVED HANDBOOK');
  assert.equal(cards[1].querySelector('.eyebrow').textContent, 'CALCULATED PROFILE');
  assert.equal(cards[1].querySelector('p').textContent, evil + ' purity · 2× elevator · 3× power');
  assert.equal(cards[1].querySelector('.small').textContent, '5 checks complete · Phase 4');
  assert.match(cards[0].querySelector('[data-open-save]').textContent, /Continue current profile/);
  assert.match(cards[1].querySelector('[data-open-save]').textContent, /Open profile/);
  for (const hook of ['duplicate', 'share', 'remove'])
    assert.equal(cards[1].querySelector(`[data-${hook}-profile]`).dataset[hook + 'Profile'], 'p');
  assert.equal($('.toolbar a').textContent, 'Set up user accounts');
  assert.ok($('#rename-form select[name=target]'));
});

test('renaming the open save updates the page and the frame', async () => {
  const calls = stubFetch({
    '/api/rename': body => ({
      saves: [
        {
          id: 's',
          name: body.name,
          profiles: [{ id: 'original', kind: 'original', name: evil, completed: 2, phase: '3' }],
        },
      ],
    }),
  });
  go('profiles');
  render();
  $('#rename-form input[name=name]').value = 'Renamed & safe';
  $('#rename-form').dispatchEvent(new Event('submit', { cancelable: true }));
  await new Promise(r => setTimeout(r, 20));
  await nextTick();
  assert.deepEqual(calls[0], ['/api/rename', { target: 'save', name: 'Renamed & safe' }]);
  assert.equal(currentSave.name, 'Renamed & safe');
  assert.equal($('.save-panel h2').textContent, 'Renamed & safe');
  assert.equal($('.breadcrumbs a').textContent, 'Renamed & safe');
});

test('the account page offers setup until accounts are on, then the signed-in user', async () => {
  go('account');
  render();
  assert.equal($('#main h1').textContent, 'User accounts');
  assert.equal($('#auth-form h2').textContent.trim(), 'Secure your existing save');
  assert.ok($('#auth-form input[name=setupToken]'));
  assert.ok($('#auth-form input[name=registration]'));
  open({ workspace: { accountsEnabled: true } });
  render();
  await nextTick();
  assert.equal($('#main h1').textContent, evil);
  noMarkup();
  assert.ok($('[data-logout]'));
  assert.equal($('#auth-form'), null);
});

test('the sign-in screen switches between signing in and registering', async () => {
  open({ workspace: { user: null, registration: true } });
  showSignedOut($('#app'));
  assert.equal($('.layout'), null, 'the frame is gone');
  assert.equal($('#auth-form h2').textContent.trim(), 'Sign in');
  assert.equal($('#auth-form input[name=password]').autocomplete, 'current-password');
  $('[data-auth-mode]').click();
  await nextTick();
  assert.equal($('#auth-form h2').textContent.trim(), 'Create your account');
  assert.equal($('#auth-form input[name=password]').autocomplete, 'new-password');
  assert.match($('[data-auth-mode]').textContent, /Back to sign in/);
});

test('a failed sign-in says why in the form', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'Wrong username or password.' }), { status: 401 });
  open({ workspace: { user: null, accountsEnabled: true } });
  showSignedOut($('#app'));
  $('#auth-form input[name=username]').value = 'pioneer';
  $('#auth-form input[name=password]').value = 'correct horse battery';
  $('#auth-form').dispatchEvent(new Event('submit', { cancelable: true }));
  await new Promise(r => setTimeout(r, 20));
  await nextTick();
  assert.equal($('#auth-error').textContent, 'Wrong username or password.');
  assert.equal($('#auth-form button').disabled, false);
});

test('the handbook backup page keeps the save-wide note exactly and lists the sources', () => {
  const note = evil + '\n  second line';
  open({ notes: { global: note } });
  go('backup');
  render();
  noMarkup();
  assert.equal($('#global-note').value, note, 'the note keeps its line break and indent');
  assert.equal($('[data-save-note="global"]').dataset.input, 'global-note');
  assert.equal($('a[download]').getAttribute('href'), '/api/export?save=s&profile=original');
  assert.equal($$('.list-links a').length, handbook.sources.length);
  assert.ok($('#import-file') && $('#import-saves') && $('[data-export-saves]'));
});

test('the calculated backup page names the profile and lists its assumptions', () => {
  open({ calculated: true });
  go('backup');
  render();
  noMarkup();
  assert.equal(
    $('#main .subtitle').textContent,
    `Checkmarks, deliveries and notes belong to ${evil} / ${evil}`,
  );
  assert.deepEqual(
    $$('#main .panel p')
      .map(p => p.textContent)
      .filter(t => t === evil || t === 'Second assumption'),
    [evil, 'Second assumption'],
  );
  assert.equal($('a[download]').getAttribute('href'), '/api/export?save=s&profile=p');
});

test('the handbook resources page shows every resource with its icon, and the power checks', async () => {
  go('resources');
  render();
  const rows = $$('#main tbody tr');
  const resources = Object.keys(handbook.resources['3']);
  assert.equal(rows.length, resources.length);
  for (const row of rows) {
    const name = row.querySelector('.resource-name span').textContent;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    assert.equal(
      row.querySelector('.resource-name img').getAttribute('src'),
      `./icons/${slug}.png`,
    );
  }
  assert.equal($$('[data-check^="power-"]').length, 9);
  assert.equal($('[data-check="power-u4"]').checked, false);
  open({ phase: '3' });
  const { state } = await import('../../public/app/session.js');
  state.checks['power-u4'] = true;
  render();
  await nextTick();
  assert.equal($('[data-check="power-u4"]').checked, true, 'a saved check shows ticked');
});

test('moving between a component page and a legacy page leaves nothing behind', async () => {
  go('profiles');
  render();
  assert.equal($$('.profile-card').length, 2);
  go('factories');
  render();
  assert.equal($$('.profile-card').length, 0, 'the component page is gone');
  assert.equal($('#main h1').textContent, 'Factory targets');
  go('backup');
  render();
  assert.equal($$('#main h1').length, 1);
  assert.equal($('#main h1').textContent, 'Backup & notes');
  go('resources');
  render();
  assert.equal($$('#main h1').length, 1);
  assert.equal($('#main h1').textContent, 'Power & resources');
  // A calculated profile's resources page is still the legacy one.
  assert.equal(vuePage('resources', {}), null);
});

// Opening the handbook from a calculated profile's page: anything that redraws before render()
// swaps the page (a save finishing, the save indicator) reaches the calculated page and dialog
// once more, with no calculated plan open.
test('a calculated page survives a redraw after the handbook is opened', async () => {
  const errors = [];
  const onError = e => errors.push(e.reason ?? e.error);
  process.on('unhandledRejection', onError);
  try {
    for (const view of ['plan', 'factories', 'storage']) {
      page();
      const plan = generated();
      open({ calculated: plan });
      go(view);
      render();
      openCalculatedFactory(plan.stages['3'].rows[0].id);
      open();
      invalidate();
      await nextTick();
      await new Promise(r => setTimeout(r, 0));
      render();
      await nextTick();
      assert.ok($('#main h1'), view + ' shows the handbook page after render()');
    }
  } finally {
    process.off('unhandledRejection', onError);
  }
  assert.deepEqual(errors, []);
});
