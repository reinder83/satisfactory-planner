// "Everything before Phase N is done" (#1068): a profile made for a later phase can say that the
// milestone-only phases before its start phase are behind the player, in the wizard's Review
// (ui/wizard/AlreadyHave.vue, sent as the new profile's `built` keys) and later on the build plan
// (ui/plan/MilestoneOnlyNotice.vue, one `checks` update). Both only add ticks.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { carryOptions } from '../../public/state.ts';
import { phaseStepIds } from '../../public/app/opening-phase.ts';
import {
  loadContext,
  phase,
  progressionData,
  setHideDone,
  setQuery,
  setWizard,
  state,
  workspace,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { type AlternateHunt, alternateHunts, stepsBeforeStart } from '../../public/progression.ts';
import type { WizardDraft } from '../../public/app/wizard/wizard.ts';
import {
  $,
  $$,
  answerConfirms,
  applyUpdate,
  evil,
  generated,
  generatedWith,
  go,
  open,
  page,
  stubFetch,
} from './setup.ts';
import type { ContextReply, Phase, UpdateOp } from '../../public/types/index.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() || '';

beforeEach(() => {
  page();
  setQuery('');
  setHideDone(false);
});

// The planner's default profile starts in Phase 3.
const phaseThreePlan = () => {
  const plan = generated();
  assert.equal(plan.settings.phase, '3');
  return plan;
};

// Opens the profile through /api/context, as the app does, so it opens on the first phase with an
// open step.
async function openThrough(savedPhase: Phase, checks: Record<string, boolean>) {
  open();
  const reply: ContextReply = {
    save: { id: 's', name: 'Save' },
    profile: { id: 'p', kind: 'calculated', name: 'Started in Phase 3' },
    state: { ...structuredClone(state), settings: { phase: savedPhase }, checks, customTasks: [] },
    plan: phaseThreePlan(),
  };
  const calls = stubFetch<UpdateOp>({
    '/api/context': reply,
    '/api/update': (update: UpdateOp) => applyUpdate(update),
  });
  await loadContext('s', 'p');
  render();
  await settle();
  return calls;
}

test('the build plan ticks only the open steps before the start phase, then shows Phase 3', async () => {
  open({ calculated: phaseThreePlan(), phase: '3' });
  const earlier = [...phaseStepIds('1'), ...phaseStepIds('2')];
  assert.ok(earlier.length >= 16, 'a Phase 3 start lists 16+ earlier steps');
  const [ticked, unticked] = earlier as [string, string];
  const calls = await openThrough('3', {
    [ticked]: true,
    [unticked]: false,
    'calc-3-storage': true,
  });
  assert.equal(phase(), '1');
  const button = $<HTMLButtonElement>('#main [data-earlier-done]')!;
  assert.equal(text(button), 'Mark everything before Phase 3 done');
  const asked = answerConfirms(true);
  button.focus();
  button.click();
  await settle();
  await settle();
  assert.equal(asked.length, 1);
  assert.match(
    asked[0]!,
    new RegExp(`ticks the ${earlier.length - 1} open steps of Phases 1 and 2`),
  );
  const updates = calls.filter(([path]) => path.startsWith('/api/update')).map(([, body]) => body);
  assert.equal(updates.length, 1, 'one write; the saved phase already is Phase 3');
  const update = updates[0] as { type: string; keys: string[]; value: boolean };
  assert.equal(update.type, 'checks');
  assert.equal(update.value, true, 'only ticks');
  assert.deepEqual(
    [...update.keys].sort(),
    earlier.filter(key => key !== ticked).sort(),
    'every open step, the unticked one included, and not the one already ticked',
  );
  for (const key of earlier) assert.equal(state.checks[key], true, key);
  assert.equal(state.checks['calc-3-storage'], true, 'other ticks stay');
  assert.equal(phase(), '3', 'it goes on to the start phase');
  assert.equal($('[data-milestone-only]'), null);
  assert.equal(document.activeElement, $('#main h1'), 'focus goes to the heading');
});

test('cancelling the confirmation writes nothing and stays on the phase', async () => {
  open({ calculated: phaseThreePlan(), phase: '3' });
  const calls = await openThrough('3', {});
  answerConfirms(false);
  $<HTMLButtonElement>('#main [data-earlier-done]')!.click();
  await settle();
  assert.deepEqual(
    calls.filter(([path]) => path.startsWith('/api/update')),
    [],
  );
  assert.equal(phase(), '1');
  assert.deepEqual(state.checks, {});
});

test('with every earlier step ticked the notice offers only Go to Phase N', async () => {
  const plan = phaseThreePlan();
  open({ calculated: plan, phase: '3' });
  const keys = stepsBeforeStart(plan, state, progressionData);
  await openThrough('1', Object.fromEntries(keys.map(key => [key, true])));
  go('plan');
  render();
  await settle();
  assert.equal(phase(), '1');
  assert.ok($('#main [data-go-to-start-phase]'));
  assert.equal($('#main [data-earlier-done]'), null);
});

// The wizard's Review for a new save.
function reviewOf(preview: ReturnType<typeof generated>, extra: Partial<WizardDraft> = {}) {
  page();
  setWizard({
    step: 5,
    saveId: null,
    saveName: evil,
    name: '',
    settings: structuredClone(preview.settings),
    preview,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([key]) => [key, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
    ...extra,
  });
  go('wizard');
  render();
}

test('Review offers the box for a later start phase, off by default, and sends its steps', async () => {
  const plan = phaseThreePlan();
  reviewOf(plan);
  await settle();
  const keys = stepsBeforeStart(plan, { checks: {} }, progressionData);
  const panel = $('[data-already-have]')!;
  assert.ok(panel, 'the panel is there');
  assert.match(text(panel), /What you already have/);
  assert.match(
    text(panel),
    new RegExp(
      `Everything before Phase 3 is done ?Ticks the ${keys.length} steps Phases 1 and 2 list`,
    ),
  );
  assert.equal($('x-evil'), null);
  const box = $<HTMLInputElement>('input[data-earlier-done]')!;
  assert.equal(box.checked, false, 'off by default');
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  render();
  await settle();
  assert.equal($<HTMLInputElement>('input[data-earlier-done]')!.checked, true, 'a redraw keeps it');
  const calls = stubFetch<{ built: string[] }>({
    '/api/profiles': { workspace, saveId: 's', profileId: 'p3', carriedChecks: keys.length },
    '/api/context': {
      save: { id: 's', name: 'World' },
      profile: { id: 'p3', kind: 'calculated', name: 'Third' },
      state: { settings: { phase: '3' }, checks: {}, notes: {}, deliveries: {}, customTasks: [] },
      plan,
    },
  });
  $('#wizard-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  await settle();
  const body = calls.find(([path]) => path === '/api/profiles')![1];
  assert.deepEqual(body.built, keys);
  // Nothing was carried from another profile: the toast says the steps start ticked.
  assert.match(
    $('#toast')!.textContent!,
    new RegExp(`Profile created: ${keys.length} steps start ticked\.`),
  );
  assert.ok(keys.every(key => key.startsWith('unlock-')));
});

test('Review leaves the box off for a Phase 1 plan and sends nothing when it is clear', async () => {
  reviewOf(generatedWith({ phase: '1' }));
  await settle();
  assert.equal($('[data-already-have]'), null, 'nothing before Phase 1');
  const plan = phaseThreePlan();
  reviewOf(plan);
  await settle();
  const calls = stubFetch<{ built: string[] }>({
    '/api/profiles': { workspace, saveId: 's', profileId: 'p3', carriedChecks: 0 },
    '/api/context': {
      save: { id: 's', name: 'World' },
      profile: { id: 'p3', kind: 'calculated', name: 'Third' },
      state: { settings: { phase: '3' }, checks: {}, notes: {}, deliveries: {}, customTasks: [] },
      plan,
    },
  });
  $('#wizard-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  await settle();
  assert.deepEqual(calls.find(([path]) => path === '/api/profiles')![1].built, []);
});

test('Review lists the alternates to hunt, and sends the owned ones and an emptied hunt', async () => {
  const plan = generatedWith({ phase: '3', recipes: 'all' });
  const hunts = alternateHunts(plan, progressionData);
  const [first, second] = hunts as [AlternateHunt, AlternateHunt];
  reviewOf(plan);
  await settle();
  const list = $('[data-owned-alternates]')!;
  assert.ok(list, 'the owned alternates are offered');
  const boxes = $$<HTMLInputElement>('input[data-owned-alternate]');
  assert.equal(boxes.length, hunts.flatMap(hunt => hunt.recipes).length);
  assert.ok(
    boxes.every(box => !box.checked),
    'every alternate starts as one to hunt',
  );
  assert.match(text(list), /Alternates you own \(0 of \d+ ticked\)/);
  const owned = [...first.recipes.map(recipe => recipe.key), second.recipes[0]!.key];
  for (const key of owned) {
    const box = boxes.find(candidate => candidate.value === key)!;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await settle();
  render();
  await settle();
  assert.ok(text($('[data-owned-alternates]')).includes(`(${owned.length} of`));
  assert.equal(
    $$<HTMLInputElement>('input[data-owned-alternate]').filter(box => box.checked).length,
    owned.length,
    'a redraw keeps the ticks',
  );
  const calls = stubFetch<{ built: string[] }>({
    '/api/profiles': { workspace, saveId: 's', profileId: 'p3', carriedChecks: 0 },
    '/api/context': {
      save: { id: 's', name: 'World' },
      profile: { id: 'p3', kind: 'calculated', name: 'Third' },
      state: { settings: { phase: '3' }, checks: {}, notes: {}, deliveries: {}, customTasks: [] },
      plan,
    },
  });
  $('#wizard-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  await settle();
  const body = calls.find(([path]) => path === '/api/profiles')![1];
  assert.deepEqual(body.built, [
    ...first.recipes.map(recipe => recipe.key),
    first.hunt,
    second.recipes[0]!.key,
  ]);
});
