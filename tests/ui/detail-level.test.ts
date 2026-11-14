// The detail level (ONB-2, BP-12, #1337, app/detail-level.ts, ui/DetailLevel.vue): one Beginner /
// Standard / Expert control in place of the "New to Satisfactory" and "Expert mode" checkboxes,
// the same on the guided start's first screen, above All settings' steps and on the build plan,
// where "Hide completed" and "Required steps only" are filter toggle buttons beside it. It is a
// labelled radio group of native radio buttons sharing one name, so the browser's arrow keys move
// within it (the keyboard itself is checked in a real browser, browser-check.ts). Each profile
// keeps its own level: the build plan saves it, Create profile and Recalculate in place send the
// wizard's; a profile without one follows this browser's level, which the two old switches'
// keys decide once.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { carryOptions } from '../../public/state.ts';
import {
  DETAIL_KEY,
  LEGACY_BEGINNER_KEY,
  LEGACY_EXPERT_KEY,
  browserDetail,
  detailLevel,
  legacyDetail,
  setBrowserDetail,
} from '../../public/app/detail-level.ts';
import { beginnerMode } from '../../public/app/beginner.ts';
import { expertMode } from '../../public/app/expert.ts';
import {
  setHideDone,
  setRequiredOnly,
  setWizard,
  setWorkspace,
  state,
  wizard,
  workspace,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { startWizard } from '../../public/app/wizard/wizard.ts';
import {
  $,
  $$,
  applyUpdate,
  catalog,
  evil,
  generated,
  generatedWith,
  go,
  open,
  page,
  stubFetch,
} from './setup.ts';
import type { DetailLevel, UpdateOp } from '../../public/types/index.ts';

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    await nextTick();
  }
};
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
// Picks a level on the control under `scope`, as a click or an arrow key does: the browser checks
// the radio button and fires change.
async function pick(level: DetailLevel, scope = '#main') {
  const radio = $<HTMLInputElement>(`${scope} [data-detail-option="${level}"]`);
  assert.ok(radio, `${level} is on screen`);
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}
const checkedLevel = (scope = '#main') =>
  $<HTMLInputElement>(`${scope} [data-detail-level] input:checked`)?.value;

// The control as a screen reader and the keyboard meet it: a radio group named by its visible
// label, three native radio buttons in order sharing one name (the arrow keys stay in the group),
// the level shown checked, a note that says what it does, and none of the old checkboxes.
function checkControl(scope: string, level: DetailLevel) {
  const group = $(`${scope} [data-detail-level]`)!;
  assert.ok(group, 'the detail level is on screen');
  assert.equal(group.getAttribute('role'), 'radiogroup');
  const label = document.getElementById(group.getAttribute('aria-labelledby')!);
  assert.equal(text(label), 'Detail level');
  const radios = $$<HTMLInputElement>(`${scope} [data-detail-level] input`);
  assert.deepEqual(
    radios.map(radio => [radio.type, radio.value, text(radio.closest('label'))]),
    [
      ['radio', 'beginner', 'Beginner'],
      ['radio', 'standard', 'Standard'],
      ['radio', 'expert', 'Expert'],
    ],
  );
  assert.equal(new Set(radios.map(radio => radio.name)).size, 1, 'one group for the arrow keys');
  assert.equal(checkedLevel(scope), level);
  assert.equal(radios.filter(radio => radio.checked).length, 1, 'one level at a time');
  assert.equal($(`${scope} [data-beginner-switch], ${scope} [data-expert-switch]`), null);
}

beforeEach(() => {
  page();
  setBrowserDetail('standard');
  setHideDone(false);
  setRequiredOnly(false);
  HTMLFormElement.prototype.reportValidity = () => true;
});
afterEach(() => {
  setBrowserDetail('standard');
  setHideDone(false);
  setRequiredOnly(false);
});

