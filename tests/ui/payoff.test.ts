// The hard-drive payoff table (#204): app/payoff.ts's sorting and wording, and
// ui/plan/PayoffPanel.vue on the calculated plan page, mounted through render().
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import {
  payoffBest,
  payoffDefaultSort,
  payoffDelta,
  payoffTable,
} from '../../public/app/payoff.ts';
import { payoff as sessionPayoff, setPayoff } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import {
  $,
  $$,
  catalog,
  evil,
  generated as makeGenerated,
  go,
  open,
  page,
  stubFetch,
} from './setup.ts';
import type {
  AlternatePayoff,
  AlternateRanking,
  StoredCalculatedPlan,
  StoredPayoff,
} from '../../public/types/index.ts';

const generated = makeGenerated();
const alternates = catalog().alternates;
// One candidate: `id` is a real alternate, so its dialog opens.
const entry = (
  i: number,
  status: AlternatePayoff['status'],
  buildings: number,
  hours: number | null,
  over: Partial<AlternatePayoff> = {},
): AlternatePayoff => ({
  id: alternates[i]!.id,
  name: 'Alt ' + i,
  machine: 'Constructor',
  phase: 2,
  status,
  buildings,
  raw: {},
  rawTotal: buildings * 10,
  powerMW: buildings * 4,
  hours,
  ...over,
});
const ranking = (over: Partial<AlternateRanking> = {}): AlternateRanking => ({
  phase: '3',
  base: { buildings: 100, rawTotal: 1000, requiredMW: 400, hours: 10 },
  candidates: [
    entry(0, 'better', -5, -1),
    entry(1, 'worse', 3, 1),
    entry(2, 'mixed', -1, 2),
    entry(3, 'same', 0, 0),
    entry(4, 'infeasible', 0, 0, { error: evil }),
    entry(5, 'better', -2, -3),
    entry(6, 'better', -2, null, { name: 'Alt 6 ' + evil }),
  ],
  total: 7,
  stopped: false,
  elapsedMs: 1200,
  ...over,
});
const stored = (over: Partial<AlternateRanking> = {}): StoredPayoff => ({
  planCreatedAt: generated.createdAt,
  rankedAt: '2026-09-26T12:00:00Z',
  ranking: ranking(over),
});
const names = () => $$('[data-payoff-row] td:first-child button').map(b => b.textContent!.trim());
const settle = async () => {
  await new Promise(r => setTimeout(r, 20));
  await nextTick();
};
function openPlan(goal?: StoredCalculatedPlan['settings']['goal']) {
  const plan = structuredClone(generated) as StoredCalculatedPlan;
  if (goal) plan.settings.goal = goal;
  open({ calculated: plan, workspace: { catalog: catalog() } });
}

beforeEach(() => {
  page();
  go('plan');
});

test('the table sorts by what the goal optimises, collapses unchanged rows and keeps failures last', () => {
  assert.equal(payoffDefaultSort('minimal'), 'buildings');
  assert.equal(payoffDefaultSort('balanced'), 'buildings');
  assert.equal(payoffDefaultSort('timed'), 'hours');
  assert.equal(payoffDefaultSort('maximum'), 'hours');
  const byBuildings = payoffTable(ranking(), 'buildings');
  assert.deepEqual(
    byBuildings.rows.map(p => p.name),
    ['Alt 0', 'Alt 5', 'Alt 6 ' + evil, 'Alt 2', 'Alt 1', 'Alt 4'],
  );
  assert.equal(byBuildings.same, 1);
  // Missing hours sort after every figure, either way round; the failed row stays last.
  assert.deepEqual(
    payoffTable(ranking(), 'hours').rows.map(p => p.name),
    ['Alt 5', 'Alt 0', 'Alt 1', 'Alt 2', 'Alt 6 ' + evil, 'Alt 4'],
  );
  assert.deepEqual(
    payoffTable(ranking(), 'hours', -1).rows.map(p => p.name),
    ['Alt 2', 'Alt 1', 'Alt 0', 'Alt 5', 'Alt 6 ' + evil, 'Alt 4'],
  );
  assert.equal(payoffBest(ranking(), 'buildings')!.name, 'Alt 0');
  assert.equal(payoffBest(ranking(), 'hours')!.name, 'Alt 5');
  assert.equal(payoffBest(ranking({ candidates: [entry(1, 'worse', 3, 1)] }), 'buildings'), null);
  const [a] = ranking().candidates;
  assert.equal(payoffDelta(a!, 'buildings'), '−5');
  assert.equal(payoffDelta(a!, 'powerMW'), '−20 MW');
  assert.equal(payoffDelta(a!, 'rawTotal'), '−50/min');
  assert.equal(payoffDelta(ranking().candidates[1]!, 'hours'), '+1 h');
  assert.equal(payoffDelta(ranking().candidates[6]!, 'hours'), '–');
  assert.equal(payoffDelta(ranking().candidates[4]!, 'buildings'), '–');
});

