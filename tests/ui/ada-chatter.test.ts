// ADA's chatter setting and event remarks in the panel (#1353): Off / Essential / Chatty, kept in
// this browser only, with what an old Mute switch becomes; Off holds problems behind a dot; the
// events add one remark each, once, capped, and never at Off.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import {
  ADA_EVENT_CAP,
  adaChatter,
  adaClearFault,
  adaCurrent,
  adaNote,
  adaResetEvents,
  adaStore,
  adaView,
  setAdaChatter,
  setAdaIndex,
} from '../../public/app/ada-panel.ts';
import { render } from '../../public/app/shell.ts';
import { setRestoredProgress, setView } from '../../public/app/session.ts';
import { unmountShell } from '../../public/app/ui/mount.ts';
import { $, $$, generated, go, open, openMigrated, page, stubFetch } from './setup.ts';
import { save } from '../../public/app/api.ts';
import { state } from '../../public/app/session.ts';
import type { ProgressState } from '../../public/types/index.ts';

beforeEach(() => {
  unmountShell();
  page();
  localStorage.clear();
  adaResetEvents();
  setAdaChatter('essential');
  setAdaIndex(0);
  adaClearFault();
  openMigrated({ phase: '3' });
  go('plan');
});

const line = () => $('#ada-line')!.textContent;

test('the setting is Essential until chosen, and a calm remark is not said there', async () => {
  render();
  await nextTick();
  assert.equal($('.ada')!.dataset.chatter, 'essential');
  // The migrated profile has nothing wrong and nothing finished: Essential has nothing to report.
  assert.match(line()!, /Nothing needs your attention/);
  assert.equal($('[data-ada-mood]')!.textContent, 'IDLE');
  assert.match($('.ada-stamp')!.textContent!, /^LOG \d{4} · /);
  setAdaChatter('chatty');
  render();
  await nextTick();
  assert.doesNotMatch(line()!, /Nothing needs your attention/);
  assert.ok($$('.ada-wave i').length >= 4, 'the waveform has its bars');
});

test('the speaker opens Off / Essential / Chatty, and Off says her one line and goes flat', async () => {
  render();
  await nextTick();
  assert.equal($('[data-ada-chatter-panel]'), null, 'closed until the speaker is pressed');
  const speaker = $('[data-ada-settings]')!;
  assert.equal(speaker.getAttribute('aria-expanded'), 'false');
  speaker.click();
  await nextTick();
  assert.equal(speaker.getAttribute('aria-expanded'), 'true');
  const choices = $$('[data-ada-chatter]');
  assert.deepEqual(
    choices.map(b => b.textContent!.trim()),
    ['Off', 'Essential', 'Chatty'],
  );
  assert.deepEqual(
    choices.map(b => b.getAttribute('aria-pressed')),
    ['false', 'true', 'false'],
  );
  $('[data-ada-chatter="off"]')!.click();
  await nextTick();
  assert.equal(adaChatter, 'off');
  assert.equal($('.ada')!.classList.contains('is-off'), true);
  assert.equal(line(), 'Understood. Your feedback has been forwarded to no one.');
  assert.equal($('#ada-line')!.getAttribute('aria-live'), 'polite');
  assert.equal($('[data-ada-next]'), null);
  assert.equal($('[data-ada-mood]')!.textContent, 'OFF');
  assert.equal($('.ada-stamp'), null, 'nothing speaks');
  assert.equal($('[data-ada-chatter="off"]')!.getAttribute('aria-pressed'), 'true');
});

test('the choice is kept in this browser as the old values, never in the profile', () => {
  setAdaChatter('off');
  adaStore();
  assert.equal(localStorage.getItem('planner-ada'), 'muted');
  setAdaChatter('chatty');
  adaStore();
  assert.equal(localStorage.getItem('planner-ada'), 'on');
  setAdaChatter('essential');
  adaStore();
  assert.equal(localStorage.getItem('planner-ada'), 'essential');
});

test('Off still shows a real problem as a dot she reads on request', async () => {
  // A planning draft is a problem, whatever the setting.
  const plan = generated();
  plan.stages['3'] = {
    feasible: false,
    reason: 'Needs more iron.',
  } as (typeof plan.stages)['3'];
  open({ calculated: plan });
  go('plan');
  setAdaChatter('essential');
  render();
  await nextTick();
  assert.match(line()!, /planning draft/);
  assert.equal($('[data-ada-mood]')!.textContent, 'CONCERNED');
  setAdaChatter('off');
  render();
  await nextTick();
  assert.equal(line(), '', 'nothing speaks');
  assert.equal($('.ada-stamp'), null);
  assert.match($('[data-ada-pending]')!.textContent!, /1 essential/);
  const read = $('[data-ada-read]')!;
  assert.equal(read.getAttribute('aria-expanded'), 'false');
  read.click();
  await nextTick();
  assert.match(line()!, /planning draft/);
  assert.equal($('#ada-line')!.getAttribute('aria-live'), 'polite');
  assert.equal(read.getAttribute('aria-expanded'), 'true');
  // The same plan with nothing wrong holds nothing back.
  open({ calculated: generated() });
  go('plan');
  render();
  await nextTick();
  assert.equal($('[data-ada-pending]'), null);
});

