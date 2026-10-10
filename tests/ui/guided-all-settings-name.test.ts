// "All settings →" from a guided question that belongs to step 2-4 (#622, wizard/guided.ts
// toAdvanced): the five steps only check the Save name when leaving step 1, so an empty or
// spaces-only name must stop the hand-over itself, with the same message beside the box and
// focus on it as Continue (tests/ui/guided-name.test.ts, #505). A named save still hands over,
// as does a question owned by step 1 (whose Continue checks the box) and adding a profile to a
// save (no Save name box).
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
const allSettings = () => $<HTMLButtonElement>('[data-guided-advanced]')!;

// A later guided question for a new save, whose "All settings →" lands past step 1.
function laterQuestion(saveName: string, saveId: string | null = null) {
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
    mode: 'guided',
    guidedStep: saveId ? 1 : 4, // the goal question, after phase, "What you have" and supply
    guidedAsk: saveId ? ['goal', 'recipes'] : null,
    tutorial: 'doing',
  });
  go('wizard');
  render();
}

async function pressAllSettings() {
  allSettings().click();
  await settle();
}

const type = async (value: string) => {
  box().value = value;
  box().dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
};

beforeEach(() => {
  // happy-dom counts some valid steps as mismatches (see wizard.test.ts): the forms here are
  // valid apart from the name box, which the fix checks on its own.
  HTMLFormElement.prototype.reportValidity = () => true;
});

test('All settings with an empty Save name stays on the question with the message', async () => {
  laterQuestion('Rocky Desert');
  const target = Number(allSettings().dataset.guidedAdvanced);
  assert.ok(target > 1, 'this question hands over past step 1');
  await type('');
  allSettings().focus();

  await pressAllSettings();
  assert.equal(wizard!.mode, 'guided', 'the hand-over is refused');
  assert.equal(wizard!.guidedStep, 4);
  assert.equal(box().getAttribute('aria-invalid'), 'true');
  assert.equal(box().getAttribute('aria-describedby'), 'guided-name-error');
  assert.equal(message().textContent!.trim(), 'Give the save a name to continue.');
  assert.equal(document.activeElement, box(), 'focus moves to the box');

  await type('   ');
  await pressAllSettings();
  assert.equal(wizard!.mode, 'guided', 'a name of spaces is refused too');

  await type('New name');
  assert.equal(box().getAttribute('aria-invalid'), null, 'typing a name clears the error');
  await pressAllSettings();
  assert.equal(wizard!.mode, 'advanced', 'a named save hands over');
  assert.equal(wizard!.step, target, 'on the step that owns the question');
  assert.equal(wizard!.saveName, 'New name');
});

test('a question owned by step 1 still hands over with an empty name: step 1 shows the box', async () => {
  laterQuestion('');
  wizard!.guidedStep = 1;
  render();
  await settle();
  assert.equal(allSettings().dataset.guidedAdvanced, '1');
  await pressAllSettings();
  assert.equal(wizard!.mode, 'advanced');
  assert.equal(wizard!.step, 1);
  assert.equal(box().value, '', 'the empty box is on screen, checked by Continue (#578)');
});

test('adding a profile to a save hands over with a blank profile name', async () => {
  laterQuestion('World', 'save-1');
  await settle();
  assert.equal($('input[name=saveName]'), null, 'no Save name box when adding a profile');
  await pressAllSettings();
  assert.equal(wizard!.mode, 'advanced');
});
