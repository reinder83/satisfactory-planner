// A Space Elevator part's whole output goes to the elevator (#1062), and a part delivered in full
// changes what the pages say about it: the build plan dims the lines that only made it, saying
// whether a later phase builds them again ("now only needed for Phase 2") or none does; its
// summary gives the time the rest of the delivery takes; and Logistics marks the part's link to
// the elevator as delivered. Nothing is ticked or recalculated: a plan stored before #1062 keeps
// the rates it was calculated with.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { num } from '../../public/app/format.ts';
import { state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, generatedWith, go, open, page } from './setup.ts';
import type { CurrentCalculatedPlan, Phase } from '../../public/types/index.ts';

// A whole-machine plan from Phase 1, made once.
let wholePlan: CurrentCalculatedPlan | undefined;
const whole = () =>
  structuredClone((wholePlan ??= generatedWith({ wholeMachines: true, phase: '1' })));

const SMART_PLATING = 'calc-1-Recipe_SpaceElevatorPart_1_C';
const WARP_DRIVE = 'calc-5-Recipe_SpaceElevatorPart_11_C';
const NUCLEAR_PASTA = 'calc-5-Recipe_SpaceElevatorPart_9_C';

const step = (id: string) => $(`[data-check="${id}"]`)!.closest<HTMLElement>('.task')!;
const note = (id: string) => step(id).querySelector('[data-idle-note]')?.textContent;
const summary = () => $('[data-summary="hours"]')!.textContent;
const counter = (id: string) =>
  $(`#delivery-${id}`)!.closest('.delivery')!.querySelector('.muted')!.textContent;

async function show(
  plan: CurrentCalculatedPlan,
  phase: Phase,
  deliveries: Record<string, number> = {},
) {
  open({ calculated: plan, phase, state: { deliveries } });
  go('plan');
  render();
  await nextTick();
}

beforeEach(() => page());

test('the delivery counter and the summary follow the whole-machine rates (#1062)', async () => {
  // Phase 3 makes 10 Versatile Framework/min with whole machines, all for the elevator.
  await show(whole(), '3');
  assert.equal(counter('3-versatile-framework'), `${num(10)}/min net · about 4 h 10 min left`);
  assert.equal(summary(), 'Delivery in about 4 h 10 min at steady state');
  // Phase 1: one Assembler, 2 Smart Plating/min, 50 parts in 25 minutes.
  await show(whole(), '1');
  assert.equal(counter('1-smart-plating'), `${num(2)}/min net · 25 minutes left`);
  assert.equal(summary(), 'Delivery in 25 minutes at steady state');
});

test('the summary gives the time the rest of the delivery takes', async () => {
  // 1,250 of 2,500 Versatile Frameworks: 125 minutes left, but the Modular Engines still take
  // 250 at 2/min.
  await show(whole(), '3', { '3-versatile-framework': 1250 });
  assert.equal(summary(), 'Rest of the delivery in about 4 h 10 min at steady state');
  await show(whole(), '3', { '3-versatile-framework': 2500, '3-modular-engine': 400 });
  assert.equal(summary(), 'Rest of the delivery in about 1 h 40 min at steady state');
  await show(whole(), '3', {
    '3-versatile-framework': 2500,
    '3-modular-engine': 500,
    '3-adaptive-control-unit': 100,
  });
  assert.equal(summary(), 'Elevator delivery complete');
});

