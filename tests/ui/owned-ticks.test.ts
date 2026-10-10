// "Ticks keep it current" (#1068): the build plan's notice when the ticks show more than the plan's
// "What you already have" settings count (ui/plan/OwnedTicksNotice.vue): a better miner milestone,
// an alternate's unlock, generators marked running beyond what a phase runs. It is absent without
// such ticks and on any phase but the working one; "Recalculate in place with what you have" asks
// first, naming the backup, and sends the plan's settings with the owned fields raised; Dismiss
// hides it in this browser until the ticks show something new. Edit settings starts the owned
// fields from the ticks and says so (ui/wizard/TicksPrefill.vue). The mapping itself is tested on
// real plans in tests/owned-ticks.test.ts.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { save } from '../../public/app/api.ts';
import {
  setOpenedPhase,
  setWorkspace,
  state,
  view,
  wizard,
  workspace,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import type {
  CurrentCalculatedPlan,
  Phase,
  ProgressState,
  StoredSettings,
  UpdateOp,
} from '../../public/types/index.ts';
import {
  $,
  $$,
  answerConfirms,
  applyUpdate,
  catalog,
  evil,
  generatedWith,
  go,
  open,
  page,
  stubFetch,
} from './setup.ts';

const MINER_MK2 = 'unlock-Schematic_4-1_C',
  CAST_SCREWS = 'Recipe_Alternate_Screw_C',
  SCREWS_UNLOCK = 'recipe-unlock-Recipe_Alternate_Screw_C';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const text = (selector: string) => ($(selector)?.textContent || '').replace(/\s+/g, ' ').trim();

// A profile made for Phase 1 with mining per phase (Miner Mk.1 and Mk.2 belts in Phase 1; Phase 3
// runs 6 Fuel Generators, Phase 4 27 on two lines), made once in Node.
let made: CurrentCalculatedPlan | undefined;
const plan = (): CurrentCalculatedPlan =>
  structuredClone((made ??= generatedWith({ phase: '1', phaseMining: true })));

// Each test opens its own profile id: a dismissal is remembered per save and profile.
let profileCount = 0;
function show(phase: Phase, checks: Record<string, boolean> = {}, thePlan = plan()) {
  const profileId = 'p' + ++profileCount;
  open({ calculated: thePlan, phase, profileId, state: { checks } as Partial<ProgressState> });
  setWorkspace({ ...workspace, catalog: catalog() });
  go('plan');
  render();
  return { profileId, thePlan };
}
// Ticks a step as the checklist does (POST /api/update), and redraws.
async function tick(key: string) {
  stubFetch({ '/api/update': (update: UpdateOp) => applyUpdate(update) });
  await save({ type: 'check', key, value: true });
  render();
  await settle();
}

beforeEach(() => {
  page();
  // happy-dom counts 1 as a step mismatch for step="0.1", which browsers do not.
  HTMLFormElement.prototype.reportValidity = () => true;
});

test('ticking a better miner milestone and an alternate unlock shows one notice; none before', async () => {
  show('1');
  await settle();
  assert.equal($('[data-owned-ticks]'), null, 'no ticks, no notice');
  await tick(MINER_MK2);
  const notice = $('[data-owned-ticks]');
  assert.ok(notice, 'the notice appears');
  assert.ok(notice.classList.contains('info'), 'guidance, not a warning');
  assert.equal(notice.getAttribute('role'), 'status');
  assert.equal(text('[data-owned-ticks-found="unlocked"]'), 'You have unlocked Miner Mk.2.');
  assert.equal($('[data-owned-ticks-found="alternates"]'), null);
  await tick(SCREWS_UNLOCK);
  assert.equal($$('[data-owned-ticks]').length, 1, 'still one notice');
  assert.equal(text('[data-owned-ticks-found="alternates"]'), 'You own the Cast Screws alternate.');
  assert.match(text('[data-owned-ticks]'), /^Your ticks show more than this plan counts\./);
  assert.match(text('[data-owned-ticks]'), /Nothing changes until you start it\./);
  assert.equal(text('[data-recalc-owned-ticks]'), 'Recalculate in place with what you have');
});

test('a milestone the working phase unlocks anyway, or another phase shown, shows nothing', async () => {
  // Phase 2 plans with Miner Mk.2 already.
  show('2', { [MINER_MK2]: true });
  await settle();
  assert.equal($('[data-owned-ticks]'), null, 'the phase unlocks it anyway');
  // Phase 4's Fuel Generators marked running while working on Phase 3: Phase 3 runs only 6.
  const fuel = { 'calc-4-power-fuel': true, 'calc-4-power-rocket-fuel': true };
  show('3', fuel);
  await settle();
  assert.equal(text('[data-owned-ticks-found="generators"]'), 'You run 27 Fuel Generators.');
  // The same profile showing an earlier phase it opened on: not the working phase.
  setOpenedPhase({ saved: '3', phase: '2' });
  render();
  await settle();
  assert.equal($('[data-owned-ticks]'), null, 'only on the working phase');
  setOpenedPhase(null);
  render();
  await settle();
  assert.ok($('[data-owned-ticks]'));
});

test('Dismiss hides the notice until the ticks show something new', async () => {
  const { profileId } = show('1', { [MINER_MK2]: true });
  await settle();
  const button = $<HTMLButtonElement>('[data-owned-ticks-dismiss]')!;
  assert.equal(button.getAttribute('aria-describedby'), 'owned-ticks-dismiss-note');
  assert.match(text('#owned-ticks-dismiss-note'), /comes back when your ticks show something new/);
  button.focus();
  button.click();
  await settle();
  assert.equal($('[data-owned-ticks]'), null, 'dismissed');
  assert.equal(document.activeElement, $('#main h1'), 'focus goes to the page heading');
  // Remembered in this browser for this save and profile, nothing saved.
  const stored = JSON.parse(localStorage.getItem('planner-ticks-notice') || '{}');
  assert.deepEqual(stored['s/' + profileId], { miner: 2, alternates: [], generators: {} });
  assert.equal(state.checks[MINER_MK2], true, 'the tick stays');
  render();
  await settle();
  assert.equal($('[data-owned-ticks]'), null, 'still hidden after a redraw');
  // Something new: the alternate, and the notice lists everything found again.
  await tick(SCREWS_UNLOCK);
  assert.ok($('[data-owned-ticks]'), 'back for a new finding');
  assert.equal(text('[data-owned-ticks-found="unlocked"]'), 'You have unlocked Miner Mk.2.');
  assert.equal(text('[data-owned-ticks-found="alternates"]'), 'You own the Cast Screws alternate.');
});

test('the button asks first, then recalculates in place with the owned fields raised', async () => {
  const { thePlan } = show('1', { [MINER_MK2]: true, [SCREWS_UNLOCK]: true });
  await settle();
  const raised = {
    ...thePlan.settings,
    ownedMiner: 2,
    ownedAlternates: [CAST_SCREWS],
  } as StoredSettings;
  const recalculated = { ...thePlan, createdAt: '2026-10-10T12:00:00.000Z', settings: raised };
  const calls = stubFetch<{
    settings: StoredSettings;
    planCreatedAt: string;
    name: string;
    backupName: string;
  }>({
    '/api/recalculate': {
      workspace,
      saveId: 's',
      profileId: 'p',
      backupId: 'b',
      reviewCount: 0,
      carriedChecks: 2,
    },
    '/api/context': {
      save: { id: 's', name: 'World' },
      profile: { id: 'p', kind: 'calculated', name: evil },
      state: { ...structuredClone(state) },
      plan: recalculated,
    },
  });
  // Cancel sends nothing.
  let asked = answerConfirms(false);
  $<HTMLButtonElement>('[data-recalc-owned-ticks]')!.click();
  await settle();
  assert.equal(asked.length, 1);
  assert.ok(
    asked[0]!.startsWith(
      `Recalculates “${evil}” with what your ticks show you already have: Miner Mk.2 and the Cast Screws alternate.`,
    ),
    asked[0],
  );
  assert.match(asked[0]!, /is kept as “.*\(before edit, [^”]+\)” under Profiles/);
  assert.equal(document.querySelector('x-evil'), null, 'the name is text');
  assert.equal(calls.length, 0, 'nothing is sent');
  asked = answerConfirms(true);
  $<HTMLButtonElement>('[data-recalc-owned-ticks]')!.click();
  await settle();
  await settle();
  assert.deepEqual(
    calls.map(([path]) => path.split('?')[0]),
    ['/api/recalculate', '/api/context'],
  );
  const body = calls[0]![1];
  assert.equal(body.planCreatedAt, thePlan.createdAt, 'names the plan the offer was made on');
  assert.equal(body.name, evil, 'keeps the name');
  assert.match(body.backupName, /\(before edit, /);
  assert.equal(body.settings.ownedMiner, 2);
  assert.deepEqual(body.settings.ownedAlternates, [CAST_SCREWS]);
  assert.equal(body.settings.ownedBelt, undefined, 'nothing else raised');
  assert.deepEqual(
    { ...body.settings, ownedMiner: undefined, ownedAlternates: undefined },
    { ...thePlan.settings, ownedMiner: undefined, ownedAlternates: undefined },
    'every other setting is the plan’s own',
  );
  assert.match(text('#toast'), /^Recalculated in place\./);
  assert.equal($('[data-owned-ticks]'), null, 'the new plan counts them');
});

test('Edit settings starts What you already have from the ticks, and says so', async () => {
  const { thePlan } = show('1', {
    [MINER_MK2]: true,
    [SCREWS_UNLOCK]: true,
    'calc-4-power-fuel': true,
    'calc-4-power-rocket-fuel': true,
  });
  await settle();
  stubFetch({});
  $<HTMLButtonElement>('button[data-profile-switcher]')!.click();
  await settle();
  $<HTMLButtonElement>('[data-edit-open-profile]')!.click();
  await settle();
  assert.equal(view, 'wizard');
  render();
  await settle();
  const settings = wizard!.settings;
  assert.equal(settings.ownedMiner, 2);
  assert.deepEqual(settings.ownedAlternates, [CAST_SCREWS]);
  // Phase 4's lines run 27, beyond the 6 of Phase 3: counted from the start phase on.
  assert.deepEqual(settings.ownedGenerators, { 'Fuel Generator': 27 });
  assert.equal(wizard!.edit!.plan.settings.ownedMiner, undefined, 'the plan is untouched');
  assert.equal(
    text('[data-ticks-prefill]'),
    'What you already have starts from your ticks: Miner Mk.2 (step 4, Resources), the Cast Screws alternate (step 2, Preferences) and 27 Fuel Generators (step 4, Resources). Review shows what changes; nothing is recalculated until you press Recalculate in place.',
  );
  // Step 2's alternate and step 4's miner and generators show the prefilled values.
  $<HTMLButtonElement>('[data-wizard-step="2"]')!.click();
  await settle();
  assert.equal(
    $<HTMLInputElement>(`[data-owned-alt][value="${CAST_SCREWS}"]`)!.checked,
    true,
    'the alternate is ticked',
  );
  $<HTMLButtonElement>('[data-wizard-step="4"]')!.click();
  await settle();
  assert.equal($<HTMLSelectElement>('[data-owned-miner]')!.value, '2');
  assert.equal($<HTMLInputElement>('[name="ownedGenerator:Fuel Generator"]')!.value, '27');
  // Review names them as changes, from none.
  const preview = generatedWith({ ...thePlan.settings, ...wizard!.settings });
  stubFetch({ '/api/preview': preview });
  $<HTMLButtonElement>('[data-wizard-step="5"]')!.click();
  await settle();
  await settle();
  const changes = $$('[data-edit-setting]').map(el => el.textContent!.replace(/\s+/g, ' ').trim());
  assert.ok(changes.includes('Miners you already have: None → Miner Mk.2'), changes.join(' | '));
  assert.ok(changes.includes('Alternates you already own: None → 1 recipe'));
  assert.ok(changes.includes('Generators you already have: None → 27 Fuel Generators'));
});

test('Edit settings without such ticks starts from the plan’s own settings', async () => {
  const { thePlan } = show('2', { [MINER_MK2]: true });
  await settle();
  stubFetch({});
  $<HTMLButtonElement>('button[data-profile-switcher]')!.click();
  await settle();
  $<HTMLButtonElement>('[data-edit-open-profile]')!.click();
  await settle();
  render();
  await settle();
  assert.equal($('[data-ticks-prefill]'), null);
  assert.equal(wizard!.settings.ownedMiner, undefined, 'Phase 2 has Miner Mk.2 anyway');
  assert.equal(wizard!.edit!.fromTicks, undefined);
  assert.equal(wizard!.settings.phaseMining, thePlan.settings.phaseMining);
});
