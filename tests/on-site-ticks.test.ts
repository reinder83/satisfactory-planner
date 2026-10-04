// Made on site, sub-task 3 of #868 (#876): a tick and a build-plan step per factory group's own
// line (row id '<recipe>:<group>' with `onSite`), the group helpers that place such a line in its
// group, the Logistics page's books that keep its supply inside the group, and the review path for
// ticks a recalculation cannot carry onto one line (onSiteReview, state version 15).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate } from '../planner.ts';
import { onSiteSettings, siteReviewEntries } from '../public/app/on-site.ts';
import { groupFlow } from '../public/app/group-flow.ts';
import { groupLinks, itemBooks, OUTSIDE } from '../public/app/group-links.ts';
import {
  groupedRows,
  homeGroup,
  rowMemberships,
  rowPlaces,
  UNGROUPED,
} from '../public/app/group-order.ts';
import { phaseSteps } from '../public/progression.ts';
import {
  initialState,
  mutate,
  newProfileState,
  safeKey,
  shareState,
  siteTicksForReview,
  validateState,
} from '../public/state.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { validateTransfer } from '../public/transfer.ts';
import { catalog } from '../planner.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { saveExport, states, version14, version15 } from './types/fixtures.ts';
import type {
  CurrentCalculatedPlan,
  FactoryGroups,
  ProgressState,
  Progression,
  SavedState,
  StoredStage,
  WorkspaceSummary,
} from '../public/types/index.ts';

const BASE = { phase: '3', wholeMachines: true, limitsConfirmed: true };
const ALPHA = 'fg-alpha1',
  BETA = 'fg-beta22',
  CENTRAL = 'fg-centr1';
const WIRE = 'Recipe_Wire_C';
const ALPHA_WIRE = `${WIRE}:${ALPHA}`,
  BETA_WIRE = `${WIRE}:${BETA}`;
const key = (id: string) => 'calc-3-' + id;
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);

let plain: CurrentCalculatedPlan | undefined, marked: CurrentCalculatedPlan | undefined;
// Phase 3 with whole machines: without items made on site, and recalculated with Alpha and Beta
// making Wire on site, as the user-started recalculation would (#877). Made once for the file.
const plainPlan = () => (plain ??= calculate(BASE));
const markedPlan = () =>
  (marked ??= calculate({ ...BASE, onSite: onSiteSettings(plainPlan(), twoGroups()) }));
const rowOf = (stage: StoredStage, id: string) => (stage.rows || []).find(row => row.id === id);

// Alpha holds the Stator line, Beta half of the Cable line (the other half is Ungrouped), and
// both make Wire on site. With `central`, a third group holds the central Wire line.
function twoGroups(central = false): FactoryGroups {
  const cable = rowOf(plainPlan().stages['3'], 'Recipe_Cable_C')!.outputs.Cable!;
  return {
    groups: [
      { id: ALPHA, name: 'Alpha' },
      { id: BETA, name: 'Beta' },
      ...(central ? [{ id: CENTRAL, name: 'Copper works' }] : []),
    ],
    assignments: {
      Recipe_Stator_C: [{ group: ALPHA, rate: null }],
      Recipe_Cable_C: [{ group: BETA, rate: cable / 2 }],
      ...(central ? { [WIRE]: [{ group: CENTRAL, rate: null }] } : {}),
    },
    local: { [ALPHA]: ['Wire'], [BETA]: ['Wire'] },
  };
}

// A progress state for `plan` with the two groups and the given ticks.
const progress = (checks: Record<string, boolean>, groups = twoGroups()): SavedState =>
  json({ ...initialState(), factoryGroups: groups, checks });