test('a restore that took steps back is said at Essential and waits behind the dot at Off', () => {
  // A calm line, but the user just changed their progress: the default setting must say it.
  const words = 'Restored from the backup: 3 steps unticked.';
  setView('backup');
  setRestoredProgress({ words, good: false, profileId: 'p' });
  try {
    setAdaChatter('essential');
    assert.equal(adaCurrent()!.text, words);
    setAdaChatter('off');
    const held = adaView()!.pending!;
    assert.ok(held.count >= 1);
    assert.equal(held.text, words);
  } finally {
    setRestoredProgress(null);
  }
});

test('an event adds one remark, once, with its mood, and Later drops it', async () => {
  setAdaChatter('chatty');
  assert.equal(adaNote('first-step'), true);
  assert.equal(adaNote('first-step'), false, 'the same kind is not said again this session');
  render();
  await nextTick();
  assert.match(line()!, /^One down\./);
  assert.equal($('.ada')!.dataset.mood, 'satisfied');
  assert.equal($('[data-ada-mood]')!.textContent, 'SATISFIED');
  assert.match($('.ada-stamp')!.textContent!, /· MILESTONE$/);
  const later = $('[data-ada-later]')!;
  later.click();
  await nextTick();
  assert.doesNotMatch(line()!, /^One down\./);
  assert.equal($('[data-ada-later]'), null);
});

test('Essential says only the essential events, Off none', () => {
  setAdaChatter('essential');
  assert.equal(adaNote('first-step'), false);
  assert.equal(adaNote('phase-back'), false);
  assert.equal(adaNote('backup'), true, 'data loss is essential');
  assert.match(adaCurrent()!.text, /^Backup filed\./);
  adaResetEvents();
  setAdaChatter('off');
  assert.equal(adaNote('backup'), false);
});

test('the chatty events are capped for a session, the essential ones are not', () => {
  setAdaChatter('chatty');
  const chatty = [
    'first-step',
    'hundred-steps',
    'late-step',
    'phase-back',
    'profile-removed',
    'past-phase-four',
  ] as const;
  const said = chatty.map(kind => adaNote(kind, { time: '02:00' }));
  assert.equal(said.filter(Boolean).length, ADA_EVENT_CAP);
  assert.equal(adaNote('backup'), true);
  // Lines and parts are told apart by name.
  adaResetEvents();
  assert.equal(adaNote('line-running', { name: 'Iron Works' }), true);
  assert.equal(adaNote('line-running', { name: 'Iron Works' }), false);
  assert.equal(adaNote('line-running', { name: 'Steel Works' }), true);
});

test('an event goes when the page changes, and a part delivered offers one button', async () => {
  setAdaChatter('chatty');
  adaNote('part-delivered', { name: 'Versatile Framework', count: '125,000 of 125,000' });
  render();
  await nextTick();
  const action = $('[data-ada-action]')!;
  assert.equal(action.textContent!.trim(), 'Open build plan');
  assert.equal($$('#sidebar .ada [data-ada-action]').length, 1, 'at most one button');
  setView('factories');
  assert.doesNotMatch(adaCurrent()!.text, /Versatile Framework/);
});

test('the transmission-fault easter egg is for Chatty only', async () => {
  setAdaChatter('essential');
  render();
  await nextTick();
  const mark = $('.ada-head .ada-mark')!;
  for (let i = 0; i < 6; i++) mark.click();
  await nextTick();
  assert.doesNotMatch($('.ada')!.dataset.tone ?? '', /fault/);
  setAdaChatter('chatty');
  for (let i = 0; i < 6; i++) mark.click();
  await nextTick();
  assert.equal($('.ada')!.dataset.tone, 'fault');
  assert.equal($('[data-ada-mood]')!.textContent, '▒▒▒▒');
  adaClearFault();
});

test('a saved tick tells her, and a first step is not said at Essential (#1353)', async () => {
  const reply = (key: string) => () => ({
    ...state,
    checks: { ...state.checks, [key]: true },
  });
  // A profile with nothing ticked: the first tick is her first event.
  state.checks = {};
  setAdaChatter('chatty');
  stubFetch<{ key: string }>({
    '/api/update': (body: { key: string }) => reply(body.key)() as ProgressState,
  });
  await save({ type: 'check', key: 'one', value: true });
  assert.match(adaCurrent()!.text, /^One down./);
  // The same tick at Essential says nothing.
  adaResetEvents();
  setAdaChatter('essential');
  state.checks = {};
  await save({ type: 'check', key: 'two', value: true });
  assert.doesNotMatch(adaCurrent()!.text, /^One down./);
});
