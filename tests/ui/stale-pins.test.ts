// Pins on a recipe the game data no longer has, on the pages (#1271): the build plan's notices name
// a Power Shard or somersloop pin a recalculation drops instead of offering it as a change, a
// notice with nothing else to change is not shown, and the recalculation the user starts leaves
// those pins out, so it no longer fails with "Invalid line clocks." / "Invalid somersloop pins.".
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { setBeginnerMode } from '../../public/app/beginner.ts';
import { calculated, setWizard, state, workspace } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import {
  $,
  answerConfirms,
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
  ProgressState,
  StoredCalculatedPlan,
} from '../../public/types/index.ts';

const BASE = {
  phase: '3',
  recipes: 'standard',
  somersloops: 40,
  amplifySloops: 20,
  wholeMachines: true,
  storageFromSurplus: true,
};
const ROD = 'Recipe_IronRod_C';
const GONE = 'Recipe_RemovedByAnUpdate_C';
let cache: CurrentCalculatedPlan | undefined;
const plainPlan = () => structuredClone((cache ??= generatedWith(BASE)));
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
function openPlan(progress: Partial<ProgressState>) {
  page();
  open({ calculated: plainPlan(), phase: '3', workspace: { catalog: catalog() }, state: progress });
  go('plan');
  render();
}

beforeEach(() => {
  setWizard(null);
  setBeginnerMode(false);
});

test('the notice names a stale Power Shard pin, and the recalculation leaves it out', async () => {
  openPlan({
    version: 26,
    lineClocks: { '3': { [ROD]: 250, [GONE]: 200 } },
    sloopPins: { '3': { [GONE]: 2 } },
  });
  await settle();
  assert.match(
    text('[data-shard-pins-recalc]'),
    /Power Shard pins changed: Iron Rod \(Phase 3\): 250% with 3 Power Shards in each machine\. Nothing changes/,
  );
  assert.equal(
    text('[data-shard-pins-stale]'),
    `A recalculation drops the Power Shard pin on ${GONE} in Phase 3, because this planner has no such recipe any more.`,
  );
  assert.equal($('[data-sloop-pins-recalc]'), null, 'stale somersloop pins alone offer nothing');
  assert.match(adaSays('shard-pins-pending'), /^You pinned the Power Shards of 1 production line/);
  assert.equal(adaSays('sloop-pins-pending'), '');
  let sent: { settings: StoredCalculatedPlan['settings'] } | undefined;
  let next: StoredCalculatedPlan | undefined;
  stubFetch({
    '/api/recalculate': (body: typeof sent) => {
      sent = body;
      // The planner itself: it refuses a pin on a recipe it does not have.
      next = generatedWith(body!.settings);
      return {
        saveId: 's',
        profileId: 'p',
        backupId: 'b',
        reviewCount: 0,
        carriedChecks: 0,
        workspace,
      };
    },
    '/api/context': () => ({
      save: { id: 's', name: 'World' },
      profile: { id: 'p', kind: 'calculated', name: evil },
      state: { ...state, lineClocks: undefined, sloopPins: undefined },
      plan: next,
    }),
  });
  answerConfirms(true);
  $<HTMLButtonElement>('[data-recalc-shard-pins]')!.click();
  await settle();
  await settle();
  assert.deepEqual(sent?.settings.lineClocks, { '3': { [ROD]: 250 } });
  assert.equal(sent && 'sloopPins' in sent.settings, false);
  assert.deepEqual(calculated?.settings.lineClocks, { '3': { [ROD]: 250 } }, 'its new plan');
  assert.equal($('[data-shard-pins-recalc]'), null);
});

test('the somersloop notice names a stale pin too; stale pins alone show no notice', async () => {
  openPlan({ version: 26, sloopPins: { '3': { [ROD]: 4, [GONE]: 2 } } });
  await settle();
  assert.match(
    text('[data-sloop-pins-asked]'),
    /^Somersloop pins changed: Iron Rod \(Phase 3\): 4/,
  );
  assert.equal(
    text('[data-sloop-pins-stale]'),
    `A recalculation drops the somersloop pin on ${GONE} in Phase 3, because this planner has no such recipe any more, or its machine can no longer take somersloops.`,
  );
  let sent: { settings: StoredCalculatedPlan['settings'] } | undefined;
  stubFetch({
    '/api/recalculate': (body: typeof sent) => {
      sent = body;
      throw Object.assign(new Error('stop here'), { status: 500 });
    },
  });
  answerConfirms(true);
  $<HTMLButtonElement>('[data-recalc-sloop-pins]')!.click();
  await settle();
  await settle();
  assert.deepEqual(sent?.settings.sloopPins, { '3': { [ROD]: 4 } });
  // Nothing but stale pins: no recalculation is offered for them.
  openPlan({
    version: 26,
    lineClocks: { '3': { [GONE]: 200 } },
    sloopPins: { '3': { [GONE]: 2 } },
  });
  await settle();
  assert.equal($('[data-shard-pins-recalc]'), null);
  assert.equal($('[data-sloop-pins-recalc]'), null);
});