test('a group line has its own step and tick, named for its group; the central line keeps its key', () => {
  const plan = markedPlan();
  const steps = phaseSteps(plan, { checks: {}, factoryGroups: twoGroups() }, data, '3');
  const step = (id: string) => steps.find(candidate => candidate.id === key(id));
  assert.equal(step(ALPHA_WIRE)?.title, 'Wire for Alpha');
  assert.equal(step(BETA_WIRE)?.title, 'Wire for Beta');
  assert.equal(step(WIRE)?.title, 'Wire', 'the central line keeps its name and key');
  // A renamed group is named as it is now; without the groups, as the plan was calculated.
  const renamed = { ...twoGroups(), groups: [{ id: ALPHA, name: 'Stator works' }] };
  assert.equal(
    phaseSteps(plan, { checks: {}, factoryGroups: renamed }, data, '3').find(
      candidate => candidate.id === key(ALPHA_WIRE),
    )?.title,
    'Wire for Stator works',
  );
  assert.equal(
    phaseSteps(plan, { checks: {} }, data, '3').find(c => c.id === key(BETA_WIRE))?.title,
    'Wire for Beta',
  );
  // The key passes safeKey, so ticking it needs no new state version.
  assert.ok(safeKey(key(ALPHA_WIRE)));
  let state: ProgressState = validateState(initialState());
  state = mutate(state, { type: 'check', key: key(ALPHA_WIRE), value: true });
  assert.equal(state.checks[key(ALPHA_WIRE)], true);
  assert.equal(state.checks[key(WIRE)], undefined, 'the central line is not ticked with it');
  assert.equal(state.version, 1, 'a tick on a group line is an ordinary check');
  assert.deepEqual(validateState(json(state)), state, 'round-trips');
});

test('a group line belongs wholly to its group, until the group is removed', () => {
  const stage = markedPlan().stages['3'];
  const alpha = rowOf(stage, ALPHA_WIRE)!,
    central = rowOf(stage, WIRE)!;
  const groups = twoGroups();
  assert.deepEqual(rowMemberships(alpha, groups), [{ group: ALPHA, rate: null }]);
  assert.equal(homeGroup(alpha, groups), ALPHA);
  assert.deepEqual([...rowPlaces(alpha, groups)], [[ALPHA, 1]]);
  // An assignment saved for its id does not move it while its group exists.
  const moved = {
    ...groups,
    assignments: { ...groups.assignments, [ALPHA_WIRE]: [{ group: BETA, rate: null }] },
  };
  assert.equal(homeGroup(alpha, moved), ALPHA);
  // The central line has no group of its own here: Ungrouped.
  assert.equal(homeGroup(central, groups), UNGROUPED);
  // Alpha removed: the line is placed like any other row, by its saved memberships (none here).
  const gone = { ...groups, groups: groups.groups.filter(group => group.id !== ALPHA) };
  assert.deepEqual(rowMemberships(alpha, gone), []);
  assert.equal(homeGroup(alpha, gone), UNGROUPED);
  assert.equal(homeGroup(alpha, { ...moved, groups: gone.groups }), BETA);
});

test('the build plan lists each group line with its group (#869 order)', () => {
  const plan = markedPlan(),
    groups = twoGroups();
  const rows = plan.stages['3'].rows || [];
  const ordered = groupedRows(rows, groups);
  assert.equal(ordered.length, rows.length, 'every row once');
  // Each group's rows form one run, and its Wire line comes before the lines that use it.
  for (const [group, wire, user] of [
    [ALPHA, ALPHA_WIRE, 'Recipe_Stator_C'],
    [BETA, BETA_WIRE, 'Recipe_Cable_C'],
  ] as const) {
    const at = ordered
      .map((row, i) => (homeGroup(row, groups) === group ? i : -1))
      .filter(i => i >= 0);
    assert.ok(at.length >= 2, group);
    assert.equal(at[at.length - 1]! - at[0]!, at.length - 1, group + ' is one run');
    const index = (id: string) => ordered.findIndex(row => row.id === id);
    assert.ok(index(wire) >= 0 && index(wire) < index(user), wire + ' before ' + user);
  }
  // The steps follow the same order, with every step id kept.
  const steps = phaseSteps(plan, { checks: {}, factoryGroups: groups }, data, '3');
  assert.ok(steps.some(step => step.id === key(ALPHA_WIRE)));
});

