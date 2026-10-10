// "Ticks keep it current" (#1068): what the ticks show the player already has beyond the plan's
// "What you already have" settings (ownedFromTicks in public/app/owned-ticks.ts), on real plans.
// A better miner or belt counts only from its HUB milestone's `unlock-` tick and only where it
// betters the working phase's own mark under mining per phase; a hard-drive alternate from its
// `recipe-unlock-` tick only when the plan's recipe pool does not hold it; generators from their
// lines marked running only where some phase from the working phase on runs fewer. The plan's
// settings raised to it (withOwnedFound) are what the build plan's offer and Edit settings send,
// and both editions recalculate the profile in place with them, keeping a backup, after which the
// ticks show nothing more. A dismissal (kept in the browser, foundSince and dismissedFound) hides
// the notice until something new is found. The notice and Edit settings are tested in
// tests/ui/owned-ticks.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { calculate, catalog, settings } from '../planner.ts';
import {
  dismissedFound,
  foundList,
  foundSince,
  foundWords,
  ownedFromTicks,
  ticksPhase,
  withOwnedFound,
  type OwnedFound,
} from '../public/app/owned-ticks.ts';
import { settingsChanges } from '../public/app/profile-edit.ts';
import type {
  BrowserWorkspace,
  ContextReply,
  CurrentCalculatedPlan,
  StoredCalculatedPlan,
  StoredProfile,
  WorkspaceFile,
} from '../public/types/index.ts';

const alternates = catalog().alternates;
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// HUB milestones: Miner Mk.2 (Tier 4, Phase 2), Miner Mk.3 (Tier 8, Phase 4), and the belts Mk.3
// (Tier 4, Phase 2), Mk.4 (Tier 5, Phase 3), Mk.5 (Tier 7, Phase 4) and Mk.6 (Tier 9, Phase 5).
const MINER_MK2 = 'unlock-Schematic_4-1_C',
  MINER_MK3 = 'unlock-Schematic_8-4_C',
  BELT_MK3 = 'unlock-Schematic_5-3_C',
  BELT_MK4 = 'unlock-Schematic_6-1_C',
  BELT_MK5 = 'unlock-Schematic_7-2_C',
  BELT_MK6 = 'unlock-Schematic_9-5_C';
// Cast Screws, a hard-drive alternate; Turbofuel, which a MAM node unlocks; Pure Iron Ingot.
const CAST_SCREWS = 'Recipe_Alternate_Screw_C',
  TURBOFUEL = 'Recipe_Alternate_Turbofuel_C',
  PURE_IRON = 'Recipe_Alternate_PureIronIngot_C';

// One plan for most of the file: a profile made for Phase 1 with mining per phase. Its generators:
// 4 Coal Generators in Phase 2, 6 Fuel Generators in Phase 3, 27 in Phase 4 (two lines, 7 and
// 20) and 88 in Phase 5, as calculate() gives them today (checked below).
let shared: CurrentCalculatedPlan | undefined;
const plan = (): CurrentCalculatedPlan =>
  json((shared ??= calculate({ phase: '1', phaseMining: true })));
const found = (
  thePlan: StoredCalculatedPlan,
  checks: Record<string, boolean>,
  phase: number,
): OwnedFound | null => ownedFromTicks(thePlan, checks, phase, alternates);
const generatorLines = (thePlan: StoredCalculatedPlan, phase: '2' | '3' | '4' | '5') =>
  thePlan.stages[phase].rows!.filter(row => row.power < 0);

test('the working phase is the saved phase, Post Phase 5 as Phase 5, never before the start phase', () => {
  const at = (start: string) => ({ settings: { ...plan().settings, phase: start as '1' } });
  assert.equal(ticksPhase(at('1'), '3'), 3);
  assert.equal(ticksPhase(at('1'), 'post'), 5);
  assert.equal(ticksPhase(at('3'), '1'), 3, 'a milestone-only phase measures from the start');
  assert.equal(ticksPhase(at('2'), undefined), 2);
});

