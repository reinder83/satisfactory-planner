// Somersloop pins on the pages (#1235, slice 10 of #1079): "Somersloops on this line" in a
// production line's dialog saves a pin without recalculating, refuses a count that does not fill
// whole machines, and the build plan's notice offers "Recalculate in place with somersloop pins";
// ADA follows the pending pins and any pin the plan could not keep.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { setBeginnerMode } from '../../public/app/beginner.ts';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { calculated, draft, setWizard, state, workspace } from '../../public/app/session.ts';
import { startEdit } from '../../public/app/wizard/wizard.ts';
import { render } from '../../public/app/shell.ts';
import {
  $,
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
import type {
  CurrentCalculatedPlan,
  StageKey,
  StoredCalculatedPlan,
  UpdateOp,
} from '../../public/types/index.ts';

// A Phase 3 plan on whole machines with 20 somersloops for amplification.
const BASE = {
  phase: '3',
  recipes: 'standard',
  somersloops: 40,
  amplifySloops: 20,
  wholeMachines: true,
  storageFromSurplus: true,
};
let cache: CurrentCalculatedPlan | undefined;
const sloopPlan = () => structuredClone((cache ??= generatedWith(BASE)));
const settle = () => new Promise(resolve => setTimeout(resolve, 20)).then(() => nextTick());
const text = (selector: string) => ($(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
function adaSays(id: string): string {
  adaClearFault();
  for (let i = 0; i < 60; i++) {
    setAdaIndex(i);
    const line = adaCurrent();
    if (line?.id === id) return line.text;
  }
  return '';
}
function openPlan(plan: StoredCalculatedPlan = sloopPlan(), progress = {}, phase: StageKey = '3') {
  page();
  open({ calculated: plan, phase, workspace: { catalog: catalog() }, state: progress });
  go('plan');
  render();
}
const IRON_ROD = 'Recipe_IronRod_C';

beforeEach(() => {
  setWizard(null);
  setBeginnerMode(false);
});
afterEach(() => setBeginnerMode(false));

test('a line’s dialog pins its somersloops without recalculating; the plan asks for one', async () => {
  const plan = sloopPlan();
  openPlan(plan);
  const sent: UpdateOp[] = [];
  stubFetch<UpdateOp>({
    '/api/update': (update: UpdateOp) => {
      sent.push(update);
      return applyUpdate(update);
    },
  });
  openCalculatedFactory(IRON_ROD);
  await settle();
  const field = $<HTMLInputElement>(`[data-sloop-pin="${IRON_ROD}"]`)!;
  assert.ok(field, 'the dialog offers the pin');
  assert.equal(field.step, '1', 'a Constructor takes one somersloop');
  // Its accessible name and description: the label, and the note under it.
  const label = $(`label[for="${field.id}"]`)!;
  assert.equal(label.textContent!.replace(/\s+/g, ' ').trim(), 'Pin to this many somersloops');
  assert.ok(field.getAttribute('aria-describedby')!.includes('sloop-pin-note-' + IRON_ROD));
  assert.match(
    text('[data-sloop-pin-now]'),
    /^This plan puts (no somersloops|\d+ somersloops?) on this line/,
  );
  assert.match(
    text('[data-sloop-pin-note]'),
    /^The planner chooses how many somersloops this line takes\./,
  );
  assert.equal($('[data-sloop-pin-clear]'), null, 'nothing to clear yet');
  const before = JSON.stringify(calculated);
  field.value = '4';
  $<HTMLButtonElement>('[data-sloop-pin-save]')!.click();
  await settle();
  assert.deepEqual(sent, [{ type: 'sloopPins', value: { '3': { [IRON_ROD]: 4 } } }]);
  assert.deepEqual(state.sloopPins, { '3': { [IRON_ROD]: 4 } });
  assert.equal(state.version, 24);
  assert.equal(JSON.stringify(calculated), before, 'the plan is not recalculated');
  assert.match(text('[data-sloop-pin-note]'), /^Saved: 4 somersloops after a recalculation\./);
  // The build plan says what a recalculation would change, and so does ADA.
  assert.match(
    text('[data-sloop-pins-recalc]'),
    /This plan needs a recalculation\. Somersloop pins changed: Iron Rod \(Phase 3\): 4 somersloops\. Nothing changes until you start it\./,
  );
  assert.match(adaSays('sloop-pins-pending'), /^You pinned the somersloops of 1 production line/);
  go('factories');
  render();
  await settle();
  assert.ok($('[data-sloop-pins-recalc]'), 'the Factories page has the notice too');
  // "Planner's choice" forgets the pin: nothing to recalculate, the state's version as before.
  openCalculatedFactory(IRON_ROD);
  await settle();
  $<HTMLButtonElement>('[data-sloop-pin-clear]')!.click();
  await settle();
  assert.deepEqual(sent.at(-1), { type: 'sloopPins', value: null });
  assert.equal('sloopPins' in state, false);
  assert.equal($('[data-sloop-pins-recalc]'), null);
});

test('a count that does not fill whole machines is refused with why, before anything is saved', async () => {
  const plan = sloopPlan();
  const manufacturer = plan.stages['3'].rows!.find(
    row => row.machine === 'Manufacturer' && !row.id.startsWith('amp:'),
  )!;
  assert.ok(manufacturer, 'Phase 3 has a Manufacturer line');
  openPlan(plan);
  const calls = stubFetch({});
  openCalculatedFactory(manufacturer.id);
  await settle();
  const field = $<HTMLInputElement>(`[data-sloop-pin="${manufacturer.id}"]`)!;
  assert.equal(field.step, '4');
  field.value = '6';
  $<HTMLButtonElement>('[data-sloop-pin-save]')!.click();
  await settle();
  assert.deepEqual(calls, [], 'nothing is sent');
  assert.equal(
    text('[data-sloop-pin-error]'),
    'Pin a whole number of machines: a multiple of 4 from 0 to 104.',
  );
  assert.equal(field.getAttribute('aria-invalid'), 'true');
  assert.equal($('[data-sloop-pin-error]')!.getAttribute('role'), 'alert');
  // A machine with one slot takes any whole number: no "multiple of 1" (#1020).
  openCalculatedFactory(IRON_ROD);
  await settle();
  const rod = $<HTMLInputElement>(`[data-sloop-pin="${IRON_ROD}"]`)!;
  assert.equal(rod.step, '1');
  rod.value = '2.5';
  $<HTMLButtonElement>('[data-sloop-pin-save]')!.click();
  await settle();
  assert.deepEqual(calls, [], 'still nothing is sent');
  assert.equal(text('[data-sloop-pin-error]'), 'Pin a whole number from 0 to 106.');
});

test('no pin control without a budget, before Phase 3 or in New to Satisfactory mode', async () => {
  const plain = generatedWith({ ...BASE, amplifySloops: 0 });
  openPlan(plain);
  openCalculatedFactory(IRON_ROD);
  await settle();
  assert.equal($('[data-sloop-pin-choice]'), null, 'no amplification budget, no pin');
  // A pin already asked for still shows, so it can be cleared.
  openPlan(plain, { version: 24, sloopPins: { '3': { [IRON_ROD]: 2 } } });
  openCalculatedFactory(IRON_ROD);
  await settle();
  assert.ok($('[data-sloop-pin-choice]'));
  assert.match(
    text('[data-sloop-pin-now]'),
    /no amplification budget, so a pin above 0 cannot be kept/,
  );
  setBeginnerMode(true);
  openPlan(sloopPlan());
  openCalculatedFactory(IRON_ROD);
  await settle();
  assert.equal($('[data-sloop-pin-choice]'), null, 'not in New to Satisfactory mode');
  setBeginnerMode(false);
  const plan = sloopPlan();
  openPlan(plan, {}, '2');
  const early = plan.stages['2'].rows!.find(row => row.machine === 'Constructor')!;
  openCalculatedFactory(early.id);
  await settle();
  assert.equal($('[data-sloop-pin-choice]'), null, 'machines take somersloops from Phase 3');
});

test('“Recalculate in place with somersloop pins” recalculates in place with the pins', async () => {
  const plan = sloopPlan();
  openPlan(plan, { version: 24, sloopPins: { '3': { [IRON_ROD]: 4 } } });
  await settle();
  let sent: { settings: StoredCalculatedPlan['settings']; name: string; planCreatedAt: string };
  let next: StoredCalculatedPlan | undefined;
  stubFetch({
    '/api/recalculate': (body: typeof sent) => {
      sent = body;
      next = generatedWith(body.settings);
      return {
        saveId: 's',
        profileId: 'p',
        backupId: 'b',
        reviewCount: 0,
        carriedChecks: 5,
        workspace,
      };
    },
    '/api/context': () => ({
      save: { id: 's', name: 'World' },
      profile: { id: 'p', kind: 'calculated', name: evil },
      state: { ...state, sloopPins: undefined, version: 1 },
      plan: next,
    }),
  });
  const asked = answerConfirms(true);
  $<HTMLButtonElement>('[data-recalc-sloop-pins]')!.click();
  await settle();
  await settle();
  assert.equal(asked.length, 1, 'it asks first');
  assert.match(asked[0]!, /with the somersloop pins you chose/);
  assert.deepEqual(sent!.settings.sloopPins, { '3': { [IRON_ROD]: 4 } });
  assert.equal(sent!.planCreatedAt, plan.createdAt);
  assert.deepEqual(
    calculated?.settings.sloopPins,
    { '3': { [IRON_ROD]: 4 } },
    'its new plan is open',
  );
  assert.equal($('[data-sloop-pins-recalc]'), null, 'and needs no recalculation');
  const twin = calculated!.stages['3']!.rows!.find(row => row.id === 'amp:' + IRON_ROD)!;
  assert.equal(twin.sloops, 4);
  // The dialog says the plan keeps it, on the amplified line as on its plain one.
  openPlan(calculated!);
  openCalculatedFactory('amp:' + IRON_ROD);
  await settle();
  assert.match(
    text('[data-sloop-pin-note]'),
    /^Pinned to 4 somersloops: the plan keeps it exactly/,
  );
  assert.match(
    text('[data-sloop-pin-now]'),
    /^This plan puts 4 somersloops on this line: 4 amplified Constructors, 1 each\./,
  );
});

test('pins over the budget are named on the notice; a pin the plan could not keep is reported', async () => {
  openPlan(sloopPlan(), { version: 24, sloopPins: { '3': { [IRON_ROD]: 16, Recipe_Screw_C: 8 } } });
  await settle();
  assert.match(
    text('[data-sloop-pins-over]'),
    /^The pins of Phase 3 \(24\) add up to more than the 20 somersloops production amplification may place in a phase/,
  );
  const dropped = generatedWith({ ...BASE, sloopPins: { '3': { [IRON_ROD]: 24 } } });
  openPlan(dropped);
  await settle();
  assert.match(
    adaSays('sloop-pins-dropped'),
    /^This plan could not keep the somersloops you pinned on Iron Rod in Phase 3/,
  );
  openCalculatedFactory(IRON_ROD);
  await settle();
  assert.match(
    text('[data-sloop-pin-note]'),
    /^Pinned to 24 somersloops, but Phase 3 could not keep the pin: the phase’s pins add up to more than the 20 somersloops production amplification may place in a phase\. The phase is planned without it\. Raise the amplification budget/,
  );
  // The note is in the line's dialog, so it says "here", not "in the production line’s dialog"
  // (#1020).
  assert.match(
    text('[data-sloop-pin-note]'),
    /or lower or clear this pin here \(or the phase’s other pins in their production lines’ dialogs\)\.$/,
  );
  assert.doesNotMatch(text('[data-sloop-pin-note]'), /in the production line’s dialog/);
});

test('Edit settings starts from the pins asked for, so its recalculation plans them', async () => {
  const plan = sloopPlan();
  openPlan(plan, { version: 24, sloopPins: { '3': { [IRON_ROD]: 4 } } });
  await settle();
  stubFetch({});
  await startEdit('s', 'p');
  assert.deepEqual(draft().settings.sloopPins, { '3': { [IRON_ROD]: 4 } });
  // Without a choice, the plan's own pins.
  setWizard(null);
  const pinned = { ...plan, settings: { ...plan.settings, sloopPins: { '3': { [IRON_ROD]: 2 } } } };
  openPlan(pinned);
  await settle();
  await startEdit('s', 'p');
  assert.deepEqual(draft().settings.sloopPins, { '3': { [IRON_ROD]: 2 } });
  setWizard(null);
});
