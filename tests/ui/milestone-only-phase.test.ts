// A profile made for a later phase offers the phases before it as milestone-only phases (#759, the
// owner's answer on #570): production is planned from the start phase on, and each earlier phase
// lists only the milestones that belong there (milestonePhase in progression.ts). While those are
// open the profile opens there (#570, phaseToOpen), like any earlier phase. Check keys stay
// `unlock-<id>`; nothing saved changes.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { phaseStepIds } from '../../public/app/opening-phase.ts';
import {
  calcStage,
  loadContext,
  phase,
  phaseOptions,
  progressionData,
  setHideDone,
  setOpenedPhase,
  setQuery,
  state,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { phaseTrack } from '../../public/app/views/phase-track.ts';
import { $, $$, applyUpdate, generated, go, open, page, stubFetch } from './setup.ts';
import type { ContextReply, Phase, StageKey, UpdateOp } from '../../public/types/index.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};

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
const entryOf = (id: string) => progressionData.entries.find(entry => 'unlock-' + entry.id === id);
const hubTiers = (phaseKey: StageKey) =>
  phaseStepIds(phaseKey)
    .map(entryOf)
    .filter(entry => entry && !entry.mam)
    .map(entry => entry!.tier);

test('a Phase 3 profile offers Phases 1 and 2 with only their milestones', () => {
  open({ calculated: phaseThreePlan(), phase: '3' });
  assert.deepEqual(phaseOptions(), ['1', '2', '3', '4', '5', 'post']);
  for (const phaseKey of ['1', '2'] as StageKey[]) {
    const ids = phaseStepIds(phaseKey);
    assert.ok(ids.length, 'Phase ' + phaseKey + ' has steps');
    assert.deepEqual(
      ids.filter(id => !id.startsWith('unlock-')),
      [],
      'Phase ' + phaseKey + ' has no production, storage, power, hard-drive or retirement step',
    );
  }
  assert.deepEqual([...new Set(hubTiers('1'))].sort(), [1, 2]);
  assert.deepEqual([...new Set(hubTiers('2'))].sort(), [3, 4]);
  assert.ok(
    hubTiers('3').every(tier => tier >= 5),
    'Phase 3 no longer shows a Tier 1-4 milestone',
  );
  const three = phaseStepIds('3');
  assert.ok(three.includes('calc-3-storage') && three.includes('startup-3-power-review'));
});

test('the phase track counts a milestone-only phase by its milestones', () => {
  const plan = phaseThreePlan();
  open({ calculated: plan, phase: '3' });
  const one = phaseStepIds('1'),
    checks = Object.fromEntries(one.slice(0, Math.ceil(one.length / 2)).map(id => [id, true]));
  open({ calculated: plan, phase: '3', state: { checks } });
  const track = phaseTrack();
  assert.deepEqual(
    track.map(segment => segment.phase),
    ['1', '2', '3', '4', '5', 'post'],
  );
  assert.equal(
    track[0]!.pct,
    Math.round((Object.keys(checks).length / one.length) * 100),
    'Phase 1 counts its ticked milestones',
  );
  assert.equal(track[1]!.pct, 0, 'Phase 2 has milestones, none ticked');
});

// Opens the profile through /api/context, as the app does, so phaseToOpen decides the phase.
async function openThrough(savedPhase: Phase, checks: Record<string, boolean>) {
  open();
  const reply: ContextReply = {
    save: { id: 's', name: 'Save' },
    profile: { id: 'p', kind: 'calculated', name: 'Started in Phase 3' },
    state: { ...structuredClone(state), settings: { phase: savedPhase }, checks, customTasks: [] },
    plan: phaseThreePlan(),
  };
  stubFetch({
    '/api/context': reply,
    '/api/update': (update: UpdateOp) => applyUpdate(update),
  });
  await loadContext('s', 'p');
  render();
  await settle();
}

test('the profile opens on Phase 1 while its milestones are open, then on Phase 2, then Phase 3', async () => {
  open({ calculated: phaseThreePlan(), phase: '3' });
  const one = phaseStepIds('1'),
    two = phaseStepIds('2');
  await openThrough('3', {});
  assert.equal(phase(), '1', 'open Phase 1 milestones hold Phase 1 open');
  assert.ok($('[data-opened-earlier]'), 'the build plan says why');
  await openThrough('3', Object.fromEntries(one.map(id => [id, true])));
  assert.equal(phase(), '2');
  await openThrough('3', Object.fromEntries([...one, ...two].map(id => [id, true])));
  assert.equal(phase(), '3', 'with them all ticked it opens on the saved phase');
  assert.equal(state.settings.phase, '3', 'the saved phase is not changed');
});

test('the Phase 1 build plan lists only its milestones, with no production around them', async () => {
  open({ calculated: phaseThreePlan(), phase: '3' });
  setOpenedPhase({ saved: '3', phase: '1' });
  go('plan');
  render();
  await settle();
  assert.equal(phase(), '1');
  assert.equal(calcStage(), undefined, 'no stage to build in Phase 1');
  const boxes = $$<HTMLInputElement>('#main input[data-check]').map(box => box.dataset.check!);
  assert.ok(boxes.length);
  assert.deepEqual(
    boxes.filter(id => !id.startsWith('unlock-')),
    [],
    'only milestone checkboxes',
  );
  assert.ok($('[data-milestone-only]'), 'the notice says why');
  assert.match($('[data-milestone-only]')!.textContent!, /from Phase 3 on/);
  assert.equal($('[data-plan-summary]'), null, 'no summary line of production');
  assert.equal($('#main [data-delivery]'), null, 'no elevator deliveries');
  assert.ok($('[data-milestone-intro]'));
  assert.equal($('x-evil'), null);
  // The draft warning reads a stage; a milestone-only phase is not a failed plan.
  assert.doesNotMatch($('#main')!.textContent!, /Planning draft/);
  assert.doesNotMatch($('#ada-line')?.textContent || '', /planning draft/i);
});

test('the factories and resources pages of a milestone-only phase say why they are empty', async () => {
  open({ calculated: phaseThreePlan(), phase: '1' });
  for (const view of ['factories', 'resources'] as const) {
    go(view);
    render();
    await settle();
    assert.ok($('#main [data-milestone-only]'), view + ' explains');
    assert.equal($('#main .card-top'), null, view + ' shows no production line');
    assert.equal($('#main [data-power-headroom]'), null, view + ' shows no power');
  }
  // The start phase still has them.
  open({ calculated: phaseThreePlan(), phase: '3' });
  go('factories');
  render();
  await settle();
  assert.equal($('#main [data-milestone-only]'), null);
  assert.ok($('#main .card-top'), 'Phase 3 lists its production lines');
});
