// Water Extractors in both options, one suggested (#1142): no setting limits them to one. Every
// advice of them (a line's, the mining step's Water row, the power step, ADA) gives the 100% and the
// overclocked option, each with the last extractor underclocked to the exact remainder, the
// suggested one first: the one the phase's power counts (settings.waterOverclock, or what a stored
// stage was calculated with). Where the plan counts on no Power Shards yet (a Phase 2 or 3 stage
// stored at 100% before #1169) the overclocked option gives its count after the research (#1169);
// before the MAM only the 100% option is given. The setting's field is unchanged,
// so stored plans keep their numbers and load, import and export as before. Numbers as in en-US.
import './helpers/en-us-numbers.ts';
import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { calculate, catalog } from '../planner.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import {
  miningStep,
  waterChoice,
  waterExtractorWords,
  waterOptions,
  waterPowerWords,
  WATER_ROW_NOTE,
} from '../public/mining.ts';
import { adaRemarks } from '../public/ada.ts';
import { extractorAdvice, lineAdvice, recycleModel } from '../public/app/recycle.ts';
import { defaultFactoryGroups } from '../public/state/factory-groups.ts';
import { initialState } from '../public/state.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import {
  phaseMining,
  resourceDefaults,
  waterClock,
  waterMWPerUnit,
} from '../public/preferences.ts';
import { phaseSteps } from '../public/progression.ts';
import type { AdviceWords } from '../public/app/recycle.ts';
import type { MiningSettings } from '../public/preferences/mining.ts';
import type {
  CalcRow,
  Progression,
  SaveExport,
  StoredCalculatedPlan,
  StoredStage,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const plain = (text: string) => text.replace(/ /g, ' ');
const limits = resourceDefaults('vanilla', 'original').limits;
// A synthetic stage of `phase` with mining per phase, drawing Iron Ore and the owner's 258.04
// m³/min of Water (#1024's example).
const stageAt = (phase: number, extra: { overclock?: boolean; waterOverclock?: boolean } = {}) =>
  ({
    mining: phaseMining({ limits, ...extra }, phase),
    raw: { 'Iron Ore': 480, Water: 258.04 },
  }) as Pick<StoredStage, 'mining' | 'raw'>;
const choiceAt = (phase: number, extra: { overclock?: boolean; waterOverclock?: boolean } = {}) =>
  waterChoice(stageAt(phase, extra), phase, extra);
// The same stage as stored before #1169 in Phase 2 or 3, without Power Shards: miners and Water
// Extractors at 100%.
const storedAt100 = (phase: number) => {
  const stage = stageAt(phase);
  stage.mining!.miner = { ...stage.mining!.miner, clock: 1 };
  stage.mining!.water = 1;
  return stage;
};
const storedChoice = (phase: number, extra: { waterOverclock?: boolean } = {}) => {
  // The plan's settings; the stored stage counts its Water at 100% whatever they say.
  const settings: MiningSettings = { limits, ...extra };
  return waterChoice(storedAt100(phase), phase, settings);
};

const PLAIN = '2 at 100% + 1 at 15.03% (3 extractors, 41.63 MW)';
const SHARDED = '1 overclocked at 215.03% (1 extractor, 3 Power Shards, 55.03 MW)';
const AFTER_RESEARCH =
  'after researching Power Shards in the MAM: Blue Power Slugs, then Overclock Production';
// The overclocked option where the plan counts on no Power Shards yet (#1169): its count, after
// the research.
const RESEARCHED = `overclocked (${AFTER_RESEARCH}): 1 at 215.03% (1 extractor, 3 Power Shards, 55.03 MW)`;

test('which option is suggested, and what the overclocked one gives, per phase and setting', () => {
  // Phase 4 with mining per phase: both counted, 100% suggested unless the setting says otherwise.
  assert.deepEqual(choiceAt(4), { overclock: 2.5, suggestOverclocked: false, shards: 'count' });
  assert.deepEqual(choiceAt(4, { waterOverclock: true }), {
    overclock: 2.5,
    suggestOverclocked: true,
    shards: 'count',
  });
  // Phases 2 and 3 plan overclocked since #1169: a count, and the setting picks the suggested one.
  for (const phase of [2, 3]) {
    assert.deepEqual(choiceAt(phase), {
      overclock: 2.5,
      suggestOverclocked: false,
      shards: 'count',
    });
    assert.equal(choiceAt(phase, { waterOverclock: true }).suggestOverclocked, true);
  }
  // A Phase 2 or 3 stage stored at 100% before #1169: the count after the research, whatever the
  // setting.
  for (const phase of [2, 3])
    for (const waterOverclock of [false, true])
      assert.deepEqual(
        storedChoice(phase, { waterOverclock }),
        { overclock: 2.5, suggestOverclocked: false, shards: 'research' },
        `Phase ${phase}`,
      );
  // Once the player can overclock, a count, and the setting picks the suggested one.
  assert.equal(choiceAt(3, { overclock: true }).shards, 'count');
  assert.equal(choiceAt(3, { overclock: true }).suggestOverclocked, false);
  assert.equal(choiceAt(3, { overclock: true, waterOverclock: true }).suggestOverclocked, true);
  // Phase 1, before the MAM: only the 100% option.
  assert.equal(choiceAt(1).shards, 'none');
  assert.equal(choiceAt(1, { waterOverclock: true }).shards, 'none');
  // A plan without mining per phase counts its survey's clock, else 250%, as before.
  assert.deepEqual(waterChoice({}, 3, {}), {
    overclock: 2.5,
    suggestOverclocked: true,
    shards: 'count',
  });
  assert.deepEqual(waterChoice({}, 3, { extraction: { clock: 1 } }), {
    overclock: 2.5,
    suggestOverclocked: false,
    shards: 'count',
  });
});

test('a line’s advice gives both options, the suggested one first, and never hides one', () => {
  assert.equal(
    plain(waterExtractorWords(258.04, choiceAt(4))),
    `Water Extractors at 100% (suggested): ${PLAIN}. Or ${SHARDED}.`,
  );
  assert.equal(
    plain(waterExtractorWords(258.04, choiceAt(4, { waterOverclock: true }))),
    `Water Extractors (suggested): ${SHARDED}. Or at 100%: ${PLAIN}.`,
  );
  assert.equal(
    plain(waterExtractorWords(258.04, choiceAt(3))),
    `Water Extractors at 100% (suggested): ${PLAIN}. Or ${SHARDED}.`,
  );
  // Never the research advice alone (#1169): the overclocked figures, after the research.
  assert.equal(
    plain(waterExtractorWords(258.04, storedChoice(3))),
    `Water Extractors at 100% (suggested): ${PLAIN}. Or ${RESEARCHED}.`,
  );
  assert.equal(
    plain(waterExtractorWords(258.04, choiceAt(1))),
    `Water Extractors at 100%: ${PLAIN}.`,
  );
  // One extractor at 100% or less is the same either way.
  for (const choice of [choiceAt(4), choiceAt(4, { waterOverclock: true }), storedChoice(3)])
    assert.equal(
      plain(waterExtractorWords(7.49, choice)),
      'Water Extractors: 1 at 6.24% (0.51 MW); no Power Shards needed.',
    );
  // The line advice (recycle.ts) is the same words.
  assert.equal(
    extractorAdvice(258.04, choiceAt(4, { waterOverclock: true })),
    waterExtractorWords(258.04, choiceAt(4, { waterOverclock: true })),
  );
});

test("the owner's Water row (#1169): the overclocked option's figures, never cut off, the last one rounded down", () => {
  // 33 at 100% + 1 at 82.06%: 4,058.47 m³/min. Overclocked, 13 at 250% and the remainder, whose
  // exact clock (132.0627%) is rounded down so the pipe never overflows.
  const rate = 33 * 120 + 0.8206 * 120;
  assert.equal(
    plain(waterExtractorWords(rate, storedChoice(3))),
    `Water Extractors at 100% (suggested): 33 at 100% + 1 at 82.06% (34 extractors, 675.4 MW). Or overclocked (${AFTER_RESEARCH}): 13 at 250% + 1 at 132.06% (14 extractors, 40 Power Shards, 901.9 MW).`,
  );
  const over = waterOptions(rate, storedChoice(3))!.second!.option;
  const made = over.runs.reduce((sum, run) => sum + run.count * run.clock, 0) * 1.2;
  assert.ok(made <= rate + 1e-9 && rate - made < 0.012, `${made} for ${rate}`);
});

test('Water is never rounded up, in either option, whichever is suggested (property)', () => {
  let seed = 1142;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2000;
  const choices = [
    choiceAt(4),
    choiceAt(4, { waterOverclock: true }),
    choiceAt(3),
    storedChoice(3),
    choiceAt(1),
    waterChoice(undefined, 3, { extraction: { clock: 1.5 } }),
  ];
  for (let i = 0; i < 500; i++) {
    const rate = 1.2 + random();
    for (const choice of choices) {
      const options = waterOptions(rate, choice)!;
      const all = [options.first, options.second].flatMap(part =>
        part && 'option' in part ? [part.option] : [],
      );
      // Both options have figures, except before the MAM (#1169).
      assert.equal(all.length, choice.shards === 'none' || options.same ? all.length : 2);
      assert.ok(all.length >= 1);
      for (const option of all) {
        const clocks = option.runs.flatMap(run => Array<number>(run.count).fill(run.clock));
        const made = clocks.reduce((sum, clock) => sum + clock, 0) * 1.2;
        assert.ok(made <= rate + 1e-7, `${rate}: ${made} is more than needed`);
        assert.ok(rate - made < 0.012 + 1e-7, `${rate}: ${made} is short`);
        // All extractors at the option's clock but the last one or two.
        assert.ok(clocks.filter(clock => clock < option.full).length <= 2);
      }
    }
  }
});

test('the mining step’s table has a Water row with both options; its totals add the suggested one', () => {
  for (const [extra, first, other, shards, power] of [
    [{}, `at 100% (suggested): 2 at 100% + 1 at 15.03%`, `Or ${SHARDED}`, 'None', '41.63 MW'],
    [
      { waterOverclock: true },
      `(suggested): 1 overclocked at 215.03%`,
      `At 100%: ${PLAIN}`,
      '3',
      '55.03 MW',
    ],
  ] as const) {
    const stage = stageAt(4, extra);
    const step = miningStep(stage, '4', { limits, ...extra })!;
    const water = step.table.rows.at(-1)!.map(plain);
    assert.deepEqual(water, [
      'Water',
      '258.04 m³/min',
      'Open water',
      `Water Extractor ${first}. ${other}`,
      shards,
      power,
    ]);
    // The total adds the suggested option's extractors, shards and MW to the miners'.
    const without = miningStep({ ...stage, raw: { 'Iron Ore': 480 } }, '4', { limits })!;
    const extractors = extra.waterOverclock ? 1 : 3;
    const machines = (row: string[]) => Number(row[3]!.split(' ')[0]);
    assert.equal(machines(step.table.total!), machines(without.table.total!) + extractors);
    assert.match(step.table.after!, new RegExp(WATER_ROW_NOTE.replace(/[.;]/g, '\\$&') + '$'));
    assert.ok(plain(step.body).includes('Water 258.04 m³/min: Water Extractors '));
  }
  // Phase 3 since #1169: both options with figures.
  assert.deepEqual(
    miningStep(stageAt(3), '3', { limits })!.table.rows.at(-1)!.slice(3).map(plain),
    [
      `Water Extractor at 100% (suggested): 2 at 100% + 1 at 15.03%. Or ${SHARDED}`,
      'None',
      '41.63 MW',
    ],
  );
  // A Phase 3 stored at 100%: the 100% option counted, the overclocked one's figures after the
  // research (#1169), no shards counted.
  const early = miningStep(storedAt100(3), '3', { limits })!;
  assert.deepEqual(early.table.rows.at(-1)!.slice(3).map(plain), [
    `Water Extractor at 100% (suggested): 2 at 100% + 1 at 15.03%. Overclocked (${AFTER_RESEARCH}): 1 at 215.03% (1 extractor, 3 Power Shards, 55.03 MW)`,
    'None',
    '41.63 MW',
  ]);
  // Phase 1, before the MAM: the 100% option alone.
  const first = miningStep(stageAt(1), '1', { limits })!;
  assert.equal(
    plain(first.table.rows.at(-1)![3]!),
    'Water Extractor at 100%: 2 at 100% + 1 at 15.03%',
  );
});

// --- On the planner's own plans ---

const phase4 = json(calculate({ phase: '4', phaseMining: true }));
const phase4Over = json(calculate({ phase: '4', phaseMining: true, waterOverclock: true }));
const phase2 = json(calculate({ phase: '2', phaseMining: true }));
// The same Phase 2 as stored before #1169: its miners and Water Extractors at 100%.
const phase2At100 = () => {
  const plan = json(phase2);
  const mining = plan.stages['2'].mining!;
  mining.miner = { ...mining.miner, clock: 1 };
  mining.water = 1;
  return plan;
};

test('the suggested option is the one the power total counts', () => {
  for (const [plan, clock] of [
    [phase4, 1],
    [phase4Over, 2.5],
  ] as const) {
    const stage = plan.stages['4'];
    const water = stage.raw!.Water!;
    assert.ok(water > 0, 'Phase 4 extracts Water');
    assert.equal(waterClock(stage.mining!), clock);
    assert.equal(waterChoice(stage, 4, plan.settings).suggestOverclocked, clock > 1);
    const counted = water * waterMWPerUnit(clock) * (plan.settings.powerFactor ?? 1);
    assert.ok(Math.abs(stage.grid!.extraction.Water! - counted) < 1e-6);
  }
  // Overclocked Water Extractors draw more per m³, so the total is higher with the setting.
  const per = (plan: StoredCalculatedPlan) =>
    plan.stages['4'].grid!.extraction.Water! / plan.stages['4'].raw!.Water!;
  assert.ok(per(phase4Over) > per(phase4));
});

test('the power step says which option it counts, and the other one', () => {
  const words = (plan: StoredCalculatedPlan, phase: number) =>
    plain(waterPowerWords(plan.stages[String(phase) as '4'], phase, plan.settings));
  assert.match(
    words(phase4, 4),
    /^ This phase's power counts its Water Extractors at 100%, the suggested option: \d+ extractors drawing [\d.]+ MW\. Overclocked instead, they would take \d+ extractors? and \d+ Power Shards?, drawing [\d.]+ MW\.$/,
  );
  assert.match(
    words(phase4Over, 4),
    /^ This phase's power counts its Water Extractors overclocked, the suggested option: \d+ extractors? and \d+ Power Shards?, drawing [\d.]+ MW\. At 100% instead, they would take \d+ extractors drawing [\d.]+ MW\.$/,
  );
  assert.match(
    words(phase2, 2),
    /the suggested option: \d+ extractors? drawing [\d.]+ MW\. Overclocked instead, they would take \d+ extractors? and \d+ Power Shards?, drawing [\d.]+ MW\.$/,
  );
  // Stored at 100% before #1169: the overclocked figures, after the research.
  assert.ok(
    words(phase2At100(), 2).includes(
      `MW. Overclocked instead (${AFTER_RESEARCH}), they would take `,
    ),
    words(phase2At100(), 2),
  );
  assert.match(
    words(phase2At100(), 2),
    /they would take \d+ extractors? and \d+ Power Shards?, drawing [\d.]+ MW\.$/,
  );
  // The step itself ends with it.
  const data: Progression = JSON.parse(
    fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
  );
  const steps = phaseSteps(phase4Over, { checks: {} }, data, '4');
  const power = steps.find(step => step.id === 'startup-4-power-review');
  assert.ok(power, 'the power step');
  assert.ok(plain(power.body).endsWith(words(phase4Over, 4)), power.body);
});

const items: Record<string, { fluid?: boolean }> = JSON.parse(
  fs.readFileSync(new URL('../recipes.json', import.meta.url), 'utf8'),
).items;
const words: AdviceWords = {
  name: row => row.name,
  fluid: item => !!items[item]?.fluid,
  itemRate: (item, rate) => `${rate.toFixed(2)}${item === 'Water' ? ' m³' : ''}/min`,
};
// The Water Extractors a line's advice gives in `plan`'s Phase `phase`, with the phase's choice.
const lineWater = (plan: StoredCalculatedPlan, phase: '2' | '4') => {
  const stage = plan.stages[phase];
  const model = recycleModel(
    stage,
    defaultFactoryGroups(plan as never),
    undefined,
    waterChoice(stage, Number(phase), plan.settings),
  );
  for (const row of stage.rows as CalcRow[]) {
    const line = lineAdvice(row, model, words).find(entry => entry.extractors);
    if (line) return plain(line.extractors!);
  }
  return '';
};

test('a production line’s advice on a plan: both options, the suggested one first', () => {
  assert.match(
    lineWater(phase4, '4'),
    /^Water Extractors at 100% \(suggested\): .+\. Or \d+ overclocked at .+Power Shard.+\.$/,
  );
  assert.match(
    lineWater(phase4Over, '4'),
    /^Water Extractors \(suggested\): \d+ overclocked at .+Power Shard.+\. Or at 100%: .+\.$/,
  );
  assert.match(
    lineWater(phase2, '2'),
    /^Water Extractors at 100% \(suggested\): .+\. Or \d+ overclocked at .+Power Shard.+\.$/,
  );
  assert.match(
    lineWater(phase2At100(), '2'),
    /^Water Extractors at 100% \(suggested\): .+\. Or overclocked \(after researching Power Shards in the MAM: Blue Power Slugs, then Overclock Production\): \d+ at [\d.]+%.* \(\d+ extractors?, \d+ Power Shards?, [\d.]+ MW\)\.$/,
  );
});

test('ADA names both options, the suggested one first, or the research', () => {
  const ada = (waterChoice?: {
    suggestOverclocked: boolean;
    shards: 'count' | 'research' | 'none';
  }) =>
    adaRemarks({
      view: 'factories',
      phaseLabel: 'Phase 4',
      waterExtracted: '258.04',
      ...(waterChoice ? { waterChoice } : {}),
    }).find(line => line.id === 'water-extractors')!.text;
  assert.equal(
    ada({ suggestOverclocked: false, shards: 'count' }),
    'Phase 4 extracts 258.04 m³ of Water a minute. Each line that takes it says how many Water Extractors to build both ways, at 100% (suggested) or overclocked with Power Shards, each with the clocks adding up to exactly what it needs. Your pick. A full pipe stops the pumps, and I would rather it did not.',
  );
  assert.match(
    ada({ suggestOverclocked: true, shards: 'count' }),
    /both ways, overclocked with Power Shards \(suggested\) or at 100%, each with/,
  );
  assert.match(
    ada({ suggestOverclocked: false, shards: 'research' }),
    /to build both ways, at 100% \(suggested\) or overclocked with Power Shards once you research them in the MAM, each with the clocks adding up to exactly what it needs\. Your pick\./,
  );
  assert.match(
    ada({ suggestOverclocked: false, shards: 'none' }),
    /to build at 100%, with the clocks/,
  );
  assert.equal(
    ada(),
    ada({ suggestOverclocked: false, shards: 'count' }),
    'absent: both, 100% first',
  );
});

// A full export of one save holding `plan`.
const exported = (plan: StoredCalculatedPlan): SaveExport => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt: '2026-10-12T08:00:00.000Z',
  saves: [
    {
      id: 's1',
      name: 'World',
      activeProfile: 'p1',
      profiles: [{ id: 'p1', name: 'Stored', kind: 'calculated', plan, state: initialState() }],
    },
  ],
});
// A Phase 4 plan stored before #1137: its stages have no `water`, so they counted Water at the
// miner's 250%.
const before1137 = () => {
  const plan = json(phase4);
  for (const stage of Object.values(plan.stages)) delete (stage as StoredStage).mining?.water;
  return plan;
};

