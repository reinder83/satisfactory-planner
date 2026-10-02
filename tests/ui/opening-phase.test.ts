// The phase a profile opens on (#570, app/opening-phase.ts): the saved working phase, unless an
// earlier phase the profile plans still has an open check, then the first such phase. It applies
// to every profile loadContext() opens, a new one and an existing one, in both editions (they
// share this code; only /api/context's transport differs). Opening writes nothing: the saved
// phase and checks stay as they were, and the phase picker still saves and shows what is picked.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { openingPhase, phaseStepIds } from '../../public/app/opening-phase.ts';
import {
  loadContext,
  openedFrom,
  phase,
  progressionData,
  state,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { planTasks } from '../../public/app/tasks.ts';
import { calcTasks } from '../../public/app/views/calculated.ts';
import { planStepIds, profilePhases } from '../../public/state.ts';
import { $, applyUpdate, generatedWith, go, handbook, open, page, stubFetch } from './setup.ts';
import type {
  ContextReply,
  CurrentCalculatedPlan,
  Phase,
  ProfileSummary,
  StageKey,
  UpdateOp,
} from '../../public/types/index.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};

// A calculated profile that starts in Phase 1, made once for the file.
let startsInOne: CurrentCalculatedPlan | undefined;
const phaseOnePlan = () => structuredClone((startsInOne ??= generatedWith({ phase: '1' })));

beforeEach(() => page());

test('openingPhase: the first phase from the start phase with an open check, else the chosen one', () => {
  const steps: Record<string, string[]> = {
    '1': ['a', 'b'],
    '2': ['c'],
    '3': ['d'],
    '4': [],
    '5': ['e'],
  };
  const stepIds = (phase: StageKey) => steps[phase] ?? [];
  const at = (chosen: Phase, start: StageKey, checks: Record<string, boolean>) =>
    openingPhase(chosen, start, stepIds, checks);
  assert.equal(at('3', '1', {}), '1', 'Phase 1 has open checks');
  assert.equal(at('3', '1', { a: true }), '1', 'one of its checks is still open');
  assert.equal(at('3', '1', { a: true, b: true }), '2', 'Phase 1 is done, Phase 2 is not');
  assert.equal(at('3', '1', { a: true, b: true, c: true }), '3', 'everything before it is done');
  assert.equal(at('3', '2', {}), '2', 'a phase before the start phase is not counted');
  assert.equal(at('3', '3', {}), '3', 'the chosen phase is the start phase');
  assert.equal(at('5', '4', {}), '5', 'a phase with no steps holds nothing open');
  assert.equal(at('post', '5', {}), '5', 'post-game opens on an open Phase 5');
  assert.equal(at('post', '5', { e: true }), 'post', 'and on post-game once it is done');
  assert.equal(at('1', '3', {}), '1', 'a saved phase before the start is left to phase()');
});

test('openingPhase asks only for the phases before the chosen one, up to the first open one', () => {
  const asked: string[] = [];
  const stepIds = (phase: StageKey) => (asked.push(phase), phase === '3' ? ['open'] : []);
  assert.equal(openingPhase('5', '2', stepIds, {}), '3');
  assert.deepEqual(asked, ['2', '3']);
  asked.length = 0;
  assert.equal(openingPhase('2', '1', stepIds, {}), '2');
  assert.deepEqual(asked, ['1']);
});

// phaseStepIds works out another phase's checklist without opening it, through the functions
// the build plan draws with (calcTasks, planTasks, given the phase). Asked from another phase,
// it must hold exactly the steps the build plan shows once that phase is open, in their order,
// with the user's edits and personal tasks for that phase.
const otherPhase = (stage: StageKey): StageKey => (stage === '5' ? '1' : '5');

test('another phase of a calculated profile is worked out as its build plan shows it', () => {
  const plan = phaseOnePlan();
  for (const stage of ['1', '2', '3', '4', '5'] as StageKey[]) {
    const edits = {
      customTasks: [{ id: 'custom-' + stage, phase: stage, title: 'Mine' }],
      taskEdits: {
        // The personal task first, by this phase's saved order only.
        order: { [stage]: ['custom-' + stage] },
        removed: ['calc-' + stage + '-storage'],
        titles: {},
        bodies: {},
        links: {},
      },
    };
    open({ calculated: plan, phase: stage, state: structuredClone(edits) });
    const shown = planTasks().map(task => task.id),
      generated = calcTasks();
    assert.equal(shown[0], 'custom-' + stage, 'the saved order applies');
    assert.ok(!shown.includes('calc-' + stage + '-storage'), 'a removed step does not count');
    assert.ok(
      shown.some(id => id.startsWith('unlock-')),
      'milestones count',
    );
    open({ calculated: plan, phase: otherPhase(stage), state: structuredClone(edits) });
    assert.equal(phase(), otherPhase(stage));
    assert.deepEqual(phaseStepIds(stage), shown, 'Phase ' + stage + ' steps');
    assert.deepEqual(calcTasks(stage), generated, 'Phase ' + stage + ' generated steps');
  }
});

test('post-game is worked out from another phase with Phase 5 ids', () => {
  const plan = phaseOnePlan();
  open({ calculated: plan, phase: 'post' });
  const shown = planTasks().map(task => task.id);
  assert.ok(shown.includes('calc-5-storage'));
  open({ calculated: plan, phase: '3' });
  assert.deepEqual(
    planTasks('post').map(task => task.id),
    shown,
  );
});

test('another phase of the handbook is worked out as its build plan shows it', () => {
  for (const stage of ['3', '4', '5'] as StageKey[]) {
    const edits = { customTasks: [{ id: 'custom-' + stage, phase: stage, title: 'Mine' }] };
    open({ phase: stage, state: structuredClone(edits) });
    const shown = planTasks().map(task => task.id);
    assert.ok(shown.includes('custom-' + stage), 'a personal task counts');
    // The handbook plans Phase 3 on.
    const other: StageKey = stage === '3' ? '5' : '3';
    open({ phase: other, state: structuredClone(edits) });
    assert.equal(phase(), other);
    assert.deepEqual(phaseStepIds(stage), shown, 'Phase ' + stage);
  }
});

// Opens the profile /api/context answers with, as Open profile, boot and Create profile do,
// and draws the frame. Returns the requests it made.
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
// Every check of the given phases' build plans, ticked.
function ticked(plan: CurrentCalculatedPlan, phases: StageKey[]) {
  open({ calculated: plan, phase: phases[0] });
  return Object.fromEntries(phases.flatMap(stage => phaseStepIds(stage)).map(id => [id, true]));
}
const shownPhase = () => ({
  phase: phase(),
  picker: $<HTMLSelectElement>('#phase-picker')!.value,
  track: $('.phase-track-seg.current')?.getAttribute('data-phase-seg'),
});

test('a profile saved on Phase 3 with open Phase 1 checks opens on Phase 1, saving nothing', async () => {
  open();
  const checks = { 'unlock-some-other': true };
  const calls = await openThrough(calculatedReply('3', checks));
  assert.deepEqual(shownPhase(), { phase: '1', picker: '1', track: '1' });
  assert.equal(state.settings.phase, '3', 'the saved phase is unchanged');
  assert.equal(openedFrom(), '3', 'ADA is told the saved phase');
  assert.deepEqual(state.checks, checks, 'the checks are unchanged');
  assert.deepEqual(
    calls.map(([path]) => path.split('?')[0]),
    ['/api/context'],
    'opening only reads',
  );
});

test('once Phase 1 is done it opens on Phase 2, and once both are done on the saved phase', async () => {
  const plan = phaseOnePlan();
  open();
  await openThrough(calculatedReply('3', ticked(plan, ['1'])));
  assert.equal(phase(), '2');
  open();
  await openThrough(calculatedReply('3', ticked(plan, ['1', '2'])));
  assert.deepEqual(shownPhase(), { phase: '3', picker: '3', track: '3' });
});

test('picking the saved phase on the phase track shows it instead of the phase opened on', async () => {
  open();
  await openThrough(calculatedReply('3', {}));
  assert.equal(phase(), '1');
  const three = $<HTMLInputElement>('[data-phase-track] input[value="3"]')!;
  three.checked = true;
  three.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual(shownPhase(), { phase: '3', picker: '3', track: '3' });
  assert.equal(state.settings.phase, '3');
  assert.equal(openedFrom(), null);
});

test('picking another phase in the select saves and shows it', async () => {
  open();
  await openThrough(calculatedReply('4', {}));
  assert.equal(phase(), '1');
  const picker = $<HTMLSelectElement>('#phase-picker')!;
  picker.value = '2';
  picker.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual(shownPhase(), { phase: '2', picker: '2', track: '2' });
  assert.equal(state.settings.phase, '2');
});

test('the handbook, saved on Phase 5, opens on Phase 3 while its steps are open', async () => {
  open();
  await openThrough({
    save: { id: 's', name: 'Save' },
    profile: { id: 'original', kind: 'original', name: 'Handbook' },
    state: { ...structuredClone(state), settings: { phase: '5' }, checks: {}, customTasks: [] },
    plan: null,
    handbook,
  });
  assert.deepEqual(shownPhase(), { phase: '3', picker: '3', track: '3' });
  assert.equal(state.settings.phase, '5');
});

// The save list counts each phase's steps without the browser session (planStepIds in
// public/state/summary.ts, #746), from the stored plan, checks and progression.json. They must
// be the steps phaseStepIds gives: removed steps left out, personal tasks in, whatever the
// saved order (which only moves steps).
test('the summary counts the steps phaseStepIds gives, for every phase', () => {
  // A plan from Phase 1 plans every phase, each with production rows (the `!`s below).
  const plan = phaseOnePlan();
  for (const stage of ['1', '2', '3', '4', '5'] as StageKey[]) {
    const edits = {
      checks: { ['calc-' + stage + '-' + plan.stages[stage]!.rows![0]!.id]: true },
      customTasks: [{ id: 'custom-' + stage, phase: stage, title: 'Mine' }],
      taskEdits: {
        order: { [stage]: ['custom-' + stage] },
        removed: ['calc-' + stage + '-storage'],
        titles: {},
        bodies: {},
        links: {},
      },
    };
    open({ calculated: plan, phase: otherPhase(stage), state: structuredClone(edits) });
    assert.deepEqual(
      [...planStepIds(plan, state, progressionData, stage)].sort(),
      [...phaseStepIds(stage)].sort(),
      'Phase ' + stage,
    );
  }
});

// The issue's reproduction (#746): a profile starting in Phase 1, working on Phase 3, with every
// Phase 1 production line ticked and its other steps open. It opens on Phase 1, so its card must
// not draw Phase 1 as finished; it names Phase 1 as the earlier phase still open.
const cardFor = (checks: Record<string, boolean>) => {
  const phases = profilePhases(phaseOnePlan(), { checks, customTasks: [] }, progressionData)!;
  const summary: ProfileSummary = {
    id: 'p',
    kind: 'calculated',
    name: 'Started in Phase 1',
    completed: Object.keys(checks).length,
    phase: '3',
    phases,
  };
  // A fresh document, as opening Saves & profiles from another page draws it.
  page();
  open({
    workspace: { saves: [{ id: 's', name: 'Save', activeProfile: 'p', profiles: [summary] }] },
  });
  go('profiles');
  render();
  const bar = $('[data-phase-bar="p"]')!;
  return {
    label: bar.getAttribute('aria-label'),
    fill: Object.fromEntries(
      [...bar.querySelectorAll<HTMLElement>('.phase-seg')].map(segment => [
        segment.dataset.phaseSeg,
        (segment.firstElementChild as HTMLElement).style.width,
      ]),
    ),
  };
};

test('a profile card names the earlier phase the profile opens on (#746)', async () => {
  // A plan from Phase 1 plans every phase, each with production rows (the `!`s below).
  const plan = phaseOnePlan();
  const lines = Object.fromEntries(plan.stages['1']!.rows!.map(row => ['calc-1-' + row.id, true]));
  const card = cardFor(lines);
  open();
  await openThrough(calculatedReply('3', lines));
  assert.equal(phase(), '1', 'the profile opens on Phase 1');
  // The first earlier phase the card names is the one the profile opens on.
  assert.match(card.label!, /^Phase 3 of 5, \d+%; Phase 1 is \d+% done; Phase 2 is \d+% done$/);
  assert.notEqual(card.fill['1'], '100%', 'Phase 1 is not drawn as finished');
  // Every Phase 1 step and one Phase 2 line ticked: the profile opens on Phase 2 and the card
  // draws Phase 1 full and names Phase 2.
  const checks = { ...ticked(plan, ['1']), ['calc-2-' + plan.stages['2']!.rows![0]!.id]: true };
  const next = cardFor(checks);
  open();
  await openThrough(calculatedReply('3', checks));
  assert.equal(phase(), '2', 'the profile opens on Phase 2');
  assert.match(next.label!, /^Phase 3 of 5, \d+%; Phase 2 is \d+% done$/);
  assert.equal(next.fill['1'], '100%');
  assert.notEqual(next.fill['2'], '100%');
});
