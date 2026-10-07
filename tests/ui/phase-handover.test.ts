// The phase handover on the build plan (#1069): a line marked running in the phase before is
// carried into the next phase's step ("Running since Phase 1: … Add 2 machines"), the build plan
// opens with the handover summary, a phase whose elevator delivery is complete offers the next
// phase, and Post Phase 5 shows a finish card rather than reading like a sixth phase. Everything
// reads the stored plan, the ticks and the delivery counts: nothing is ticked or recalculated.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { phase, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { deliveryKey, formatNumber } from '../../public/progression.ts';
import {
  $,
  $$,
  applyUpdate,
  generatedWith,
  go,
  open,
  openMigrated,
  page,
  stubFetch,
} from './setup.ts';
import type {
  CurrentCalculatedPlan,
  Phase,
  ProgressState,
  StageKey,
  UpdateOp,
} from '../../public/types/index.ts';

// A plan from Phase 1 with exact clocks, made once.
let made: CurrentCalculatedPlan | undefined;
const plan = () => structuredClone((made ??= generatedWith({ phase: '1' })));

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const step = (id: string) => $(`[data-check="${id}"]`)!.closest<HTMLElement>('.task')!;
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

// Every line of `stageKey` marked running.
const allRunning = (stored: CurrentCalculatedPlan, stageKey: StageKey) =>
  Object.fromEntries(
    stored.stages[stageKey].rows!.map(row => [`calc-${stageKey}-${row.id}`, true]),
  );
// Every Space Elevator part of `stageKey` delivered.
const delivered = (stored: CurrentCalculatedPlan, stageKey: StageKey) =>
  Object.fromEntries(
    Object.entries(stored.stages[stageKey].delivery || {}).map(([item, part]) => [
      deliveryKey(stageKey, item),
      part.target,
    ]),
  );

async function show(stored: CurrentCalculatedPlan, shown: Phase, progress: Partial<ProgressState>) {
  open({ calculated: stored, phase: shown, state: progress });
  go('plan');
  render();
  await nextTick();
}

beforeEach(() => page());

test('a Phase 1 line marked running says what Phase 2 adds to it', async () => {
  const stored = plan(),
    checks = allRunning(stored, '1'),
    before = structuredClone(checks);
  // A line both phases build, which Phase 2 makes bigger.
  const grown = stored.stages['2'].rows!.find(row => {
    const earlier = stored.stages['1'].rows!.find(candidate => candidate.id === row.id);
    return earlier && row.machines > earlier.machines;
  })!;
  assert.ok(grown, 'the plan grows a Phase 1 line in Phase 2');
  const earlier = stored.stages['1'].rows!.find(row => row.id === grown.id)!;
  await show(stored, '2', { checks });
  const body = text(step('calc-2-' + grown.id).querySelector('p'));
  assert.ok(
    body.startsWith(
      `Running since Phase 1: ${formatNumber(earlier.machines)} × ${earlier.machine}`,
    ),
    body,
  );
  const extra = grown.machines - earlier.machines;
  assert.match(body, new RegExp(`Add ${extra} machines?[,.]`));
  // The whole line's setup still follows.
  assert.match(body, new RegExp(`${grown.machines} ${grown.machine} total`));
  // The summary at the top of the build plan.
  assert.match(
    text($('[data-handover]')),
    /^Handover\. From Phase 1: keep \d+ lines? already running, adding \d+ machines?.*; build the other \d+.* tick it Running here once it matches Phase 2\.$/,
  );
  // Nothing is ticked in Phase 2, and the Phase 1 marks stay exactly as they were.
  assert.deepEqual(state.checks, before);
  assert.equal(
    $<HTMLInputElement>(`[data-check="calc-2-${grown.id}"]`)!.checked,
    false,
    'the Phase 2 Running box stays the user’s to tick',
  );
});