test('a browser before #1337 is migrated once from the two switches, which stay as they were', async () => {
  // Both on → Expert; New to Satisfactory only → Beginner; Expert mode only → Expert; neither
  // (and nothing stored, every browser before #1076) → Standard.
  const cases: [beginner: string | null, expert: string | null, level: DetailLevel][] = [
    ['on', 'on', 'expert'],
    ['on', 'off', 'beginner'],
    ['on', null, 'beginner'],
    ['off', 'on', 'expert'],
    [null, 'on', 'expert'],
    ['off', 'off', 'standard'],
    [null, null, 'standard'],
  ];
  for (const [beginner, expert, level] of cases) {
    localStorage.clear();
    if (beginner) localStorage.setItem(LEGACY_BEGINNER_KEY, beginner);
    if (expert) localStorage.setItem(LEGACY_EXPERT_KEY, expert);
    vi.resetModules();
    const loaded = await import('../../public/app/detail-level.ts');
    assert.equal(loaded.browserDetail(), level, `${beginner} / ${expert}`);
    assert.equal(localStorage.getItem(DETAIL_KEY), level, 'migrated into the one key');
    // The old keys are the copy an older release still reads: left exactly as they were.
    assert.equal(localStorage.getItem(LEGACY_BEGINNER_KEY), beginner);
    assert.equal(localStorage.getItem(LEGACY_EXPERT_KEY), expert);
  }
  assert.equal(legacyDetail(true, true), 'expert');
  // Once migrated, the new key decides, whatever the old ones say later (an older tab).
  localStorage.setItem(DETAIL_KEY, 'beginner');
  localStorage.setItem(LEGACY_EXPERT_KEY, 'on');
  vi.resetModules();
  assert.equal((await import('../../public/app/detail-level.ts')).browserDetail(), 'beginner');
  // A value it does not know is migrated again; storage that refuses to be read means Standard.
  localStorage.setItem(DETAIL_KEY, 'wizard');
  vi.resetModules();
  assert.equal((await import('../../public/app/detail-level.ts')).browserDetail(), 'expert');
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw Error('refused');
    },
    setItem: () => {
      throw Error('refused');
    },
  });
  try {
    vi.resetModules();
    const refused = await import('../../public/app/detail-level.ts');
    assert.equal(refused.browserDetail(), 'standard', 'unreadable');
    refused.setBrowserDetail('expert');
    assert.equal(refused.browserDetail(), 'expert', 'picking still works for this page');
  } finally {
    vi.unstubAllGlobals();
    localStorage.clear();
  }
});

test('the guided start offers one detail level control; picking one keeps it in the draft', async () => {
  open({ workspace: { catalog: catalog(), saves: [] } });
  startWizard();
  render();
  await settle();
  checkControl('#wizard-form', 'standard');
  const group = $('#wizard-form [data-detail-level]')!;
  assert.equal(group.getAttribute('aria-describedby'), 'guided-detail-note');
  assert.match(text($('#guided-detail-note')), /^Every question/);
  const calls = stubFetch({});
  await pick('beginner');
  checkControl('#wizard-form', 'beginner');
  assert.equal(wizard!.detail, 'beginner');
  assert.equal(beginnerMode(), true);
  assert.match(text($('#guided-detail-note')), /^Keeps it simple/);
  assert.equal(browserDetail(), 'beginner', 'the next new plan starts there');
  assert.equal(wizard!.mode, 'guided');
  await pick('standard');
  assert.equal(beginnerMode(), false);
  assert.equal(expertMode(), false);
  assert.deepEqual(calls, [], 'nothing saved or calculated');
});

test('All settings shows the same control above the steps', async () => {
  open({ workspace: { catalog: catalog(), saves: [] } });
  setBrowserDetail('expert');
  startWizard();
  render();
  await settle();
  assert.equal(wizard!.mode, 'advanced');
  checkControl('#wizard-form', 'expert');
  assert.ok($('#wizard-form.compact'));
  await pick('beginner', '#wizard-form');
  checkControl('#wizard-form', 'beginner');
  assert.equal($('#wizard-form.compact'), null, 'five screens again');
  assert.equal(wizard!.settings.storage, 'none', 'the beginner stock for a new save');
});

test('the build plan: filters are toggle buttons, the detail level a setting apart from them', async () => {
  // A Phase 1 plan: its phase has optional research, so Required steps only is offered.
  open({ calculated: generatedWith({ phase: '1' }), phase: '1' });
  go('plan');
  render();
  await settle();
  const tools = $('#main .checklist-tools')!;
  assert.equal(tools.querySelector('input[type="checkbox"]'), null, 'no checkbox row');
  const filters = tools.querySelector('.plan-filters')!;
  assert.equal(filters.getAttribute('role'), 'group');
  assert.deepEqual(
    [...filters.querySelectorAll('button')].map(button => [
      button.type,
      text(button),
      button.getAttribute('aria-pressed'),
    ]),
    [
      ['button', 'Hide completed', 'false'],
      ['button', 'Required steps only', 'false'],
    ],
  );
  assert.equal(filters.querySelector('[data-detail-level]'), null, 'the setting is not a filter');
  checkControl('#main .checklist-tools', 'standard');
  // A filter toggles in place and stays a view preference of this browser.
  const before = JSON.stringify(state);
  $('#hide-done')!.click();
  await settle();
  assert.equal($('#hide-done')!.getAttribute('aria-pressed'), 'true');
  $('[data-required-only]')!.click();
  await settle();
  assert.equal($('[data-required-only]')!.getAttribute('aria-pressed'), 'true');
  assert.equal(JSON.stringify(state), before, 'nothing in the profile');
});

