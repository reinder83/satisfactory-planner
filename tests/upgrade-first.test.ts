// Upgrade before expanding (#1169, the owner: "upgrade the belts / miners before placing more
// miners"). When a later phase draws more of a resource than the nodes the previous phase tapped
// give at that phase's cap, and the later phase's belt, miner, pipe or clock raises what those
// nodes give, the build plan's "Upgrade … before tapping more nodes" step (`upgrade-nodes-<stage>`)
// comes right before "Tap the resource nodes": it names each upgrade's milestone and the extra rate
// the tapped nodes bring in, and the mining step says how many of its nodes are new. Every phase
// taps the best nodes first from the same counted nodes, so the later phase's stored node count
// already uses the tapped nodes upgraded: nothing is recalculated, and a stored plan keeps its
// numbers and step ids (the new step is new content with a new id).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate } from '../planner.ts';
import { formatNumber, phaseSteps, phaseUpgrade } from '../public/progression.ts';
import { miningStep, nodeUpgrades, stageMiningAdvice } from '../public/mining.ts';
import { newProfileState, recalculatedProfile } from '../public/state.ts';
import type {
  Phase,
  Progression,
  StageKey,
  StoredCalculatedPlan,
  StoredProfile,
  StoredStage,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const fixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/plan-before-1169.json', import.meta.url), 'utf8'),
) as { plan: StoredCalculatedPlan; stepIds: Record<string, string[]> };
const PHASES: Phase[] = ['1', '2', '3', '4', '5', 'post'];
// A synthetic Phase 3 profile like the owner's: Miner Mk.2, Mk.4 belts, Mk.2 pipes; calculated now.
const SETTINGS = fixture.plan.settings;
const plans = new Map<string, StoredCalculatedPlan>();
const planWith = (extra: object = {}) => {
  const key = JSON.stringify(extra);
  if (!plans.has(key))
    plans.set(key, json(calculate({ ...SETTINGS, ...extra })) as StoredCalculatedPlan);
  return plans.get(key)!;
};
const stepsOf = (
  plan: StoredCalculatedPlan,
  phase: Phase,
  checks: Record<string, boolean> = {},
  working?: Phase,
) =>
  phaseSteps(plan, { checks, ...(working ? { settings: { phase: working } } : {}) }, data, phase);
const upgradeOf = (plan: StoredCalculatedPlan, phase: Phase, ...rest: [object?, Phase?]) =>
  stepsOf(plan, phase, ...(rest as [Record<string, boolean>?, Phase?])).find(step =>
    step.id.startsWith('upgrade-nodes-'),
  );
const n = formatNumber;
const ironOf = (stage: StoredStage) =>
  stageMiningAdvice(stage).find(entry => entry.resource === 'Iron Ore')!;