test('a miner milestone counts only where it betters the working phase’s own miner', () => {
  const thePlan = plan();
  assert.equal(found(thePlan, {}, 1), null, 'no ticks, nothing found');
  assert.deepEqual(found(thePlan, { [MINER_MK2]: true }, 1), {
    miner: 2,
    alternates: [],
    generators: {},
  });
  // Phase 2 and later unlock Miner Mk.2 themselves.
  assert.equal(found(thePlan, { [MINER_MK2]: true }, 2), null, 'the phase unlocks it anyway');
  assert.equal(found(thePlan, { [MINER_MK2]: false }, 1), null, 'unticked');
  assert.equal(found(thePlan, { [MINER_MK3]: true }, 2)?.miner, 3);
  assert.equal(found(thePlan, { [MINER_MK3]: true, [MINER_MK2]: true }, 3)?.miner, 3);
  assert.equal(found(thePlan, { [MINER_MK3]: true }, 4), null, 'Phase 4 has Miner Mk.3');
  // The plan's own setting already says so.
  const owned = { ...thePlan, settings: { ...thePlan.settings, ownedMiner: 3 as const } };
  assert.equal(found(owned, { [MINER_MK3]: true }, 2), null);
  const mk2 = { ...thePlan, settings: { ...thePlan.settings, ownedMiner: 2 as const } };
  assert.equal(found(mk2, { [MINER_MK3]: true }, 2)?.miner, 3, 'a better one than owned');
  // A node survey's miner caps every phase's: Mk.3 would change nothing.
  const surveyed = {
    ...thePlan,
    settings: { ...thePlan.settings, extraction: { mark: 2, clock: 1 } },
  } as StoredCalculatedPlan;
  assert.equal(found(surveyed, { [MINER_MK3]: true }, 2), null, 'capped by the survey');
  // Without mining per phase the plan has no miner to raise.
  const flat = { ...thePlan, settings: { ...thePlan.settings, phaseMining: undefined } };
  assert.equal(found(flat, { [MINER_MK3]: true, [BELT_MK5]: true }, 2), null);
});

test('a belt milestone counts only where it betters the working phase’s own belt', () => {
  const thePlan = plan();
  // Phase 1 has Mk.2 belts, Phase 2 Mk.3, Phase 3 Mk.4, Phase 4 Mk.5, Phase 5 Mk.6.
  assert.equal(found(thePlan, { [BELT_MK3]: true }, 1)?.belt, 3);
  assert.equal(found(thePlan, { [BELT_MK3]: true }, 2), null, 'Phase 2 has Mk.3 belts');
  assert.equal(found(thePlan, { [BELT_MK4]: true, [BELT_MK3]: true }, 2)?.belt, 4);
  assert.equal(found(thePlan, { [BELT_MK4]: true }, 3), null);
  assert.equal(found(thePlan, { [BELT_MK5]: true }, 3)?.belt, 5);
  assert.equal(found(thePlan, { [BELT_MK6]: true }, 4)?.belt, 6);
  assert.equal(found(thePlan, { [BELT_MK6]: true }, 5), null);
  // Mk.1 and Mk.2 belts come with Phase 1.
  assert.equal(found(thePlan, { 'unlock-Schematic_3-2_C': true }, 1), null);
  const owned = { ...thePlan, settings: { ...thePlan.settings, ownedBelt: 5 as const } };
  assert.equal(found(owned, { [BELT_MK5]: true }, 2), null, 'owned already');
  assert.equal(found(owned, { [BELT_MK6]: true }, 2)?.belt, 6);
});

test('an alternate’s unlock tick counts only when the plan’s recipe pool does not hold it', () => {
  const thePlan = plan();
  const ticked = { ['recipe-unlock-' + CAST_SCREWS]: true };
  assert.equal(thePlan.settings.recipes, 'standard');
  assert.deepEqual(found(thePlan, ticked, 3)?.alternates, [CAST_SCREWS]);
  // From any phase: owning it changes the pool of the phases still ahead.
  assert.deepEqual(found(thePlan, ticked, 5)?.alternates, [CAST_SCREWS]);
  const withSettings = (extra: object) =>
    ({ ...thePlan, settings: { ...thePlan.settings, ...extra } }) as StoredCalculatedPlan;
  assert.equal(found(withSettings({ recipes: 'all' }), ticked, 3), null, 'all alternates');
  assert.equal(
    found(withSettings({ recipes: 'custom', alternateRecipes: [CAST_SCREWS] }), ticked, 3),
    null,
    'picked',
  );
  assert.deepEqual(
    found(withSettings({ recipes: 'custom', alternateRecipes: [] }), ticked, 3)?.alternates,
    [CAST_SCREWS],
  );
  assert.equal(found(withSettings({ ownedAlternates: [CAST_SCREWS] }), ticked, 3), null, 'owned');
  const pure = { ['recipe-unlock-' + PURE_IRON]: true };
  assert.deepEqual(found(thePlan, pure, 3)?.alternates, [PURE_IRON]);
  assert.equal(found(withSettings({ pureIngots: true }), pure, 3), null, 'pure ingots on');
  // A MAM recipe comes with its research step, not a hard drive.
  assert.equal(found(thePlan, { ['recipe-unlock-' + TURBOFUEL]: true }, 3), null);
  assert.equal(found(thePlan, { 'recipe-unlock-Recipe_NotAnything_C': true }, 3), null);
  assert.equal(found(thePlan, { ['recipe-unlock-' + CAST_SCREWS]: false }, 3), null);
});

