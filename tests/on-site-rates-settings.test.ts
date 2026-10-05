// settings.onSite[group].rates (#984): a group's part of a row with a fixed-rate membership, which
// the planner follows to the row's total in the plan the recalculation produces. Checked by the
// planner's settings(), never required: a plan stored before #984 has only `shares`, and keeps
// loading, validating, importing and recalculating exactly as it did (recorded on main before
// #984 in tests/fixtures/on-site-shares-2026-10-04.json). Likewise settings.onSite[group].ifBuilt
// (#1038), a group's parts of rows the plan being recalculated lacked in a phase: a plan stored
// before #1038 has none and recalculates exactly as it did (recorded on main before #1038 in
// tests/fixtures/on-site-rates-2026-10-04.json). #1064's power model changed every plan, so both
// fixtures' rows were recorded again on it from the same settings, by the same steps as these
// tests (which reproduced the earlier recordings exactly on main before #1064). #1063 dropped the
// central Wire line that sank almost all it made in Phases 4 and 5 of the second shares case, so
// that case's rows were recorded again on it the same way; the other cases did not change.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { calculate, settings } from '../planner.ts';
import { onSiteSettings } from '../public/app/on-site.ts';
import { rowParts, rowShares } from '../public/app/group-order.ts';
import { initialState, validateState } from '../public/state.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { loadWorkspace } from '../server/persistence.ts';
import { STANDARD_BEFORE_1040 } from './helpers/standard-before-1040.ts';
import type {
  CurrentSettings,
  FactoryGroups,
  OnSiteSettings,
  SaveExport,
  StoredCalculatedPlan,
} from '../public/types/index.ts';

const ALPHA = 'fg-alpha1';
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

interface RecordedCase {
  label: string;
  settings: CurrentSettings;
  rows: Record<string, [string, number][]>;
}
const recorded: { cases: RecordedCase[] } = JSON.parse(
  fs.readFileSync('tests/fixtures/on-site-shares-2026-10-04.json', 'utf8'),
);
// Both cases were recorded with the standard recipes, which until #1040 held Pure Aluminum
// Ingot. A recalculation of them now plans the standard Aluminum Ingot instead (as #1040 means
// it to), so each case is solved with the recipes it was recorded with, to compare #984 alone.
for (const entry of recorded.cases) {
  assert.equal(entry.settings.recipes, 'standard', entry.label);
  Object.assign(entry.settings, STANDARD_BEFORE_1040);
}
// A plan's rows as recorded: per phase, each row's id and whole machines.
const rowsOf = (plan: Pick<StoredCalculatedPlan, 'stages'>) =>
  Object.fromEntries(
    Object.entries(plan.stages).map(([phase, stage]) => [
      phase,
      (stage.rows || []).map(row => [row.id, row.machines]),
    ]),
  );

test('rowParts is rowShares at every total that makes the fixed rates', () => {
  const memberships = [
    { group: 'a', rate: 47 },
    { group: 'b', rate: null },
    { group: 'c', rate: 20 },
    { group: 'd', rate: null },
  ];
  const parts = rowParts(memberships);
  assert.deepEqual(Object.fromEntries(parts), {
    a: { rate: 47, open: 0, after: 0 },
    c: { rate: 20, open: 0, after: 47 },
    b: { rate: 0, open: 0.5, after: 67 },
    d: { rate: 0, open: 0.5, after: 67 },
  });
  for (const total of [67, 80, 520, 560, 10000]) {
    const shares = rowShares(total, memberships);
    for (const [group, part] of parts) {
      const rate = part.rate || part.open * (total - part.after);
      assert.ok(Math.abs(rate / total - (shares.get(group) || 0)) < 1e-12, `${group} at ${total}`);
    }
  }
  assert.equal(rowParts([{ group: 'a', rate: null }]).size, 0, 'no fixed rate, no parts');
  assert.equal(rowParts(undefined).size, 0);
});

