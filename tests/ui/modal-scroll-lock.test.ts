// A modal dialog is fixed in the window and the page behind it does not scroll (#1325). The
// browser puts a modal <dialog> in the top layer, centred on the window, wherever the page is
// scrolled to; what it leaves to the app is the page behind scrolling on under the wheel. The
// stylesheet hides the page's scrollbar while a dialog is open and keeps its width
// (scrollbar-gutter: stable, #1330), when the page has one, which ui/scroll-lock.ts notes in
// --scroll-gutter before showModal(), so the sidebar and the columns do not shift, and the page
// keeps its scroll position when the dialog closes. happy-dom does no layout, so the scrollbar
// is stubbed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextTick } from 'vue';
import { afterEach, beforeAll, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { render } from '../../public/app/shell.ts';
import { closeDetail } from '../../public/app/ui/actions.ts';
import { confirmAction } from '../../public/app/ui/confirm.ts';
import { $, go, migratedRow, openMigrated, page } from './setup.ts';

const root = () => document.documentElement;
const gutter = () => root().style.getPropertyValue('--scroll-gutter');
// A window 1440 wide whose page area is `clientWidth` wide: 1425 is a 15px scrollbar.
const withScrollbar = (clientWidth: number) => {
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
  Object.defineProperty(root(), 'clientWidth', { value: clientWidth, configurable: true });
};
const stylesheet = () => readFileSync('public/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// The declarations of the first rule that starts with `selector`.
const body = (css: string, selector: string) => {
  const at = css.indexOf(selector + ' {');
  assert.ok(at >= 0, selector + ' has a rule');
  return css.slice(css.indexOf('{', at), css.indexOf('}', at));
};

beforeAll(() => {
  page();
  openMigrated();
  go('factories');
  render();
});
afterEach(async () => {
  await closeDetail();
  root().style.removeProperty('--scroll-gutter');
});

test('opening #detail notes that the page has a scrollbar, for the rule that hides it', () => {
  withScrollbar(1425);
  openCalculatedFactory(migratedRow('wire'));
  assert.ok($<HTMLDialogElement>('#detail')!.open);
  assert.equal(gutter(), 'stable');
});

test('a page with no scrollbar keeps none: no gutter is reserved for it (#1330)', () => {
  withScrollbar(1440);
  openCalculatedFactory(migratedRow('wire'));
  assert.equal(gutter(), 'auto');
});

test('a confirmation over #detail keeps what was noted for it, though the scrollbar is gone by then', () => {
  withScrollbar(1425);
  openCalculatedFactory(migratedRow('wire'));
  withScrollbar(1440);
  void confirmAction({ title: 'Remove this?', body: 'It goes.', confirmLabel: 'Remove' });
  assert.ok($<HTMLDialogElement>('#confirm')!.open);
  assert.equal(gutter(), 'stable');
  $<HTMLButtonElement>('#confirm [data-confirm-cancel]')!.click();
});

test('the stylesheet fixes and centres modal dialogs and locks the page behind them', () => {
  const css = stylesheet();
  const modal = body(css, 'dialog:modal');
  assert.match(modal, /position:\s*fixed/);
  assert.match(modal, /inset:\s*0/);
  assert.match(modal, /margin:\s*auto/);
  const locked = body(css, 'html:has(dialog[open])');
  assert.match(locked, /overflow:\s*hidden/);
  // The scrollbar's width is kept by the gutter, not by padding that is dropped a moment before
  // the scrollbar is back: that jumped a page closed at its very bottom up (#1330).
  assert.match(locked, /scrollbar-gutter:\s*var\(--scroll-gutter/);
  assert.doesNotMatch(locked, /padding/);
});

test('the phone drawer locks the page behind it too, though it is no <dialog> (#1330)', () => {
  const css = stylesheet();
  const locked = body(css, 'html:has(.layout.menu-open)');
  assert.match(locked, /overflow:\s*hidden/);
  assert.match(locked, /scrollbar-gutter:\s*var\(--scroll-gutter/);
  // Inside the phone layout only: above 720px the sidebar is a column of the page.
  const at = css.indexOf('html:has(.layout.menu-open) {');
  const media = css.lastIndexOf('@media', at);
  assert.match(css.slice(media, css.indexOf('{', media)), /max-width:\s*720px/);
});

test('opening the drawer notes the scrollbar the way a dialog does (#1330)', async () => {
  withScrollbar(1425);
  render();
  await nextTick();
  $<HTMLButtonElement>('[data-menu-toggle]')!.click();
  await nextTick();
  assert.ok($('.layout.menu-open'));
  assert.equal(gutter(), 'stable');
});