test('Phase 4 needs more Iron Ore: upgrade the belts to Mk.5 and the miners to Mk.3 first, with the extra rate, then 3 new nodes, not 8', () => {
  const plan = planWith();
  // Phase 3 taps 5 pure nodes at 480/min, a full Mk.4 belt each.
  const three = ironOf(plan.stages['3']);
  assert.equal(three.advice.nodes, 5);
  // Phase 4 draws more than those 5 nodes give at Phase 3's cap (2,400/min).
  const four = ironOf(plan.stages['4']);
  assert.ok(four.rate > 2400, `${four.rate}/min`);
  assert.deepEqual(plan.stages['4'].mining!.belt, { mark: 'Mk.5', cap: 780 });
  assert.equal(plan.stages['4'].mining!.miner.mark, 3);

  const upgrade = phaseUpgrade(plan, '4')!;
  assert.equal(upgrade.previous, 3);
  assert.deepEqual(upgrade.belt, { from: 'Mk.4', to: 'Mk.5' });
  assert.deepEqual(upgrade.miner, { from: 2, to: 3 });
  assert.equal(upgrade.pipe, null, 'Phase 3 already has Mk.2 pipes');
  assert.equal(upgrade.clock, null, 'both phases run up to 250%');
  const iron = upgrade.resources.find(own => own.resource === 'Iron Ore')!;
  assert.deepEqual(iron.tapped, [['pure', 5]]);
  assert.equal(iron.before, 5 * 480);
  assert.equal(iron.after, 5 * 780, 'a pure Mk.3 node at 250% is capped by its Mk.5 belt');
  // The plan's own node count for Phase 4 already uses the 5 upgraded nodes first: 8 in all,
  // the remainder after 5 × 780/min on 3 new nodes, where Phase 3's cap would take 8 new ones.
  const newNodes = Math.ceil((four.rate - 5 * 780) / 780 - 1e-9);
  assert.equal(four.advice.nodes, 5 + newNodes);
  assert.equal(iron.added, newNodes);
  assert.equal(iron.without, Math.ceil((four.rate - 5 * 480) / 480 - 1e-9));
  assert.ok(iron.without! > iron.added);
  // Crude Oil's pipe and clock are already the best in Phase 3: no upgrade for it.
  assert.equal(
    upgrade.resources.find(own => own.resource === 'Crude Oil'),
    undefined,
  );

  const step = upgradeOf(plan, '4')!;
  assert.equal(step.id, 'upgrade-nodes-4');
  assert.equal(
    step.title,
    'Upgrade the belts to Mk.5 and the miners to Mk.3 before tapping more nodes',
  );
  assert.equal(step.optional, undefined, 'a required step');
  assert.equal(step.satisfied, undefined);
  assert.ok(
    step.body.startsWith(
      'Phase 4 draws more than the nodes Phase 3 tapped give at their cap. Upgrade those nodes first, before tapping more: replace their Mk.4 belts with Conveyor Belt Mk.5 (milestone Logistics Mk.5, Tier 7) and replace their Miner Mk.2 with Miner Mk.3 (milestone Leading-Edge Production, Tier 8).',
    ),
    step.body,
  );
  assert.ok(
    step.body.includes(
      `Iron Ore: the 5 pure nodes give up to ${n(3900)}/min instead of ${n(2400)}/min, ${n(1500)}/min more; Phase 4 draws ${n(four.rate)}/min, so ${n(newNodes)} new nodes (${n(iron.without!)} without the upgrade).`,
    ),
    step.body,
  );
  assert.ok(step.body.endsWith('Then tap only the new nodes the next step lists.'));
  const row = step.table!.rows.find(cells => cells[0] === 'Iron Ore')!;
  assert.deepEqual(row, [
    'Iron Ore',
    '5 pure',
    `${n(2400)}/min`,
    `${n(3900)}/min (+${n(1500)})`,
    `${n(four.rate)}/min`,
    `${n(newNodes)} (${n(iron.without!)} without the upgrade)`,
  ]);
  assert.deepEqual(step.table!.columns, [
    'Resource',
    'Tapped nodes',
    'Now',
    'Upgraded',
    'Phase 4 draws',
    'New nodes',
  ]);

  // The mining step after it says which nodes are new.
  const mining = stepsOf(plan, '4').find(each => each.id === 'mining-4')!;
  const cells = mining.table!.rows.find(cells => cells[0] === 'Iron Ore')!;
  assert.equal(cells[2], `${n(5 + newNodes)} pure (5 tapped in Phase 3, ${n(newNodes)} new)`);
  assert.match(
    mining.body,
    /The nodes Phase 3 tapped give more once upgraded \(the step before\), so .* take \d+ new nodes, not \d+\./,
  );
  assert.ok(
    mining.body.includes(
      `Phase 3 tapped 5 of them, upgraded in the step before: ${n(newNodes)} new nodes.`,
    ),
  );
  // Caterium Ore, which Phase 3 did not mine, has no such note.
  assert.doesNotMatch(mining.table!.rows.find(cells => cells[0] === 'Caterium Ore')![2]!, /tapped/);
});

