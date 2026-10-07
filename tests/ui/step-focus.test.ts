// Where focus goes when Continue or Back changes the screen of the five steps or the guided start
// (#608, focusNewStep in public/app/ui/refocus.ts): the form is replaced, and the pressed button
// with it, so focus would fall to <body>. It goes to the new screen's heading
// (ui/form/StepHeading.vue, tabindex="-1"), whose name says which step it is. A step tab stays on
// the page and keeps focus, and the first screen drawn takes nothing.
// The focused element is compared by what identifies it, never two elements with assert.equal
// (#287).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { setWizard, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { guidedFlow } from '../../public/app/wizard/guided.ts';
import { carryOptions } from '../../public/state.ts';
import { $, catalog, generated, go, open, page, stubFetch } from './setup.ts';
import type { WizardDraft } from '../../public/app/wizard/wizard.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
// Focus a control, then press it, as the keyboard does.
const press = async (selector: string) => {
  const el = $(selector);
  assert.ok(el, selector + ' is on screen');
  el.focus();
  el.click();
  await settle();
  await settle();
};
// Continue, the form's submit button: focused, then the form submitted, as Enter or a press does.
// (happy-dom's own click on it checks the number boxes' steps, which it gets wrong for 0.1.)
const pressContinue = async () => {
  const button = $<HTMLButtonElement>('#wizard-form button[type=submit]');
  assert.ok(button, 'Continue is on screen');
  button.focus();
  button.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  await settle();
};
const focused = () => document.activeElement as HTMLElement | null;
const describeFocus = () => focused()?.outerHTML.slice(0, 120) ?? 'null';
const stepHeading = () => $('#wizard-form [data-step-heading]');
// Whether focus is on the screen's heading, and the name it is read out by.
const onStepHeading = () => !!stepHeading() && focused() === stepHeading();
const headingName = () => stepHeading()?.textContent?.replace(/\s+/g, ' ').trim();

// A draft at `step` of the five steps, or at guidedStep of the guided start with mode 'guided'.
function draftAt(step: number, extra: Partial<WizardDraft> = {}) {
  setWizard({
    step,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: structuredClone(generated().settings),
    preview: step === 5 ? generated() : null,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
    ...extra,
  });
  go('wizard');
  render();
}

let scrolled: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  page();
  open({ workspace: { catalog: catalog() } });
  // happy-dom counts 1 as a step mismatch for step="0.1", which browsers do not.
  HTMLFormElement.prototype.reportValidity = () => true;
  scrolled = vi.spyOn(window, 'scrollTo');
});
afterEach(() => vi.restoreAllMocks());

test('every step heading can take focus by script, not by Tab', () => {
  for (let step = 1; step <= 5; step++) {
    draftAt(step);
    assert.equal(stepHeading()!.tagName, 'H2', 'step ' + step);
    assert.equal(stepHeading()!.getAttribute('tabindex'), '-1', 'step ' + step);
  }
});

test('the first step drawn leaves focus where it is', async () => {
  draftAt(2);
  await settle();
  assert.equal(focused(), document.body);
  page();
  draftAt(1, { mode: 'guided' });
  await settle();
  assert.equal(focused(), document.body);
  assert.equal(scrolled.mock.calls.length, 0, 'and does not scroll');
});

test('Continue and Back in the five steps focus the new step’s heading, named by its step', async () => {
  draftAt(1);
  await pressContinue();
  assert.equal(wizard!.step, 2);
  assert.ok(onStepHeading(), 'Continue: ' + describeFocus());
  assert.equal(headingName(), 'Step 2 of 5: How do you want to build?');
  assert.deepEqual(scrolled.mock.calls, [[0, 0]], 'the step starts at the top of the page');
  await pressContinue();
  assert.equal(headingName(), 'Step 3 of 5: Choose your production goal');
  assert.ok(onStepHeading(), 'Continue to Goals: ' + describeFocus());
  await press('[data-wizard-back]');
  assert.equal(wizard!.step, 2);
  assert.ok(onStepHeading(), 'Back: ' + describeFocus());
  await press('[data-wizard-back]');
  assert.equal(headingName(), 'Step 1 of 5: Your save and game settings');
  assert.ok(onStepHeading(), 'Back to step 1: ' + describeFocus());
});

test('Continue on Resources calculates and focuses Review’s heading', async () => {
  draftAt(4);
  stubFetch({ '/api/preview': generated() });
  await pressContinue();
  await settle();
  assert.equal(wizard!.step, 5);
  assert.match(headingName()!, /^Step 5 of 5: Review /);
  assert.ok(onStepHeading(), describeFocus());
});

test('a step tab keeps focus when it changes the step', async () => {
  draftAt(1);
  await press('[data-wizard-step="3"]');
  assert.equal(wizard!.step, 3);
  assert.equal(focused()?.getAttribute('data-wizard-step'), '3', describeFocus());
});

test('Continue and Back in the guided start focus the new question’s heading', async () => {
  draftAt(1, { mode: 'guided' });
  const flow = guidedFlow();
  await pressContinue();
  assert.equal(wizard!.guidedStep, 2);
  assert.ok(onStepHeading(), 'Continue: ' + describeFocus());
  // The questions, then Review as the flow's last step (#1072).
  assert.equal(headingName(), `Step 2 of ${flow.length + 1}: ${guidedFlow()[1]!.title}`);
  await press('[data-guided-back]');
  assert.equal(wizard!.guidedStep, 1);
  assert.ok(onStepHeading(), 'Back: ' + describeFocus());
  assert.equal(headingName(), `Step 1 of ${flow.length + 1}: ${guidedFlow()[0]!.title}`);
});

test('Continue from "What is different this time?" focuses the first question', async () => {
  draftAt(1, { mode: 'guided', saveId: 's', carryFrom: 'p' });
  assert.equal(headingName(), 'What is different this time?');
  await pressContinue();
  assert.equal($('.guided-topics'), null);
  assert.ok(onStepHeading(), describeFocus());
  assert.match(headingName()!, /^Step 1 of \d+: /);
});

// #449: at 720px and below the estimate's bar covers the foot of the screen. Where the top of
// the page would leave the heading under it, the step tabs come to the top instead.
test('a heading the top of the page leaves under the estimate bar is scrolled into view', async () => {
  draftAt(3);
  const into = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
  const box = (top: number, height: number) => ({ top, bottom: top + height, height }) as DOMRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.matches('[data-estimate-peek]')) return box(window.innerHeight - 60, 60);
    if (this.matches('[data-step-heading]')) return box(window.innerHeight - 80, 30);
    return box(0, 0);
  });
  await press('[data-wizard-back]');
  assert.equal(wizard!.step, 2);
  assert.ok(onStepHeading(), describeFocus());
  assert.equal($('[data-estimate-peek]'), null, 'Preferences has no estimate');
  // Preferences has no bar: the heading's own place is checked against the window alone.
  assert.equal(into.mock.calls.length, 0);
  await pressContinue();
  assert.equal(wizard!.step, 3);
  assert.ok($('[data-estimate-peek]'), 'Goals shows the estimate');
  assert.ok(onStepHeading(), describeFocus());
  assert.ok(
    into.mock.contexts.some(el => (el as HTMLElement).matches('.wizard-progress')),
    'the step tabs come to the top',
  );
});
