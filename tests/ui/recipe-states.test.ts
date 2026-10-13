// The recipe picker's figures and the plan page's ranking (#1075): Edit settings' picker shows
// what this profile's stored hard-drive ranking says each recipe saves ("If found: …" on a hunting
// row, a verdict per product), and the plan page's ranking, over the remaining phases, offers
// "Add as hunting" on each recipe not allowed yet.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { carryOptions } from '../../public/state.ts';
import { setPayoff, setWizard } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, catalog, generated, go, open, page } from './setup.ts';
import type {
  AlternatePayoff,
  AlternateRanking,
  StoredCalculatedPlan,
} from '../../public/types/index.ts';

const CAST = 'Recipe_Alternate_Screw_C',
  STEEL = 'Recipe_Alternate_Screw_2_C',
  RIP = 'Recipe_Alternate_ReinforcedIronPlate_2_C';
const text = (selector: string) => $(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const entry = (id: string, buildings: number, over: Partial<AlternatePayoff> = {}) => ({
  id,
  name: id,
  machine: 'Constructor',
  phase: 1,
  status: buildings < 0 ? ('better' as const) : ('worse' as const),
  buildings,
  raw: {},
  rawTotal: buildings,
  powerMW: 0,
  hours: 0,
  ...over,
});
const ranking = (candidates: AlternatePayoff[]): AlternateRanking => ({
  phase: '2',
  phases: ['2', '3', '4', '5'],
  base: { buildings: 100, rawTotal: 1000, requiredMW: 400, hours: 10 },
  candidates,
  total: candidates.length,
  stopped: false,
  elapsedMs: 10,
});

beforeEach(() => page());

function editAt(plan: StoredCalculatedPlan, candidates: AlternatePayoff[]) {
  open({ calculated: plan, workspace: { catalog: catalog() } });
  setPayoff({
    planCreatedAt: plan.createdAt,
    rankedAt: '2026-10-13T12:00:00Z',
    ranking: ranking(candidates),
  });
  page();
  setWizard({
    step: 2,
    saveId: 's',
    saveName: 'World',
    name: 'Mine',
    settings: {
      ...structuredClone(plan.settings),
      recipes: 'custom',
      alternateRecipes: [CAST],
      mamRecipes: true,
    },
    preview: null,
    carryFrom: null,
    carry: Object.fromEntries(carryOptions.map(([k]) => [k, true])),
    mode: 'advanced',
    guidedStep: 1,
    guidedAsk: null,
    tutorial: 'doing',
    edit: { profileId: 'p', name: 'Mine', plan },
  });
  go('wizard');
  render();
}

test('#1075: Edit settings’ picker shows what finding each recipe saves, from the stored ranking', async () => {
  const plan = generated() as StoredCalculatedPlan;
  editAt(plan, [
    entry(CAST, -14, { hunting: true, byPhase: { '2': -10, '3': -4, '4': 0, '5': 0 } }),
    entry(STEEL, -3),
    entry(RIP, 2),
  ]);
  await nextTick();
  assert.equal(
    text(`[data-alt-row="${CAST}"] [data-alt-payoff]`),
    'If found: −14 buildings in Phases 2–5 · until then: Screws',
  );
  assert.equal(
    text(`[data-alt-row="${STEEL}"] [data-alt-payoff]`),
    'Worth a hard drive: −3 buildings in Phases 2–5',
  );
  assert.equal($(`[data-alt-row="${RIP}"] [data-alt-payoff]`), null, 'no saving, no line');
  // The group's verdict names the alternate that saves the most.
  assert.equal(
    text('[data-alt-group="Screws"] [data-alt-verdict]'),
    'Cast Screws skips Iron Rod, −14 buildings in Phases 2–5',
  );
  assert.match(text('.alt-picker'), /Buildings saved are from this profile’s hard-drive ranking/);
  // A ranking of another plan is not used.
  setPayoff({
    planCreatedAt: 'older',
    rankedAt: '2026-10-13T12:00:00Z',
    ranking: ranking([entry(CAST, -14, { hunting: true })]),
  });
  render();
  await nextTick();
  assert.equal(text(`[data-alt-row="${CAST}"] [data-alt-payoff]`), 'Until found: Screws');
  assert.equal(text('[data-alt-group="Screws"] [data-alt-verdict]'), 'Cast Screws skips Iron Rod');
});
