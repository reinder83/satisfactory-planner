// The belt cap (#1232, slice 9 of #1079): settings.beltCap, the best belt the plan may assume, Mk.2
// to Mk.5. Every phase's belt is lowered to it (phaseBelt in public/preferences/mining.ts), an
// owned belt's too, so with mining per phase (#1065) a node gives no more than the capped belt
// carries. It is an input, not a solve: no search, no draft of its own, so a cap at or above a
// phase's belt changes nothing there, and without mining per phase it changes no plan at all. It
// belongs to the plan snapshot, like ownedBelt: a plan without it, and every plan stored before
// it, calculates, loads, imports and exports exactly as before, in both editions.
import './helpers/en-us-numbers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { calculate, catalog, settings } from '../planner.ts';
import { equipmentWords, miningStep, ownedBeltsWords } from '../public/mining.ts';
import {
  BELT_CAP_MARKS,
  BELT_MARKS,
  beltCapMark,
  beltCapWords,
  phaseBelt,
  phaseMining,
} from '../public/preferences.ts';
import { initialState, validateState } from '../public/state.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { loadWorkspace } from '../server/persistence.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { settingsChanges } from '../public/app/profile-edit.ts';
import { draftAdvice } from '../public/app/draft-advice.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { browserProfile, dockerProfile, newSaveRequest } from './helpers/editions.ts';
import type {
  CurrentCalculatedPlan,
  SaveExport,
  StageKey,
  StoredCalculatedPlan,
  StoredStage,
} from '../public/types/index.ts';

const PHASES: StageKey[] = ['1', '2', '3', '4', '5'];
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
// A plan without the time it was made and its belt cap, which is all a cap that changes nothing
// may differ in.
const uncapped = (plan: CurrentCalculatedPlan | StoredCalculatedPlan) => {
  const { beltCap: _cap, ...rest } = plan.settings;
  return JSON.stringify({ ...plan, settings: rest, createdAt: '' });
};
const REFUSAL = 'Choose the best belt the plan may use: Mk.2 to Mk.5, or no cap.';

test('settings keep Mk.2 to Mk.5 as the belt cap and refuse anything else', () => {
  for (const mark of BELT_CAP_MARKS) assert.equal(settings({ beltCap: mark }).beltCap, mark);
  assert.deepEqual([...BELT_CAP_MARKS], [2, 3, 4, 5]);
  for (const absent of [undefined, null])
    assert.equal('beltCap' in settings({ beltCap: absent }), false, String(absent));
  assert.equal('beltCap' in settings({}), false, 'absent unless chosen');
  for (const wrong of [0, 1, 6, 7, 4.5, '4', 'Mk.4', [4], { mark: 4 }, Number.NaN])
    assert.throws(
      () => settings({ beltCap: wrong }),
      (error: Error & { status?: number }) => error.status === 400 && error.message === REFUSAL,
      JSON.stringify(wrong),
    );
});

