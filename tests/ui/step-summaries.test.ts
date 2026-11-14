// ONB-5 (#1341): each wizard step keeps a one-line summary where it used to print a paragraph of
// four to six lines, and the whole text sits behind a "?" (ui/HelpPopover.vue, X-3) keyed in
// preferences/help.ts. Nothing is lost: the popup holds the original text word for word.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { helpText } from '../../public/preferences.ts';
import { setWizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { carryOptions } from '../../public/state.ts';
import { $, catalog, generated, go, open, page } from './setup.ts';

const plain = (text: string | null | undefined) => (text || '').replace(/\s+/g, ' ').trim();
const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());

function stepOf(step: number) {
  page();
  open({ workspace: { catalog: catalog() } });
  setWizard({
    step,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: structuredClone(generated().settings),
    preview: null,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  });
  go('wizard');
  render();
}

beforeEach(() => {
  HTMLFormElement.prototype.reportValidity = () => true;
});

// Every summary: the key of its "?", and the words the long text has and the summary does not.
const STEPS: [number, string, string][] = [
  [1, 'buildCostNote', 'within its time and budgets'],
  [1, 'settingsNotes', 'Modified recipes, production boosts and modded items are not simulated'],
  [2, 'samConversion', 'Gathered items get storage positions'],
  [2, 'portals', 'Reserve portal operating power separately'],
  [3, 'wholeMachinesCost', 'Fluid, generator and nuclear lines always run at exact clocks'],
  [4, 'resourceBudgets', 'Starter values are full-map estimates'],
  [4, 'waterOverclock', 'overclocked when on (from Phase 2'],
  [4, 'phaseBudgets', 'crude oil from Phase 3 and resource wells from Phase 4'],
];

for (const [step, key, rest] of STEPS)
  test(`step ${step}: "${key}" is one short line with the rest behind a "?" (ONB-5)`, async () => {
    stepOf(step);
    // Step 4's per-phase table shows once the per-phase budgets are ticked.
    if (step === 4 && !$('[data-phase-budgets]')) {
      $<HTMLInputElement>('#wizard-form [name=phaseMining]')!.click();
      await settle();
    }
    const help = $<HTMLButtonElement>(`#wizard-form [data-help="${key}"]`);
    assert.ok(help, 'the "?" is on the step');
    assert.equal(help.tagName, 'BUTTON', 'a real button, reached with Tab');
    const summary = help.closest('p, div, small, caption')!;
    assert.ok(
      plain(summary.textContent).length <= 150,
      'a short summary: ' + plain(summary.textContent),
    );
    assert.ok(
      !plain($('#wizard-form')!.textContent).includes(rest),
      'the long text is not on the page',
    );
    assert.ok(helpText[key]!.includes(rest), 'and the "?" holds it');
    help.click();
    await settle();
    assert.ok(plain($('[data-help-tip]')!.textContent).includes(rest), 'opened by a click');
  });

test('the glossary terms in the summaries still open their definitions (ONB-5)', async () => {
  stepOf(1);
  const mam = $<HTMLButtonElement>('#wizard-form [data-term="mam"]');
  assert.ok(mam, 'MAM is still a glossary term');
  mam.click();
  await settle();
  assert.ok($('[data-term-tip]'), 'its definition opens');
  stepOf(3);
  assert.ok($('#wizard-form [data-term="underclock"]'), 'so is underclocked');
});

test('every long explanation keeps all its words in the help texts (ONB-5)', () => {
  // The whole of what the step paragraphs said, word for word, apart from the words that stay in
  // the visible summary.
  assert.match(helpText.surveyBudgets!, /free for this plan to use/);
  assert.match(helpText.surveySource!, /never sends your save anywhere/);
  assert.match(helpText.portals!, /the Satellite Portal does not consume cells/);
  assert.match(helpText.samConversion!, /Pure recipes still need unlocking/);
});
