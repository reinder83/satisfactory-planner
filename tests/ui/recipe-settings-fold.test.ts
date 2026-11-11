// Recipe preferences (ONB-1, #1328): the settings form above the picker is a disclosure, folded
// by default with a one-line summary, opened with one click, remembered per viewer in this
// browser (localStorage, never the profile) and opened by a field the browser finds invalid.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test, vi } from 'vitest';
import { carryOptions } from '../../public/state.ts';
import { setWizard, wizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { SETTINGS_FOLD_KEY, setSettingsOpen } from '../../public/app/wizard/settings-fold.ts';
import { $, catalog, generated, go, open, page } from './setup.ts';

const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const toggle = () => $<HTMLButtonElement>('[data-settings-toggle]')!;
const region = () => $<HTMLElement>('#prefs-settings')!;
const text = (selector: string) => ($(selector)?.textContent || '').replace(/\s+/g, ' ').trim();

function start() {
  page();
  open({ workspace: { catalog: catalog() } });
  page();
  setWizard({
    step: 2,
    saveId: null,
    saveName: 'World',
    name: '',
    settings: {
      ...structuredClone(generated().settings),
      recipes: 'custom',
      sam: 'avoid',
      storage: 'construction',
      mainPower: 'auto',
      nuclear: 'none',
    },
    preview: null,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
  } as Parameters<typeof setWizard>[0]);
  go('wizard');
  render();
}

beforeEach(() => {
  setSettingsOpen(false);
  localStorage.removeItem(SETTINGS_FOLD_KEY);
  start();
});

test('the settings form starts folded behind a button that says what is set', () => {
  assert.equal(toggle().tagName, 'BUTTON');
  assert.equal(toggle().getAttribute('aria-expanded'), 'false');
  assert.equal(toggle().getAttribute('aria-controls'), region().id);
  assert.equal(region().hidden, true);
  const summary = text('[data-settings-summary]');
  assert.match(summary, /Recipe access: Pick specific alternates/);
  assert.match(summary, /Ingot lines: planner chooses/);
  assert.match(summary, /SAM: avoid/);
  assert.match(summary, /Storage: construction materials/);
  // The picker is not folded away with it.
  assert.ok($('.alt-toolbar'), 'the sticky toolbar is still there');
  // The fields stay in the form, so the step is read as before.
  assert.ok(region().querySelector('select[name=recipes]'));
});

test('one click opens it, and another folds it again', async () => {
  toggle().click();
  await settle();
  assert.equal(toggle().getAttribute('aria-expanded'), 'true');
  assert.equal(region().hidden, false);
  assert.equal($('[data-settings-summary]'), null, 'the summary gives way to the fields');
  toggle().click();
  await settle();
  assert.equal(toggle().getAttribute('aria-expanded'), 'false');
  assert.equal(region().hidden, true);
});

test('the summary follows what was changed while it was open', async () => {
  toggle().click();
  await settle();
  const sam = $<HTMLSelectElement>('select[name=sam]')!;
  sam.value = 'allow';
  sam.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  toggle().click();
  await settle();
  assert.match(text('[data-settings-summary]'), /SAM: allow/);
});

test('the choice is remembered in this browser and not in the profile', async () => {
  const before = JSON.stringify(wizard!.settings);
  toggle().click();
  await settle();
  assert.equal(localStorage.getItem(SETTINGS_FOLD_KEY), 'on');
  assert.equal(JSON.stringify(wizard!.settings), before, 'no setting is written');
  // A new page load reads it back, still open.
  vi.resetModules();
  assert.equal((await import('../../public/app/wizard/settings-fold.ts')).settingsOpen.value, true);
  setSettingsOpen(true);
  start();
  assert.equal(toggle().getAttribute('aria-expanded'), 'true', 'open on return');
  toggle().click();
  await settle();
  assert.equal(localStorage.getItem(SETTINGS_FOLD_KEY), 'off');
  start();
  assert.equal(toggle().getAttribute('aria-expanded'), 'false', 'closed stays closed');
  vi.resetModules();
  assert.equal(
    (await import('../../public/app/wizard/settings-fold.ts')).settingsOpen.value,
    false,
  );
});

test('storage that refuses means folded, and the toggle still works', async () => {
  const { getItem, setItem } = Storage.prototype;
  Storage.prototype.getItem = () => {
    throw Error('refused');
  };
  Storage.prototype.setItem = () => {
    throw Error('refused');
  };
  try {
    vi.resetModules();
    const fold = await import('../../public/app/wizard/settings-fold.ts');
    assert.equal(fold.settingsOpen.value, false);
    fold.setSettingsOpen(true);
    assert.equal(fold.settingsOpen.value, true, 'kept in memory');
  } finally {
    Storage.prototype.getItem = getItem;
    Storage.prototype.setItem = setItem;
  }
});

test('a field the browser finds invalid opens the form, without changing the choice', async () => {
  const field = $<HTMLInputElement>('input[name=utilityPercent]')!;
  field.value = '';
  assert.equal(region().hidden, true);
  field.dispatchEvent(new Event('invalid'));
  await settle();
  assert.equal(region().hidden, false, 'the error is not hidden');
  assert.equal(toggle().getAttribute('aria-expanded'), 'true');
  assert.equal(localStorage.getItem(SETTINGS_FOLD_KEY), null, 'the remembered choice is kept');
});