test('a belt cap lowers each phase to it, never raises one, and wins over an owned belt', () => {
  assert.equal(phaseBelt(5, undefined, 4).mark, 'Mk.4');
  assert.equal(phaseBelt(4, undefined, 3).mark, 'Mk.3');
  assert.equal(phaseBelt(2, undefined, 5).mark, 'Mk.3', 'never raises a phase');
  assert.equal(phaseBelt(1, undefined, 2).mark, 'Mk.2');
  assert.equal(phaseBelt(2, 6, 4).mark, 'Mk.4', 'the cap wins over an owned belt');
  assert.equal(phaseBelt(2, 4, 5).mark, 'Mk.4', 'an owned belt under the cap still raises');
  for (const ignored of [undefined, 1, 6, 7])
    for (const phase of [1, 2, 3, 4, 5])
      assert.equal(phaseBelt(phase, undefined, ignored), phaseBelt(phase), String(ignored));
  assert.equal(beltCapMark(4), BELT_MARKS[3]);
  assert.equal(beltCapMark(6), undefined);
  assert.equal(beltCapWords(4), 'belts up to Mk.4 (480/min)');
  assert.equal(beltCapWords(undefined), '');
  // The mining warning's words: the phases' belts and why.
  assert.equal(
    ownedBeltsWords(2, undefined, 4),
    'Mk.3 belts in Phase 2 and Mk.4 in Phases 3, 4 and 5, no better than the Mk.4 belts your belt cap allows',
  );
  assert.equal(
    ownedBeltsWords(2, 5, 4),
    'Mk.4 belts in Phases 2, 3, 4 and 5, at least the Mk.4 belts you already have and no better than the Mk.4 belts your belt cap allows',
  );
  assert.equal(
    ownedBeltsWords(2, 4),
    'Mk.4 belts in Phases 2 and 3, Mk.5 in Phase 4 and Mk.6 in Phase 5, at least the Mk.4 belts you already have',
    'as before without a cap',
  );
  assert.equal(
    ownedBeltsWords(2, undefined, 5),
    'Mk.3 belts in Phase 2, Mk.4 in Phase 3 and Mk.5 in Phases 4 and 5, no better than the Mk.5 belts your belt cap allows',
  );
  assert.equal(ownedBeltsWords(1, undefined, 2).endsWith('your belt cap allows'), true);
  assert.equal(ownedBeltsWords(2), '', 'none without either');
});

// Phase 4's Miner Mk.3 at 250% gives a pure node 1,200/min: on Phase 4's Mk.5 belts 780, under a
// Mk.4 cap 480 (the 34,290 and 53,940 of tests/owned-belt.test.ts are Phase 2's Mk.3 and Mk.4).
test('a plan with a belt cap mines the capped phases on it; the phases before, as before', () => {
  const limits = settings({ phase: '2' }).limits;
  const free = phaseMining({ limits }, 4),
    capped = phaseMining({ limits, beltCap: 4 }, 4);
  assert.deepEqual(free.belt, { mark: 'Mk.5', cap: 780 });
  assert.deepEqual(capped.belt, { mark: 'Mk.4', cap: 480 });
  assert.equal(capped.budgets['Iron Ore'], 53940);
  assert.ok(free.budgets['Iron Ore']! > capped.budgets['Iron Ore']!);
  assert.equal(capped.budgets['Water'], free.budgets['Water'], 'Water keeps its allowance');
  assert.deepEqual(phaseMining({ limits, beltCap: 5 }, 4), free, 'a cap at its belt: nothing');

  const plain = calculate({ phase: '2', phaseMining: true });
  const plan = calculate({ phase: '2', phaseMining: true, beltCap: 4 });
  assert.equal(plan.settings.beltCap, 4);
  assert.deepEqual(
    PHASES.map(phase => plan.stages[phase].mining!.belt.mark),
    ['Mk.2', 'Mk.3', 'Mk.4', 'Mk.4', 'Mk.4'],
  );
  for (const phase of ['1', '2', '3'] as const)
    assert.equal(JSON.stringify(plan.stages[phase]), JSON.stringify(plain.stages[phase]), phase);
  assert.equal(plan.stages['4'].mining!.budgets['Iron Ore'], 53940);
  for (const phase of ['4', '5'] as const) assert.ok(plan.stages[phase].feasible, phase);
  const words = plan.warnings.find(warning => warning.startsWith("Each phase's resource budgets"));
  assert.match(
    words!,
    /; Mk\.3 belts in Phase 2 and Mk\.4 in Phases 3, 4 and 5, no better than the Mk\.4 belts your belt cap allows\):/,
  );
  assert.doesNotMatch(plain.warnings.join(' '), /belt cap/);
});