test('generators marked running count only where a phase from the working phase on runs fewer', () => {
  const thePlan = plan();
  // The plan as this test reads it (see `plan` above).
  assert.deepEqual(
    generatorLines(thePlan, '4').map(row => [row.id, row.machines]),
    [
      ['power-fuel', 7],
      ['power-rocket-fuel', 20],
    ],
  );
  assert.equal(thePlan.stages['3'].grid!.generators[0]!.machines, 6);
  assert.equal(thePlan.stages['4'].grid!.generators[0]!.machines, 27);
  const phase4 = { 'calc-4-power-fuel': true, 'calc-4-power-rocket-fuel': true };
  // Phase 4's two Fuel Generator lines run 27: Phase 3 runs only 6 of them.
  assert.deepEqual(found(thePlan, phase4, 3), {
    alternates: [],
    generators: { 'Fuel Generator': 27 },
  });
  // Phase 4 itself, and Phase 5 with 88, run at least as many.
  assert.equal(found(thePlan, phase4, 4), null, 'the working phase runs them already');
  // One of the two lines marked: its own machines.
  assert.deepEqual(found(thePlan, { 'calc-4-power-rocket-fuel': true }, 3)?.generators, {
    'Fuel Generator': 20,
  });
  // The working phase's own line marked running is what the plan builds: nothing more.
  assert.equal(found(thePlan, { 'calc-3-power-fuel': true }, 3), null);
  // Phase 2's coal line, while working on Phase 2: no later phase runs Coal Generators, so owning
  // them would change nothing.
  assert.equal(found(thePlan, { 'calc-2-power-coal': true }, 2), null);
  const owned = {
    ...thePlan,
    settings: { ...thePlan.settings, ownedGenerators: { 'Fuel Generator': 27 } },
  };
  assert.equal(found(owned, phase4, 3), null, 'already entered');
  const fewer = {
    ...thePlan,
    settings: { ...thePlan.settings, ownedGenerators: { 'Fuel Generator': 10 } },
  };
  assert.deepEqual(found(fewer, phase4, 3)?.generators, { 'Fuel Generator': 27 });
});

test('a plan guide (a profile moved from the original plan) is left out', () => {
  const thePlan = { ...plan(), guide: { phases: {} } };
  assert.equal(found(thePlan, { [MINER_MK3]: true }, 2), null);
});