test('onSiteSettings adds the parts of rows with a fixed rate beside the shares', () => {
  const plan = calculate({ phase: '4', wholeMachines: true, limitsConfirmed: true });
  const groups: FactoryGroups = {
    groups: [
      { id: ALPHA, name: 'Alpha' },
      { id: 'fg-beta22', name: 'Beta' },
    ],
    assignments: {
      Recipe_IronPlate_C: [
        { group: 'fg-beta22', rate: 47 },
        { group: ALPHA, rate: null },
      ],
      Recipe_IronRod_C: [{ group: ALPHA, rate: null }],
    },
    local: { [ALPHA]: ['Iron Ingot'] },
  };
  const onSite = onSiteSettings(plan, groups)!;
  // Phase 4's Iron Plate line makes 520: Alpha's share is what Beta's 47 leaves.
  assert.ok(Math.abs(onSite[ALPHA]!.shares['4']!.Recipe_IronPlate_C! - 473 / 520) < 1e-12);
  assert.deepEqual(onSite[ALPHA]!.rates!['4'], {
    Recipe_IronPlate_C: { rate: 0, open: 1, after: 47 },
  });
  // A row without a fixed rate has no part: its share does not depend on its total.
  assert.equal(onSite[ALPHA]!.shares['4']!.Recipe_IronRod_C, 1);
  // The planner takes the setting as it is.
  assert.deepEqual(settings({ onSite }).onSite, onSite);
  // Without a fixed rate anywhere, the setting is what it was before #984.
  const open = onSiteSettings(plan, {
    ...groups,
    assignments: { Recipe_IronRod_C: [{ group: ALPHA, rate: null }] },
  })!;
  assert.equal('rates' in open[ALPHA]!, false);
  assert.equal('ifBuilt' in open[ALPHA]!, false);
  // The plan has the Iron Plate line in every phase, so nothing is stored apart either (#1038).
  assert.equal('ifBuilt' in onSite[ALPHA]!, false);
});

test('settings() checks the parts, and drops what plans nothing', () => {
  const entry = (rates: unknown) => ({
    [ALPHA]: { items: ['Wire'], shares: { '3': { Recipe_Cable_C: 0.5 } }, rates },
  });
  const checked = (rates: unknown) => settings({ onSite: entry(rates) }).onSite![ALPHA]!.rates;
  assert.deepEqual(
    checked({
      '3': {
        Recipe_Cable_C: { rate: 75, after: 0 },
        Recipe_Stator_C: { open: 0.5, after: 75, floor: true, note: 'x' },
        Recipe_Rotor_C: { rate: 0, open: 0, after: 3 },
      },
      '4': {},
    }),
    {
      '3': {
        Recipe_Cable_C: { rate: 75, open: 0, after: 0 },
        // A part may stand for a row without a share; the planner's own `floor` and anything
        // else unknown is left out.
        Recipe_Stator_C: { rate: 0, open: 0.5, after: 75 },
      },
    },
    'normalised: absent numbers 0, parts that plan nothing and empty phases dropped',
  );
  assert.equal(checked(undefined), undefined, 'absent stays absent');
  assert.equal(checked({ '3': { Recipe_Cable_C: { rate: 0 } } }), undefined, 'nothing left');
  // Row ids that name Object.prototype's fields stay plain own entries.
  const odd = checked(
    JSON.parse('{"3": {"__proto__": {"rate": 5}, "constructor": {"open": 1, "after": 2}}}'),
  )!['3']!;
  assert.equal(Object.getPrototypeOf(odd), Object.prototype);
  assert.deepEqual(Object.keys(odd).sort(), ['__proto__', 'constructor']);
  assert.deepEqual(Object.getOwnPropertyDescriptor(odd, '__proto__')!.value, {
    rate: 5,
    open: 0,
    after: 0,
  });
  const many = Object.fromEntries(
    Array.from({ length: 1001 }, (_, i) => [`Recipe_${i}`, { rate: 1 }]),
  );
  for (const rates of [
    [],
    'rates',
    null,
    7,
    { post: {} },
    { '3': [] },
    { '3': { 'bad id': { rate: 1 } } },
    { '3': { Recipe_Cable_C: 5 } },
    { '3': { Recipe_Cable_C: null } },
    { '3': { Recipe_Cable_C: { rate: -1 } } },
    { '3': { Recipe_Cable_C: { rate: '47' } } },
    { '3': { Recipe_Cable_C: { rate: 1e300 } } },
    { '3': { Recipe_Cable_C: { rate: 10000001 } } },
    { '3': { Recipe_Cable_C: { open: 1.5 } } },
    { '3': { Recipe_Cable_C: { open: -0.5 } } },
    { '3': { Recipe_Cable_C: { after: -1 } } },
    { '3': { Recipe_Cable_C: { after: 120000001 } } },
    { '3': { Recipe_Cable_C: { rate: 47, open: 0.5 } } },
    { '3': { Recipe_Cable_C: { rate: true } } },
    { '3': many },
  ])
    assert.throws(
      () => settings({ onSite: entry(rates) }),
      /Invalid items made on site/,
      JSON.stringify(rates)?.slice(0, 80),
    );
  // An invalid part is refused even in a group that is dropped for having no share.
  assert.throws(
    () =>
      settings({
        onSite: { [ALPHA]: { items: ['Wire'], shares: {}, rates: { '3': { X: { rate: -1 } } } } },
      }),
    /Invalid items made on site/,
  );
});