test('without a cap, or without mining per phase, every plan is the plan it was', () => {
  for (const base of [
    { phase: '2', phaseMining: true },
    { phase: '3', recipes: 'all', wholeMachines: true },
  ]) {
    const plain = calculate(base);
    for (const absent of [undefined, null]) {
      const again = calculate({ ...base, beltCap: absent });
      assert.equal('beltCap' in again.settings, false);
      assert.equal(uncapped(again), uncapped(plain));
    }
  }
  // Without mining per phase the planner reads no belt.
  const plain = calculate({ phase: '3', recipes: 'all' });
  for (const beltCap of BELT_CAP_MARKS)
    assert.equal(uncapped(calculate({ phase: '3', recipes: 'all', beltCap })), uncapped(plain));
});

// Over many settings: start phases, owned belts and miners, overclocking, alternates, goals, whole
// machines, a node survey with a miner of its own. For every cap:
//   no phase plans its nodes on a belt above the cap, nor gets more of any budget than without it;
//   the phases before the first one the cap lowers are their plan without it, byte for byte;
//   a plan the cap lowers nowhere (no mining per phase) is the plan without it, byte for byte.
const survey = {
  mark: 2,
  clock: 2.5,
  nodes: { 'Iron Ore': { impure: 10, normal: 20, pure: 15 }, Limestone: { normal: 30, pure: 10 } },
};
const SETTINGS: object[] = [
  { phase: '1', phaseMining: true },
  { phase: '2', phaseMining: true, ownedBelt: 5 },
  { phase: '2', phaseMining: true, ownedMiner: 3, ownedBelt: 4, overclock: true },
  { phase: '3', phaseMining: true, recipes: 'all' },
  { phase: '3', phaseMining: true, wholeMachines: true },
  { phase: '3', phaseMining: true, goal: 'minimal' },
  { phase: '4', phaseMining: true, ownedBelt: 6 },
  { phase: '4', phaseMining: true, goal: 'timed', hours: 4 },
  { phase: '5', phaseMining: true, recipes: 'all', wholeMachines: true },
  { phase: '2', phaseMining: true, extraction: survey },
  { phase: '3', phaseMining: true, phaseTime: 'final' },
  { phase: '2' },
  { phase: '4', recipes: 'all', wholeMachines: true },
];
const budgetsOf = (stage: StoredStage) => stage.mining?.budgets ?? {};

test('property: no phase plans above the cap, and what the cap does not lower stays as it was', () => {
  for (const base of SETTINGS) {
    const plain = calculate(base);
    const config = settings(base);
    for (const beltCap of BELT_CAP_MARKS) {
      const label = JSON.stringify({ ...base, beltCap });
      const plan = calculate({ ...base, beltCap });
      const most = beltCapMark(beltCap)!;
      const lowered = PHASES.filter(
        phase => !!config.phaseMining && phaseBelt(Number(phase), config.ownedBelt).cap > most.cap,
      );
      for (const phase of PHASES) {
        const stage = plan.stages[phase];
        if (!stage.mining) continue;
        assert.ok(stage.mining.belt.cap <= most.cap, `${label} Phase ${phase} belt`);
        for (const [resource, budget] of Object.entries(budgetsOf(stage)))
          assert.ok(
            budget <= (budgetsOf(plain.stages[phase])[resource] ?? 0) + 1e-6,
            `${label} Phase ${phase} ${resource} budget`,
          );
      }
      if (!lowered.length) {
        assert.equal(uncapped(plan), uncapped(plain), `${label}: lowered nowhere`);
        continue;
      }
      // Phases are planned in order; a later target time re-solves earlier phases (`final`).
      if ((config.phaseTime ?? 'every') !== 'every') continue;
      for (const phase of PHASES.filter(phase => phase < lowered[0]!))
        assert.equal(
          JSON.stringify(plan.stages[phase]),
          JSON.stringify(plain.stages[phase]),
          `${label} Phase ${phase}, before the first phase the cap lowers`,
        );
    }
  }
});

