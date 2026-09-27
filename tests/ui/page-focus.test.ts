// Where focus goes when an action opens another page (#304, focusOpenedPage and
// refocusOnOpenedPage in public/app/ui/refocus.ts): the button goes with the page it was on, so
// focus would fall to <body>. It goes to the new page's heading instead (PageHeader's h1,
// tabindex="-1"). Focus still on the page, such as a sidebar link after it is followed, stays.
// The address hash is the page, as in the app: the listener below does what the hashchange
// listener in listeners.ts does (that module is not loaded by these tests).
// The focused element is compared by what identifies it, never two elements with assert.equal
// (#287).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterAll, beforeAll, beforeEach, test, vi } from 'vitest';
import { acceptRoute } from '../../public/app/api.ts';
import { setView, setWizard, state, view, viewOf, workspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import {
  $,
  answerConfirms,
  catalog,
  generated,
  go,
  handbook,
  open,
  page,
  stubFetch,
} from './setup.ts';
import { carryOptions } from '../../public/state.ts';
import type { WizardDraft } from '../../public/app/wizard/wizard.ts';
import type { ContextReply } from '../../public/types/index.ts';

const settle = async () => {
  await new Promise(r => setTimeout(r, 20));
  await nextTick();
};
// Focus a control, then press it, as the keyboard does.
const press = async (selector: string) => {
  const el = $(selector);
  assert.ok(el, selector);
  el.focus();
  el.click();
  await settle();
  await settle();
};
const focused = () => document.activeElement as HTMLElement | null;
const describeFocus = () => focused()?.outerHTML.slice(0, 120) ?? 'null';
// Whether focus is on the page's heading, and that heading's text.
const onHeading = () => focused() === $('#main h1');
const heading = () => $('#main h1')?.textContent?.trim();

const onHash = () => {
  if (!acceptRoute()) return;
  setView(viewOf(location.hash.slice(1)));
  render();
};
beforeAll(() => window.addEventListener('hashchange', onHash));
afterAll(() => window.removeEventListener('hashchange', onHash));

// The handbook profile as /api/context answers it, with the state open() gave the page.
const original = (name: string): ContextReply => ({
  save: { id: 's', name: 'World' },
  profile: { id: 'original', kind: 'original', name },
  state: structuredClone(state),
  plan: null,
  handbook,
});

// Shows `v` the way a route does: the address first, then the page.
function show(v: Parameters<typeof go>[0]) {
  history.replaceState(null, '', '#' + v);
  acceptRoute();
  go(v);
  render();
}

// A wizard draft at `step` of the five steps, or of the guided start with mode 'guided'.
function draftAt(step: number, extra: Partial<WizardDraft> = {}) {
  setWizard({
    step,
    saveId: 's',
    saveName: 'World',
    name: 'Third',
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
  show('wizard');
}

beforeEach(() => {
  page();
  open({ workspace: { catalog: catalog() } });
  answerConfirms(true);
  // happy-dom counts 1 as a step mismatch for step="0.1", which browsers do not.
  HTMLFormElement.prototype.reportValidity = () => true;
});

test('every page heading can take focus by script, not by Tab', () => {
  show('plan');
  assert.equal($('#main h1')!.getAttribute('tabindex'), '-1');
});

test('the first page drawn leaves focus where it is', () => {
  show('plan');
  assert.equal(focused(), document.body);
});

test('Open profile moves focus to the heading of the plan it opens', async () => {
  stubFetch({ '/api/select': workspace, '/api/context': original('Opened') });
  show('profiles');
  await press('[data-open-profile="original"]');
  assert.equal(view, 'plan');
  assert.equal(location.hash, '#plan');
  assert.ok(onHeading(), describeFocus());
  assert.equal(heading(), 'Phase 3 field plan');
});

test('Duplicate moves focus to the heading of the copy’s plan', async () => {
  stubFetch({
    '/api/duplicate-profile': { workspace, saveId: 's', profileId: 'original' },
    '/api/context': original('Copy'),
  });
  show('profiles');
  // Duplicate is in the card's ⋯ menu (#238).
  await press('[data-profile-menu="original"]');
  await press('[data-duplicate-profile="original"]');
  assert.equal(view, 'plan');
  assert.match($('#toast')!.textContent!, /Copy created and opened/);
  assert.ok(onHeading(), describeFocus());
});

test('the wizard’s Create profile moves focus to the heading of the new plan', async () => {
  stubFetch({
    '/api/profiles': { workspace, saveId: 's', profileId: 'p3', carriedChecks: 0 },
    '/api/context': {
      save: { id: 's', name: 'World' },
      profile: { id: 'p3', kind: 'calculated', name: 'Third' },
      state: { settings: { phase: '3' }, checks: {}, notes: {}, deliveries: {}, customTasks: [] },
      plan: generated(),
    },
  });
  draftAt(5);
  const create = $<HTMLButtonElement>('#wizard-form button[type=submit]')!;
  assert.equal(create.textContent!.trim(), 'Create profile');
  await press('#wizard-form button[type=submit]');
  await settle();
  assert.equal(view, 'plan');
  assert.ok($('#main .heading-row'), 'the calculated plan is drawn');
  assert.ok(onHeading(), describeFocus());
});

test('New profile and Cancel move focus to the heading of the page they open', async () => {
  show('profiles');
  await press('[data-new-profile="s"]');
  assert.equal(view, 'wizard');
  assert.ok(onHeading(), 'New profile: ' + describeFocus());
  await press('[data-cancel-wizard]');
  assert.equal(view, 'profiles');
  assert.ok(onHeading(), 'Cancel: ' + describeFocus());
  assert.equal(heading(), 'Saves & profiles');
});

test('All settings and Guided start move focus to the heading of the screen they open', async () => {
  draftAt(1, { mode: 'guided' });
  // A screen change inside #wizard has no route change to scroll it, so the new screen starts at
  // its top here.
  const scrolled = vi.spyOn(window, 'scrollTo');
  assert.ok($('[data-guided-advanced]'), 'the guided start is shown');
  await press('[data-guided-advanced]');
  assert.ok($('[data-wizard-step="1"]'), 'All settings is shown');
  assert.ok(onHeading(), 'All settings: ' + describeFocus());
  assert.deepEqual(scrolled.mock.calls, [[0, 0]]);
  await press('[data-guided-start]');
  assert.ok($('[data-guided-advanced]'), 'the guided start is back');
  assert.ok(onHeading(), 'Guided start: ' + describeFocus());
  scrolled.mockRestore();
});

test('a link inside the page moves focus to the heading of the page it opens', async () => {
  setWizard(null);
  show('wizard');
  const link = $<HTMLAnchorElement>('#main a[href="#profiles"]')!;
  link.focus();
  location.hash = 'profiles';
  await settle();
  assert.equal(view, 'profiles');
  assert.ok(onHeading(), describeFocus());
});

test('a sidebar link keeps focus after it opens its page', async () => {
  show('plan');
  const link = $<HTMLAnchorElement>('nav a[href="#storage"]')!;
  link.focus();
  location.hash = 'storage';
  await settle();
  assert.equal(view, 'storage');
  assert.ok(focused() === $('nav a[href="#storage"]'), describeFocus());
});