test('a stored ranking shows on the calculated plan; headers re-sort and rows open the recipe', async () => {
  openPlan();
  setPayoff(stored());
  render();
  assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');
  assert.match($('[data-payoff-summary]')!.textContent!, /7 of 7 alternates checked for\s+Phase 3/);
  assert.equal($('[data-rank-alternates]')!.textContent!.trim(), 'Re-rank');
  assert.deepEqual(names(), ['Alt 0', 'Alt 5', 'Alt 6 ' + evil, 'Alt 2', 'Alt 1', 'Alt 4']);
  assert.match($('[data-payoff-same]')!.textContent!, /1 other alternate changes\s+nothing/);
  assert.equal($('[data-payoff-row] .payoff-better')!.textContent, 'Pays off');
  assert.equal($(`[data-payoff-row="${alternates[4]!.id}"] td:nth-child(2)`)!.title, evil);
  assert.equal($('th[aria-sort="ascending"] [data-payoff-sort]')!.dataset.payoffSort, 'buildings');
  $('[data-payoff-sort="hours"]')!.click();
  await nextTick();
  assert.deepEqual(names().slice(0, 2), ['Alt 5', 'Alt 0']);
  $('[data-payoff-sort="hours"]')!.click();
  await nextTick();
  assert.equal($('th[aria-sort="descending"] [data-payoff-sort]')!.dataset.payoffSort, 'hours');
  assert.deepEqual(names().slice(0, 2), ['Alt 2', 'Alt 1']);
  $(`[data-payoff-recipe="${alternates[0]!.id}"]`)!.click();
  await nextTick();
  const dialog = $<HTMLDialogElement>('#detail')!;
  assert.equal(dialog.open, true);
  assert.match(dialog.textContent!, new RegExp(alternates[0]!.name.replace('Alternate: ', '')));
});

test('a timed profile sorts by delivery time; a ranking of another phase is only mentioned', async () => {
  openPlan('timed');
  setPayoff(stored());
  render();
  assert.equal($('th[aria-sort="ascending"] [data-payoff-sort]')!.dataset.payoffSort, 'hours');
  assert.equal(names()[0], 'Alt 5');
  setPayoff(stored({ phase: '2' }));
  render();
  await nextTick();
  assert.equal(names().length, 0);
  assert.match($('[data-payoff-other]')!.textContent!, /for\s+Phase 2/);
  assert.equal($('[data-rank-alternates]')!.textContent!.trim(), 'Rank alternates');
  // A stopped ranking says so; one with nothing left to allow says that.
  setPayoff(stored({ stopped: true, total: 20 }));
  render();
  await nextTick();
  assert.match($('[data-payoff-summary]')!.textContent!, /7 of 20/);
  assert.ok($('[data-payoff-stopped]'));
  setPayoff(stored({ candidates: [], total: 0 }));
  render();
  await nextTick();
  assert.ok($('[data-payoff-none]'));
});

test('Rank alternates runs the ranking for the phase on screen and shows it', async () => {
  openPlan();
  render();
  assert.equal(sessionPayoff, null);
  assert.match($('[data-payoff]')!.textContent!, /does not allow\s+yet/);
  const calls = stubFetch({ '/api/rank-alternates': stored() });
  $('[data-rank-alternates]')!.click();
  await nextTick();
  assert.equal($<HTMLButtonElement>('[data-rank-alternates]')!.disabled, true);
  assert.match($('[data-payoff-progress]')!.textContent!, /Checking alternates/);
  await settle();
  assert.deepEqual(calls, [['/api/rank-alternates', { phase: '3' }]]);
  assert.equal(names().length, 6);
  assert.ok(!$('[data-payoff-progress]'));
  assert.equal($<HTMLButtonElement>('[data-rank-alternates]')!.disabled, false);
});

test('the panel is left out of a phase without a plan', () => {
  const plan = structuredClone(generated) as StoredCalculatedPlan;
  plan.stages['3'].feasible = false;
  open({ calculated: plan });
  render();
  assert.ok(!$('[data-payoff]'));
});

test('a column no alternate changes is left out and named under the table', () => {
  openPlan();
  const flat = ranking();
  for (const p of flat.candidates) p.hours = 0;
  setPayoff({ ...stored(), ranking: flat });
  render();
  assert.deepEqual(
    $$('[data-payoff-sort]').map(b => b.dataset.payoffSort),
    ['buildings', 'rawTotal', 'powerMW'],
  );
  assert.equal($$('[data-payoff-row]')[0]!.querySelectorAll('td').length, 5);
  assert.match($('[data-payoff-unchanged]')!.textContent!, /No alternate changes delivery time/);
});