test('the settings raised to what the ticks show, accepted by the planner, leave nothing more', () => {
  const thePlan = plan();
  const checks = {
    [MINER_MK3]: true,
    [BELT_MK5]: true,
    ['recipe-unlock-' + CAST_SCREWS]: true,
    'calc-4-power-fuel': true,
    'calc-4-power-rocket-fuel': true,
  };
  const shown = found(thePlan, checks, 3)!;
  assert.deepEqual(shown, {
    miner: 3,
    belt: 5,
    alternates: [CAST_SCREWS],
    generators: { 'Fuel Generator': 27 },
  });
  assert.equal(
    foundList(foundWords(shown, alternates)),
    'Miner Mk.3, Mk.5 belts, the Cast Screws alternate and 27 Fuel Generators running',
  );
  const raised = withOwnedFound(
    {
      ...thePlan.settings,
      ownedAlternates: ['Recipe_Alternate_Wire_1_C'],
      ownedGenerators: { 'Coal Generator': 2 },
    },
    shown,
  );
  assert.equal(raised.ownedMiner, 3);
  assert.equal(raised.ownedBelt, 5);
  assert.deepEqual(raised.ownedAlternates, [CAST_SCREWS, 'Recipe_Alternate_Wire_1_C'].sort());
  assert.deepEqual(raised.ownedGenerators, { 'Coal Generator': 2, 'Fuel Generator': 27 });
  // Every other setting is the plan's own, and the planner keeps the raised ones as they are.
  const { ownedMiner, ownedBelt, ownedAlternates, ownedGenerators, ...rest } = raised;
  const {
    ownedAlternates: _a,
    ownedGenerators: _g,
    ...before
  } = {
    ...thePlan.settings,
    ownedAlternates: undefined,
    ownedGenerators: undefined,
  };
  assert.deepEqual(rest, before);
  const kept = settings(raised);
  assert.deepEqual(
    [kept.ownedMiner, kept.ownedBelt, kept.ownedAlternates, kept.ownedGenerators],
    [ownedMiner, ownedBelt, ownedAlternates, ownedGenerators],
  );
  // Nothing found leaves the settings as they are.
  assert.deepEqual(withOwnedFound(thePlan.settings, { alternates: [], generators: {} }), {
    ...thePlan.settings,
  });
  // The plan calculated with them: the same ticks show nothing more.
  const recalculated = calculate(withOwnedFound(thePlan.settings, shown));
  assert.equal(found(recalculated, checks, 3), null);
  assert.equal(recalculated.stages['3'].mining!.miner.mark, 3, 'Phase 3 plans with Miner Mk.3');
  assert.equal(recalculated.stages['3'].mining!.belt.mark, 'Mk.5');
  assert.equal(recalculated.stages['3'].grid!.generators[0]!.owned, 27);
});

test('Review names the owned settings an edit turns on, from none', () => {
  const thePlan = plan();
  const raised = withOwnedFound(thePlan.settings, {
    miner: 3,
    belt: 5,
    alternates: [CAST_SCREWS],
    generators: { 'Fuel Generator': 27 },
  });
  const { changes, others } = settingsChanges(thePlan.settings, raised, catalog().goals);
  assert.deepEqual(changes, [
    { label: 'Miners you already have', before: 'None', after: 'Miner Mk.3' },
    { label: 'Belts you already have', before: 'None', after: 'Mk.5 belts' },
    { label: 'Alternates you already own', before: 'None', after: '1 recipe' },
    { label: 'Generators you already have', before: 'None', after: '27 Fuel Generators' },
  ]);
  assert.equal(others, 0);
  // And mining per phase turned on for a plan without it; an empty list is none, as absent is.
  const { phaseMining: _m, ...flat } = thePlan.settings;
  assert.deepEqual(
    settingsChanges(flat, { ...flat, phaseMining: true, ownedAlternates: [] }, []).changes,
    [{ label: 'Mining and belts per phase', before: 'Off', after: 'On' }],
  );
  assert.deepEqual(settingsChanges(flat, flat, []), { changes: [], others: 0 });
});

test('a dismissal hides the notice until the ticks show something new', () => {
  const shown: OwnedFound = {
    miner: 2,
    belt: 4,
    alternates: [CAST_SCREWS],
    generators: { 'Fuel Generator': 27 },
  };
  // Kept in the browser as JSON, and read back checked.
  const stored = dismissedFound(JSON.parse(JSON.stringify(shown)));
  assert.deepEqual(stored, shown);
  assert.equal(foundSince(shown, null), true, 'never dismissed');
  assert.equal(foundSince(shown, stored), false, 'the same');
  assert.equal(foundSince({ ...shown, belt: 3, alternates: [] }, stored), false, 'less');
  assert.equal(foundSince({ ...shown, miner: 3 }, stored), true, 'a better miner');
  assert.equal(foundSince({ ...shown, belt: 5 }, stored), true, 'a better belt');
  assert.equal(
    foundSince({ ...shown, alternates: [CAST_SCREWS, PURE_IRON] }, stored),
    true,
    'another alternate',
  );
  assert.equal(
    foundSince({ ...shown, generators: { 'Fuel Generator': 30 } }, stored),
    true,
    'more generators',
  );
  assert.equal(
    foundSince({ ...shown, generators: { 'Coal Generator': 4, 'Fuel Generator': 27 } }, stored),
    true,
    'another kind',
  );
  // Anything unreadable shows the notice; damaged fields are dropped.
  for (const junk of [null, undefined, 'x', 3, [], [shown]])
    assert.equal(dismissedFound(junk), null, String(junk));
  assert.deepEqual(
    dismissedFound({ miner: 'Mk.3', belt: 2.5, alternates: [1, CAST_SCREWS], generators: 'x' }),
    { alternates: [CAST_SCREWS], generators: {} },
  );
});