test('Phase 5 upgrades the belts to Mk.6; Iron Ore then needs no new nodes at all', () => {
  const plan = planWith();
  const upgrade = phaseUpgrade(plan, '5')!;
  assert.deepEqual(upgrade.belt, { from: 'Mk.5', to: 'Mk.6' });
  assert.equal(upgrade.miner, null, 'Miner Mk.3 already');
  const iron = upgrade.resources.find(own => own.resource === 'Iron Ore')!;
  const tapped = ironOf(plan.stages['4']).advice.nodes;
  assert.equal(iron.before, tapped * 780);
  assert.equal(iron.after, tapped * 1200);
  const five = ironOf(plan.stages['5']);
  assert.ok(five.rate > iron.before && five.rate <= iron.after, 'the upgrade covers it');
  assert.equal(iron.added, 0);
  const step = upgradeOf(plan, '5')!;
  assert.equal(step.title, 'Upgrade the belts to Mk.6 before tapping more nodes');
  assert.match(step.body, /Conveyor Belt Mk\.6 \(milestone Peak Efficiency, Tier 9\)/);
  assert.match(step.body, /Iron Ore: .*so no new nodes \(\d+ without the upgrade\)\./);
  const mining = stepsOf(plan, '5').find(each => each.id === 'mining-5')!;
  assert.equal(
    mining.table!.rows.find(cells => cells[0] === 'Iron Ore')![2],
    `${n(five.advice.nodes)} pure (all tapped in Phase 4)`,
  );
});

test('Miner Mk.3 alone: with Mk.5 belts already owned, Phase 4 upgrades only the miners', () => {
  const plan = planWith({ ownedBelt: 5 });
  assert.equal(plan.stages['3'].mining!.belt.mark, 'Mk.5');
  // A pure node under Miner Mk.2 at 250% gives 600/min, below its Mk.5 belt's 780.
  const iron3 = ironOf(plan.stages['3']);
  assert.equal(iron3.advice.runs[0]!.clock, 2.5);
  const upgrade = phaseUpgrade(plan, '4')!;
  assert.equal(upgrade.belt, null);
  assert.deepEqual(upgrade.miner, { from: 2, to: 3 });
  const iron = upgrade.resources.find(own => own.resource === 'Iron Ore')!;
  assert.equal(iron.before, iron3.advice.nodes * 600);
  assert.equal(iron.after, iron3.advice.nodes * 780);
  const step = upgradeOf(plan, '4')!;
  assert.equal(step.title, 'Upgrade the miners to Mk.3 before tapping more nodes');
  assert.match(
    step.body,
    /Upgrade those nodes first, before tapping more: replace their Miner Mk\.2 with Miner Mk\.3 \(milestone Leading-Edge Production, Tier 8\)\./,
  );
  assert.doesNotMatch(step.body, /belts with/);
});

test('the pipe: Crude Oil tapped on Mk.1 pipes gets Pipeline Mk.2 first, its extractors still to the exact remainder', () => {
  const plan = json(planWith());
  // A Phase 3 that carried its Crude Oil on Mk.1 pipes (300 m³/min a pure node at 250%).
  const three = plan.stages['3'];
  three.mining!.pipe = { mark: 'Mk.1', cap: 300 };
  three.mining!.sources['Crude Oil'] = three.mining!.sources['Crude Oil']!.map(source => ({
    ...source,
    cap: 300,
  }));
  three.raw = { ...three.raw, 'Crude Oil': 900 };
  const oil3 = stageMiningAdvice(three).find(entry => entry.resource === 'Crude Oil')!;
  assert.equal(oil3.advice.nodes, 3, '3 pure nodes at 300 m³/min');
  const four = plan.stages['4'];
  const oil4 = stageMiningAdvice(four).find(entry => entry.resource === 'Crude Oil')!;
  const upgrade = nodeUpgrades(three, four, 4)!;
  assert.deepEqual(upgrade.pipe, { from: 'Mk.1', to: 'Mk.2' });
  const oil = upgrade.resources.find(own => own.resource === 'Crude Oil')!;
  assert.equal(oil.fluid, true);
  assert.equal(oil.before, 900);
  assert.equal(oil.after, 1800, 'each of the 3 nodes up to 600 m³/min on Mk.2 pipes');
  assert.equal(oil.added, oil4.advice.nodes - 3);
  assert.equal(oil.without, Math.ceil((oil4.rate - 900) / 300 - 1e-9));
  const step = phaseSteps(plan, { checks: {} }, data, '4').find(
    each => each.id === 'upgrade-nodes-4',
  )!;
  assert.match(step.title, /the pipes to Mk\.2 before tapping more nodes$/);
  assert.match(
    step.body,
    /replace their Mk\.1 pipes with Pipeline Mk\.2 \(milestone Pipeline Engineering Mk\.2, Tier 6\)/,
  );
  assert.deepEqual(step.table!.rows.find(cells => cells[0] === 'Crude Oil')!.slice(0, 4), [
    'Crude Oil',
    '3 pure',
    `${n(900)} m³/min`,
    `${n(1800)} m³/min (+${n(900)})`,
  ]);
  // No fluid overproduction: the mining step's extractors still add up to the exact draw, the
  // last one underclocked (the advice is the stage's own, unchanged).
  const run = oil4.advice.runs[0]!;
  const output = run.full * 600 + (run.last ?? 0) * 240;
  assert.ok(Math.abs(output - oil4.rate) < 1e-6, `${output} against ${oil4.rate}`);
});

