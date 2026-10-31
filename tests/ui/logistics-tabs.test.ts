// The Logistics page's tabs (#1295, ui/pages/LogisticsPage.vue): "Between factories" holds the
// links and their notices, "Trains" the train stations (and the lines and diagram of #1284), in
// every phase. The build plan's tab pattern: a WAI-ARIA tab list, the arrow keys, Home and End
// move and open, only the open tab is in the Tab order, and each panel is labelled by its tab.
// The open tab is remembered in this browser, so coming back to Logistics opens it again, and the
// subtitle follows the tab.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { render } from '../../public/app/shell.ts';
import { setLogisticsTab } from '../../public/app/session.ts';
import { $, $$, go, open, page } from './setup.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 10));
  await nextTick();
};
const tab = (id: string) => $<HTMLButtonElement>(`[data-logistics-tab="${id}"]`)!;
const panel = (id: string) => $(`[data-logistics-panel="${id}"]`)!;
const subtitle = () => $('#main .subtitle')?.textContent?.trim() ?? '';
const key = (target: Element, name: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

async function showLogistics() {
  open({ state: { version: 3, factoryGroups: { groups: [], assignments: {} } } });
  go('logistics');
  render();
  await settle();
}

beforeEach(() => {
  page();
  setLogisticsTab('links');
});

test('two tabs under the header: Between factories open, Trains beside it', async () => {
  await showLogistics();
  const list = $('[data-logistics-tabs]')!;
  assert.equal(list.getAttribute('role'), 'tablist');
  assert.equal(list.getAttribute('aria-label'), 'Logistics');
  assert.deepEqual(
    $$('[role="tab"]')
      .filter(el => list.contains(el))
      .map(el => el.textContent!.trim()),
    ['Between factories', 'Trains'],
  );
  assert.equal(tab('links').getAttribute('aria-selected'), 'true');
  assert.equal(tab('links').tabIndex, 0);
  assert.equal(tab('trains').getAttribute('aria-selected'), 'false');
  assert.equal(tab('trains').tabIndex, -1, 'only the open tab is in the Tab order');
  for (const id of ['links', 'trains']) {
    assert.equal(panel(id).getAttribute('role'), 'tabpanel');
    assert.equal(panel(id).getAttribute('aria-labelledby'), 'logistics-tab-' + id);
    assert.equal(tab(id).getAttribute('aria-controls'), panel(id).id);
  }
  assert.equal(panel('links').hidden, false);
  assert.equal(panel('trains').hidden, true);
  // The notice of a profile without factories sits on Between factories only.
  assert.ok(panel('links').querySelector('[data-logistics-empty="groups"]'));
  assert.equal(panel('trains').querySelector('[data-logistics-empty]'), null);
  assert.ok(panel('trains').querySelector('[data-train-stations]'), 'the stations are on Trains');
  assert.match(subtitle(), /What each factory sends the others/);
});

test('arrow keys, Home and End move and open; the open tab is remembered', async () => {
  await showLogistics();
  tab('links').focus();
  key(tab('links'), 'ArrowRight');
  await settle();
  assert.equal(tab('trains').getAttribute('aria-selected'), 'true');
  assert.equal(document.activeElement, tab('trains'), 'focus follows');
  assert.equal(panel('trains').hidden, false);
  assert.equal(panel('links').hidden, true);
  assert.match(subtitle(), /train stations and the lines between them/);
  key(tab('trains'), 'ArrowRight');
  await settle();
  assert.equal(document.activeElement, tab('links'), 'the arrows wrap');
  key(tab('links'), 'End');
  await settle();
  assert.equal(document.activeElement, tab('trains'));
  key(tab('trains'), 'Home');
  await settle();
  assert.equal(document.activeElement, tab('links'));
  // A click opens Trains; leaving and coming back opens it again.
  tab('trains').click();
  await settle();
  go('plan');
  render();
  await settle();
  go('logistics');
  render();
  await settle();
  assert.equal(tab('trains').getAttribute('aria-selected'), 'true');
  assert.equal(panel('trains').hidden, false);
});

test('a phase without production lines keeps its notice on Between factories only', async () => {
  // A plan without stages: no production lines in the phase shown.
  open({ calculated: true, state: { version: 1 } });
  go('logistics');
  render();
  await settle();
  assert.ok(panel('links').querySelector('[data-logistics-empty="phase"]'));
  tab('trains').click();
  await settle();
  assert.ok(panel('trains').querySelector('[data-train-stations]'), 'Trains in every phase');
  assert.equal(panel('trains').querySelector('[data-logistics-empty]'), null);
});