test('two groups that make Wire on site have no Wire link between them', () => {
  const stage = markedPlan().stages['3'];
  const groups = twoGroups(true);
  const links = groupLinks(stage, groups);
  const wire = (from: string, to: string) =>
    links
      .find(link => link.from === from && link.to === to)
      ?.items.find(entry => entry.item === 'Wire')?.rate || 0;
  for (const [from, to] of [
    [ALPHA, BETA],
    [BETA, ALPHA],
    [CENTRAL, ALPHA],
    [CENTRAL, BETA],
  ])
    assert.equal(wire(from!, to!), 0, `${from} → ${to}`);
  // The central Wire line still serves the remaining consumers: the Ungrouped half of Cable.
  assert.ok(wire(CENTRAL, UNGROUPED) > 0, 'central → Ungrouped');
  // What a group's own line makes beyond the group's demand goes to the sink, not elsewhere.
  for (const [group, line] of [
    [ALPHA, ALPHA_WIRE],
    [BETA, BETA_WIRE],
  ] as const) {
    const made = rowOf(stage, line)!.outputs.Wire!;
    const asked = (stage.rows || []).reduce(
      (sum, row) => sum + (row.inputs.Wire || 0) * (rowPlaces(row, groups).get(group) || 0),
      0,
    );
    assert.ok(made >= asked - 1e-6, group + ' line covers its own demand');
    assert.ok(Math.abs(wire(group, OUTSIDE.surplus) - (made - asked)) < 1e-6, group + ' excess');
  }
  // The books keep that supply inside the groups.
  const books = itemBooks(stage, groups);
  assert.equal(books.supply.Wire?.get(ALPHA), undefined);
  assert.equal(books.demand.Wire?.get(ALPHA), undefined);
  // Without the marks the same lines are ordinary supply again. Each group then uses its own
  // supply first (#1022), and these lines were sized to their groups' demand, so there is still
  // no Wire link between the groups.
  const unmarkedGroups = { ...groups, local: {} };
  assert.ok((itemBooks(stage, unmarkedGroups).supply.Wire?.get(ALPHA) || 0) > 0, 'ordinary supply');
  const unmarked = groupLinks(stage, unmarkedGroups);
  assert.ok(
    !unmarked.some(
      link =>
        [ALPHA, BETA].includes(link.from) &&
        [ALPHA, BETA].includes(link.to) &&
        link.items.some(e => e.item === 'Wire'),
    ),
    'no Wire link between the groups without the marks either',
  );
});

test("a group's flow feeds its own Wire line to its own users first", () => {
  const stage = markedPlan().stages['3'];
  const groups = twoGroups(true);
  for (const [group, line] of [
    [ALPHA, ALPHA_WIRE],
    [BETA, BETA_WIRE],
  ] as const) {
    const flow = groupFlow(stage, groups, group, (_item, rate) => String(rate))!;
    const wireLine = flow.lines.find(entry => entry.id === line)!;
    const out = wireLine.outputs.find(row => row.item === 'Wire')!;
    const fed = out.links
      .filter(link => link.to.kind === 'line')
      .reduce((sum, link) => sum + link.rate, 0);
    // Every Wire input row of the group is fed from its own line, in full.
    const asked = flow.lines
      .flatMap(entry => entry.inputs)
      .filter(row => row.item === 'Wire')
      .reduce((sum, row) => sum + row.rate, 0);
    assert.ok(asked > 0, group + ' uses Wire');
    assert.ok(Math.abs(fed - asked) < 1e-6, `${group}: ${fed} of ${asked}`);
    // No Wire comes into the group from anywhere else.
    assert.ok(!flow.ins.some(port => port.item === 'Wire'), group + ' takes no Wire in');
  }
});

