// Lines running from the phase before (#1069) in the counts: the plan summary and "Built so far"
// count the lines Phase 1 marked running that Phase 2 builds again apart from Phase 2's own ticks,
// the build status runs them at their Phase 1 size, a factory card says how many machines already
// run, and the production line dialog marks the phases the line ran in. All of it reads the stored
// plan and the saved ticks: nothing is ticked, stored or recalculated.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { openCalculatedFactory } from '../../public/app/factory-detail.ts';
import { calculated, state, type View } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { currentBuildStatus } from '../../public/app/views/calculated.ts';
import { formatNumber } from '../../public/progression.ts';
import { $, $$, generatedWith, go, open, openMigrated, migratedPlan, page } from './setup.ts';
import type {
  CalcRow,
  CurrentCalculatedPlan,
  Phase,
  ProgressState,
  StageKey,
} from '../../public/types/index.ts';

// A plan from Phase 1, made once.
let made: CurrentCalculatedPlan | undefined;
const plan = () => structuredClone((made ??= generatedWith({ phase: '1' })));

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const allRunning = (stored: CurrentCalculatedPlan, stageKey: StageKey) =>
  Object.fromEntries(
    stored.stages[stageKey].rows!.map(row => [`calc-${stageKey}-${row.id}`, true]),
  );
// The Phase 2 lines Phase 1 also builds (the ones a Phase 1 tick carries).
const kept = (stored: CurrentCalculatedPlan) =>
  stored.stages['2'].rows!.filter(row => stored.stages['1'].rows!.some(r => r.id === row.id));
const earlier = (stored: CurrentCalculatedPlan, row: CalcRow) =>
  stored.stages['1'].rows!.find(candidate => candidate.id === row.id)!;

async function show(
  stored: CurrentCalculatedPlan,
  shown: Phase,
  progress: Partial<ProgressState>,
  view: View = 'plan',
) {
  open({ calculated: stored, phase: shown, state: progress });
  go(view);
  render();
  await nextTick();
}
const card = (rowId: string) =>
  $(`[data-check="calc-2-${rowId}"]`)!.closest<HTMLElement>('.factory-card')!;

beforeEach(() => page());

test('Phase 2 counts the lines Phase 1 ran apart from its own ticks', async () => {
  const stored = plan(),
    lines = kept(stored),
    total = stored.stages['2'].rows!.length;
  assert.ok(lines.length > 1 && lines.length < total, 'Phase 2 keeps some Phase 1 lines');
  await show(stored, '2', { checks: allRunning(stored, '1') });
  // The plain count of this phase's ticks stays as it was; the carried lines come after it.
  assert.match(
    text($('[data-summary="factories"]')),
    new RegExp(`^0 of ${total} production lines running, `),
  );
  assert.equal(
    text($('[data-summary="carried"]')),
    `${lines.length} more lines running since Phase 1`,
  );
  // "Built so far" says the same, and runs those lines at their Phase 1 size.
  const built = text($('[data-build-status] p'));
  assert.match(built, new RegExp(`^0 of ${total} production lines marked running\\. `));
  assert.match(
    text($('[data-build-carried]')),
    new RegExp(`^${lines.length} more run from Phase 1, counted at their Phase 1 size\\.$`),
  );
  const status = currentBuildStatus()!;
  assert.equal(status.builtCount, 0);
  assert.equal(status.carriedCount, lines.length);
  for (const row of lines) {
    const rowStatus = status.rows.find(r => r.id === row.id)!;
    assert.equal(rowStatus.built, false);
    assert.ok(rowStatus.carried! > 0 && rowStatus.carried! <= 1, row.id);
    assert.ok(rowStatus.share <= rowStatus.carried! + 1e-9, row.id);
  }
  // Some of what Phase 1 left running is made now.
  assert.ok(lines.some(row => status.rows.find(r => r.id === row.id)!.share > 0));
});

