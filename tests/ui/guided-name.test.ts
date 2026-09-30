// The guided start's Save name (#505, GuidedPage.vue): with no saves yet the box starts empty, and
// Continue on an empty (or spaces-only) name stops with a message beside the box, tied to it
// with aria-describedby and aria-invalid, and focus on the box, instead of the browser's bubble
// alone. Typing a name clears it and Continue moves on.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setWizard, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { carryOptions } from '../../public/state.ts';
import { $, catalog, generated, go, open, page } from './setup.ts';

const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const box = () => $<HTMLInputElement>('input[name=saveName]')!;
const message = () => $('#guided-name-error')!;

// The first guided question for a new save, as startWizard() leaves it with no saves.
function firstQuestion(saveName = '') {
  page();
  open({ workspace: { catalog: catalog() } });
  setWizard({
    step: 1,
    saveId: null,
    saveName,
    name: '',
    settings: structuredClone(generated().settings),
    preview: null,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
    mode: 'guided',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  });
  go('wizard');
  render();
}

// What a browser does on Continue: validate the form, which fires `invalid` on each bad box;
// the submit only follows when every box is valid.
async function pressContinue() {
  const form = $<HTMLFormElement>('#wizard-form')!;
  if (box().checkValidity())
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
}

const type = async (value: string) => {
  box().value = value;
  box().dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
};

beforeEach(() => {
  // happy-dom counts some valid steps as mismatches (see wizard.test.ts): only the name box
  // is checked here, by pressContinue.
  HTMLFormElement.prototype.reportValidity = () => true;
});

test('an empty Save name stops Continue with a message tied to the box, and focus on it', async () => {
  firstQuestion();
  assert.equal(box().value, '', 'no saves yet: the box starts empty');
  assert.notEqual(box().placeholder, 'My Satisfactory save', 'the hint does not read as a value');
  assert.equal(box().getAttribute('aria-invalid'), null);
  assert.equal(message().textContent, '', 'no message before Continue, and no space taken');
  $<HTMLElement>('[data-guided-back], [data-cancel-wizard]')!.focus();

  await pressContinue();
  assert.equal(wizard!.guidedStep, 1, 'Continue is refused');
  assert.equal(box().getAttribute('aria-invalid'), 'true');
  assert.equal(box().getAttribute('aria-describedby'), 'guided-name-error');
  assert.equal(message().textContent!.trim(), 'Give the save a name to continue.');
  assert.equal(message().getAttribute('role'), 'alert');
  assert.equal(document.activeElement, box(), 'focus moves to the box');

  await type('   ');
  await pressContinue();
  assert.equal(wizard!.guidedStep, 1, 'a name of spaces is refused too');
  assert.equal(box().getAttribute('aria-invalid'), 'true');

  await type('Rocky Desert');
  assert.equal(box().getAttribute('aria-invalid'), null, 'typing a name clears the error');
  assert.equal(box().getAttribute('aria-describedby'), null);
  assert.equal(message().textContent!.trim(), '');
  await pressContinue();
  assert.equal(wizard!.guidedStep, 2, 'Continue moves on');
  assert.equal(wizard!.saveName, 'Rocky Desert');
  assert.equal(box().value, 'Rocky Desert', 'the next question keeps the name');
});

test('a named save continues at once, with no message', async () => {
  firstQuestion('World');
  await pressContinue();
  assert.equal(wizard!.guidedStep, 2);
  assert.equal(message().textContent!.trim(), '');
});