test('settings() checks the parts of rows the plan lacked (ifBuilt) as it checks rates (#1038)', () => {
  const entry = (ifBuilt: unknown, rates?: unknown) => ({
    [ALPHA]: { items: ['Wire'], shares: { '3': { Recipe_Cable_C: 0.5 } }, rates, ifBuilt },
  });
  const checked = (ifBuilt: unknown, rates?: unknown) =>
    settings({ onSite: entry(ifBuilt, rates) }).onSite![ALPHA]!.ifBuilt;
  assert.deepEqual(
    checked({
      '2': { Recipe_Cable_C: { rate: 75 }, Recipe_Rotor_C: { rate: 0, open: 0, after: 3 } },
      '3': { Recipe_Stator_C: { open: 0.5, after: 75, floor: true, note: 'x' } },
      '4': {},
    }),
    {
      '2': { Recipe_Cable_C: { rate: 75, open: 0, after: 0 } },
      '3': { Recipe_Stator_C: { rate: 0, open: 0.5, after: 75 } },
    },
    'normalised as rates are',
  );
  assert.equal(checked(undefined), undefined, 'absent stays absent');
  assert.equal(checked({ '3': { Recipe_Cable_C: { rate: 0 } } }), undefined, 'nothing left');
  // A row with a part of rates in the phase keeps that one: the plan had the row there.
  assert.deepEqual(
    checked(
      {
        '3': { Recipe_Cable_C: { rate: 9 }, Recipe_Rotor_C: { rate: 4 } },
        '4': { Recipe_Cable_C: { rate: 9 } },
      },
      { '3': { Recipe_Cable_C: { rate: 75 } } },
    ),
    {
      '3': { Recipe_Rotor_C: { rate: 4, open: 0, after: 0 } },
      '4': { Recipe_Cable_C: { rate: 9, open: 0, after: 0 } },
    },
  );
  for (const ifBuilt of [
    [],
    'ifBuilt',
    null,
    7,
    { post: {} },
    { '3': [] },
    { '3': { 'bad id': { rate: 1 } } },
    { '3': { Recipe_Cable_C: 5 } },
    { '3': { Recipe_Cable_C: { rate: -1 } } },
    { '3': { Recipe_Cable_C: { rate: '47' } } },
    { '3': { Recipe_Cable_C: { rate: 1e300 } } },
    { '3': { Recipe_Cable_C: { open: 1.5 } } },
    { '3': { Recipe_Cable_C: { after: -1 } } },
    { '3': { Recipe_Cable_C: { rate: 47, open: 0.5 } } },
    {
      '3': Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`Recipe_${i}`, { rate: 1 }])),
    },
  ])
    assert.throws(
      () => settings({ onSite: entry(ifBuilt) }),
      /Invalid items made on site/,
      JSON.stringify(ifBuilt)?.slice(0, 80),
    );
});

