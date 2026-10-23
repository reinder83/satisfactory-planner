// The caps per phase (#1221) over a set of settings: several start phases, exact clocks and whole
// machines, every alternate, minimal construction, the target time on the final phase, build costs
// counted, and production amplification. Two properties, with each phase's buildings and MW counted as the
// plan and the pages count them (its rows' machines and its grid's need):
//   a cap at or above what the plan without caps uses never changes it: the plan is the same,
//     byte for byte, apart from the caps in its settings and the time it was made;
//   a cap below it changes only the phases it binds: every other phase is its plan without the
//     caps, a phase that fits keeps within them, and a draft's `capShortfalls` name only caps the
//     plan without them is over, each `needed` above the cap and never above that plan's figure.
import './helpers/en-us-numbers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate } from '../planner.ts';
import type {
  CurrentCalculatedPlan,
  PhaseCaps,
  StageKey,
  StoredCalculatedPlan,
  StoredStage,
} from '../public/types/index.ts';

const PHASES: StageKey[] = ['1', '2', '3', '4', '5'];
const amplified = (
  JSON.parse(
    fs.readFileSync(new URL('./fixtures/amplified-early-2026-10-12.json', import.meta.url), 'utf8'),
  ) as StoredCalculatedPlan
).settings;
const SETTINGS: [string, object][] = [
  ['Phase 1, exact clocks', { phase: '1' }],
  ['Phase 3, every alternate', { phase: '3', recipes: 'all' }],
  ['Phase 2, whole machines', { phase: '2', wholeMachines: true }],
  [
    'Phase 3, every alternate, whole machines, storage from surplus',
    { phase: '3', recipes: 'all', wholeMachines: true, storageFromSurplus: true },
  ],
  ['Phase 3, minimal construction', { phase: '3', goal: 'minimal' }],
  ['Phase 3, target time on the final phase', { phase: '3', phaseTime: 'final' }],
  [
    'Phase 3, every alternate, build costs counted',
    { phase: '3', recipes: 'all', buildCost: true },
  ],
  ['amplified (fixture)', amplified],
];
// A phase's figures as the caps count them.
const figures = (stage: StoredStage): Required<PhaseCaps> => ({
  buildings: (stage.rows || []).reduce((total, row) => total + row.machines, 0),
  mw: stage.grid!.needMW,
});
const keepsWithin = (caps: PhaseCaps, own: Required<PhaseCaps>) =>
  (caps.buildings === undefined || own.buildings <= caps.buildings) &&
  (caps.mw === undefined || own.mw <= caps.mw + 1e-6);
// A plan without the time it was made and without the caps in its settings.
const capless = (plan: CurrentCalculatedPlan) => {
  const { phaseCaps: _caps, ...settings } = plan.settings;
  return JSON.stringify({ ...plan, settings, createdAt: '' });
};

for (const [label, base] of SETTINGS)
  test(`caps per phase keep the plan's own figures true: ${label}`, () => {
    const free = calculate(base);
    const own: Partial<Record<StageKey, Required<PhaseCaps>>> = {};
    for (const phase of PHASES)
      if (free.stages[phase].feasible) own[phase] = figures(free.stages[phase]);
    const all = Object.values(own);
    assert.ok(all.length > 0, 'some phase fits');
    const busiest = {
      buildings: Math.max(...all.map(entry => entry.buildings)),
      mw: Math.max(...all.map(entry => entry.mw)),
    };
    // At or above what every phase uses: the plan without caps, byte for byte.
    for (const caps of [
      { buildings: busiest.buildings, mw: Math.ceil(busiest.mw) },
      { mw: Math.ceil(busiest.mw * 1.1) },
      { buildings: busiest.buildings + 5 },
    ]) {
      const capped = calculate({ ...base, phaseCaps: caps });
      assert.deepEqual(capped.settings.phaseCaps, caps);
      assert.equal(capless(capped), capless(free), JSON.stringify(caps));
    }
    // Below what the busiest phase uses.
    const binding: PhaseCaps[] = [
      { buildings: Math.floor(busiest.buildings * 0.92) },
      { mw: Math.floor(busiest.mw * 0.85) },
    ];
    for (const caps of binding) {
      const capped = calculate({ ...base, phaseCaps: caps });
      for (const phase of PHASES) {
        const stage = capped.stages[phase],
          figure = own[phase];
        const where = `${JSON.stringify(caps)}, Phase ${phase}`;
        if (!figure) continue;
        if (keepsWithin(caps, figure)) {
          assert.equal(JSON.stringify(stage), JSON.stringify(free.stages[phase]), where);
          continue;
        }
        if (stage.feasible) {
          assert.ok(keepsWithin(caps, figures(stage)), `${where} keeps within the caps`);
          continue;
        }
        assert.ok(stage.capShortfalls?.length, `${where}: a draft names the caps`);
        for (const { name, needed, cap } of stage.capShortfalls!) {
          assert.equal(cap, caps[name], where);
          assert.ok(figure[name] > cap, `${where}: ${name} is over its cap without it`);
          assert.ok(needed > cap, `${where}: ${name} needs ${needed}, over the cap ${cap}`);
          assert.ok(
            needed <= figure[name],
            `${where}: ${name} needs ${needed}, no more than the plan's ${figure[name]}`,
          );
        }
      }
    }
  });