test('Review names a change of the belt cap, absent as no cap', () => {
  const change = (before: object, after: object) =>
    settingsChanges(before, after, []).changes.filter(
      entry => entry.label === 'Best belt the plan may use',
    );
  assert.deepEqual(change({}, { beltCap: 4 }), [
    { label: 'Best belt the plan may use', before: 'No cap', after: 'Mk.4 belts' },
  ]);
  assert.deepEqual(change({ beltCap: 3 }, {}), [
    { label: 'Best belt the plan may use', before: 'Mk.3 belts', after: 'No cap' },
  ]);
  assert.deepEqual(change({ beltCap: 4 }, { beltCap: 4 }), []);
  assert.equal(settingsChanges({}, { beltCap: 4 }, []).others, 0, 'named once');
});

// A stage the cap held to Mk.3 belts in Phase 4, made a draft short of `short`.
let heldStage: StoredStage | undefined;
const shortStage = (short: string): StoredStage => {
  heldStage ??= json(calculate({ phase: '2', phaseMining: true, beltCap: 3 }).stages['4']);
  return {
    ...structuredClone(heldStage),
    feasible: false,
    shortfalls: [{ name: short, needed: 40000, budget: 34290 }],
  };
};

test('a draft the cap runs short offers raising or clearing the belt cap', () => {
  const lever = (stage: StoredStage, extra: object, phase = 4) =>
    draftAdvice(stage, { phaseMining: true, ...extra }, { phase }).levers.find(
      entry => entry.id === 'beltCap',
    );
  assert.deepEqual(lever(shortStage('Iron Ore'), { beltCap: 3 }), {
    id: 'beltCap',
    text: 'Raise or clear the belt cap (Goals): this phase taps its nodes on Mk.3 belts (270/min), where Mk.5 belts (780/min) would let each node give more.',
    step: 3,
    label: 'Change the belt cap in Edit settings →',
  });
  assert.equal(lever(shortStage('Iron Ore'), {}), undefined, 'no cap, no lever');
  assert.equal(lever(shortStage('Water'), { beltCap: 3 }), undefined, 'Water rides no belt');
  assert.equal(lever(shortStage('Crude Oil'), { beltCap: 3 }), undefined, 'oil rides pipes');
  assert.equal(
    lever(shortStage('Iron Ore'), { beltCap: 3 }, 2),
    undefined,
    'a phase the cap does not lower',
  );
});

// A full export of one save holding `plan`.
const exported = (plan: StoredCalculatedPlan): SaveExport => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt: '2026-10-24T08:00:00.000Z',
  saves: [
    {
      id: 's1',
      name: 'World',
      activeProfile: 'p1',
      profiles: [{ id: 'p1', name: 'Stored', kind: 'calculated', plan, state: initialState() }],
    },
  ],
});
const before = (
  JSON.parse(
    fs.readFileSync(new URL('./fixtures/plan-before-1065.json', import.meta.url), 'utf8'),
  ) as { plan: StoredCalculatedPlan }
).plan;
const cappedPlan = (): StoredCalculatedPlan =>
  json(calculate({ phase: '2', phaseMining: true, beltCap: 3 }));

test('migration: plans stored before the cap recalculate unchanged, without one', () => {
  assert.equal('beltCap' in before.settings, false);
  assert.equal('beltCap' in settings(before.settings), false);
  assert.equal(JSON.stringify(calculate(before.settings).stages), JSON.stringify(before.stages));
});

test('migration: plans with and without the cap load, import and export unchanged (Docker)', async () => {
  for (const plan of [before, cappedPlan()]) {
    const file = exported(plan);
    const checked = validateTransfer(json(file)).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(checked), JSON.stringify(plan));
    const imported = (await importableTransfer(json(file))).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(imported), JSON.stringify(plan));
    assert.equal('beltCap' in settings(plan.settings), 'beltCap' in plan.settings);
    const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-belt-cap-'));
    try {
      const workspace = await loadWorkspace(dataDir, validateState);
      workspace.saves.push({
        id: 's1',
        name: 'World',
        userId: 'owner',
        activeProfile: 'p1',
        profiles: [{ id: 'p1', name: 'Stored', kind: 'calculated', plan, state: initialState() }],
      });
      await fsp.writeFile(path.join(dataDir, 'workspace.json'), JSON.stringify(workspace));
      const loaded = await loadWorkspace(dataDir, validateState);
      assert.equal(JSON.stringify(loaded.saves[0]!.profiles[0]!.plan), JSON.stringify(plan));
    } finally {
      await fsp.rm(dataDir, { recursive: true, force: true });
    }
  }
  // A stored capped plan recalculated with its own settings is the plan it was.
  const plan = cappedPlan();
  assert.deepEqual(json(calculate(plan.settings).stages), plan.stages);
});