test('the build order: the milestones, then the upgrade, right before Tap the resource nodes', () => {
  const plan = planWith();
  const ids = stepsOf(plan, '4').map(step => step.id);
  const at = ids.indexOf('upgrade-nodes-4');
  assert.ok(at > 0, ids.join(' '));
  assert.equal(ids[at + 1], 'mining-4', 'right before the nodes are tapped');
  for (const milestone of ['Schematic_7-2_C', 'Schematic_8-4_C'])
    assert.ok(ids.indexOf('unlock-' + milestone) < at, `${milestone} before it`);
  assert.ok(ids.findIndex(id => id.startsWith('calc-4-')) > at, 'before the lines');
  // A stored plan whose Phase 4 is also its first overclocked phase: the research, the upgrade,
  // then the nodes.
  const stored = stepsOf(json(fixture.plan), '4').map(step => step.id);
  const research = stored.indexOf('power-shards-4');
  assert.deepEqual(stored.slice(research, research + 3), [
    'power-shards-4',
    'upgrade-nodes-4',
    'mining-4',
  ]);
});

test('no upgrade step in the start phase, in Post Phase 5, where the caps are already the best, or where no more is needed', () => {
  const plan = planWith();
  // The start phase has no tapped nodes before it; Post Phase 5 repeats Phase 5's nodes only.
  for (const phase of ['1', '2', '3', 'post'] as Phase[])
    assert.equal(upgradeOf(plan, phase), undefined, `Phase ${phase}`);
  const post = stepsOf(plan, 'post').find(step => step.id === 'mining-5')!;
  assert.doesNotMatch(post.body, /tapped in Phase|upgraded/);
  // Miner Mk.3 and Mk.6 belts already owned: nothing raises the cap, however much more is drawn.
  const best = planWith({ ownedBelt: 6, ownedMiner: 3 });
  assert.equal(best.stages['3'].mining!.belt.mark, 'Mk.6');
  assert.ok(ironOf(best.stages['4']).rate > ironOf(best.stages['3']).rate, 'Phase 4 draws more');
  for (const phase of PHASES) assert.equal(upgradeOf(best, phase), undefined, `Phase ${phase}`);
  for (const key of ['4', '5'] as StageKey[]) {
    assert.equal(phaseUpgrade(best, key), null);
    assert.doesNotMatch(
      miningStep(best.stages[key], key, best.settings, phaseUpgrade(best, key))!.body,
      /tapped in Phase|upgraded/,
    );
  }
  // No more drawn than the tapped nodes already give: no upgrade, though the cap would rise.
  const less = json(plan.stages['4']);
  less.raw = { 'Iron Ore': 2000 };
  assert.equal(nodeUpgrades(plan.stages['3'], less, 4), null);
  // A plan without mining per phase has no such step.
  const plain = json(calculate({ ...SETTINGS, phaseMining: undefined })) as StoredCalculatedPlan;
  for (const phase of PHASES) assert.equal(upgradeOf(plain, phase), undefined, `Phase ${phase}`);
});