test('a recalculation that splits a ticked central line keeps the tick for review', () => {
  const source = progress({
    [key(WIRE)]: true,
    [key('Recipe_Stator_C')]: true,
    'unlock-some-milestone': true,
  });
  const before = json(source);
  const carried = newProfileState(markedPlan(), source, plainPlan(), undefined, undefined);
  assert.deepEqual(source, before, 'the source is only read');
  const state = carried.state;
  assert.deepEqual(state.onSiteReview, { checks: { [key(WIRE)]: true } }, 'kept exactly');
  assert.equal(state.version, 15);
  // The central line, which the new plan still has, is unticked for review, not guessed.
  assert.equal(state.checks[key(WIRE)], false);
  assert.ok(carried.reviewCount >= 1);
  // The group lines start unticked, like any new line.
  assert.equal(state.checks[key(ALPHA_WIRE)], undefined);
  assert.equal(state.checks[key(BETA_WIRE)], undefined);
  // Nothing of the source is lost: every tick is still ticked, kept for review, or (for a line
  // that grew) unticked for review with the source keeping it.
  for (const [checkKey, ticked] of Object.entries(source.checks))
    if (ticked)
      assert.ok(
        checkKey in state.checks || checkKey in (state.onSiteReview?.checks || {}),
        checkKey,
      );
  // It round-trips, and a carry without factory progress keeps none of it.
  assert.deepEqual(validateState(json(state)), state);
  const bare = newProfileState(markedPlan(), source, plainPlan(), {}, undefined).state;
  assert.equal(bare.onSiteReview, undefined);
  assert.equal(bare.checks[key(WIRE)], undefined);
});

test('recalculating with the same marks carries the group ticks as they are', () => {
  const plan = markedPlan();
  const source = progress({ [key(ALPHA_WIRE)]: true, [key(WIRE)]: true });
  const carried = newProfileState(plan, source, plan, undefined, undefined);
  assert.equal(carried.state.onSiteReview, undefined, 'every tick has its own line');
  assert.equal(carried.state.checks[key(ALPHA_WIRE)], true);
  assert.equal(carried.state.checks[key(WIRE)], true);
  assert.equal(carried.reviewCount, 0);
  assert.equal(carried.state.version, 14, 'only the groups’ marks: no review, no version 15');
  // An untouched central tick with no split in the new plan is not reviewed either.
  assert.deepEqual(
    siteTicksForReview(plainPlan(), { checks: { [key(WIRE)]: true } }, plainPlan()),
    [],
  );
});

test('recalculating without the mark keeps a ticked group line for review', () => {
  const source = progress({ [key(ALPHA_WIRE)]: true, [key(BETA_WIRE)]: false });
  const carried = newProfileState(plainPlan(), source, markedPlan(), undefined, undefined);
  // Only the ticked line; a line left unticked has nothing to review.
  assert.deepEqual(carried.state.onSiteReview, { checks: { [key(ALPHA_WIRE)]: true } });
  assert.equal(carried.state.checks[key(ALPHA_WIRE)], undefined, 'the plan has no such line');
  assert.equal(carried.state.version, 15);
});

test('ticks kept for review are listed with where their machines are now', () => {
  const groups = twoGroups();
  const entries = siteReviewEntries(
    { [key(WIRE)]: true, [key(`${WIRE}:${ALPHA}`)]: true, 'calc-3-Gone_C': true },
    markedPlan(),
    groups,
  );
  assert.deepEqual(
    entries.map(entry => [entry.key, entry.what, entry.now]),
    [
      [key('Gone_C'), key('Gone_C'), ''],
      [key(WIRE), 'Wire, Phase 3', 'Now made on site for Alpha and Beta, and on a central line.'],
      // A kept tick whose line this plan has again.
      [key(ALPHA_WIRE), 'Wire for Alpha, Phase 3', 'This line is in this plan.'],
    ].sort(([a], [b]) => a!.localeCompare(b!)),
  );
  // A dropped group line in a plan without group lines: named with its group.
  assert.deepEqual(
    siteReviewEntries({ [key(ALPHA_WIRE)]: true }, plainPlan(), groups).map(entry => [
      entry.what,
      entry.now,
    ]),
    [['Wire for Alpha, Phase 3', 'Now made on the central line.']],
  );
  assert.deepEqual(siteReviewEntries(undefined, plainPlan(), groups), []);
});

