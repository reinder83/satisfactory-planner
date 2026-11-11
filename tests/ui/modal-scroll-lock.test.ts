// A modal dialog is fixed in the window and the page behind it does not scroll (#1325). The
// browser puts a modal <dialog> in the top layer, centred on the window, wherever the page is
// scrolled to; what it leaves to the app is the page behind scrolling on under the wheel. The
// stylesheet hides the page's scrollbar while a dialog is open and pads the page by the
// scrollbar's width, which ui/scroll-lock.ts notes in --scrollbar-width before showModal(), so
// the sidebar and the columns do not shift. happy-dom does no layout, so the width is stubbed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { render } from '../../public/app/shell.ts';
import { closeDetail } from '../../public/app/ui/actions.ts';
import { confirmAction } from '../../public/app/ui/confirm.ts';
import { $, go, migratedRow, openMigrated, page } from './setup.ts';

const root = () => document.documentElement;
const scrollbar = () => root().style.getPropertyValue('--scrollbar-width');
// A window 1440 wide whose page area is 1425 wide: a 15px scrollbar.
const withScrollbar = (clientWidth: number) => {
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
  Object.defineProperty(root(), 'clientWidth', { value: clientWidth, configurable: true });
};

beforeAll(() => {
  page();
  openMigrated();
  go('factories');
  render();
});
afterEach(async () => {
  await closeDetail();
  root().style.removeProperty('--scrollbar-width');
});

test('opening #detail notes the page scrollbar’s width for the rule that hides it', () => {
  withScrollbar(1425);
  openCalculatedFactory(migratedRow('wire'));
  assert.ok($<HTMLDialogElement>('#detail')!.open);
  assert.equal(scrollbar(), '15px');
});

test('a confirmation over #detail keeps the width noted for it, though the scrollbar is gone by then', () => {
  withScrollbar(1425);
  openCalculatedFactory(migratedRow('wire'));
  withScrollbar(1440);
  void confirmAction({ title: 'Remove this?', body: 'It goes.', confirmLabel: 'Remove' });
  assert.ok($<HTMLDialogElement>('#confirm')!.open);
  assert.equal(scrollbar(), '15px');
  $<HTMLButtonElement>('#confirm [data-confirm-cancel]')!.click();
});

test('the stylesheet fixes and centres modal dialogs and locks the page behind them', () => {
  const css = readFileSync('public/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const body = (selector: string) => {
    const at = css.indexOf(selector + ' {');
    assert.ok(at >= 0, selector + ' has a rule');
    return css.slice(css.indexOf('{', at), css.indexOf('}', at));
  };
  const modal = body('dialog:modal');
  assert.match(modal, /position:\s*fixed/);
  assert.match(modal, /inset:\s*0/);
  assert.match(modal, /margin:\s*auto/);
  const locked = body('html:has(dialog[open])');
  assert.match(locked, /overflow:\s*hidden/);
  assert.match(locked, /padding-right:\s*var\(--scrollbar-width/);
});
