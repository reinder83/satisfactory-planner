// The phone's shell and flow graph (MOB-1, MOB-2, MOB-3, #1354): the bottom bar (Plan, Factories,
// Map and More, with the other pages and Quick jump in More), the phase select that marks a phase
// shown but not worked on, and the flow graph's list of lines with its List / Graph toggle on a
// narrow screen. What the stylesheet draws at 320 to 430px is measured in a real browser (see the
// pull request) and its rules are checked in tests/mobile-css.test.ts.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { itemRate } from '../../public/app/flow.ts';
import { flowGraph } from '../../public/app/flow-graph.ts';
import { setQuery, viewPhase } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { shownGroupFlow } from '../../public/app/shown-group-flow.ts';
import { jumpShortcut } from '../../public/app/ui/jump.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { $, $$, generated, go, open, page } from './setup.ts';

const plan = generated();
const GROUP = 'fg-iron01';
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const dialog = () => $<HTMLDialogElement>('#detail')!;
const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

// A screen that is or is not the phone layout, for what the components ask matchMedia.
const real = window.matchMedia;
function screen(narrow: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: narrow && query.includes('max-width: 720px'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as never;
}
afterEach(() => {
  window.matchMedia = real;
});

async function showFactories() {
  page();
  setQuery('');
  open({
    calculated: structuredClone(plan),
    phase: '3',
    state: { factoryGroups: structuredClone(defaultFactoryGroups(plan)) },
  });
  go('factories');
  render();
  await settle();
}

beforeEach(() => {
  history.replaceState(null, '', '#factories');
  document.body.addEventListener('keydown', jumpShortcut);
});

test('the bottom bar has Plan, Factories, Map and More, the open page marked (MOB-2)', async () => {
  await showFactories();
  const bar = $('[data-bottom-bar]')!;
  assert.equal(bar.tagName, 'NAV');
  assert.equal(bar.getAttribute('aria-label'), 'Quick navigation');
  assert.deepEqual(
    $$('[data-bottom-link]').map(link => [
      link.getAttribute('href'),
      text(link).replace(/^\S\s*/, ''),
    ]),
    [
      ['#plan', 'Plan'],
      ['#factories', 'Factories'],
      ['#map', 'Map'],
    ],
  );
  assert.equal($('[data-bottom-link="factories"]')!.getAttribute('aria-current'), 'page');
  assert.equal($('[data-bottom-link="plan"]')!.getAttribute('aria-current'), null);
  assert.match(text($('[data-bottom-more]')!), /More$/);
});

test('More lists every other page and Quick jump, so nothing of the old top bar is lost (MOB-1, MOB-2)', async () => {
  await showFactories();
  assert.deepEqual(
    $$('#bottom-more [role="menuitem"]').map(item => text(item)),
    ['Logistics', 'Storage room', 'Power & resources', 'Notes', 'Backup', 'Quick jump'],
  );
  assert.ok($('[data-jump-open]'), 'the top bar keeps its search button for wider screens');
  $<HTMLButtonElement>('[data-more-page="notes"]')!.click();
  assert.equal(location.hash, '#notes');
  $<HTMLButtonElement>('[data-more-jump]')!.click();
  await settle();
  assert.ok($<HTMLDialogElement>('#jump')?.open, 'Quick jump opens from More');
  $<HTMLDialogElement>('#jump')!.close();
});

test('the bottom bar is left out of the wizard, which has its own bar (MOB-2)', async () => {
  await showFactories();
  go('wizard');
  render();
  await settle();
  assert.equal($('[data-bottom-bar]'), null);
});

test('the phase select has a dashed edge while another phase than the working one is shown (MOB-1)', async () => {
  await showFactories();
  assert.ok(!$('#phase-picker')!.classList.contains('is-elsewhere'));
  viewPhase('2');
  render();
  await settle();
  assert.ok($('#phase-picker')!.classList.contains('is-elsewhere'));
});

async function openGraph() {
  const opener = $<HTMLButtonElement>(`#main [data-group-graph="${GROUP}"]`)!;
  opener.focus();
  opener.click();
  await settle();
  assert.ok(dialog().open, 'the dialog is open');
}
const hidden = (el: Element) => (el as HTMLElement).style.display === 'none';

test('on a phone the flow graph opens as a list of lines with their rates, and a toggle shows the graph (MOB-3)', async () => {
  screen(true);
  await showFactories();
  await openGraph();
  const list = $('#detail [data-flow-graph-list]')!;
  assert.ok(!hidden(list), 'the list shows');
  assert.ok(hidden($('#detail .fgraph-wrap')!), 'the graph is hidden');
  assert.ok(hidden($('#detail [data-flow-graph-tools]')!), 'and so are its zoom tools');
  assert.equal($('#detail [data-flow-mode-set="list"]')!.getAttribute('aria-pressed'), 'true');
  const graph = flowGraph(shownGroupFlow(GROUP)!, itemRate, () => '');
  const lines = graph.nodes.filter(node => node.kind === 'line');
  assert.equal($$('#detail [data-flow-list-line]').length, lines.length, 'a row per line');
  const busy = lines.find(node => graph.edges.some(edge => edge.to === node.id))!;
  const row = $(`#detail [data-flow-list-line="${busy.id}"]`)!.closest('li')!;
  const ins = graph.edges.filter(edge => edge.to === busy.id);
  const inText = text(row.querySelector('[data-flow-list-in]')!);
  assert.ok(inText.startsWith('In '), 'a line of what comes in');
  assert.ok(inText.includes(`${ins[0]!.item} ${ins[0]!.rateText}`), 'with each item and rate');
  assert.ok(text(row.querySelector('[data-flow-list-out]')!).startsWith('Out '));

  // A press on a row selects the line: the same panel as the graph's.
  $<HTMLButtonElement>(`#detail [data-flow-list-line="${busy.id}"]`)!.click();
  await settle();
  assert.equal(
    $(`#detail [data-flow-list-line="${busy.id}"]`)!.getAttribute('aria-pressed'),
    'true',
  );
  assert.ok($('#detail [data-flow-graph-selection]'), 'the selection panel opens under the list');

  $<HTMLButtonElement>('#detail [data-flow-mode-set="graph"]')!.click();
  await settle();
  assert.ok(hidden(list));
  assert.ok(!hidden($('#detail .fgraph-wrap')!));
  assert.equal($('#detail [data-flow-mode-set="graph"]')!.getAttribute('aria-pressed'), 'true');
  dialog().close();
  await settle();
});

test('a wide screen has only the graph: no toggle, the list hidden (MOB-3)', async () => {
  screen(false);
  await showFactories();
  await openGraph();
  assert.equal($('#detail [data-flow-mode]'), null);
  assert.ok(hidden($('#detail [data-flow-graph-list]')!));
  assert.ok(!hidden($('#detail .fgraph-wrap')!));
  dialog().close();
  await settle();
});
