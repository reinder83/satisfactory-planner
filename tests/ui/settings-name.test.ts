// All settings step 1's Save name (#578, ui/wizard/SettingsStep.vue): Continue on an empty or
// spaces-only name stays on step 1 with a message beside the box, tied to it with
// aria-describedby and aria-invalid, and focus on the box, as the guided start does
// (tests/ui/guided-name.test.ts). Typing a name clears it and Continue moves on; a save's name
// is read-only when adding a profile to it, and never refused.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setWizard, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { carryOptions } from '../../public/state.ts';
import { $, catalog, generated, go, open, page } from './setup.ts';

const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const box = () => $<HTMLInputElement>('input[name=saveName]')!;
const message = () => $('#settings-name-error')!;

// Step 1 of the five steps, as "All settings" leaves it.
function settingsStep(saveName = '', saveId: string | null = null) {
  page();
  open({ workspace: { catalog: catalog() } });
  setWizard({
    step: 1,
    saveId,
    saveName,
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

// Continue submits the form; moveWizard then validates it with reportValidity, which fires
// `invalid` on each bad box.
async function pressContinue() {
  $<HTMLFormElement>('#wizard-form')!.dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
  await settle();
}

const type = async (value: string) => {
  box().value = value;
  box().dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
};

beforeEach(() => {
  // happy-dom counts some valid steps as mismatches (see wizard.test.ts): only the name box
  // is validated here.
  HTMLFormElement.prototype.reportValidity = function (this: HTMLFormElement) {
    const name = this.querySelector<HTMLInputElement>('input[name=saveName]');
    return name ? name.checkValidity() : true;
  };
});

test('an empty or spaces-only Save name stays on step 1 with a message tied to the box', async () => {
  settingsStep();
  assert.equal(box().getAttribute('aria-invalid'), null);
  assert.equal(message().textContent, '', 'no message before Continue, and no space taken');
  $<HTMLElement>('[data-wizard-step="1"]')!.focus();

  await pressContinue();
  assert.equal(wizard!.step, 1, 'Continue is refused');
  assert.equal(box().getAttribute('aria-invalid'), 'true');
  assert.equal(box().getAttribute('aria-describedby'), 'settings-name-error');
  assert.equal(message().textContent!.trim(), 'Give the save a name to continue.');
  assert.equal(message().getAttribute('role'), 'alert');
  assert.equal(document.activeElement, box(), 'focus moves to the box');

  await type('   ');
  assert.equal(box().getAttribute('aria-invalid'), 'true', 'spaces do not clear it');
  await pressContinue();
  assert.equal(wizard!.step, 1, 'a name of spaces is refused too');

  await type('Rocky Desert');
  assert.equal(box().getAttribute('aria-invalid'), null, 'typing a name clears the error');
  assert.equal(box().getAttribute('aria-describedby'), null);
  assert.equal(message().textContent!.trim(), '');
  await pressContinue();
  assert.equal(wizard!.step, 2, 'Continue moves on');
  assert.equal(wizard!.saveName, 'Rocky Desert');
});

test('a spaces-only name on a fresh step 1 is refused with the message', async () => {
  settingsStep('   ');
  await pressContinue();
  assert.equal(wizard!.step, 1);
  assert.equal(box().getAttribute('aria-invalid'), 'true');
  assert.equal(message().textContent!.trim(), 'Give the save a name to continue.');
});

test('a named save continues at once, with no message', async () => {
  settingsStep('World');
  await pressContinue();
  assert.equal(wizard!.step, 2);
});

test('adding a profile to a save: the name is read-only and never refused', async () => {
  settingsStep('World', 'save-1');
  assert.equal(box().readOnly, true);
  await pressContinue();
  assert.equal(wizard!.step, 2);
});
