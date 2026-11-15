// ADA's buttons and the phone strip in the panel (#1353): the button on a remark opens the page that
// fixes what she named (and focuses the thing to press), the build plan scrolls to the retirement
// step, and the folded phone ticker carries her button and "Later".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import {
  adaClearFault,
  adaNote,
  adaResetEvents,
  adaView,
  setAdaChatter,
  setAdaIndex,
} from '../../public/app/ada-panel.ts';
import { render } from '../../public/app/shell.ts';
import { setLogisticsTab, setRestoredProgress, state } from '../../public/app/session.ts';
import { jumpTarget, setJumpTarget } from '../../public/app/step-jump.ts';
import { unmountShell } from '../../public/app/ui/mount.ts';
import { $, $$, generated, go, openMigrated, page } from './setup.ts';

beforeEach(() => {
  unmountShell();
  page();
  localStorage.clear();
  adaResetEvents();
  setAdaChatter('essential');
  setAdaIndex(0);
  adaClearFault();
  setJumpTarget('');
  openMigrated({ phase: '3' });
  go('plan');
});

const frames = () => new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));

test('the strip under the folded ticker has the event remark button and Later, the panel the same', async () => {
  setAdaChatter('chatty');
  go('factories');
  adaNote('part-delivered', { name: 'Versatile Framework', count: '125,000 of 125,000' });
  render();
  await nextTick();
  const strip = $('.ada [data-ada-strip]')!;
  assert.equal($$('[data-ada-strip-action]').length, 1);
  assert.equal($('[data-ada-strip-action]')!.textContent!.trim(), 'Open build plan');
  assert.equal($('[data-ada-strip-later]')!.textContent!.trim(), 'Later');
  assert.equal($$('.ada [data-ada-action]').length, 1, 'the panel keeps its own button');
  // The strip comes before the body, so a keyboard user meets the ticker, then the strip.
  assert.ok(
    $('[data-ada-ticker]')!.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  assert.ok(strip.compareDocumentPosition($('#ada-body')!) & Node.DOCUMENT_POSITION_FOLLOWING);
  $('[data-ada-strip-action]')!.click();
  await nextTick();
  assert.equal(location.hash, '#plan', 'the strip button opens the same page as the panel one');
  $('[data-ada-strip-later]') && $('[data-ada-strip-later]')!.click();
  await nextTick();
  assert.equal($('[data-ada-strip-later]'), null, 'Later drops the event and its strip buttons');
});

test('the strip button that opens a page leaves focus on the opened page heading, not <body> (#1355)', async () => {
  setAdaChatter('chatty');
  go('factories');
  adaNote('part-delivered', { name: 'Versatile Framework', count: '125,000 of 125,000' });
  render();
  await nextTick();
  const button = $<HTMLButtonElement>('[data-ada-strip-action]')!;
  button.focus();
  button.click();
  // The drawer closes and takes the button with it: focus is lost, as a hidden button loses it.
  button.blur();
  await nextTick();
  for (let i = 0; i < 5 && document.activeElement === document.body; i++) await frames();
  assert.equal(location.hash, '#plan');
  const heading = $('#main h1')!;
  assert.ok(heading);
  assert.equal(document.activeElement, heading, 'the opened page heading has focus');
  assert.equal(heading.getAttribute('tabindex'), '-1');
});

test('the strip is absent without a button or event, and when she is Off', async () => {
  render();
  await nextTick();
  assert.equal($('[data-ada-strip]'), null, 'a plain remark has no button');
  setAdaChatter('chatty');
  go('factories');
  adaNote('part-delivered', { name: 'Versatile Framework', count: '1 of 1' });
  setAdaChatter('off');
  render();
  await nextTick();
  assert.equal($('[data-ada-strip]'), null);
});

test('a problem remark carries its button in the panel and the strip', async () => {
  // A restore that took steps back is a problem remark: its button reads See changes.
  setRestoredProgress({
    profileId: 'p',
    words: 'Restored 3 lines.',
    good: false,
  });
  go('backup');
  render();
  await nextTick();
  assert.equal($('[data-ada-action]')!.textContent!.trim(), 'See changes');
  assert.equal($('[data-ada-strip-action]')!.textContent!.trim(), 'See changes');
  assert.equal($$('.ada button[data-ada-action], .ada button[data-ada-strip-action]').length, 2);
  setRestoredProgress(null);
});

test('Show step on the retirement remark opens the build plan on that step', async () => {
  // Phase 4 drops a line Phase 3 ran, so it has the retirement step to show.
  const plan = generated();
  const dropped = plan.stages['4']!.rows![0]!.id;
  for (const key of ['4', '5'] as const)
    plan.stages[key]!.rows = plan.stages[key]!.rows!.filter(row => row.id !== dropped);
  openMigrated({ calculated: plan, phase: '4' });
  go('plan');
  const view = adaView();
  // The retirement step is open, so the problem is there to be shown.
  assert.ok(view);
  assert.match(view.text, /retirement steps? still open: /);
  assert.equal(view.action?.label, 'Show step');
  assert.match(view.action!.step!, /^retire-4$/);
  go('factories');
  render();
  await nextTick();
  $('[data-ada-action]')!.click();
  await nextTick();
  await frames();
  assert.equal(location.hash, '#plan');
  assert.equal(jumpTarget(), view.action!.step, 'the build plan is told which step to show');
  const box = $('#main input[data-check="retire-4"]');
  assert.ok(box, 'the step is on the page');
  assert.equal(document.activeElement, box, 'arriving from another page, its checkbox has focus');
  // Already on the build plan, where nothing is mounted again to focus it: the button does it.
  (document.activeElement as HTMLElement).blur();
  $('[data-ada-action]')!.click();
  await nextTick();
  await frames();
  assert.equal(document.activeElement, $('#main input[data-check="retire-4"]'));
});

test('the action focuses its target once the page has drawn', async () => {
  setRestoredProgress({ profileId: 'p', words: 'Restored 3 lines.', good: true });
  go('backup');
  render();
  await nextTick();
  $('[data-ada-action]')!.click();
  await nextTick();
  const heading = document.createElement('h2');
  heading.id = 'restore-changes-title';
  heading.tabIndex = -1;
  document.body.appendChild(heading);
  for (let i = 0; i < 5 && document.activeElement !== heading; i++) await frames();
  assert.equal(document.activeElement, heading, 'See changes lands on the summary heading');
  setRestoredProgress(null);
});

test('the strip is hidden except on a phone with the ticker folded, and its buttons are touch size', () => {
  const css = fs.readFileSync('public/style.css', 'utf8').replace(/\r\n/g, '\n');
  assert.match(css, /\n\.ada-strip \{\n {2}display: none;/);
  assert.match(css, /\.ada:not\(\.is-open\) \.ada-strip \{\n {4}display: flex;/);
  assert.match(css, /\.ada-strip \.btn \{\n {4}min-height: 44px;/);
});

test('a strip button closes the modal menu drawer around it, whether it opens a page or says Later', async () => {
  setRestoredProgress({ profileId: 'p', words: 'Restored 3 lines.', good: true });
  go('plan');
  render();
  await nextTick();
  const toggle = $<HTMLButtonElement>('[data-menu-toggle]')!;
  for (const press of ['[data-ada-strip-action]', '[data-ada-strip-later]']) {
    if (press === '[data-ada-strip-later]') {
      setAdaChatter('chatty');
      adaNote('part-delivered', { name: 'Versatile Framework', count: '1 of 1' });
      render();
      await nextTick();
    }
    toggle.click();
    await nextTick();
    await nextTick();
    assert.equal($('#sidebar')!.getAttribute('role'), 'dialog', 'the drawer is open');
    $(press)!.click();
    await nextTick();
    await nextTick();
    assert.equal($('#sidebar')!.getAttribute('role'), null, press + ' leaves no drawer open');
    assert.equal($('.layout.menu-open'), null);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  }
  assert.equal(location.hash, '#backup', 'the first press still opened its page');
  setRestoredProgress(null);
});

test('the strip’s Later gives focus back to the menu button that opened the drawer, not <body> (#1355)', async () => {
  setAdaChatter('chatty');
  adaNote('part-delivered', { name: 'Versatile Framework', count: '1 of 1' });
  render();
  await nextTick();
  const toggle = $<HTMLButtonElement>('[data-menu-toggle]')!;
  toggle.click();
  await nextTick();
  await nextTick();
  const later = $<HTMLButtonElement>('[data-ada-strip-later]')!;
  later.focus();
  later.click();
  // The drawer closes and takes the button with it: focus is lost, as a hidden button loses it.
  later.blur();
  await nextTick();
  await nextTick();
  assert.equal($('#sidebar')!.getAttribute('role'), null, 'the drawer is closed');
  assert.equal($('[data-ada-strip-later]'), null, 'the remark is gone');
  assert.equal(document.activeElement, toggle, 'focus is on the menu button');
});

test('the panel’s Later leaves focus on Another remark, not <body> (#1355)', async () => {
  setAdaChatter('chatty');
  adaNote('part-delivered', { name: 'Versatile Framework', count: '1 of 1' });
  render();
  await nextTick();
  const later = $<HTMLButtonElement>('[data-ada-later]')!;
  later.focus();
  later.click();
  await nextTick();
  await nextTick();
  assert.equal($('[data-ada-later]'), null, 'the remark is gone');
  assert.equal(document.activeElement, $('#ada-next'), 'focus is on Another remark');
});

test('Plan a train line opens Logistics on the Trains tab whichever tab was used last', async () => {
  setAdaChatter('chatty');
  setLogisticsTab('links');
  state.trainStations = [
    { id: 'ts-a', name: 'A', platforms: [{ kind: 'load', cargo: ['Iron Ore'] }] },
    { id: 'ts-b', name: 'B', platforms: [{ kind: 'unload' }] },
  ];
  state.trainLines = [];
  go('map');
  render();
  await nextTick();
  // Other remarks may rank first: cycle to this one.
  for (let i = 0; i < 30 && adaView()?.action?.label !== 'Plan a train line'; i++) {
    setAdaIndex(i);
    render();
    await nextTick();
  }
  assert.equal(adaView()?.action?.label, 'Plan a train line');
  $('[data-ada-action]')!.click();
  await nextTick();
  await nextTick();
  assert.equal(location.hash, '#logistics');
  // The page opens as the address change draws it.
  go('logistics');
  render();
  await nextTick();
  await nextTick();
  assert.equal($('[data-logistics-tab="trains"]')!.getAttribute('aria-selected'), 'true');
});
