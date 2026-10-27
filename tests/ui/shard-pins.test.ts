// Power Shard pins on the pages (#1239, slice 2): "Power Shards on this line" in a production line's
// dialog saves a clock without recalculating, the build plan's notice offers "Recalculate in place
// with Power Shard pins", every other recalculation offer and Edit settings carry the pins, the
// cards, the dialog and the build step show a clocked line's clock and shards, and ADA follows the
// pending pins and any clock the plan could not keep.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { setBeginnerMode } from '../../public/app/beginner.ts';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { calculated, draft, setWizard, state, workspace } from '../../public/app/session.ts';
import { startEdit } from '../../public/app/wizard/wizard.ts';
import { render } from '../../public/app/shell.ts';
import { machineSetup } from '../../public/app/views/calculated.ts';
import { machineCounts, machineLine } from '../../public/app/views/factories.ts';
import { machineClockWords } from '../../public/app/flow.ts';
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
import type {
  CurrentCalculatedPlan,
  StageKey,
  StoredCalculatedPlan,
  UpdateOp,
} from '../../public/types/index.ts';

const BASE = { phase: '3', recipes: 'standard', wholeMachines: true, storageFromSurplus: true };
const ROD = 'Recipe_IronRod_C';
let cache: CurrentCalculatedPlan | undefined;
const plainPlan = () => structuredClone((cache ??= generatedWith(BASE)));
let clockedCache: CurrentCalculatedPlan | undefined;
const clockedPlan = () =>
  structuredClone(
    (clockedCache ??= generatedWith({ ...BASE, lineClocks: { '3': { [ROD]: 250 } } })),
  );
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
function openPlan(plan: StoredCalculatedPlan = plainPlan(), progress = {}, phase: StageKey = '3') {
  page();
  open({ calculated: plan, phase, workspace: { catalog: catalog() }, state: progress });
  go('plan');
  render();
}

beforeEach(() => {
  setWizard(null);
  setBeginnerMode(false);
});
afterEach(() => setBeginnerMode(false));

test('a line’s dialog pins its Power Shards without recalculating; the plan asks for one', async () => {
  const plan = plainPlan();
  openPlan(plan);
  const sent: UpdateOp[] = [];
  stubFetch<UpdateOp>({
    '/api/update': (update: UpdateOp) => {
      sent.push(update);
      return applyUpdate(update);
    },
  });
  openCalculatedFactory(ROD);
  await settle();
  const field = $<HTMLSelectElement>(`[data-shard-pin="${ROD}"]`)!;
  assert.ok(field, 'the dialog offers the pin');
  const label = $(`label[for="${field.id}"]`)!;
  assert.equal(label.textContent!.trim(), 'Run every machine at');
  assert.equal(field.getAttribute('aria-describedby'), 'shard-pin-note-' + ROD);
  assert.deepEqual(
    [...field.options].map(option => [option.value, option.textContent!.trim()]),
    [
      ['', '100% · no Power Shards'],
      ['150', '150% · 1 Power Shard in each machine'],
      ['200', '200% · 2 Power Shards in each machine'],
      ['250', '250% · 3 Power Shards in each machine'],
    ],
  );
  assert.equal(field.value, '');
  assert.match(
    text('[data-shard-pin-now]'),
    /^This plan runs this line at 100%: \d+ Constructors, no Power Shards\.$/,
  );
  assert.match(text('[data-shard-pin-note]'), /^The planner runs this line at 100%\./);
  const before = JSON.stringify(calculated);
  field.value = '250';
  $<HTMLButtonElement>('[data-shard-pin-save]')!.click();
  await settle();
  assert.deepEqual(sent, [{ type: 'lineClocks', value: { '3': { [ROD]: 250 } } }]);
  assert.deepEqual(state.lineClocks, { '3': { [ROD]: 250 } });
  assert.equal(state.version, 26);
  assert.equal(JSON.stringify(calculated), before, 'the plan is not recalculated');
  assert.match(
    text('[data-shard-pin-note]'),
    /^Saved: 250% with 3 Power Shards in each machine after a recalculation\./,
  );
  // The build plan says what a recalculation would change, and so does ADA.
  assert.match(
    text('[data-shard-pins-recalc]'),
    /This plan needs a recalculation\. Power Shard pins changed: Iron Rod \(Phase 3\): 250% with 3 Power Shards in each machine\. Nothing changes until you start it\./,
  );
  assert.match(adaSays('shard-pins-pending'), /^You pinned the Power Shards of 1 production line/);
  go('factories');
  render();
  await settle();
  assert.ok($('[data-shard-pins-recalc]'), 'the Factories page has the notice too');
  // Back to 100%: the saved map is forgotten, nothing to recalculate, the state's version as before.
  openCalculatedFactory(ROD);
  await settle();
  $<HTMLSelectElement>(`[data-shard-pin="${ROD}"]`)!.value = '';
  $<HTMLButtonElement>('[data-shard-pin-save]')!.click();
  await settle();
  assert.deepEqual(sent.at(-1), { type: 'lineClocks', value: null });
  assert.equal('lineClocks' in state, false);
  assert.equal($('[data-shard-pins-recalc]'), null);
});