test('without Phase 1 lines marked running nothing is carried', async () => {
  const stored = plan();
  await show(stored, '2', { checks: {} });
  assert.ok(!$$('.task').some(task => /Running since/.test(task.textContent!)));
  assert.match(
    text($('[data-handover]')),
    /From Phase 1: nothing marked running there carries over, so build all \d+ lines/,
  );
  // Phase 1 has no phase before it, and Post Phase 5 works on Phase 5's own steps.
  await show(stored, '1', { checks: {} });
  assert.equal($('[data-handover]'), null);
  await show(stored, 'post', { checks: allRunning(stored, '4') });
  assert.equal($('[data-handover]'), null);
  assert.ok(!$$('.task').some(task => /Running since/.test(task.textContent!)));
});

test('once every Phase 2 line is marked running the handover summary goes', async () => {
  const stored = plan();
  await show(stored, '2', { checks: { ...allRunning(stored, '1'), ...allRunning(stored, '2') } });
  assert.equal($('[data-handover]'), null);
});

test('a delivered phase offers the next one, which the button saves', async () => {
  const stored = plan();
  await show(stored, '1', {});
  assert.equal($('[data-next-phase]'), null, 'not while the delivery is open');
  await show(stored, '1', { deliveries: delivered(stored, '1') });
  assert.equal(
    text($('[data-next-phase]')),
    'Phase 1 delivered. Every Space Elevator part of this phase is handed in. Phase 2 starts ' +
      'from the lines marked running here.Go to Phase 2',
  );
  const before = structuredClone(state.checks);
  const calls = stubFetch<UpdateOp>({ '/api/update': (update: UpdateOp) => applyUpdate(update) });
  $<HTMLButtonElement>('[data-go-to-next-phase]')!.click();
  await settle();
  await settle();
  assert.equal(phase(), '2');
  assert.equal(state.settings.phase, '2');
  assert.deepEqual(
    calls.filter(([path]) => path.startsWith('/api/update')).map(([, body]) => body),
    [{ type: 'phase', value: '2' }],
    'only the phase is written',
  );
  assert.deepEqual(state.checks, before, 'no tick is written');
  assert.equal($('[data-next-phase]'), null, 'Phase 2 is not delivered yet');
});

test('Phase 5 delivered leads to the finish card, not a sixth phase', async () => {
  const stored = plan();
  await show(stored, '5', { deliveries: delivered(stored, '5') });
  assert.match(
    text($('[data-next-phase]')),
    /^Phase 5 delivered: Project Assembly is complete\. .*\.Go to Post Phase 5$/,
  );
  await show(stored, 'post', { deliveries: delivered(stored, '5') });
  assert.equal($('[data-next-phase]'), null);
  const card = text($('[data-finish-card]'));
  assert.match(card, /^Project Assembly complete\. Post Phase 5 is not a sixth phase/);
  assert.match(card, /Retain these Phase 5 capacities\./);
  await show(stored, 'post', {});
  assert.match(text($('[data-finish-card]')), /^After Phase 5\. Post Phase 5 is not a sixth phase/);
});

test('a stored plan from before #1069 opens as it was: a migrated profile has no handover', async () => {
  // A profile migrated from the handbook keeps its guide's own steps: nothing is carried into
  // them, whatever is ticked, and its stored progress is not touched.
  const checks = { 'calc-3-x': true };
  openMigrated({ phase: '4', state: { checks } });
  go('plan');
  render();
  await nextTick();
  assert.equal($('[data-handover]'), null);
  assert.ok(!$$('.task').some(task => /Running since/.test(task.textContent!)));
  assert.deepEqual(state.checks, { 'calc-3-x': true });
});

test('a finished Post Phase 5 checklist offers no next phase', async () => {
  const stored = plan();
  // Every step of `shown` ticked.
  const ticked = async (shown: Phase) => {
    await show(stored, shown, {});
    const ids = $$<HTMLInputElement>('[data-check]').map(box => box.dataset.check!);
    await show(stored, shown, { checks: Object.fromEntries(ids.map(id => [id, true])) });
    return text($('[data-phase-complete]'));
  };
  const post = await ticked('post');
  assert.match(
    post,
    /Nothing left to build Post Phase 5 has no next phase: keep these lines running\./,
  );
  assert.doesNotMatch(post, /Ready for the next phase/);
  assert.match(await ticked('5'), /Ready for the next phase/);
});