test('a stored plan keeps its numbers and suggests what it was calculated with (Docker)', async () => {
  const old = before1137();
  const stage = old.stages['4'];
  const grid = JSON.stringify(stage.grid);
  // It suggests the overclocked option, which its stored power counts, until it is recalculated.
  assert.equal(waterChoice(stage, 4, old.settings).suggestOverclocked, true);
  assert.match(
    miningStep(stage, '4', old.settings)!.table.rows.at(-1)![3]!,
    /^Water Extractor \(suggested\): \d+ overclocked at /,
  );
  assert.equal(JSON.stringify(stage.grid), grid, 'reading it changes nothing');
  for (const plan of [old, phase4, phase4Over]) {
    const file = exported(plan);
    const checked = validateTransfer(json(file)).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(checked), JSON.stringify(plan));
    const imported = (await importableTransfer(json(file))).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(imported), JSON.stringify(plan));
  }
  assert.equal(phase4Over.settings.waterOverclock, true);
  assert.equal('waterOverclock' in phase4.settings, false, 'absent unless chosen, as before');
});

test('a stored plan keeps its numbers across a reload (browser edition)', async () => {
  const records = new Map<string, unknown>();
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
    );
  const plans = [before1137(), phase4Over];
  let api = open();
  for (const plan of plans)
    await api('/api/import-saves', { body: JSON.stringify(exported(plan)) });
  api = open();
  const out = (await api('/api/export-saves')) as SaveExport;
  assert.deepEqual(
    out.saves.map(save => JSON.stringify(save.profiles[0]!.plan)),
    plans.map(plan => JSON.stringify(plan)),
  );
  const stored = out.saves[0]!.profiles[0]!.plan!;
  assert.equal(waterChoice(stored.stages['4'], 4, stored.settings).suggestOverclocked, true);
});
