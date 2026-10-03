// The profile cards on Saves & profiles (#804): the workspace summary now counts build-plan steps
// only for the phases up to the one each profile works on (profilePhases in
// public/state/summary.ts), since a card draws later phases empty. Every card must read exactly
// as it did from the counts of every phase: the same label and the same fill per segment, for
// plans from Phase 1 and Phase 3 (milestone-only Phases 1 and 2, #759) and one with a guide,
// every phase worked on, and ticks, personal tasks and removed steps across the phases.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { progressionData } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { milestoneOnlyPhases, phaseSteps } from '../../public/progression.ts';
import {
  initialState,
  phaseProgress,
  planStepIds,
  profilePhases,
  profilePhasesCache,
} from '../../public/state.ts';
import { $, $$, generated, generatedWith, go, open, page } from './setup.ts';
import type {
  Phase,
  PhaseProgress,
  ProfileSummary,
  ProgressState,
  StageKey,
  StoredCalculatedPlan,
} from '../../public/types/index.ts';

const PHASES: Phase[] = ['1', '2', '3', '4', '5', 'post'];
const STAGES: StageKey[] = ['1', '2', '3', '4', '5'];

// What profilePhases sent before #804: every phase's steps.
function everyPhase(plan: StoredCalculatedPlan, state: ProgressState): PhaseProgress[] {
  const milestoneOnly = milestoneOnlyPhases(plan).map(phase => ({ phase, done: 0, total: 0 }));
  return [...milestoneOnly, ...phaseProgress(plan, state.checks)!].map(entry => {
    const ids = planStepIds(plan, state, progressionData, entry.phase);
    return {
      ...entry,
      steps: { done: ids.filter(id => state.checks[id]).length, total: ids.length },
    };
  });
}

// A small seeded generator, so the profiles are the same on every run.
let seed = 804;
const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

// A profile on `plan` working on `working`: each phase's steps ticked at a share of 0, 50, 95 or
// 100%, a few removed steps, and personal tasks in random phases, some ticked.
function progress(plan: StoredCalculatedPlan, working: Phase, index: number): ProgressState {
  const state = initialState();
  state.settings.phase = working;
  for (const stage of STAGES) {
    const share = [0, 0.5, 0.95, 1][Math.floor(random() * 4)]!;
    for (const id of planStepIds(plan, { checks: {} }, progressionData, stage)) {
      if (random() < share) state.checks[id] = true;
      if (random() < 0.03) state.taskEdits.removed.push(id);
    }
  }
  for (let i = 0; i < 3; i++) {
    const id = `custom-${index}-${i}`;
    state.customTasks.push({ id, phase: PHASES[Math.floor(random() * 6)]!, title: 'Task' });
    if (random() < 0.5) state.checks[id] = true;
  }
  return state;
}

// Every card's label and segment fills, drawn from these summaries.
function cards(profiles: ProfileSummary[]) {
  page();
  open({ workspace: { saves: [{ id: 's', name: 'Save', activeProfile: 'p0', profiles }] } });
  go('profiles');
  render();
  return $$('[data-phase-bar]').map(bar => ({
    id: bar.dataset.phaseBar,
    label: bar.getAttribute('aria-label'),
    segments: [...bar.querySelectorAll<HTMLElement>('.phase-seg')].map(segment => [
      segment.dataset.phaseSeg,
      segment.className,
      (segment.firstElementChild as HTMLElement).style.width,
    ]),
  }));
}

test('every profile card reads as it did when the summary counted every phase', () => {
  const fromOne = generatedWith({ phase: '1' }),
    fromThree = generated();
  const guided: StoredCalculatedPlan = {
    ...structuredClone(fromThree),
    guide: {
      phases: Object.fromEntries(
        (['3', '5'] as const).map(phase => [
          phase,
          phaseSteps(fromThree, { checks: {} }, progressionData, phase).map(
            ({ id, title, body }) => ({ id, title, body }),
          ),
        ]),
      ),
    },
  };
  const cache = profilePhasesCache();
  const before: ProfileSummary[] = [],
    after: ProfileSummary[] = [],
    cached: ProfileSummary[] = [];
  let index = 0;
  for (const plan of [fromOne, fromThree, guided])
    for (const working of PHASES)
      for (let copy = 0; copy < 4; copy++, index++) {
        const state = progress(plan, working, index),
          id = 'p' + index;
        const card = (phases: PhaseProgress[] | undefined): ProfileSummary => ({
          id,
          kind: 'calculated',
          name: id,
          completed: 1,
          phase: working,
          phases,
        });
        before.push(card(everyPhase(plan, state)));
        after.push(card(profilePhases(plan, state, progressionData)));
        cached.push(card(cache(id, plan, structuredClone(state), progressionData)));
      }
  const drawn = cards(before);
  assert.equal(drawn.length, index, 'a bar per profile');
  assert.ok(
    drawn.some(card => /; Phase \d is/.test(card.label ?? '')),
    'some cards name an earlier phase still open',
  );
  assert.deepEqual(cards(after), drawn);
  assert.deepEqual(cards(cached), drawn);
  // And the card is not merely the same because nothing was shown.
  assert.ok($('[data-phase-bar]'));
});