// One edition: a request and the save's stored profiles.
interface Edition {
  request: <T>(route: string, body?: unknown) => Promise<T>;
  profiles: () => Promise<StoredProfile[]>;
}
interface Recalculated {
  profileId: string;
  backupId: string;
}

// A profile made for Phase 1 with mining per phase, working on Phase 1, ticks Miner Mk.2's and Mk.4
// belts' milestones and the Cast Screws unlock; the offer's settings recalculate it in place.
async function recalculateWithTicks(edition: Edition) {
  const created = await edition.request<Recalculated>('/api/profiles', {
    saveName: 'World',
    name: 'Main base',
    settings: { phase: '1', phaseMining: true },
  });
  const context = () => edition.request<ContextReply>('/api/context');
  const ticks = [MINER_MK2, BELT_MK4, 'recipe-unlock-' + CAST_SCREWS];
  for (const key of ticks)
    await edition.request('/api/update', { type: 'check', key, value: true });
  const before = await context();
  const stored = (await edition.profiles()).find(p => p.id === created.profileId)!;
  const shown = ownedFromTicks(
    before.plan,
    before.state.checks,
    ticksPhase(before.plan!, before.state.settings.phase),
    alternates,
  )!;
  assert.deepEqual(shown, { miner: 2, belt: 4, alternates: [CAST_SCREWS], generators: {} });
  const done = await edition.request<Recalculated>('/api/recalculate', {
    name: before.profile.name,
    backupName: 'Main base (before edit, Oct 10, 2:05 PM)',
    settings: withOwnedFound(before.plan!.settings, shown),
    planCreatedAt: before.plan!.createdAt,
  });
  assert.equal(done.profileId, created.profileId, 'the profile keeps its id');
  const after = await context();
  assert.equal(after.profile.name, 'Main base');
  assert.equal(after.plan!.settings.ownedMiner, 2);
  assert.equal(after.plan!.settings.ownedBelt, 4);
  assert.deepEqual(after.plan!.settings.ownedAlternates, [CAST_SCREWS]);
  assert.equal(after.plan!.stages['1'].mining!.miner.mark, 2, 'Phase 1 plans with Miner Mk.2');
  // The ticks are carried, and show nothing more now.
  for (const key of ticks) assert.equal(after.state.checks[key], true, key);
  assert.equal(after.state.settings.phase, '1', 'the phase worked on stays');
  assert.equal(
    ownedFromTicks(after.plan, after.state.checks, 1, alternates),
    null,
    'the notice is gone',
  );
  // The previous version, whole, right after it and linked to it.
  const profiles = await edition.profiles();
  assert.deepEqual(
    profiles.map(p => p.id),
    [created.profileId, done.backupId],
  );
  const { backupOf, ...backup } = profiles[1]!;
  assert.equal(backupOf, created.profileId);
  assert.deepEqual({ ...backup, id: stored.id, name: stored.name }, stored);
  assert.equal(profiles[1]!.name, 'Main base (before edit, Oct 10, 2:05 PM)');
  assert.equal(profiles[1]!.plan?.settings.ownedMiner, undefined, 'the backup plans as before');
}

test('the Docker server recalculates in place with what the ticks show, keeping a backup', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-owned-ticks-'));
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  try {
    await recalculateWithTicks({
      async request<T>(route: string, body?: unknown) {
        const response = await fetch(url + route, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        assert.ok(response.ok, route + ' ' + (await response.clone().text()));
        return (await response.json()) as T;
      },
      async profiles() {
        const file = JSON.parse(
          await fs.readFile(path.join(dir, 'workspace.json'), 'utf8'),
        ) as WorkspaceFile;
        return file.saves[0]!.profiles;
      },
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition recalculates in place with what the ticks show, keeping a backup', async () => {
  let data: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  const store = {
    async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(data);
      if (!change) return copy as T;
      const result = change(copy);
      data = copy;
      return structuredClone(result);
    },
  };
  const api = createBrowserApi(store, calculate, catalog());
  await recalculateWithTicks({
    request: async <T>(route: string, body?: unknown) =>
      (await api(route, body === undefined ? {} : { body: JSON.stringify(body) })) as T,
    profiles: async () => structuredClone(data.saves[0]!.profiles),
  });
});