test('ticks kept for review are state version 15, validated, carried and never shared', () => {
  const clean = validateState(json(version15));
  assert.equal(clean.version, 15);
  assert.deepEqual(clean.onSiteReview, version15.onSiteReview);
  assert.deepEqual(validateState(json(clean)), clean, 'round-trips');
  // Empty: dropped, and the version stays what the rest needs.
  const empty = validateState(json({ ...version14, onSiteReview: { checks: {} } }));
  assert.equal('onSiteReview' in empty, false);
  assert.equal(empty.version, 14);
  for (const bad of [
    [],
    { checks: [] },
    { checks: { 'bad key': true } },
    { checks: { 'calc-3-Recipe_Wire_C': 'yes' } },
  ])
    assert.throws(
      () => validateState(json({ ...version14, onSiteReview: bad })),
      /Invalid ticks kept for review/,
      JSON.stringify(bad),
    );
  assert.throws(() => validateState({ ...json(clean), version: 16 }), /newer planner version/);
  // Every earlier released format loads unchanged and does not gain it.
  for (const [saved, version] of states.filter(([, version]) => version < 15)) {
    const loaded = validateState(json(saved));
    assert.equal(loaded.version, version);
    assert.equal('onSiteReview' in loaded, false, 'version ' + version);
  }
  // A share strips it with the rest of the progress; a carried profile keeps it, whatever the picks.
  assert.equal('onSiteReview' in shareState(json(clean)), false);
  const carried = newProfileState(null, json(clean), null, {}, undefined).state;
  assert.deepEqual(carried.onSiteReview, clean.onSiteReview);
  // No update op edits it.
  const ticked = mutate(clean, { type: 'check', key: key(WIRE), value: true });
  assert.deepEqual(ticked.onSiteReview, clean.onSiteReview);
  // A full export carries it through the import's check.
  assert.deepEqual(
    validateTransfer({
      ...saveExport,
      saves: [
        {
          ...saveExport.saves[0]!,
          profiles: [{ ...saveExport.saves[0]!.profiles[0]!, state: json(clean) }],
        },
      ],
    }).saves[0]!.profiles[0]!.state.onSiteReview,
    clean.onSiteReview,
  );
});

// The browser edition end to end: a profile with the central Wire line ticked, recalculated into
// a new profile with the groups' marks (settings.onSite, as #877 will send it), kept on reload.
// The Docker edition shares newProfileState through calculatedProfile (save-routes.ts).
test('the browser edition keeps an old central tick for review across a reload', async () => {
  const records = new Map<string, unknown>();
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
    );
  let api = open();
  const post = (route: string, body: unknown) => api(route, { body: JSON.stringify(body) });
  const made = (await post('/api/profiles', {
    saveName: 'World',
    name: 'First',
    settings: BASE,
  })) as { saveId: string; profileId: string };
  await post('/api/import', progress({ [key(WIRE)]: true }));
  const first = (await api('/api/state')) as ProgressState;
  assert.equal(first.checks[key(WIRE)], true);
  const second = (await post('/api/profiles', {
    saveId: made.saveId,
    name: 'Made on site',
    settings: { ...BASE, onSite: onSiteSettings(plainPlan(), twoGroups()) },
    carryFrom: made.profileId,
  })) as { reviewCount: number };
  assert.ok(second.reviewCount >= 1);
  api = open();
  const state = (await api('/api/state')) as ProgressState;
  assert.deepEqual(state.onSiteReview, { checks: { [key(WIRE)]: true } });
  assert.equal(state.checks[key(WIRE)], false);
  const summary = (await api('/api/workspace')) as WorkspaceSummary;
  assert.equal(summary.saves[0]!.profiles.length, 2, 'the first profile stays');
});
