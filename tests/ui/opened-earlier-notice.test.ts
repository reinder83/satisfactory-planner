// The build plan says why a profile opened on an earlier phase than its saved working phase
// (#666, ui/plan/OpenedEarlierNotice.vue): while openedFrom() is set, a notice above the build
// sequence names both phases and the open steps, and "Go to Phase N" shows the saved phase the way
// the phase track does, writing nothing. On the saved phase there is no notice.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { phaseStepIds } from '../../public/app/opening-phase.ts';
import { loadContext, openedFrom, phase, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { planTasks, satisfiedStepIds, stepDone } from '../../public/app/tasks.ts';
import { $, applyUpdate, generatedWith, migratedPlan, open, page, stubFetch } from './setup.ts';
import type {
  ContextReply,
  CurrentCalculatedPlan,
  Phase,
  StageKey,
  UpdateOp,
} from '../../public/types/index.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};

let startsInOne: CurrentCalculatedPlan | undefined;
const phaseOnePlan = () => structuredClone((startsInOne ??= generatedWith({ phase: '1' })));

beforeEach(() => page());

async function openThrough(reply: ContextReply) {
  const calls = stubFetch({
    '/api/context': reply,
    '/api/update': (update: UpdateOp) => applyUpdate(update),
  });
  await loadContext(reply.save.id, reply.profile.id);
  render();
  await settle();
  return calls;
}
const calculatedReply = (savedPhase: Phase, checks: Record<string, boolean>): ContextReply => ({
  save: { id: 's', name: 'Save' },
  profile: { id: 'p', kind: 'calculated', name: 'Started in Phase 1' },
  state: {
    ...structuredClone(state),
    settings: { phase: savedPhase },
    checks,
    customTasks: [],
  },
  plan: phaseOnePlan(),
});
const notice = () => $('[data-opened-earlier]');
const goButton = () => $<HTMLButtonElement>('[data-go-to-saved-phase]');
// Open as the progress bar counts them: a step done by its own condition is done (#1070).
const openSteps = () => planTasks().filter(task => !stepDone(task)).length;

test('a profile opened on Phase 1 while saved on Phase 3 says why, above the build sequence', async () => {
  open();
  await openThrough(calculatedReply('3', {}));
  assert.equal(phase(), '1');
  const shown = notice();
  assert.ok(shown, 'the notice shows');
  assert.ok(shown.classList.contains('notice') && shown.classList.contains('info'));
  const open1 = openSteps();
  assert.ok(open1 > 1, 'Phase 1 has open steps');
  assert.equal(
    shown.textContent?.replace(/\s+/g, ' ').trim(),
    `You are working on Phase 3. Phase 1 still has ${open1} open steps, so the plan starts here. Go to Phase 3`,
  );
  assert.equal(goButton()?.textContent?.trim(), 'Go to Phase 3');
  assert.equal(goButton()?.type, 'button');
  // Above the build sequence: before the section with the "Build sequence" heading.
  const sequence = $('#main .split')!;
  assert.ok(shown.compareDocumentPosition(sequence) & Node.DOCUMENT_POSITION_FOLLOWING);
});

test('the open-step count follows the ticks, and one open step reads in the singular', async () => {
  const plan = phaseOnePlan();
  open({ calculated: plan, phase: '1' });
  const ids = phaseStepIds('1' as StageKey);
  const allButOne = Object.fromEntries(ids.slice(1).map(id => [id, true]));
  open();
  await openThrough(calculatedReply('3', allButOne));
  assert.equal(phase(), '1');
  assert.match(notice()!.textContent!, /Phase 1 still has 1 open step, so the plan starts here\./);
});

// ADA's `opened-earlier` remark on the open build plan, or undefined when it has none.
function adaOpenedEarlier(): string | undefined {
  for (let i = 0; i < 60; i++) {
    setAdaIndex(i);
    const line = adaCurrent();
    if (line?.id === 'opened-earlier') return line.text;
  }
  return undefined;
}

// #974: ticking the shown phase's last open step leaves it shown, and ADA then agrees with the
// notice that its steps are done, rather than saying it still has open steps.
test("ADA's opened-earlier line follows the notice once every step is ticked", async () => {
  const plan = phaseOnePlan();
  open({ calculated: plan, phase: '1' });
  const ids = phaseStepIds('1' as StageKey);
  const allButOne = Object.fromEntries(ids.slice(1).map(id => [id, true]));
  open();
  await openThrough(calculatedReply('3', allButOne));
  adaClearFault();
  assert.equal(phase(), '1');
  assert.match(adaOpenedEarlier() ?? '', /Phase 1 still has open steps/);
  state.checks[ids[0]!] = true;
  render();
  await settle();
  assert.equal(phase(), '1', 'the phase opened on stays shown');
  assert.match(notice()!.textContent!, /All Phase 1 steps are done now\./);
  const text = adaOpenedEarlier() ?? '';
  assert.doesNotMatch(text, /open steps/);
  assert.match(text, /all Phase 1 steps are done now/);
});

// A step done by its own condition (#1070: "Send the Phase 1 delivery" while the working phase is
// later) is done, as the progress bar counts it, though nobody ticks it: with every other step
// ticked the notice and ADA say the phase is done, not that one step is still open.
test('a step done by its own condition counts as done in the notice and ADA alike', async () => {
  const plan = phaseOnePlan();
  open({ calculated: plan, phase: '1' });
  const ids = phaseStepIds('1' as StageKey);
  open();
  const satisfied = () => satisfiedStepIds('1');
  await openThrough(calculatedReply('3', {}));
  const own = satisfied();
  assert.ok(own.size > 0, 'Phase 1 has a step done by its own condition');
  for (const id of ids) if (!own.has(id)) state.checks[id] = true;
  render();
  await settle();
  adaClearFault();
  assert.equal(phase(), '1');
  assert.match(notice()!.textContent!, /All Phase 1 steps are done now\./);
  assert.match(adaOpenedEarlier() ?? '', /all Phase 1 steps are done now/);
});

test('Go to Phase 3 shows the saved phase, writes nothing and the notice goes', async () => {
  open();
  const calls = await openThrough(calculatedReply('3', {}));
  goButton()!.focus();
  goButton()!.click();
  await settle();
  await settle();
  assert.equal(phase(), '3');
  assert.equal(state.settings.phase, '3');
  assert.equal(openedFrom(), null);
  assert.equal(notice(), null, 'the notice is gone');
  assert.equal($<HTMLSelectElement>('#phase-picker')!.value, '3');
  assert.equal($('.phase-track-seg.current')?.getAttribute('data-phase-seg'), '3');
  assert.equal($('#main h1')?.textContent?.trim(), 'Phase 3');
  assert.equal(document.activeElement, $('#main h1'), 'focus goes to the heading');
  assert.deepEqual(
    calls.map(([path]) => path.split('?')[0]),
    ['/api/context'],
    'nothing is written',
  );
});

test('no notice on the saved phase', async () => {
  open();
  await openThrough(calculatedReply('1', {}));
  assert.equal(phase(), '1');
  assert.equal(notice(), null);
  open({ calculated: phaseOnePlan(), phase: '3' });
  render();
  await settle();
  assert.equal(notice(), null, 'nor on a profile opened on its saved phase');
});

test('picking the saved phase on the phase track also takes the notice away', async () => {
  open();
  await openThrough(calculatedReply('3', {}));
  assert.ok(notice());
  $<HTMLButtonElement>('[data-phase-seg="3"]')!.click();
  await settle();
  assert.equal(notice(), null);
});

test('a profile migrated from the handbook, saved on Phase 5 and opened on Phase 3, shows the notice too', async () => {
  open();
  await openThrough({
    save: { id: 's', name: 'Save' },
    profile: { id: 'original', kind: 'calculated', name: 'Handbook' },
    state: { ...structuredClone(state), settings: { phase: '5' }, checks: {}, customTasks: [] },
    plan: migratedPlan(),
  });
  assert.equal(phase(), '3');
  assert.match(
    notice()!.textContent!.replace(/\s+/g, ' '),
    new RegExp(`You are working on Phase 5\\. Phase 3 still has ${openSteps()} open steps`),
  );
  goButton()!.click();
  await settle();
  assert.equal(phase(), '5');
  assert.equal(notice(), null);
});
