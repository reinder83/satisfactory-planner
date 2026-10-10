// Each factory's handover from the phase before on the Factories page (#1069,
// ui/factories/FactoryHandover.vue): under a factory's heading, and over the ungrouped lines, the
// build plan's handover sentence counted over that factory's lines, unfolding to its lines kept as
// they run, those to add machines to or change a clock on (in the build-plan step's own words), the
// new ones, the ones the phase before did not mark running and the lines it retires. Nothing in
// Phase 1, Post Phase 5, a plan guide's phase or while groups are edited, and nothing once the
// lines are marked running. It reads the stored plan and the saved ticks: nothing is ticked,
// stored or recalculated.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import {
  carriedChange,
  carriedLine,
  handoverText,
  phaseHandover,
} from '../../public/app/handover.ts';
import { calculated, setFactoryEditing, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { buildRowName } from '../../public/app/views/calculated.ts';
import { listNames } from '../../public/wording.ts';
import { retiredLineText, retiredLines } from '../../public/progression.ts';
import { $, $$, evil, generatedWith, go, migratedPlan, open, openMigrated, page } from './setup.ts';
import type {
  CalcRow,
  CurrentCalculatedPlan,
  FactoryGroups,
  Phase,
  StageKey,
} from '../../public/types/index.ts';

// A plan from Phase 1, made once.
let made: CurrentCalculatedPlan | undefined;
const plan = () => structuredClone((made ??= generatedWith({ phase: '1' })));

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const running = (stored: CurrentCalculatedPlan, stageKey: StageKey, every = 1) =>
  Object.fromEntries(
    stored.stages[stageKey]
      .rows!.filter((_, i) => i % every === 0)
      .map(row => [`calc-${stageKey}-${row.id}`, true]),
  );

// Two factories, one with a hostile name: Alpha holds the first half of `rowIds`, the other the
// next quarter, and the rest stay ungrouped.
const ALPHA = 'fg-alpha',
  BETA = 'fg-beta';
function groupsOf(rowIds: string[]): FactoryGroups {
  const half = Math.ceil(rowIds.length / 2),
    quarter = Math.ceil(rowIds.length * 0.75);
  return {
    groups: [
      { id: ALPHA, name: 'Alpha' },
      { id: BETA, name: evil },
    ],
    assignments: Object.fromEntries(
      rowIds.flatMap((id, i) =>
        i < half
          ? [[id, [{ group: ALPHA, rate: null }]]]
          : i < quarter
            ? [[id, [{ group: BETA, rate: null }]]]
            : [],
      ),
    ),
  };
}

async function show(
  stored: CurrentCalculatedPlan,
  shown: Phase,
  checks: Record<string, boolean>,
  groups?: FactoryGroups,
) {
  open({
    calculated: stored,
    phase: shown,
    state: { version: 3, checks, ...(groups ? { factoryGroups: groups } : {}) },
  });
  go('factories');
  render();
  await nextTick();
}
const block = (place: string) => $(`[data-factory-handover="${place}"]`);
// A block's parts as label → entries.
const parts = (place: string) =>
  Object.fromEntries(
    [...block(place)!.querySelectorAll('dt')].map(dt => {
      const entries: string[] = [];
      for (let next = dt.nextElementSibling; next?.tagName === 'DD'; next = next.nextElementSibling)
        entries.push(text(next));
      return [dt.getAttribute('data-handover-status'), entries];
    }),
  );
// A line as the page names it: its build-plan step's title.
const name = (row: CalcRow) => buildRowName(row.id);
// `rows` by the place the page draws them in: Alpha, the other factory, Ungrouped.
const placesOf = (rows: CalcRow[], groups: FactoryGroups): [string, CalcRow[]][] => [
  [ALPHA, rows.filter(row => groups.assignments[row.id]?.[0]?.group === ALPHA)],
  [BETA, rows.filter(row => groups.assignments[row.id]?.[0]?.group === BETA)],
  ['ungrouped', rows.filter(row => !groups.assignments[row.id])],
];

beforeEach(() => page());

test('Phase 2 shows each factory what it keeps, adds and builds new from Phase 1', async () => {
  const stored = plan(),
    rows = stored.stages['2'].rows!,
    groups = groupsOf(rows.map(row => row.id)),
    checks = running(stored, '1');
  await show(stored, '2', checks, groups);
  const before = new Set(stored.stages['1'].rows!.map(row => row.id));
  const places = placesOf(rows, groups);
  const counts = { kept: 0, add: 0, clocks: 0, build: 0, retire: 0 };
  for (const [place, lines] of places) {
    const element = block(place)!;
    assert.ok(element, place);
    assert.equal(element.tagName, 'DETAILS', 'it folds');
    assert.equal(element.hasAttribute('open'), false, 'folded at first');
    const carried = (row: CalcRow) => carriedLine(stored, checks, '2', row.id);
    const change = (row: CalcRow) => carriedChange(carried(row)!, row);
    const keep = lines.filter(row => carried(row) && change(row) === 'Nothing to add or change.');
    const add = lines.filter(row => carried(row) && !keep.includes(row));
    const fresh = lines.filter(row => !before.has(row.id));
    // The summary is the build plan's sentence over this factory's lines.
    const summary = text(element.querySelector('summary'));
    assert.match(summary, /^Handover\. From Phase 1: /);
    const added = add.reduce(
      (sum, row) => sum + Math.max(0, row.machines - carried(row)!.before.machines),
      0,
    );
    counts.kept += keep.length + add.length;
    counts.add += added;
    counts.build += fresh.length;
    if (keep.length + add.length)
      assert.match(
        summary,
        new RegExp(
          `^Handover\\. From Phase 1: keep ${keep.length + add.length} lines? already running`,
        ),
      );
    // Its lines by status, in the build plan's words.
    const listed = parts(place);
    assert.deepEqual(listed.keep ?? [], keep.length ? [listNames(keep.map(name))] : []);
    assert.deepEqual(
      listed.add ?? [],
      add.map(row => `${name(row)}: ${change(row)}`),
    );
    assert.deepEqual(listed.new ?? [], fresh.length ? [listNames(fresh.map(name))] : []);
    assert.equal(listed.build, undefined, 'everything Phase 1 built ran');
    assert.equal(listed.retire, undefined, 'Phase 2 retires nothing of Phase 1');
  }
  // The factories split the build plan's summary between them.
  const whole = phaseHandover(stored, checks, '2')!;
  assert.equal(counts.kept, whole.kept);
  assert.equal(counts.add, whole.add);
  assert.equal(counts.build, whole.build);
  // The labels the parts carry.
  assert.deepEqual(
    [...block(ALPHA)!.querySelectorAll('dt')].map(dt => text(dt)),
    [
      ...(parts(ALPHA).keep ? ['Keep as is'] : []),
      ...(parts(ALPHA).add ? ['Add or change'] : []),
      ...(parts(ALPHA).new ? ['New in Phase 2'] : []),
    ],
  );
  // It sits under the factory's heading, before its cards.
  const section = $('#section-' + ALPHA)!;
  assert.ok(section.contains(block(ALPHA)));
  assert.ok(!$('#cards-' + ALPHA)!.contains(block(ALPHA)));
  assert.equal($$('x-evil').length, 0, 'a hostile factory name stays text');
});

test('Phase 3 lists what each factory retires and what Phase 2 did not mark running', async () => {
  const stored = plan(),
    retired = retiredLines(stored, 3);
  assert.ok(retired.length > 0, 'Phase 3 retires a Phase 2 line');
  // The retired lines go with Alpha, by their row id.
  const groups = groupsOf([
    ...retired.map(line => line.id),
    ...stored.stages['3'].rows!.map(row => row.id),
  ]);
  // Every other Phase 2 line ran.
  const checks = running(stored, '2', 2);
  await show(stored, '3', checks, groups);
  const listed = parts(ALPHA);
  assert.deepEqual(listed.retire, retired.map(retiredLineText));
  assert.match(
    text(block(ALPHA)!.querySelector('summary')),
    new RegExp(`; retire ${retired.length}\\.$`),
  );
  // The Phase 3 lines Phase 2 built but did not mark running, per place.
  const notRun = (row: CalcRow) =>
    !checks['calc-2-' + row.id] && stored.stages['2'].rows!.some(r => r.id === row.id);
  let pending = 0;
  for (const [place, lines] of placesOf(stored.stages['3'].rows!, groups)) {
    const expected = lines.filter(notRun);
    pending += expected.length;
    assert.deepEqual(
      parts(place).build ?? [],
      expected.length ? [listNames(expected.map(name))] : [],
      place,
    );
  }
  assert.ok(pending > 0, 'some lines Phase 2 did not mark running');
  assert.deepEqual(
    [...block(ALPHA)!.querySelectorAll('[data-handover-status="build"]')].map(dt => text(dt)),
    parts(ALPHA).build ? ['Not marked running in Phase 2'] : [],
  );
});

test('a factory whose lines all run here shows no handover, and neither does a page that is done', async () => {
  const stored = plan(),
    rows = stored.stages['2'].rows!,
    groups = groupsOf(rows.map(row => row.id)),
    alpha = rows.filter(row => groups.assignments[row.id]?.[0]?.group === ALPHA);
  await show(
    stored,
    '2',
    {
      ...running(stored, '1'),
      ...Object.fromEntries(alpha.map(row => ['calc-2-' + row.id, true])),
    },
    groups,
  );
  assert.equal(block(ALPHA), null, "Alpha's lines all run in Phase 2");
  assert.ok(block(BETA));
  assert.ok(block('ungrouped'));
  await show(stored, '2', { ...running(stored, '1'), ...running(stored, '2') }, groups);
  assert.equal($('[data-factory-handover]'), null, 'every line of Phase 2 runs');
});

test('no handover in Phase 1, Post Phase 5, on a plan guide or while factories are edited', async () => {
  const stored = plan(),
    groups = groupsOf(stored.stages['2'].rows!.map(row => row.id));
  await show(stored, '1', running(stored, '1'), groups);
  assert.equal($('[data-factory-handover]'), null, 'Phase 1');
  await show(stored, 'post', { ...running(stored, '4'), ...running(stored, '5', 2) }, groups);
  assert.equal($('[data-factory-handover]'), null, 'Post Phase 5');
  // Without factories, the page's lines are all ungrouped and get one handover.
  await show(stored, '2', running(stored, '1'));
  assert.equal($$('[data-factory-handover]').length, 1);
  assert.equal(
    text(block('ungrouped')!.querySelector('summary')),
    'Handover. ' + handoverText(phaseHandover(stored, running(stored, '1'), '2')!),
  );
  // While factories are edited, the picker stands under the heading instead.
  await show(stored, '2', running(stored, '1'), groups);
  setFactoryEditing(true);
  render();
  await nextTick();
  assert.equal($('[data-factory-handover]'), null, 'edit mode');
  setFactoryEditing(false);
  // A profile migrated from the handbook (a plan guide) hands nothing over.
  const migrated = migratedPlan();
  openMigrated({
    calculated: migrated,
    phase: '3',
    state: {
      checks: Object.fromEntries(
        (migrated.stages['2']?.rows || []).map(row => ['calc-2-' + row.id, true]),
      ),
    },
  });
  go('factories');
  render();
  await nextTick();
  assert.equal($('[data-factory-handover]'), null, 'plan guide');
});

test('the handover changes no tick, running mark or stored plan', async () => {
  const stored = plan(),
    groups = groupsOf(stored.stages['2'].rows!.map(row => row.id)),
    checks = { ...running(stored, '1'), ['calc-2-' + stored.stages['2'].rows![0]!.id]: true },
    frozenChecks = structuredClone(checks),
    frozenGroups = structuredClone(groups),
    frozenPlan = structuredClone(stored);
  await show(stored, '2', checks, groups);
  // Unfold every factory's handover.
  for (const summary of $$('[data-factory-handover] summary')) summary.click();
  await nextTick();
  assert.ok($$('[data-factory-handover][open]').length > 0);
  assert.deepEqual(state.checks, frozenChecks);
  assert.deepEqual(state.factoryGroups, frozenGroups);
  assert.deepEqual(calculated, frozenPlan);
});