test('a delivered part dims its line, which Phase 2 builds again', async () => {
  await show(whole(), '1');
  assert.ok(!step(SMART_PLATING).classList.contains('is-idle'), 'not delivered yet: not dimmed');
  assert.equal(note(SMART_PLATING), undefined);
  await show(whole(), '1', { '1-smart-plating': 50 });
  const dimmed = step(SMART_PLATING);
  assert.ok(dimmed.classList.contains('is-idle'));
  assert.equal(
    note(SMART_PLATING),
    'Smart Plating is delivered: this line is now only needed for Phase 2.',
  );
  // The note describes the step's checkbox, and the title stays the step's own.
  const box = dimmed.querySelector<HTMLInputElement>('[data-check]')!;
  assert.equal($('#' + box.getAttribute('aria-describedby'))!.textContent, note(SMART_PLATING));
  assert.ok(dimmed.querySelector('summary')!.textContent!.startsWith('Smart Plating'));
  // It is not ticked, comes after the other unfinished steps and does not lead.
  assert.equal(box.checked, false);
  assert.equal(state.checks[SMART_PLATING], undefined);
  const open = $$('[data-open-steps] > .task');
  assert.equal(open.at(-1), dimmed);
  assert.ok(!dimmed.classList.contains('lead'));
  assert.ok(open[0]!.classList.contains('lead'));
  assert.equal(summary(), 'Elevator delivery complete');
});

test('a part no later phase makes says its line is no longer needed', async () => {
  await show(whole(), '5', { '5-ballistic-warp-drive': 200, '5-nuclear-pasta': 1000 });
  assert.equal(
    note(WARP_DRIVE),
    'Ballistic Warp Drive is delivered: this line is no longer needed.',
  );
  // The Singularity Cells still take Nuclear Pasta, so its line stays as it is.
  assert.ok(!step(NUCLEAR_PASTA).classList.contains('is-idle'));
  assert.equal(note(NUCLEAR_PASTA), undefined);
  // Post Phase 5 keeps every Phase 5 line running, so nothing is dimmed there.
  await show(whole(), 'post', { '5-ballistic-warp-drive': 200 });
  assert.equal(note(WARP_DRIVE), undefined);
});

test('Logistics marks a delivered part on its link to the Space Elevator', async () => {
  const plan = whole();
  const factoryGroups = {
    groups: [{ id: 'fg-main1', name: 'Main' }],
    assignments: Object.fromEntries(
      plan.stages['3'].rows!.map(row => [row.id, [{ group: 'fg-main1', rate: null }]]),
    ),
  };
  const elevatorItem = (name: string) =>
    $$('[data-link-out="fg-main1:elevator"] li').find(li => li.textContent!.includes(name))!;
  open({ calculated: plan, state: { factoryGroups } });
  go('logistics');
  render();
  await nextTick();
  // All 10 Versatile Framework/min go to the elevator, none to the sink.
  assert.match(elevatorItem('Versatile Framework').textContent!, new RegExp(`${num(10)}/min$`));
  assert.ok(
    !$$('[data-link-out="fg-main1:sink"] li').some(li =>
      li.textContent!.includes('Versatile Framework'),
    ),
  );
  assert.ok(!elevatorItem('Versatile Framework').classList.contains('delivered'));
  open({
    calculated: plan,
    state: { factoryGroups, deliveries: { '3-versatile-framework': 2500 } },
  });
  go('logistics');
  render();
  await nextTick();
  const done = elevatorItem('Versatile Framework');
  assert.ok(done.classList.contains('delivered'));
  assert.equal(done.querySelector('[data-delivered-link]')!.textContent, ' · delivered');
  assert.match(done.title, /, delivered$/);
  assert.ok(!elevatorItem('Modular Engine').classList.contains('delivered'));
});

test('a plan stored before #1062 keeps the rates it was calculated with', async () => {
  // A stored whole-machine Phase 3 that delivered 5.3 of its 10 Versatile Framework/min and
  // sank the rest, as the planner used to: nothing recalculates it.
  const plan = whole();
  const three = plan.stages['3'];
  three.delivery!['Versatile Framework']!.rate = 5.3;
  three.surplus = { ...three.surplus, 'Versatile Framework': 4.7 };
  three.hours = 2500 / 5.3 / 60;
  await show(plan, '3');
  assert.equal(counter('3-versatile-framework'), `${num(5.3)}/min net · about 7 h 52 min left`);
  assert.equal(summary(), 'Delivery in about 7 h 52 min at steady state');
});