test('the very early game: a Phase 1 profile taps at 100% in Phase 1, then upgrades the belts and overclocks in Phase 2', () => {
  const plan = json(calculate({ phase: '1', phaseMining: true })) as StoredCalculatedPlan;
  const upgrade = phaseUpgrade(plan, '2')!;
  assert.deepEqual(upgrade.belt, { from: 'Mk.2', to: 'Mk.3' });
  assert.deepEqual(upgrade.clock, { from: 1, to: 2.5 });
  // A pure node under Miner Mk.1 at 250% would already fill a Mk.3 belt (270/min): the Miner
  // Mk.2 does not raise what a tapped node gives, so the step does not ask for it.
  assert.equal(upgrade.miner, null);
  const step = upgradeOf(plan, '2')!;
  assert.equal(step.title, 'Upgrade the belts to Mk.3 before tapping more nodes');
  assert.ok(
    step.body.includes(
      'replace their Mk.2 belts with Conveyor Belt Mk.3 (milestone Logistics Mk.3, Tier 4) and overclock them from up to 100% to up to 250% with Power Shards.',
    ),
    step.body,
  );
  // Phase 1 itself, before the MAM, stays at 100% with no such step (#1137).
  assert.equal(upgradeOf(plan, '1'), undefined);
});

test('stable ids: the stored plan keeps every step id and number, the upgrade steps are new; it shows as done in a later phase', () => {
  const stored = json(fixture.plan);
  for (const phase of PHASES) {
    const ids = stepsOf(stored, phase).map(step => step.id);
    const added = ids.filter(id => !fixture.stepIds[phase]!.includes(id));
    assert.deepEqual(
      fixture.stepIds[phase]!.filter(id => !ids.includes(id)),
      [],
      `Phase ${phase} lists every old id`,
    );
    assert.deepEqual(
      added,
      phase === '4'
        ? ['power-shards-4', 'upgrade-nodes-4']
        : phase === '5'
          ? ['upgrade-nodes-5']
          : [],
      `Phase ${phase}`,
    );
  }
  // Its Phase 3 ran at 100%, so Phase 4's upgrade also overclocks the tapped nodes.
  const upgrade = phaseUpgrade(stored, '4')!;
  assert.deepEqual(upgrade.clock, { from: 1, to: 2.5 });
  // Its stored numbers are read as they are.
  assert.equal(ironOf(stored.stages['3']).advice.nodes, 10);
  assert.deepEqual(stored, fixture.plan, 'nothing about the stored plan changed');

  const plan = planWith();
  assert.equal(upgradeOf(plan, '4', {}, '5')!.satisfied, 'Done: you are working in a later phase.');
  assert.equal(upgradeOf(plan, '4', {}, '4')!.satisfied, undefined);
});

// `plan` as a stored profile with `checks` ticked, working on Phase 4.
const profileWith = (
  plan: StoredCalculatedPlan,
  checks: Record<string, boolean>,
): StoredProfile => {
  const state = newProfileState(plan, null, null, undefined, undefined).state;
  return {
    id: 'p',
    name: 'P',
    kind: 'calculated',
    plan,
    state: { ...state, checks: { ...state.checks, ...checks }, settings: { phase: '4' } },
  };
};
const recalculated = (previous: StoredProfile, plan: StoredCalculatedPlan) =>
  recalculatedProfile(previous, plan, 'P', undefined, undefined, 'b', 'B', data).profile.state
    .checks;

test('ticks carry: a recalculation in place keeps every listed tick, the upgrade steps’ included', () => {
  const ticks = Object.fromEntries(
    PHASES.flatMap(phase => stepsOf(json(fixture.plan), phase).map(step => step.id))
      .filter(id => !id.startsWith('calc-'))
      .map(id => [id, true]),
  );
  assert.equal(ticks['upgrade-nodes-4'], true);
  const plan = planWith();
  const checks = recalculated(profileWith(json(fixture.plan), ticks), plan);
  const listed = new Set(PHASES.flatMap(phase => stepsOf(plan, phase).map(step => step.id)));
  assert.ok(listed.has('upgrade-nodes-4') && listed.has('upgrade-nodes-5'));
  const lost = Object.keys(ticks).filter(id => listed.has(id) && checks[id] !== true);
  assert.deepEqual(lost, []);
  assert.equal(checks['upgrade-nodes-4'], true);
  assert.equal(checks['upgrade-nodes-5'], true);
  assert.equal(checks['mining-4'], true);
});