test('a carried line ticked in Phase 2 moves from the carried count to the plain one', async () => {
  const stored = plan(),
    lines = kept(stored),
    first = lines[0]!;
  await show(stored, '2', { checks: { ...allRunning(stored, '1'), ['calc-2-' + first.id]: true } });
  assert.match(text($('[data-summary="factories"]')), /^1 of \d+ production lines running, /);
  assert.equal(
    text($('[data-summary="carried"]')),
    `${lines.length - 1} more ${lines.length - 1 === 1 ? 'line' : 'lines'} running since Phase 1`,
  );
  const status = currentBuildStatus()!;
  assert.equal(status.builtCount, 1);
  assert.equal(status.carriedCount, lines.length - 1);
  assert.equal(status.rows.find(r => r.id === first.id)!.carried, undefined);
});

test('a factory card shows how many machines run since Phase 1', async () => {
  const stored = plan();
  const grown = kept(stored).find(row => row.machines > earlier(stored, row).machines)!;
  assert.ok(grown, 'the plan grows a Phase 1 line in Phase 2');
  const fresh = stored.stages['2'].rows!.find(row => !kept(stored).includes(row))!;
  await show(stored, '2', { checks: allRunning(stored, '1') }, 'factories');
  const grownCard = card(grown.id);
  assert.equal(
    text(grownCard.querySelector('[data-carried]')),
    `Running since Phase 1: ${formatNumber(earlier(stored, grown).machines)} of ${formatNumber(grown.machines)} machines`,
  );
  const chip = grownCard.querySelector('[data-running-status]')!;
  assert.equal(chip.getAttribute('data-running-status'), 'carried');
  assert.equal(text(chip), '◑ From Phase 1');
  // The Running box stays the user's to tick.
  assert.equal(
    grownCard.querySelector<HTMLInputElement>(`[data-check="calc-2-${grown.id}"]`)!.checked,
    false,
  );
  // A line new in Phase 2 is not built yet.
  assert.equal(card(fresh.id).querySelector('[data-carried]'), null);
  assert.equal(
    card(fresh.id).querySelector('[data-running-status]')!.getAttribute('data-running-status'),
    'idle',
  );
});

test('the production line dialog marks the phase it ran in and what Phase 2 changes', async () => {
  const stored = plan();
  const grown = kept(stored).find(row => row.machines > earlier(stored, row).machines)!;
  await show(stored, '2', { checks: allRunning(stored, '1') });
  openCalculatedFactory(grown.id);
  const rows = [...$$('#detail table').at(-1)!.querySelectorAll('tbody tr')];
  const ran = rows
    .filter(row => row.querySelector('[data-expansion-running]'))
    .map(row => text(row.querySelector('td')));
  assert.deepEqual(ran, ['Phase 1marked running']);
  assert.match(
    text($('[data-expansion-carried]')),
    new RegExp(`^Running since Phase 1: ${formatNumber(earlier(stored, grown).machines)} × `),
  );
});

test('nothing is carried without Phase 1 ticks, in Phase 1 or on a migrated profile', async () => {
  const stored = plan();
  await show(stored, '2', { checks: {} });
  assert.equal($('[data-summary="carried"]'), null);
  assert.equal($('[data-build-carried]'), null);
  assert.equal(currentBuildStatus()!.carriedCount, 0);
  await show(stored, '1', { checks: allRunning(stored, '1') });
  assert.equal($('[data-summary="carried"]'), null);
  assert.equal($('[data-build-carried]'), null);
  // A profile migrated from the handbook (a plan guide) hands nothing over.
  const migrated = migratedPlan();
  const checks = Object.fromEntries(
    (migrated.stages['2']?.rows || []).map(row => ['calc-2-' + row.id, true]),
  );
  openMigrated({ calculated: migrated, phase: '3', state: { checks } });
  go('plan');
  render();
  await nextTick();
  assert.equal($('[data-summary="carried"]'), null);
  assert.equal($('[data-build-carried]'), null);
});

test('the carried counts change no tick, running mark or stored plan', async () => {
  const stored = plan(),
    checks = { ...allRunning(stored, '1'), ['calc-2-' + kept(stored)[0]!.id]: true },
    frozenChecks = structuredClone(checks),
    frozenPlan = structuredClone(stored);
  await show(stored, '2', { checks });
  currentBuildStatus();
  go('factories');
  render();
  await nextTick();
  openCalculatedFactory(kept(stored)[1]!.id);
  await nextTick();
  assert.deepEqual(state.checks, frozenChecks);
  assert.deepEqual(calculated, frozenPlan);
});
