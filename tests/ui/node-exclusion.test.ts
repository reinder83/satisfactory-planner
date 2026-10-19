// Leaving resource nodes out of the plan (#1183) in the node survey (ui/pages/SurveyPage.vue,
// ui/survey/LeaveOut.vue and CountTable.vue's leaveOut mode): each counting screen has a folded
// "Leave nodes out of this plan" with a row per counted resource, each count up to the one
// beside it; the budgets screen takes them off the pool before what is committed, and names a
// resource with every node left out; applying the survey keeps them in settings.extraction and
// writes the budgets without them. The sidebar footer names how many a plan leaves out.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { presetSurvey } from '../../public/preferences.ts';
import { setView, setWizard, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { unmountShell } from '../../public/app/ui/mount.ts';
import { $, $$, catalog, generated, go, open, page } from './setup.ts';
import type { WizardDraft, WizardSettings } from '../../public/app/wizard/wizard.ts';
import type { Survey } from '../../public/types/index.ts';

const text = (selector: string) => $(selector)!.textContent.replace(/\s+/g, ' ').trim();

beforeEach(() => {
  page();
  open({ workspace: { catalog: catalog() } });
});

// A draft in the survey at `step`, opened from All settings step 4, over a calculated plan's
// settings, with `extraction` as the survey being edited.
function survey(step: number, extraction: Survey, settings: Partial<WizardSettings> = {}) {
  setWizard({
    step: 4,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: {
      ...structuredClone(generated().settings),
      purity: 'vanilla',
      distribution: 'original',
      ...settings,
    },
    preview: null,
    carryFrom: null,
    carry: {},
    mode: 'extraction',
    extractionStep: step,
    extractionReturn: { mode: 'advanced', step: 4 },
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
    extraction: structuredClone(extraction),
  } as WizardDraft);
  go('wizard');
  render();
}
const redraw = async () => {
  render();
  await nextTick();
};
const change = async (selector: string, value: string) => {
  const el = $<HTMLInputElement>(selector);
  assert.ok(el, selector + ' is on screen');
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await nextTick();
};
const leaveOut = () => $<HTMLDetailsElement>('details[data-leave-out]')!;
const leaveOutRow = (name: string) =>
  $$('.leave-out-table .count-row').find(
    row => row.querySelector('.count-name')!.textContent === name,
  );
const budgetRow = (name: string) =>
  $$('#main tbody tr').find(row => row.querySelector('.resource-name span')!.textContent === name)!;
const cells = (row: Element) => [...row.querySelectorAll('td')].map(td => td.textContent.trim());

test('the ore screen folds "Leave nodes out of this plan" under its counts, a row per counted ore', async () => {
  const counted = presetSurvey('vanilla');
  delete counted.nodes.SAM;
  survey(2, counted);
  const details = leaveOut();
  assert.equal(details.open, false, 'folded while nothing is left out');
  assert.equal(
    details.querySelector('summary')!.textContent.trim(),
    'Leave nodes out of this plan',
  );
  assert.match(
    text('details[data-leave-out] > p'),
    /^For a node too far from where you build, or one already feeding a factory this plan does not include\. The plan never taps a node you leave out: its budgets and the build plan's "Tap the resource nodes" use only the others\./,
  );
  // Every counted ore, SAM (not counted here) left out of it.
  const names = $$('.leave-out-table .count-name').map(name => name.textContent);
  assert.ok(names.includes('Iron Ore') && !names.includes('SAM'), names.join());
  const pure = $<HTMLInputElement>('input[name="exclude-node:Iron Ore:pure"]')!;
  assert.equal(pure.max, '46');
  assert.equal(pure.value, '0');
  assert.equal(pure.getAttribute('aria-label'), 'Pure Iron Ore nodes left out of this plan, of 46');
  assert.deepEqual(
    [...leaveOutRow('Iron Ore')!.querySelectorAll('.count-cell > span')].map(s => s.textContent),
    ['Impure of 39', 'Normal of 42', 'Pure of 46'],
  );
  assert.equal(leaveOutRow('Iron Ore')!.querySelector('.count-total')!.textContent, '—');
  // Leaving 6 pure nodes out keeps them in the survey, with the rate they give taken off.
  await change('input[name="exclude-node:Iron Ore:pure"]', '6');
  assert.deepEqual(wizard!.extraction!.excludedNodes, {
    'Iron Ore': { impure: 0, normal: 0, pure: 6 },
  });
  assert.equal(leaveOutRow('Iron Ore')!.querySelector('.count-total')!.textContent, '−7,200/min');
  // The counting row above is unchanged: the world still holds those nodes.
  assert.deepEqual(wizard!.extraction!.nodes!['Iron Ore'], { impure: 39, normal: 42, pure: 46 });
  // Never more than the count beside it, and none drops the row.
  await change('input[name="exclude-node:Iron Ore:pure"]', '60');
  assert.deepEqual(wizard!.extraction!.excludedNodes, {
    'Iron Ore': { impure: 0, normal: 0, pure: 46 },
  });
  await change('input[name="node:Iron Ore:pure"]', '10');
  assert.deepEqual(
    wizard!.extraction!.excludedNodes,
    { 'Iron Ore': { impure: 0, normal: 0, pure: 10 } },
    'a lowered count lowers what it leaves out',
  );
  await change('input[name="exclude-node:Iron Ore:pure"]', '0');
  assert.equal('excludedNodes' in wizard!.extraction!, false, 'none left out: no field');
});

test('a screen opens its "Leave nodes out" unfolded while it leaves some out, and the well screen has its own', async () => {
  const extraction: Survey = {
    ...presetSurvey('vanilla'),
    excludedNodes: { Coal: { impure: 2, normal: 0, pure: 0 } },
  };
  extraction.nodes!['Crude Oil'] = { impure: 2, normal: 3, pure: 1 };
  survey(2, extraction);
  assert.equal(leaveOut().open, true);
  assert.equal($<HTMLInputElement>('input[name="exclude-node:Coal:impure"]')!.value, '2');
  // The oil screen: its crude oil nodes and well satellites, folded, as it leaves none out.
  wizard!.extractionStep = 3;
  await redraw();
  assert.equal(leaveOut().open, false);
  assert.deepEqual(
    $$('details[data-leave-out] .leave-out-heading').map(h => h.textContent),
    ['Crude oil nodes', 'Resource well satellites'],
  );
  assert.equal($<HTMLInputElement>('input[name="exclude-node:Crude Oil:normal"]')!.max, '3');
  assert.equal(
    $<HTMLInputElement>('input[name="exclude-well:Nitrogen Gas:pure"]')!.getAttribute('aria-label'),
    `Pure Nitrogen Gas well satellites left out of this plan, of ${wizard!.extraction!.wells!['Nitrogen Gas']!.pure}`,
  );
  // No crude oil satellites are counted, so there are none to leave out.
  assert.equal($('input[name^="exclude-well:Crude Oil"]'), null);
  await change('input[name="exclude-well:Nitrogen Gas:normal"]', '1');
  assert.deepEqual(wizard!.extraction!.excludedWells, {
    'Nitrogen Gas': { impure: 0, normal: 1, pure: 0 },
  });
  assert.deepEqual(
    wizard!.extraction!.excludedNodes,
    { Coal: { impure: 2, normal: 0, pure: 0 } },
    'the ores left out on the other screen stay',
  );
});

test('the budgets screen takes the left-out nodes off the pool, and applying keeps them', async () => {
  survey(4, {
    ...presetSurvey('vanilla'),
    used: { 'Iron Ore': 900 },
    excludedNodes: { 'Iron Ore': { impure: 0, normal: 0, pure: 6 } },
  });
  assert.deepEqual(
    $$('#main thead th').map(th => th.textContent.trim()),
    ['Resource', 'Whole pool', 'Left out', 'Already committed', 'Budget'],
  );
  // 92,100 less 6 pure nodes' 7,200 less the 900 committed.
  const iron = cells(budgetRow('Iron Ore'));
  assert.equal(iron[1], '92,100/min');
  assert.equal(iron[2], '−7,200/min');
  assert.equal(iron[4], '84,000/min');
  assert.equal(cells(budgetRow('Coal'))[2], '—');
  assert.equal($('[data-all-left-out]'), null);
  $('#wizard-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await nextTick();
  assert.equal(wizard!.settings.limits!['Iron Ore'], 84000);
  assert.deepEqual(wizard!.settings.extraction!.excludedNodes, {
    'Iron Ore': { impure: 0, normal: 0, pure: 6 },
  });
});

test('a resource with every node left out is named on the budgets screen; a survey without any has no column', async () => {
  const world = presetSurvey('vanilla');
  survey(4, { ...world, excludedNodes: { Sulfur: { ...world.nodes.Sulfur! } } });
  assert.equal(cells(budgetRow('Sulfur'))[4], '0/min');
  assert.equal(
    text('[data-all-left-out]'),
    'Every node left out: Sulfur. This plan cannot mine it, so a phase that needs it will not fit. Put some nodes back on the counting screens if the plan should use them.',
  );
  page();
  open({ workspace: { catalog: catalog() } });
  survey(4, presetSurvey('vanilla'));
  assert.deepEqual(
    $$('#main thead th').map(th => th.textContent.trim()),
    ['Resource', 'Whole pool', 'Already committed', 'Budget'],
  );
});

test('the sidebar names how many nodes a plan leaves out, only when it leaves some out', () => {
  const footer = () => $('.sidebar-foot .profile-switcher')!.textContent!;
  for (const [excludedNodes, shown] of [
    [undefined, null],
    [{ 'Iron Ore': { impure: 0, normal: 2, pure: 4 } }, '6 resource nodes left out'],
    [{ Coal: { impure: 1, normal: 0, pure: 0 } }, '1 resource node left out'],
  ] as const) {
    unmountShell();
    document.body.innerHTML = '<div id="app"></div><dialog id="detail"></dialog>';
    setView('plan');
    const plan = generated();
    plan.settings.extraction = {
      ...presetSurvey('vanilla'),
      mark: 3,
      ...(excludedNodes ? { excludedNodes } : {}),
    };
    open({ calculated: plan });
    render();
    if (shown) assert.ok(footer().includes(shown), footer());
    else assert.doesNotMatch(footer(), /left out/);
    assert.equal(
      $('.sidebar-foot .profile-switcher')!.querySelectorAll('br').length,
      shown ? 4 : 3,
    );
  }
});
