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
import { $, $$, answerConfirms, catalog, generated, go, open, page, stubFetch } from './setup.ts';
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

// The plan page's ranking of Phase 3 on, as the panel stores it.
function planAt(candidates: AlternatePayoff[]) {
  const plan = generated() as StoredCalculatedPlan;
  open({ calculated: plan, workspace: { catalog: catalog() } });
  setPayoff({
    planCreatedAt: plan.createdAt,
    rankedAt: '2026-10-13T12:00:00Z',
    ranking: { ...ranking(candidates), phase: '3', phases: ['3', '4', '5'] },
  });
  go('plan');
  render();
  return plan;
}
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const rowIds = () => $$('[data-payoff-row]').map(row => row.dataset.payoffRow);

test('#1075: the best next hard drive sits above the build sequence, with a threshold and the first rows', async () => {
  const ids = catalog()
    .alternates.filter(a => !a.mam && !a.milestone)
    .slice(0, 12)
    .map(a => a.id);
  planAt(ids.map((id, i) => entry(id, -(i + 1))));
  const panel = $('[data-payoff]')!;
  assert.equal(text('[data-payoff] h2'), 'Best next hard drive');
  const checklist = $$('h2').find(h => h.textContent === 'Build sequence')!;
  assert.ok(
    panel.compareDocumentPosition(checklist) & Node.DOCUMENT_POSITION_FOLLOWING,
    'before the build sequence',
  );
  assert.match(text('[data-payoff-summary]'), /12 of 12 alternates checked for Phases 3–5/);
  // Sorted by buildings, the first eight shown.
  assert.equal(rowIds().length, 8);
  assert.equal(rowIds()[0], ids[11]);
  $('[data-payoff-more]')!.click();
  await nextTick();
  assert.equal(rowIds().length, 12);
  // The threshold hides the rows that save fewer buildings, and says how many.
  const threshold = $<HTMLSelectElement>('[data-payoff-threshold]')!;
  threshold.value = '10';
  threshold.dispatchEvent(new Event('change'));
  await nextTick();
  assert.deepEqual(rowIds(), [ids[11], ids[10], ids[9]]);
  assert.match(
    text('[data-payoff-hidden]'),
    /^9 more alternates save fewer buildings than that\.$/,
  );
});

test('#1075: Add as hunting recalculates in place with the recipe allowed, after asking; hunting rows say so', async () => {
  const plan = planAt([
    entry(CAST, -6, { name: 'Cast Screws' }),
    entry(STEEL, -3, { hunting: true }),
    entry(RIP, 0, { status: 'infeasible', error: 'x' }),
  ]);
  assert.equal(plan.settings.recipes, 'standard');
  assert.equal(text(`[data-payoff-row="${STEEL}"] [data-payoff-hunting]`), 'Hunting: if found');
  assert.equal($(`[data-payoff-hunt="${STEEL}"]`), null);
  assert.equal($(`[data-payoff-hunt="${RIP}"]`), null, 'not for one that does not fit');
  const calls = stubFetch<{ settings: StoredCalculatedPlan['settings']; planCreatedAt: string }>({
    '/api/recalculate': {
      workspace: {},
      saveId: 's',
      profileId: 'p',
      backupId: 'b',
      reviewCount: 0,
      carriedChecks: 0,
    },
    '/api/context': {
      save: { id: 's', name: 'World' },
      profile: { id: 'p', kind: 'calculated', name: 'Mine' },
      state: {
        version: 1,
        revision: 1,
        settings: { phase: '3' },
        checks: {},
        notes: {},
        deliveries: {},
        customTasks: [],
      },
      plan,
    },
  });
  let asked = answerConfirms(false);
  $<HTMLButtonElement>(`[data-payoff-hunt="${CAST}"]`)!.click();
  await settle();
  assert.equal(asked.length, 1);
  assert.match(asked[0]!, /with Cast Screws allowed as a recipe to hunt\./);
  assert.equal(calls.length, 0, 'nothing is sent until confirmed');
  asked = answerConfirms(true);
  $<HTMLButtonElement>(`[data-payoff-hunt="${CAST}"]`)!.click();
  await settle();
  await settle();
  const body = calls[0]![1];
  assert.equal(calls[0]![0], '/api/recalculate');
  assert.equal(body.planCreatedAt, plan.createdAt);
  assert.equal(body.settings.recipes, 'custom');
  assert.deepEqual(body.settings.alternateRecipes, [CAST]);
  assert.deepEqual(body.settings.plannerPicks, [CAST]);
  assert.equal(body.settings.mamRecipes, true, 'the standard plan’s MAM recipes stay');
  // The new plan is opened and the page redrawn before the test ends.
  await settle();
});