test('migration: the browser edition keeps the plans unchanged across a reload', async () => {
  const records = new Map<string, unknown>();
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
    );
  const plans = [before, cappedPlan()];
  let api = open();
  for (const plan of plans)
    await api('/api/import-saves', { body: JSON.stringify(exported(plan)) });
  api = open();
  const out = (await api('/api/export-saves')) as SaveExport;
  assert.deepEqual(
    out.saves.map(save => JSON.stringify(save.profiles[0]!.plan)),
    plans.map(plan => JSON.stringify(plan)),
  );
});

// The Docker server's answer to Create profile with `body`: its status and message.
async function dockerRefusal(body: object): Promise<{ status: number; text: string }> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-belt-cap-'));
  const server: Server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    const reply = await fetch(url + '/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      body: JSON.stringify(body),
    });
    return { status: reply.status, text: await reply.text() };
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test('both editions create the same plan from the same request, and refuse an invalid cap', async () => {
  const body = newSaveRequest({ phase: '2', phaseMining: true, beltCap: 3 });
  const docker = await dockerProfile(body),
    browser = await browserProfile(body);
  assert.equal(docker.plan!.settings.beltCap, 3);
  assert.equal(JSON.stringify(browser.plan!.settings), JSON.stringify(docker.plan!.settings));
  assert.equal(JSON.stringify(browser.plan!.stages), JSON.stringify(docker.plan!.stages));
  assert.equal(docker.plan!.stages['5'].mining!.belt.mark, 'Mk.3');
  for (const beltCap of [6, 'Mk.4', 1.5]) {
    const wrong = newSaveRequest({ phase: '2', beltCap });
    const refused = await dockerRefusal(wrong);
    assert.equal(refused.status, 400, JSON.stringify(beltCap));
    assert.ok(refused.text.includes(REFUSAL), refused.text);
    await assert.rejects(browserProfile(wrong), (error: Error & { status?: number }) => {
      assert.equal(error.message, REFUSAL);
      assert.equal(error.status, 400);
      return true;
    });
  }
});

test('under a low belt cap the mining step names the clock the belt allows, not 250% (#1020)', () => {
  const words = (beltCap?: number) => {
    const config = { ...settings({ phase: '3', phaseMining: true }), ...(beltCap ? { beltCap } : {}) };
    const stage = { mining: phaseMining(config, 4), raw: { 'Iron Ore': 900 } };
    return { equipment: equipmentWords(stage.mining), body: miningStep(stage, '4', config)!.body };
  };
  // Mk.2 belts carry 120/min: an impure node, the poorest, gives that at 100%.
  const low = words(2);
  assert.match(low.equipment, /^Miner Mk\.3 at up to 100% \(what a Mk\.2 belt carries\) · Mk\.2 belts/);
  assert.match(low.body, /^Phase 4 mines with Miner Mk\.3 at up to 100% \(what a Mk\.2 belt carries\) and carries on Mk\.2 belts/);
  assert.doesNotMatch(low.body, /250%/);
  assert.match(words(3).equipment, /^Miner Mk\.3 at up to 225% \(what a Mk\.3 belt carries\)/);
  // A belt that carries an impure node at 250%: the phase's clock, as before.
  assert.match(words(4).equipment, /^Miner Mk\.3 at 250% · Mk\.4 belts/);
  assert.match(words().equipment, /^Miner Mk\.3 at 250% · Mk\.5 belts/);
});