test('a plan stored with only shares recalculates exactly as before #984', () => {
  assert.equal(recorded.cases.length, 2);
  for (const entry of recorded.cases) {
    const onSite = entry.settings.onSite as OnSiteSettings;
    for (const group of Object.values(onSite)) assert.equal('rates' in group, false, entry.label);
    // A recalculation from the stored settings (as /api/round-up and the browser edition's
    // round-up do) plans what the release before #984 planned, and keeps the setting unchanged.
    const plan = calculate(json(entry.settings));
    assert.deepEqual(rowsOf(plan), entry.rows, entry.label);
    assert.deepEqual(plan.settings.onSite, onSite, entry.label);
  }
});

test('a plan stored with rates and without ifBuilt recalculates exactly as before #1038', () => {
  const before1038: { cases: RecordedCase[] } = JSON.parse(
    fs.readFileSync('tests/fixtures/on-site-rates-2026-10-04.json', 'utf8'),
  );
  assert.equal(before1038.cases.length, 2);
  for (const entry of before1038.cases) {
    const onSite = entry.settings.onSite as OnSiteSettings;
    assert.ok(
      Object.values(onSite).some(group => 'rates' in group),
      entry.label,
    );
    for (const group of Object.values(onSite)) assert.equal('ifBuilt' in group, false, entry.label);
    const plan = calculate(json(entry.settings));
    assert.deepEqual(rowsOf(plan), entry.rows, entry.label);
    assert.deepEqual(plan.settings.onSite, onSite, entry.label);
  }
});

// A full export holding a profile whose plan stores `settings.onSite`, as a release before #984
// (shares only) or a later one (with rates, and since #1038 ifBuilt) froze it.
function exported(plan: StoredCalculatedPlan): SaveExport {
  return {
    format: 'satisfactory-planner-saves',
    version: 1,
    exportedAt: '2026-10-04T12:00:00.000Z',
    saves: [
      {
        id: 's1',
        name: 'World',
        activeProfile: 'p1',
        profiles: [
          { id: 'p1', name: 'Made on site', kind: 'calculated', plan, state: initialState() },
        ],
      },
    ],
  };
}
// The recorded case's plan, as the release before #984 stored it.
const storedPlan = (entry: RecordedCase): StoredCalculatedPlan => json(calculate(entry.settings));

test('a stored plan with only shares imports and loads unchanged, and so does one with rates or ifBuilt', async () => {
  const entry = recorded.cases[0]!;
  const before = storedPlan(entry);
  const withRates = json(calculate({ ...entry.settings, onSite: undefined }));
  withRates.settings.onSite = {
    'fg-plc3': {
      ...(entry.settings.onSite as OnSiteSettings)['fg-plc3']!,
      rates: { '4': { Recipe_IronPlate_C: { rate: 47, open: 0, after: 0 } } },
    },
  };
  const withIfBuilt = json(withRates);
  withIfBuilt.settings.onSite!['fg-plc3']!.ifBuilt = {
    '1': { Recipe_IronPlate_C: { rate: 0, open: 1, after: 47 } },
  };
  for (const plan of [before, withRates, withIfBuilt]) {
    const file = exported(plan);
    // The import's check and conversion keep the plan byte for byte.
    const checked = validateTransfer(json(file)).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(checked), JSON.stringify(plan));
    const imported = (await importableTransfer(json(file))).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(imported), JSON.stringify(plan));
    // The Docker edition loads workspace.json without touching it.
    const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-onsite-rates-'));
    const workspace = await loadWorkspace(dataDir, validateState);
    const profile = { id: 'p1', name: 'Made on site', kind: 'calculated' as const, plan };
    workspace.saves.push({
      id: 's1',
      name: 'World',
      userId: 'owner',
      activeProfile: 'p1',
      profiles: [{ ...profile, state: initialState() }],
    });
    await fsp.writeFile(path.join(dataDir, 'workspace.json'), JSON.stringify(workspace));
    const loaded = await loadWorkspace(dataDir, validateState);
    assert.equal(JSON.stringify(loaded.saves[0]!.profiles[0]!.plan), JSON.stringify(plan));
    await fsp.rm(dataDir, { recursive: true, force: true });
  }
  // And the stored plan with only shares recalculates as recorded.
  assert.deepEqual(rowsOf(calculate(before.settings)), entry.rows);
});