test('picking a level on the build plan saves the profile’s own and switches what it shows', async () => {
  setBrowserDetail('beginner');
  open({ calculated: generated(), phase: '1' });
  go('plan');
  render();
  await settle();
  // A profile without a level follows the browser's.
  checkControl('#main', 'beginner');
  assert.ok($('#main [data-beginner-note]'));
  assert.equal(
    $('#main [data-detail-level]')!.getAttribute('aria-describedby'),
    'beginner-note',
    'the note says what the level hides',
  );
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  await pick('expert');
  assert.deepEqual(calls, [['/api/update', { type: 'detailLevel', value: 'expert' }]]);
  assert.equal(state.detailLevel, 'expert');
  assert.equal(state.version, 31);
  checkControl('#main', 'expert');
  assert.ok($('#main [data-unlock-groups]'), 'the unlocks grouped by tier');
  assert.ok($('#main [data-expert-note]'));
  assert.equal($('#main [data-beginner-note]'), null);
  assert.equal(browserDetail(), 'beginner', 'this browser’s level stays');
  await pick('standard');
  assert.equal(state.detailLevel, 'standard');
  assert.equal($('#main [data-unlock-groups]'), null);
  assert.equal($('#main [data-expert-note]'), null);
  assert.equal(
    $('#main [data-detail-level]')!.getAttribute('aria-describedby'),
    null,
    'no note at Standard',
  );
});

test('each profile keeps its own level; one without follows this browser', async () => {
  setBrowserDetail('beginner');
  open({ calculated: generated(), phase: '1', state: { version: 31, detailLevel: 'expert' } });
  go('plan');
  render();
  await settle();
  assert.equal(detailLevel(), 'expert');
  checkControl('#main', 'expert');
  open({ calculated: generated(), phase: '1', profileId: 'original' });
  render();
  await settle();
  assert.equal(detailLevel(), 'beginner');
  checkControl('#main', 'beginner');
});

test('a refused save shows the saved level again', async () => {
  open({ calculated: generated(), phase: '1' });
  go('plan');
  render();
  await settle();
  // No reply for /api/update: the stub answers 500, so save() fails.
  stubFetch({});
  await pick('expert');
  assert.equal(state.detailLevel, undefined);
  assert.equal(checkedLevel(), 'standard', 'Standard checked again');
  assert.equal($('#main [data-unlock-groups]'), null);
  assert.match(text($('#toast')), /unexpected/);
});

