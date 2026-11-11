// "Between factories" on the Logistics page, grouped by sender (LOG-1, #1329, GroupLinks.vue):
// Water pumped at the site that uses it is no link between factories, so it is one summary line
// with the total and no card or row; the real transfers sit in one card per sender, collapsed
// until opened by a disclosure button, with the same rows, controls and checks inside.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { groupLinks } from '../../public/app/group-links.ts';
import { linkCarrier, linkTotal } from '../../public/app/logistics.ts';
import { FLUIDS } from '../../public/app/flow.ts';
import { calcStage, calculated } from '../../public/app/session.ts';
import { factoryGroupsState } from '../../public/app/views/factories.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, generated, go, open, page } from './setup.ts';

const plan = generated();
const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

async function showLogistics() {
  const rows = plan.stages['3'].rows!;
  open({
    calculated: plan,
    state: {
      factoryGroups: {
        groups: [
          { id: 'fg-smelt1', name: 'Iron & steel works' },
          { id: 'fg-parts1', name: 'Parts' },
          { id: 'fg-spare1', name: 'Spare' },
        ],
        assignments: Object.fromEntries(
          rows.map((r, i) => [r.id, [{ group: i % 2 ? 'fg-parts1' : 'fg-smelt1', rate: null }]]),
        ),
      },
    },
  });
  go('logistics');
  render();
  await nextTick();
}
const toggle = (card: Element) => card.querySelector<HTMLButtonElement>('[data-group-toggle]')!;
const body = (card: Element) => card.querySelector<HTMLElement>('[data-group-body]')!;
const click = async (el: Element) => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await nextTick();
};
const links = () => groupLinks(calcStage()!, factoryGroupsState(), calculated!.settings.onSite);

beforeEach(() => page());

test('Water pumped on site is one summary line with the total, not a link per factory', async () => {
  await showLogistics();
  const pumped = links().filter(
    l => linkCarrier(factoryGroupsState().links, l.from, l.to).kind === 'extract',
  );
  assert.ok(pumped.length, 'the plan pumps Water');
  const sites = new Set(pumped.map(l => l.to)).size;
  const total = linkTotal(
    pumped.flatMap(l => l.items.map(i => ({ ...i, fluid: FLUIDS.has(i.item) }))),
  );
  assert.match(total, / m³\/min$/);
  const lines = $$('[data-on-site-text]');
  assert.equal(lines.length, 1, 'one line for the one pumped resource');
  assert.equal(
    text(lines[0]!),
    `Water: extracted on site at ${sites} ${sites === 1 ? 'factory' : 'factories'} · ${total} total`,
  );
  // No row, card or sentence per factory any more.
  assert.equal($$('[data-link-extract]').length, 0);
  assert.equal($('[data-group-card][data-group="supply/Water"]'), null);
  const keys = $$('[data-link-out], [data-link-in]').map(
    row => row.dataset.linkOut ?? row.dataset.linkIn ?? '',
  );
  assert.ok(keys.length && keys.every(key => !key.startsWith('supply/Water:')));
  assert.doesNotMatch($('[data-group-links]')!.textContent!, /Build the Water Extractors at/);
  // Which factories, and how much each, is one disclosure away.
  const button = $<HTMLButtonElement>('[data-on-site-toggle]')!;
  const list = $<HTMLElement>('[data-on-site-list]')!;
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(button.getAttribute('aria-controls'), list.id);
  assert.ok(list.hidden);
  await click(button);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.ok(!list.hidden);
  assert.equal(list.querySelectorAll('li').length, pumped.length);
});

test('the transfers are grouped by sender and every group starts collapsed', async () => {
  await showLogistics();
  const cards = $$('[data-group-card]');
  assert.ok(cards.length > 3);
  for (const card of cards) {
    assert.equal(toggle(card).getAttribute('aria-expanded'), 'false', card.dataset.group);
    assert.ok(body(card).hidden, card.dataset.group);
    assert.match(
      text(card.querySelector('[data-group-summary]')!),
      /^[→←] \d+ [a-z]+ · \d+ items?$/,
    );
  }
  // A sender's header says where it sends and how many items.
  const smelt = $('[data-group-card][data-group="fg-smelt1"]')!;
  assert.equal(text(smelt.querySelector('h3')!), 'Iron & steel works');
  const out = links().filter(l => l.from === 'fg-smelt1');
  const items = new Set(out.flatMap(l => l.items.map(i => i.item))).size;
  const to = new Set(out.map(l => l.to)).size;
  assert.match(
    text(smelt.querySelector('[data-group-summary]')!),
    new RegExp(`^→ ${to} [a-z]+ · ${items} items?$`),
  );
});

test('opening a group shows the same cards, controls and checks as before', async () => {
  await showLogistics();
  const smelt = $('[data-group-card][data-group="fg-smelt1"]')!;
  const rowsOut = () => [...smelt.querySelectorAll<HTMLElement>('[data-link-out]')];
  assert.ok(rowsOut().length);
  await click(toggle(smelt));
  assert.equal(toggle(smelt).getAttribute('aria-expanded'), 'true');
  assert.ok(!body(smelt).hidden);
  assert.equal(body(smelt).id, toggle(smelt).getAttribute('aria-controls'));
  for (const row of rowsOut()) {
    assert.ok(body(smelt).contains(row));
    assert.ok(row.querySelector('[data-link-mode]'), 'the vehicle choice');
    assert.ok(row.querySelector('[data-link-badge], [data-link-load]'), 'the belt or vehicle math');
  }
  assert.ok(smelt.querySelector('[data-flow="in"]') && smelt.querySelector('[data-flow="out"]'));
  // The other groups stay closed; the same button closes it again.
  assert.equal($$('[data-group-toggle][aria-expanded="true"]').length, 1);
  await click(toggle(smelt));
  assert.ok(body(smelt).hidden);
  // Expand all and Collapse all.
  await click($('[data-groups-expand]')!);
  assert.equal($$('[data-group-body]').filter(b => b.hidden).length, 0);
  await click($('[data-groups-collapse]')!);
  assert.equal($$('[data-group-body]').filter(b => !b.hidden).length, 0);
});

test('every disclosure is a real button in the Tab order, named, and linked to what it opens', async () => {
  await showLogistics();
  const buttons = $$<HTMLButtonElement>('[data-group-toggle], [data-on-site-toggle]');
  assert.ok(buttons.length > 4);
  for (const button of buttons) {
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(button.type, 'button');
    assert.ok(button.tabIndex >= 0, 'in the Tab order');
    assert.ok(text(button).length > 2, 'has a name');
    assert.ok(['true', 'false'].includes(button.getAttribute('aria-expanded')!));
    assert.ok(document.getElementById(button.getAttribute('aria-controls')!));
  }
  // The heading holds the button, so the headings still outline the page.
  for (const card of $$('[data-group-card]')) assert.ok(card.querySelector('h3 > button'));
  // What is closed is hidden from the Tab order and the screen reader too.
  for (const card of $$('[data-group-card]')) assert.ok(body(card).hasAttribute('hidden'));
});
