// Two per-browser facts kept in localStorage only (#1353, #1355, app/sessions.ts): the session
// counter behind ADA's "never backed up" remark, and the build plan's intro shown once (BP-13).
// Neither is in a saved profile, an export or a backup, and the app works when storage throws.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { render } from '../../public/app/shell.ts';
import {
  INTRO_SEEN_KEY,
  SESSIONS_KEY,
  bumpSessions,
  introSeen,
  markIntroSeen,
  resetIntroSeen,
  resetSessionCount,
  sessionCount,
} from '../../public/app/sessions.ts';
import { workspace } from '../../public/app/session.ts';
import { unmountShell } from '../../public/app/ui/mount.ts';
import { helpText } from '../../public/preferences.ts';
import { $, $$, generated, go, open, page } from './setup.ts';

beforeEach(() => {
  unmountShell();
  page();
  localStorage.clear();
  resetIntroSeen();
  resetSessionCount();
});
afterEach(() => vi.unstubAllGlobals());

const breakStorage = () =>
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('refused');
    },
    setItem: () => {
      throw new Error('refused');
    },
  });

test('the counter starts at 1 and bumps once per load, not per call', () => {
  assert.equal(sessionCount(), 1);
  assert.equal(sessionCount(), 1, 'the same load counts once');
  assert.equal(localStorage.getItem(SESSIONS_KEY), '1');
  resetSessionCount();
  assert.equal(sessionCount(), 2, 'the next load');
  resetSessionCount();
  assert.equal(sessionCount(), 3);
  assert.equal(bumpSessions(), 4);
});

test('a damaged counter starts over, and it stops at a cap', () => {
  for (const bad of ['', 'abc', '-4', '0', '2.5', 'NaN']) {
    localStorage.setItem(SESSIONS_KEY, bad);
    assert.equal(bumpSessions(), 1, JSON.stringify(bad));
  }
  localStorage.setItem(SESSIONS_KEY, '999');
  assert.equal(bumpSessions(), 999);
});

test('a throwing localStorage is tolerated: the count is 1 and nothing throws', () => {
  breakStorage();
  assert.equal(bumpSessions(), 1);
  assert.equal(bumpSessions(), 1, 'it cannot count up without storage');
  assert.equal(sessionCount(), 1);
  assert.equal(sessionCount(), 1);
  assert.equal(introSeen(), false);
  assert.doesNotThrow(() => markIntroSeen());
  assert.equal(introSeen(), true, 'seen for the rest of the page load');
});

test('the app draws with storage that throws, and the intro shows once per load then', async () => {
  breakStorage();
  open({ calculated: generated(), phase: '3' });
  go('plan');
  assert.doesNotThrow(() => render());
  await nextTick();
  assert.ok($('#main h1'), 'the page is drawn');
  assert.ok($('[data-build-intro]'), 'the intro shows without storage');
});

test('the counter and the intro flag are not in the saved workspace, only in localStorage', () => {
  sessionCount();
  markIntroSeen();
  const saved = JSON.stringify(workspace);
  assert.ok(!saved.includes(SESSIONS_KEY) && !saved.includes(INTRO_SEEN_KEY));
  assert.deepEqual(Object.keys(localStorage).sort(), [INTRO_SEEN_KEY, SESSIONS_KEY]);
});

test('the build plan shows the intro the first time, not on another phase, not after a reload', async () => {
  open({ calculated: generated(), phase: '3' });
  go('plan');
  render();
  await nextTick();
  const intro = $('#main [data-build-intro]')!;
  assert.ok(intro, 'first view');
  assert.ok(intro.textContent!.includes(helpText.buildIntro!), 'the whole text');
  assert.equal(localStorage.getItem(INTRO_SEEN_KEY), '1');
  assert.equal($('[data-build-intro-region]')!.getAttribute('aria-live'), 'polite');
  // Another phase does not repeat it.
  open({ calculated: generated(), phase: '4' });
  render();
  await nextTick();
  assert.equal($('#main [data-build-intro]'), null, 'not on every phase');
  // A reload: nothing in memory, the browser's flag remains.
  unmountShell();
  page();
  resetIntroSeen();
  open({ calculated: generated(), phase: '3' });
  go('plan');
  render();
  await nextTick();
  assert.equal($('#main [data-build-intro]'), null, 'after a reload');
  assert.ok($('#main [data-help=buildIntro]'), 'the "?" is still there');
});

test('"Got it" hides the intro, and the "?" reopens the whole text', async () => {
  open({ calculated: generated(), phase: '3' });
  go('plan');
  render();
  await nextTick();
  const got = $<HTMLButtonElement>('[data-build-intro-dismiss]')!;
  got.focus();
  got.click();
  await nextTick();
  assert.equal($('#main [data-build-intro]'), null);
  assert.equal(
    document.activeElement,
    $('#main [data-help=buildIntro]'),
    'focus moves to the "?", not <body>',
  );
  $<HTMLButtonElement>('#main [data-help=buildIntro]')!.click();
  await nextTick();
  assert.equal(document.querySelector('[role=tooltip]')!.textContent, helpText.buildIntro);
});

test('a guided plan never shows it, and does not use the flag up', async () => {
  open({
    calculated: {
      ...structuredClone(generated()),
      guide: { phases: { '3': [{ id: 'phase-3-survey', title: 'Survey', body: 'Walk it.' }] } },
    } as never,
    phase: '3',
  });
  go('plan');
  render();
  await nextTick();
  assert.equal($$('[data-build-intro]').length, 0);
  assert.equal(localStorage.getItem(INTRO_SEEN_KEY), null);
});