test('the pin is not offered in Phase 1 without overclocking, nor for beginners or generators', async () => {
  const plan = plainPlan();
  setBeginnerMode(true);
  openPlan(plan);
  openCalculatedFactory(ROD);
  await settle();
  assert.equal($('[data-shard-pin-choice]'), null, 'not in New to Satisfactory mode');
  setBeginnerMode(false);
  const generator = plan.stages['3'].rows!.find(row => row.power < 0)!;
  openPlan(plan);
  openCalculatedFactory(generator.id);
  await settle();
  assert.equal($('[data-shard-pin-choice]'), null, 'a generator line');
  const early = generatedWith({ ...BASE, phase: '1' });
  openPlan(early, {}, '1');
  const constructor = early.stages['1'].rows!.find(row => row.machine === 'Constructor')!;
  openCalculatedFactory(constructor.id);
  await settle();
  assert.equal($('[data-shard-pin-choice]'), null, 'Phase 1 cannot overclock yet');
});

test('a clocked line shows its clock and shards on the card, in the dialog and in its step', async () => {
  const plan = clockedPlan();
  const rod = plan.stages['3'].rows!.find(row => row.id === ROD)!;
  assert.equal(rod.clock, 250);
  openPlan(plan);
  await settle();
  // The build step says what to insert, and the Power Shards research comes first.
  const step = text(`[data-task="calc-3-${ROD}"]`);
  assert.match(
    step,
    new RegExp(
      `Insert 3 Power Shards in each machine — ${rod.shards} in total — to run it at 250%`,
    ),
  );
  assert.ok(
    $$('[data-task]').some(node =>
      /Research Power Shards before building the overclocked lines/.test(node.textContent || ''),
    ),
    'the research step is listed',
  );
  openCalculatedFactory(ROD);
  await settle();
  assert.match(
    text('[data-shard-pin-now]'),
    new RegExp(
      `^This plan runs this line at 250%: ${rod.machines} Constructors with 3 Power Shards each, ${rod.shards} Power Shards in all\\.$`,
    ),
  );
  assert.equal($<HTMLSelectElement>(`[data-shard-pin="${ROD}"]`)!.value, '250');
  assert.equal(
    text('[data-shard-pin-note]'),
    'Pinned to 250% with 3 Power Shards in each machine: the plan keeps it exactly.',
  );
  assert.ok(
    $$('.machine-cells dt').some(node => node.textContent === 'At 250%'),
    'the full machines’ cell names the clock',
  );
  go('factories');
  render();
  await settle();
  assert.ok(
    $$('.factory-card').some(node =>
      (node.textContent || '').includes(`${rod.machines} × Constructor at 250%`),
    ),
    'the card names the clock',
  );
  // The helpers: a full line, an exact plan's last machine at the remainder, a line at 100%.
  const setup = machineSetup(rod);
  assert.equal(setup.full, 250);
  assert.match(setup.summary, / at 250% \(no underclock needed\)\.$/);
  assert.deepEqual(machineCounts(rod.machines, 250, 250), {
    total: rod.machines,
    full: rod.machines,
    adjustable: 0,
    fullClock: '250',
  });
  const exact = { ...rod, equivalent: rod.machines - 0.5, lastClock: 125 };
  const partial = machineSetup(exact);
  assert.equal(partial.clock, 125);
  assert.match(partial.summary, / at 250% \+ 1 adjustable machine\.$/);
  assert.equal(
    machineLine(rod.machines, rod.machine, 125, 250),
    `${rod.machines} × Constructor at 250% · last at 125%`,
  );
  assert.equal(machineClockWords(exact), `${rod.machines - 1} at 250% + 1 at 125%`);
  const unclocked = plainPlan().stages['3'].rows!.find(row => row.id === ROD)!;
  assert.equal(machineSetup(unclocked).full, 100);
  assert.equal(machineLine(4, 'Constructor'), '4 × Constructor');
  assert.deepEqual(machineCounts(4, 100), { total: 4, full: 4, adjustable: 0 });
  assert.equal(machineClockWords(unclocked).endsWith('at 100%'), true);
});

