// The build plan's tabs (#1243, ui/pages/CalculatedPlanPage.vue with ui/plan/plan-tabs.ts): Build
// sequence first and open, then Overview (the summary line and the notices), Hard drives and
// Somersloops; a WAI-ARIA tab list that arrow keys, Home and End move through; a count on a tab
// for the notices that ask for something, gone once dismissed; tabs whose panel would be empty
// left out, and no tab list at all when Build sequence is all there is. Nothing is stored.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { setBeginnerMode } from '../../public/app/beginner.ts';
import { setHideDone, setQuery, setWorkspace, workspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { tabKeyTarget } from '../../public/app/ui/plan/plan-tabs.ts';
import type { CurrentCalculatedPlan, Phase, ProgressState } from '../../public/types/index.ts';
import { $, $$, catalog, generated, generatedWith, go, open, page } from './setup.ts';

const MINER_MK2 = 'unlock-Schematic_4-1_C';
const words = (element: Element | null | undefined) =>
  (element?.textContent || '').replace(/\s+/g, ' ').trim();
const tabIds = () => $$('[data-plan-tab]').map(tab => tab.dataset.planTab);
const selected = () => $('[data-plan-tab][aria-selected="true"]')?.dataset.planTab;
const shownPanels = () =>
  $$('[data-plan-panel]')
    .filter(panel => !panel.hidden)
    .map(panel => panel.dataset.planPanel);

let profileCount = 0;
async function show(
  plan: CurrentCalculatedPlan,
  phase: Phase,
  checks: Record<string, boolean> = {},
) {
  page();
  // Each call opens its own profile id: a dismissal is remembered per save and profile.
  open({
    calculated: plan,
    phase,
    profileId: 'tabs' + ++profileCount,
    state: { checks } as Partial<ProgressState>,
  });
  setWorkspace({ ...workspace, catalog: catalog() });
  setQuery('');
  setHideDone(false);
  go('plan');
  render();
  await nextTick();
  await nextTick();
}
const keyOn = async (key: string) => {
  (document.activeElement as HTMLElement).dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true }),
  );
  await nextTick();
};

beforeEach(() => setBeginnerMode(false));
afterEach(() => setBeginnerMode(false));

test('the page opens on Build sequence; the other tabs hold the summary, the payoff and the somersloops', async () => {
  await show(generated(), '4');
  const list = $('[data-plan-tabs]')!;
  assert.equal(list.getAttribute('aria-label'), 'Build plan');
  assert.ok(list.classList.contains('tabs'), 'the shared .tabs style');
  assert.deepEqual(tabIds(), ['build', 'overview', 'hard-drives', 'somersloops']);
  assert.deepEqual($$('[data-plan-tab]').map(words), [
    'Build sequence',
    'Overview',
    'Hard drives',
    'Somersloops',
  ]);
  assert.equal(selected(), 'build');
  assert.deepEqual(shownPanels(), ['build']);
  // Each tab names its panel and the panel its tab; only the open tab is in the Tab order.
  for (const tab of $$('[data-plan-tab]')) {
    const panel = $('#' + tab.getAttribute('aria-controls'))!;
    assert.equal(panel.getAttribute('role'), 'tabpanel');
    assert.equal(panel.getAttribute('aria-labelledby'), tab.id);
    assert.equal(tab.tabIndex, tab.dataset.planTab === 'build' ? 0 : -1);
  }
  assert.ok($('#plan-panel-build .checklist, #plan-panel-build [data-task]'), 'the steps');
  assert.ok($('#plan-panel-build aside'), 'and the elevator delivery column');
  assert.ok($('#plan-panel-overview [data-plan-summary]'));
  assert.ok($('#plan-panel-hard-drives [data-payoff]'));
  assert.ok($('#plan-panel-somersloops [data-sloop-payoff]'));
  // Before Build sequence on the page: only the header, the edit bar and the tab list.
  const build = $('#plan-panel-build')!;
  assert.ok(
    list.compareDocumentPosition(build) & Node.DOCUMENT_POSITION_FOLLOWING,
    'the tab list comes first',
  );
  $<HTMLButtonElement>('[data-plan-tab="overview"]')!.click();
  await nextTick();
  assert.equal(selected(), 'overview');
  assert.deepEqual(shownPanels(), ['overview']);
});

test('arrow keys, Home and End move between the tabs and open the one they reach', async () => {
  await show(generated(), '4');
  $<HTMLButtonElement>('[data-plan-tab="build"]')!.focus();
  await keyOn('ArrowRight');
  assert.equal(selected(), 'overview');
  assert.equal(document.activeElement, $('[data-plan-tab="overview"]'));
  await keyOn('End');
  assert.equal(selected(), 'somersloops');
  await keyOn('ArrowRight');
  assert.equal(selected(), 'build', 'wraps round');
  await keyOn('ArrowLeft');
  assert.equal(selected(), 'somersloops');
  await keyOn('Home');
  assert.equal(selected(), 'build');
  assert.equal(document.activeElement, $('[data-plan-tab="build"]'));
  assert.deepEqual(shownPanels(), ['build']);
  assert.equal(tabKeyTarget('Enter', 0, 4), null);
  assert.equal(tabKeyTarget('ArrowLeft', 0, 4), 3);
});

test('Overview counts a notice that asks for something until it is dismissed', async () => {
  const plan = generatedWith({ phase: '1', phaseMining: true });
  await show(plan, '1', { [MINER_MK2]: true });
  assert.ok($('#plan-panel-overview [data-owned-ticks]'), 'the ticks notice is in Overview');
  assert.ok($('#plan-panel-overview [data-power-short]'), 'and so is the power warning');
  const overview = $('[data-plan-tab="overview"]')!;
  assert.equal(words(overview.querySelector('[data-plan-tab-count]')), '2');
  assert.equal(
    overview.querySelector('[data-plan-tab-count]')!.getAttribute('aria-hidden'),
    'true',
  );
  assert.equal(words(overview), 'Overview2, 2 new');
  assert.equal($('[data-plan-tab="hard-drives"] [data-plan-tab-count]'), null);
  overview.click();
  await nextTick();
  $<HTMLButtonElement>('[data-owned-ticks-dismiss]')!.click();
  await nextTick();
  await nextTick();
  assert.equal($('[data-owned-ticks]'), null);
  assert.equal(words($('[data-plan-tab="overview"] [data-plan-tab-count]')), '1', 'one less');
  assert.equal(selected(), 'overview', 'the summary keeps the tab');
  assert.equal(document.activeElement, $('[data-plan-tab="overview"]'), 'focus on its tab');
});

test('tabs with nothing to show are left out, and an open one that empties hands back', async () => {
  await show(generatedWith({ phase: '1', phaseMining: true }), '1');
  assert.deepEqual(tabIds(), ['build', 'overview', 'hard-drives'], 'no somersloops before Phase 3');
  $<HTMLButtonElement>('[data-plan-tab="hard-drives"]')!.click();
  await nextTick();
  setBeginnerMode(true);
  render();
  await nextTick();
  await nextTick();
  assert.deepEqual(tabIds(), ['build', 'overview'], 'New to Satisfactory hides the payoff');
  assert.equal(selected(), 'build');
  assert.deepEqual(shownPanels(), ['build']);
});

test('a milestone-only phase without notices has no tab list', async () => {
  await show(generated(), '1');
  assert.ok($('[data-milestone-intro]'), 'Phase 1 of a Phase 3 profile is milestones only');
  assert.equal($('[data-plan-tabs]'), null);
  assert.equal($('#plan-panel-build')!.getAttribute('role'), null);
  assert.equal($('#plan-panel-build')!.hidden, false);
});
