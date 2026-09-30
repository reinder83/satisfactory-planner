// rankAlternates (planner.ts): the hard-drive payoff of each alternate a profile does not allow,
// measured on one phase of its plan (#67).
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, rankAlternates } from '../planner.ts';

const MAM = ['Recipe_Alternate_EnrichedCoal_C', 'Recipe_Alternate_Turbofuel_C'];
const buildings = (settings: object, phase: '3') =>
  calculate(settings).stages[phase].rows!.reduce((total, r) => total + r.machines, 0);

test('a standard profile is compared with the same recipe pool the trials start from', () => {
  // Standard already has the two MAM recipes; each trial is custom with those plus one more.
  assert.equal(buildings({}, '3'), buildings({ recipes: 'custom', alternateRecipes: MAM }, '3'));
});

test('every alternate available by the phase is tried, with progress, and some pay off', () => {
  const progress: [number, number][] = [];
  const ranking = rankAlternates(
    {},
    { phase: '3', onProgress: (finished, total) => progress.push([finished, total]) },
  );
  assert.equal(ranking.phase, '3');
  assert.ok(ranking.total > 10, 'Phase 3 has many alternates: ' + ranking.total);
  assert.equal(ranking.candidates.length, ranking.total);
  assert.equal(ranking.stopped, false);
  assert.ok(
    ranking.candidates.every(c => c.phase <= 3),
    'nothing that unlocks later',
  );
  assert.ok(
    ranking.candidates.every(c => !MAM.includes(c.id)),
    'the MAM recipes are owned',
  );
  assert.deepEqual(
    progress.map(p => p[0]),
    ranking.candidates.map((_, i) => i + 1),
  );
  assert.ok(progress.every(p => p[1] === ranking.total));
  // At least one alternate saves buildings on the default plan, and says so consistently.
  const better = ranking.candidates.filter(c => c.status === 'better');
  assert.ok(better.length, JSON.stringify(ranking.candidates.map(c => [c.name, c.status])));
  for (const candidate of better)
    assert.ok(candidate.buildings <= 0 && candidate.rawTotal <= 1e-6, candidate.name);
  // A candidate the plan does not pick up changes nothing.
  for (const candidate of ranking.candidates.filter(c => c.status === 'same'))
    assert.deepEqual(
      [candidate.buildings, candidate.rawTotal, candidate.raw],
      [0, 0, {}],
      candidate.name,
    );
  assert.ok(ranking.base.buildings > 0);
  assert.ok(ranking.elapsedMs >= 0);
});

test('alternates the profile already allows are not candidates; "all" leaves none', () => {
  const all = rankAlternates({}, { phase: '3' });
  const owned = all.candidates[0]!.id;
  const custom = rankAlternates({ recipes: 'custom', alternateRecipes: [owned] }, { phase: '3' });
  assert.ok(!custom.candidates.some(c => c.id === owned));
  // Custom without the MAM recipes has those two as candidates as well.
  assert.equal(custom.total, all.total - 1 + MAM.length);
  const everything = rankAlternates({ recipes: 'all' }, { phase: '3' });
  assert.equal(everything.total, 0);
  assert.deepEqual(everything.candidates, []);
});

test('past the time budget the rest are skipped and the ranking says so', () => {
  const ranking = rankAlternates({}, { phase: '3', budgetMs: -1 });
  assert.equal(ranking.stopped, true);
  assert.equal(ranking.candidates.length, 0);
  assert.ok(ranking.total > 0);
});

test("a leftover preferred list does not change a standard profile's trials (#185)", () => {
  const plain = rankAlternates({}, { phase: '3' });
  for (const name of ['Recycled Rubber', 'Bolted Frame']) {
    const candidate = plain.candidates.find(c => c.name === name)!;
    assert.ok(candidate, name + ' is a Phase 3 candidate');
    // Once custom with this alternate preferred, now back on standard: the lists stay stored.
    const leftover = rankAlternates(
      { recipes: 'standard', alternateRecipes: [candidate.id], preferredRecipes: [candidate.id] },
      { phase: '3' },
    ).candidates.find(c => c.id === candidate.id)!;
    assert.deepEqual(
      [leftover.status, leftover.buildings, leftover.rawTotal],
      [candidate.status, candidate.buildings, candidate.rawTotal],
      name,
    );
  }
});