test('“Recalculate in place with Power Shard pins” recalculates in place with the clocks', async () => {
  const plan = plainPlan();
  openPlan(plan, { version: 26, lineClocks: { '3': { [ROD]: 250 } } });
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
      state: { ...state, lineClocks: undefined, version: 1 },
      plan: next,
    }),
  });
  const asked = answerConfirms(true);
  $<HTMLButtonElement>('[data-recalc-shard-pins]')!.click();
  await settle();
  await settle();
  assert.equal(asked.length, 1, 'it asks first');
  assert.match(asked[0]!, /with the Power Shard pins you chose/);
  assert.deepEqual(sent!.settings.lineClocks, { '3': { [ROD]: 250 } });
  assert.equal(sent!.planCreatedAt, plan.createdAt);
  assert.deepEqual(
    calculated?.settings.lineClocks,
    { '3': { [ROD]: 250 } },
    'its new plan is open',
  );
  assert.equal($('[data-shard-pins-recalc]'), null, 'and needs no recalculation');
  assert.equal(calculated!.stages['3']!.rows!.find(row => row.id === ROD)!.clock, 250);
});

test('another recalculation offer carries the Power Shard pins asked for', async () => {
  // The somersloop pins' offer: it sends the Power Shard pins too, so it never drops them.
  const plan = generatedWith({ ...BASE, somersloops: 40, amplifySloops: 20 });
  openPlan(plan, {
    version: 26,
    sloopPins: { '3': { [ROD]: 4 } },
    lineClocks: { '3': { Recipe_Screw_C: 200 } },
  });
  await settle();
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
  assert.deepEqual(sent?.settings.lineClocks, { '3': { Recipe_Screw_C: 200 } });
});

test('a clock the plan could not keep is reported in the dialog and by ADA', async () => {
  const dropped = generatedWith({
    ...BASE,
    lineClocks: { '3': { [ROD]: 250 } },
    lineShardBudget: 1,
  });
  openPlan(dropped);
  await settle();
  assert.match(
    adaSays('shard-pins-dropped'),
    /^This plan could not keep the Power Shards you pinned on Iron Rod in Phase 3, so it runs that line at 100%\./,
  );
  openCalculatedFactory(ROD);
  await settle();
  assert.match(
    text('[data-shard-pin-note]'),
    /^Pinned to 250% with 3 Power Shards in each machine, but Phase 3 could not keep the pin: the phase’s overclocked production lines would hold more than the 1 Power Shard this plan allows them\. The phase runs the line at 100%\. Lower or clear this pin here/,
  );
  assert.match(text('[data-shard-pin-now]'), /^This plan runs this line at 100%/);
});

test('Edit settings starts from the Power Shard pins asked for, and Review names them', async () => {
  const plan = plainPlan();
  openPlan(plan, { version: 26, lineClocks: { '3': { [ROD]: 200 } } });
  await settle();
  stubFetch({});
  await startEdit('s', 'p');
  assert.deepEqual(draft().settings.lineClocks, { '3': { [ROD]: 200 } });
  // Without a choice, the plan's own clocks.
  setWizard(null);
  const pinned = { ...plan, settings: { ...plan.settings, lineClocks: { '3': { [ROD]: 150 } } } };
  openPlan(pinned);
  await settle();
  await startEdit('s', 'p');
  assert.deepEqual(draft().settings.lineClocks, { '3': { [ROD]: 150 } });
  setWizard(null);
});
