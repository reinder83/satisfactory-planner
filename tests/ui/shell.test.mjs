// The Vue page frame (public/app/ui/Shell.vue and AdaPanel.vue), mounted the way the app
// mounts it: render() on a page with #app, in happy-dom.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { adaClearFault, setAdaIndex, setAdaMuted } from '../../public/app/ada-panel.js';
import { setContext, setView, setWorkspace } from '../../public/app/session.js';
import { render } from '../../public/app/shell.js';
import { showSignedOut, unmountShell } from '../../public/app/ui/mount.js';

// Vitest runs from the repository root.
const handbook = JSON.parse(fs.readFileSync('public/plan.json', 'utf8'));
const evil = '<x-evil onclick=alert(1)> & "quoted"';
const $ = s => document.querySelector(s);

function open({ name = evil, phase = '3' } = {}) {
  setWorkspace({
    user: { id: 'owner', username: 'Pioneer' },
    accountsEnabled: false,
    catalog: {},
    saves: [{ id: 's', name, profiles: [{ id: 'original', kind: 'original', name }] }],
  });
  setContext({
    save: { id: 's', name },
    profile: { id: 'original', kind: 'original', name },
    state: {
      settings: { phase },
      checks: {},
      notes: {},
      deliveries: {},
      customTasks: [],
    },
    plan: null,
    handbook,
  });
}

beforeEach(() => {
  unmountShell();
  document.body.innerHTML = '<div id="app"></div><dialog id="detail"></dialog>';
  setAdaMuted(false);
  setAdaIndex(0);
  adaClearFault();
  setView('plan');
  open();
});

test('the frame shows the open save and profile, escaped, around the page', () => {
  render();
  assert.equal($('.breadcrumbs a').textContent, evil);
  assert.ok($('.breadcrumbs').innerHTML.includes('&lt;x-evil'), 'the save name is escaped');
  assert.ok(!document.body.innerHTML.includes('<x-evil'), 'no user text is inserted as markup');
  assert.ok($('.sidebar-foot').textContent.startsWith(evil), 'the footer names the profile');
  assert.equal($('.sidebar-foot').querySelectorAll('br').length, 3);
  // The page itself is drawn into the frame's <main>.
  assert.ok($('#main .heading-row'), 'the plan page is drawn into <main>');
});

test('navigation marks the current page', async () => {
  render();
  assert.equal($('.nav a.active').getAttribute('href'), '#plan');
  assert.equal($('.nav a.active').getAttribute('aria-current'), 'page');
  assert.equal($('.nav a[href="#storage"]').getAttribute('aria-current'), null);
  setView('storage');
  render();
  await nextTick();
  assert.equal($('.nav a.active').getAttribute('href'), '#storage');
});

test('the phase picker offers the profile’s phases and shows the working one', () => {
  open({ phase: '4' });
  render();
  const picker = $('#phase-picker');
  assert.equal(picker.value, '4');
  assert.deepEqual(
    [...picker.options].map(o => o.textContent),
    ['Phase 3', 'Phase 4', 'Phase 5', 'Post Phase 5'],
  );
  assert.equal(picker.disabled, false);
});

test('ADA speaks, cycles, mutes and unmutes', async () => {
  render();
  assert.match($('.ada').textContent, /Artificial Directory and Assistant/);
  assert.equal($('.ada').dataset.tone, 'calm');
  const first = $('#ada-line').textContent;
  $('[data-ada-next]').click();
  await nextTick();
  assert.notEqual($('#ada-line').textContent, first, 'Another remark shows the next line');
  $('[data-ada-mute="on"]').click();
  await nextTick();
  assert.match($('.ada').textContent, /ADA muted/);
  assert.equal($('[data-ada-next]'), null, 'a muted assistant says nothing');
  $('[data-ada-mute="off"]').click();
  await nextTick();
  assert.ok($('[data-ada-next]'));
});

test('ADA repeats a renamed step escaped', async () => {
  open();
  render();
  setAdaIndex(0);
  const plan = handbook.phases['3'];
  setContext({
    save: { id: 's', name: 'World' },
    profile: { id: 'original', kind: 'original', name: 'Original' },
    state: {
      settings: { phase: '3' },
      checks: {},
      notes: {},
      deliveries: {},
      customTasks: [],
      taskEdits: { titles: { [plan[0].id]: 'Weld the <boat>' } },
    },
    plan: null,
    handbook,
  });
  render();
  await nextTick();
  assert.match($('#ada-line').textContent, /Weld the <boat>/);
  assert.ok($('#ada-line').innerHTML.includes('Weld the &lt;boat&gt;'));
});

test('five pokes at the badge stage a transmission fault; the next remark ends it', async () => {
  render();
  for (let i = 0; i < 5; i++) $('.ada-mark').click();
  await nextTick();
  assert.equal($('.ada').dataset.tone, 'fault');
  assert.equal($('.ada b').textContent, '???');
  assert.match($('.ada').textContent, /Transmission fault/);
  $('[data-ada-next]').click();
  await nextTick();
  assert.notEqual($('.ada').dataset.tone, 'fault');
});

test('the sign-in screen replaces the frame, and the next render brings it back', async () => {
  render();
  setWorkspace({ user: null, registration: false });
  showSignedOut($('#app'));
  assert.equal($('.layout'), null);
  assert.ok($('#auth-form'), 'the sign-in form is shown');
  open();
  render();
  assert.ok($('.layout'), 'the frame is mounted again');
  assert.ok($('#main .heading-row'));
});