test('Create profile sends the wizard’s level; Edit settings starts from the profile’s', async () => {
  open({ workspace: { catalog: catalog(), saves: [] } });
  const plan = generated();
  setWizard({
    step: 5,
    saveId: null,
    saveName: evil,
    name: '',
    settings: structuredClone(plan.settings),
    preview: plan,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([key]) => [key, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
    detail: 'beginner',
  });
  go('wizard');
  render();
  await settle();
  const calls = stubFetch<{ detailLevel?: DetailLevel }>({
    '/api/profiles': { workspace, saveId: 's', profileId: 'p', carriedChecks: 0 },
    '/api/context': {
      save: { id: 's', name: 'World' },
      profile: { id: 'p', kind: 'calculated', name: 'New' },
      state: {
        version: 31,
        settings: { phase: '3' },
        checks: {},
        notes: {},
        deliveries: {},
        customTasks: [],
        detailLevel: 'beginner',
      },
      plan,
    },
  });
  $('#wizard-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  await settle();
  assert.equal(calls.find(([path]) => path === '/api/profiles')![1].detailLevel, 'beginner');

  // Edit settings of a profile at Expert, from a browser at Standard: the wizard shows Expert, and
  // Recalculate in place sends the level it shows.
  page();
  open({ calculated: plan, state: { version: 31, detailLevel: 'expert' } });
  setWorkspace({ ...workspace, catalog: catalog() });
  go('plan');
  render();
  await settle();
  const edits = stubFetch<{ detailLevel?: DetailLevel }>({
    '/api/preview': generated(),
    '/api/recalculate': { workspace, saveId: 's', profileId: 'p', backupId: 'b', reviewCount: 0 },
    '/api/context': {
      save: { id: 's', name: 'World' },
      profile: { id: 'p', kind: 'calculated', name: 'Edited' },
      state: { version: 31, settings: { phase: '3' }, checks: {}, notes: {}, deliveries: {} },
      plan: generated(),
    },
  });
  $('button[data-profile-switcher]')!.click();
  await settle();
  $('[data-edit-open-profile]')!.click();
  await settle();
  render();
  await settle();
  assert.equal(wizard!.detail, undefined, 'nothing picked yet');
  checkControl('#wizard-form', 'expert');
  await pick('standard', '#wizard-form');
  $<HTMLElement>('[data-wizard-step="5"]')!.click();
  await settle();
  $('#wizard-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  await settle();
  assert.equal(edits.find(([path]) => path === '/api/recalculate')![1].detailLevel, 'standard');
});

// A new wizard profile or an Edit settings recalculation writes the level (and so state version 31)
// only when the user picked one for that profile: the draft starts without one.
const submitWizard = async () => {
  $('#wizard-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  await settle();
};
const newWizard = async (picked: DetailLevel | null) => {
  open({ workspace: { catalog: catalog(), saves: [] } });
  setBrowserDetail('expert');
  const plan = generated();
  startWizard();
  wizard!.mode = 'advanced';
  wizard!.step = 1;
  go('wizard');
  render();
  await settle();
  if (picked) await pick(picked, '#wizard-form');
  Object.assign(wizard!, {
    step: 5,
    saveName: evil,
    settings: structuredClone(plan.settings),
    preview: plan,
  });
  render();
  await settle();
  const calls = stubFetch<{ detailLevel?: DetailLevel }>({
    '/api/profiles': { workspace, saveId: 's', profileId: 'p', carriedChecks: 0 },
    '/api/context': {
      save: { id: 's', name: 'World' },
      profile: { id: 'p', kind: 'calculated', name: 'New' },
      state: { version: 30, settings: { phase: '3' }, checks: {}, notes: {}, deliveries: {} },
      plan,
    },
  });
  await submitWizard();
  return calls.find(([path]) => path === '/api/profiles')![1];
};

test('an untouched new wizard profile sends no level, so it keeps its content version', async () => {
  const body = await newWizard(null);
  assert.equal('detailLevel' in body, false, 'no detailLevel in the request');
});

test('picking a level in the wizard sends it for the new profile', async () => {
  assert.equal((await newWizard('beginner')).detailLevel, 'beginner');
});

const recalculation = async (picked: DetailLevel | null, own?: DetailLevel) => {
  page();
  const plan = generated();
  open({ calculated: plan, state: own ? { version: 31, detailLevel: own } : { version: 30 } });
  setWorkspace({ ...workspace, catalog: catalog() });
  go('plan');
  render();
  await settle();
  const calls = stubFetch<{ detailLevel?: DetailLevel }>({
    '/api/preview': generated(),
    '/api/recalculate': { workspace, saveId: 's', profileId: 'p', backupId: 'b', reviewCount: 0 },
    '/api/context': {
      save: { id: 's', name: 'World' },
      profile: { id: 'p', kind: 'calculated', name: 'Edited' },
      state: { version: 30, settings: { phase: '3' }, checks: {}, notes: {}, deliveries: {} },
      plan: generated(),
    },
  });
  $('button[data-profile-switcher]')!.click();
  await settle();
  $('[data-edit-open-profile]')!.click();
  await settle();
  render();
  await settle();
  if (picked) await pick(picked, '#wizard-form');
  $<HTMLElement>('[data-wizard-step="5"]')!.click();
  await settle();
  await submitWizard();
  return calls.find(([path]) => path === '/api/recalculate')![1];
};

test('Recalculate in place of a v30 profile sends no level unless one is picked', async () => {
  assert.equal('detailLevel' in (await recalculation(null)), false);
  assert.equal((await recalculation('beginner')).detailLevel, 'beginner');
});

test('Recalculate in place keeps a stored level without sending it again', async () => {
  const body = await recalculation(null, 'expert');
  assert.equal('detailLevel' in body, false, 'the profile keeps its own level server-side');
});
