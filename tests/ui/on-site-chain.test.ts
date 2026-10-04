// Made on site: one rule for what a group's marks come to, which the picker, the recalculation
// notice and the heading all follow (#951, #967). A recalculation sizes a group's lines to its
// rows other than its lines made on site (onSiteSettings), and gives the group its own line of
// each part it marks, which takes the ingredients the group marks too from its own lines
// (siteCopies in planner/on-site.ts). So:
// - #967: once a part is ticked, even before it is saved, the picker also offers the ingredients
//   of its recipe ("Copper Ingot (for Wire made on site)"), and one recalculation plans the chain
//   (it took two: Copper Ingot was offered only once the group's own Wire line existed);
// - #951: an ingredient only a group's own line uses, for a part it no longer marks, is not
//   offered as an item the group uses: the picker gives it the heading's note, and the notice
//   and a recalculation give it no line.
// Each recalculation here is the real planner's (generatedWith).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import {
  calculated,
  setFactoryEditing,
  setFactoryFilter,
  setQuery,
  state,
  workspace,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { onSiteSettings } from '../../public/app/on-site.ts';
import {
  onSiteChange,
  onSiteOffers,
  onSitePickerOffers,
  onSiteSummaries,
  RAW_NOTE,
  UNUSED_NOTE,
} from '../../public/app/on-site-picker.ts';
import {
  $,
  $$,
  applyUpdate,
  generated,
  generatedWith,
  go,
  open,
  page,
  stubFetch,
} from './setup.ts';
import type {
  CalcRow,
  FactoryGroups,
  StageKey,
  StoredCalculatedPlan,
  UpdateOp,
} from '../../public/types/index.ts';

const ALPHA = 'fg-alpha1';
const MOTORS = 'fg-motors1';
const WIRING = 'fg-wiring1';
const WIRE = 'Recipe_Wire_C';
const COPPER = 'Recipe_IngotCopper_C';
const FOR_WIRE = '(for Wire made on site)';

// #967's group: Alpha holds the Stator and Motor lines.
const alpha = (local?: string[]): FactoryGroups => ({
  groups: [{ id: ALPHA, name: 'Alpha' }],
  assignments: {
    Recipe_Stator_C: [{ group: ALPHA, rate: null }],
    Recipe_Motor_C: [{ group: ALPHA, rate: null }],
  },
  ...(local ? { local: { [ALPHA]: local } } : {}),
});
// #951's groups: Motors holds the Rotor, Stator and Motor lines (only the Stator takes Wire),
// Wiring the Cable line.
const pair = (local: FactoryGroups['local']): FactoryGroups => ({
  groups: [
    { id: MOTORS, name: 'Motors' },
    { id: WIRING, name: 'Wiring' },
  ],
  assignments: {
    Recipe_Rotor_C: [{ group: MOTORS, rate: null }],
    Recipe_Stator_C: [{ group: MOTORS, rate: null }],
    Recipe_Motor_C: [{ group: MOTORS, rate: null }],
    Recipe_Cable_C: [{ group: WIRING, rate: null }],
  },
  local,
});

// The plan "Recalculate with items made on site" makes from `plan` and the groups now.
function recalculated(plan: StoredCalculatedPlan, now: FactoryGroups) {
  const onSite = onSiteSettings(plan, now);
  return generatedWith({ ...plan.settings, ...(onSite ? { onSite } : {}) });
}
const ownLines = (plan: StoredCalculatedPlan, group: string, phase: StageKey = '3') =>
  plan.stages[phase].rows!.filter(row => row.onSite?.group === group);
const ownLineIds = (plan: StoredCalculatedPlan, group: string) =>
  ownLines(plan, group)
    .map(row => row.id)
    .sort();

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const show = async (plan: StoredCalculatedPlan, now: FactoryGroups, editing = false) => {
  open({ calculated: plan, phase: '3', state: { factoryGroups: now } });
  setFactoryEditing(editing);
  render();
  await settle();
};
const words = (selector: string) => $(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
const made = (group: string) => words(`#section-${group} [data-on-site-made]`);
const marked = (group: string) => words(`#section-${group} [data-on-site-marked]`);
const notice = () => words('[data-on-site-recalc]');
const box = (group: string, item: string) =>
  $<HTMLInputElement>(`[data-on-site-picker="${group}"] [data-on-site-item="${item}"]`);
const boxes = (group: string) =>
  $$<HTMLInputElement>(`[data-on-site-picker="${group}"] [data-on-site-item]`).map(
    input => input.dataset.onSiteItem,
  );
// The note beside a box, in its own element (#934), or '' for none.
const noteOf = (group: string, item: string) =>
  box(group, item)?.closest('label')?.querySelector('small')?.textContent?.trim() ?? '';
const tick = (input: HTMLInputElement, on: boolean) => {
  input.checked = on;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

beforeEach(() => {
  page();
  setQuery('');
  setFactoryFilter('all');
  setFactoryEditing(false);
  go('factories');
});

test('#967: a ticked part offers the ingredients of its recipe, named after it', () => {
  const plan = generated();
  const plain = ['Rotor', 'Stator', 'Steel Pipe', 'Wire'];
  // Nothing marked: only what Alpha's lines use, as before.
  assert.deepEqual(onSiteOffers(plan, alpha(), ALPHA), plain);
  // Wire ticked (saved or not): Copper Ingot, which the plan's Wire line takes and a plan line
  // makes, after the items the cards use. Copper Ore is raw, so never offered.
  assert.deepEqual(onSitePickerOffers(plan, alpha(), ALPHA, '3', ['Wire']), [
    ...plain.map(item => ({ item, note: '' })),
    { item: 'Copper Ingot', note: FOR_WIRE },
  ]);
  assert.deepEqual(onSiteOffers(plan, alpha(['Wire']), ALPHA), ['Copper Ingot', ...plain]);
  // A part the group's lines do not use offers nothing more: Cable is not Alpha's.
  assert.deepEqual(onSiteOffers(plan, alpha(['Cable']), ALPHA), plain);
  // Down a chain of marked parts: Steel Pipe's Steel Ingot, then nothing past Steel Ingot's raw
  // ores. An ingredient a card uses as well keeps no note.
  const chain = onSitePickerOffers(plan, alpha(), ALPHA, '3', ['Steel Ingot', 'Steel Pipe']);
  assert.deepEqual(
    chain.find(offer => offer.item === 'Steel Ingot'),
    { item: 'Steel Ingot', note: '(for Steel Pipe made on site)' },
  );
  assert.ok(chain.every(offer => !['Iron Ore', 'Coal'].includes(offer.item)));
});

test('#967: tick Wire and Copper Ingot is offered at once; one recalculation plans the chain', async () => {
  const plan = generated();
  await show(plan, alpha(), true);
  assert.deepEqual(boxes(ALPHA), ['Rotor', 'Stator', 'Steel Pipe', 'Wire']);
  assert.equal(box(ALPHA, 'Copper Ingot'), null);
  // Ticked, not saved yet: the ingredient is offered with why.
  tick(box(ALPHA, 'Wire')!, true);
  await nextTick();
  assert.ok($('[data-on-site-unsaved]'));
  assert.deepEqual(boxes(ALPHA), ['Rotor', 'Stator', 'Steel Pipe', 'Wire', 'Copper Ingot']);
  assert.equal(noteOf(ALPHA, 'Copper Ingot'), FOR_WIRE);
  assert.equal(box(ALPHA, 'Copper Ingot')!.checked, false);
  // Cleared again, the ingredient goes; ticked, it stays (cleared Wire leaves it listed so it can
  // be cleared, with the note the heading would give it, #951).
  tick(box(ALPHA, 'Wire')!, false);
  await nextTick();
  assert.equal(box(ALPHA, 'Copper Ingot'), null);
  tick(box(ALPHA, 'Wire')!, true);
  await nextTick();
  tick(box(ALPHA, 'Copper Ingot')!, true);
  tick(box(ALPHA, 'Wire')!, false);
  await nextTick();
  assert.ok(box(ALPHA, 'Copper Ingot')!.checked);
  assert.equal(noteOf(ALPHA, 'Copper Ingot'), UNUSED_NOTE);
  tick(box(ALPHA, 'Wire')!, true);
  await nextTick();
  assert.equal(noteOf(ALPHA, 'Copper Ingot'), FOR_WIRE);

  // Save both: the notice asks for one recalculation with both.
  let sent: { settings: StoredCalculatedPlan['settings'] } | undefined;
  let next: StoredCalculatedPlan | undefined;
  const calls = stubFetch<UpdateOp>({
    '/api/update': applyUpdate,
    '/api/profiles': (body: typeof sent) => {
      sent = body;
      next = generatedWith(body!.settings);
      return { saveId: 's', profileId: 'p2', reviewCount: 0, workspace };
    },
    '/api/context': () => ({
      save: { id: 's', name: 'World' },
      profile: { id: 'p2', kind: 'calculated', name: 'Made on site' },
      state,
      plan: next,
    }),
  });
  $<HTMLButtonElement>(`[data-on-site-save="${ALPHA}"]`)!.click();
  await settle();
  assert.deepEqual(state.factoryGroups?.local, { [ALPHA]: ['Copper Ingot', 'Wire'] });
  assert.match(notice()!, /Now: Alpha makes Copper Ingot and Wire on site\./);
  // The heading, before the recalculation: both need it.
  setFactoryEditing(false);
  render();
  await settle();
  assert.equal(made(ALPHA), null);
  assert.deepEqual(onSiteSummaries(plan, state.factoryGroups, plan.stages['3'])[ALPHA], {
    made: [],
    marked: ['Copper Ingot', 'Wire'].map(item => ({ item, note: '(needs a recalculation)' })),
  });
  assert.match(marked(ALPHA)!, /^Marked, not made on site: Copper Ingot .*Wire \(needs a recal/);

  // One recalculation, from a plan with no line of Alpha's own yet.
  assert.equal(ownLines(plan, ALPHA).length, 0);
  $<HTMLButtonElement>('[data-recalc-on-site]')!.click();
  await settle();
  await settle();
  assert.equal(calls.filter(([path]) => path === '/api/profiles').length, 1);
  assert.deepEqual(sent!.settings.onSite![ALPHA]!.items, ['Copper Ingot', 'Wire']);
  assert.ok(calculated?.settings.onSite, 'the new profile is open');
  for (const phase of ['3', '4', '5'] as const) {
    const lines = ownLines(calculated, ALPHA, phase);
    assert.deepEqual(
      lines.map(row => row.id).sort(),
      [`${COPPER}:${ALPHA}`, `${WIRE}:${ALPHA}`],
      `Phase ${phase}`,
    );
    // Chained: Alpha's Copper Ingot line feeds its Wire line, all of it.
    const copper = lines.find(row => row.onSite!.recipe === COPPER)!;
    const wire = lines.find(row => row.onSite!.recipe === WIRE)!;
    assert.ok(
      Math.abs(copper.outputs['Copper Ingot']! - wire.inputs['Copper Ingot']!) < 1e-6,
      `Phase ${phase}: ${copper.outputs['Copper Ingot']} made, ${wire.inputs['Copper Ingot']} used`,
    );
  }
  // The heading says so on the Phase 3 page, and there is nothing more to recalculate.
  await show(calculated, state.factoryGroups!);
  assert.equal(made(ALPHA), 'Made on site: Copper Ingot and Wire');
  assert.equal(marked(ALPHA), null);
  assert.equal(notice(), null);
  assert.equal(onSiteChange(calculated, state.factoryGroups), null);
  // In the new profile the picker still offers Copper Ingot for the Wire it marks.
  setFactoryEditing(true);
  render();
  await settle();
  assert.equal(noteOf(ALPHA, 'Copper Ingot'), FOR_WIRE);
  assert.ok(box(ALPHA, 'Copper Ingot')!.checked);
});

test("#951: an input of a group's own line, for a part it no longer marks: picker, notice and heading agree", async () => {
  // Both groups mark Wire, recalculated: Wiring gets its own Wire line, which takes Copper Ingot.
  const first = recalculated(generated(), pair({ [MOTORS]: ['Wire'], [WIRING]: ['Wire'] }));
  assert.deepEqual(ownLineIds(first, WIRING), [`${WIRE}:${WIRING}`]);
  assert.ok(ownLines(first, WIRING)[0]!.inputs['Copper Ingot']);
  // Wiring then marks Copper Ingot and clears Wire.
  const now = pair({ [MOTORS]: ['Wire'], [WIRING]: ['Copper Ingot'] });
  // The picker: Copper Ingot is no item Wiring uses, only a stale mark with the heading's note.
  assert.deepEqual(onSiteOffers(first, now, WIRING), ['Wire']);
  await show(first, now, true);
  assert.deepEqual(boxes(WIRING), ['Wire', 'Copper Ingot']);
  assert.ok(box(WIRING, 'Copper Ingot')!.checked);
  assert.equal(noteOf(WIRING, 'Copper Ingot'), UNUSED_NOTE);
  assert.equal(noteOf(WIRING, 'Wire'), '');
  // The notice: a recalculation gives Wiring nothing.
  const change = onSiteChange(first, now)!;
  assert.equal(change.now, 'Motors makes Wire on site');
  assert.equal(change.want?.[WIRING], undefined);
  assert.match(notice()!, /Now: Motors makes Wire on site\./);
  // The heading: the Wire line until a recalculation, and Copper Ingot with the picker's note.
  await show(first, now);
  assert.equal(made(WIRING), 'Made on site: Wire (until a recalculation)');
  assert.equal(marked(WIRING), `Marked, not made on site: Copper Ingot ${UNUSED_NOTE}`);
  assert.deepEqual(onSiteSummaries(first, now, first.stages['3'])[WIRING]!.marked, [
    { item: 'Copper Ingot', note: UNUSED_NOTE },
  ]);
  // The recalculation does what all three said: no line for Wiring, and nothing more to do.
  const second = recalculated(first, now);
  assert.deepEqual(ownLineIds(second, WIRING), []);
  await show(second, now);
  assert.equal(made(WIRING), null);
  assert.equal(marked(WIRING), `Marked, not made on site: Copper Ingot ${UNUSED_NOTE}`);
  assert.equal(notice(), null);
  await show(second, now, true);
  assert.equal(noteOf(WIRING, 'Copper Ingot'), UNUSED_NOTE);
});

test('#951: while the part stays marked, its ingredient is offered for it, and the chain is planned', async () => {
  const first = recalculated(generated(), pair({ [MOTORS]: ['Wire'], [WIRING]: ['Wire'] }));
  const now = pair({ [MOTORS]: ['Wire'], [WIRING]: ['Copper Ingot', 'Wire'] });
  await show(first, now, true);
  assert.equal(noteOf(WIRING, 'Copper Ingot'), FOR_WIRE);
  assert.match(
    notice()!,
    /Now: Motors makes Wire on site; Wiring makes Copper Ingot and Wire on site\./,
  );
  await show(first, now);
  assert.equal(made(WIRING), 'Made on site: Wire');
  assert.equal(marked(WIRING), 'Marked, not made on site: Copper Ingot (needs a recalculation)');
  const second = recalculated(first, now);
  assert.deepEqual(ownLineIds(second, WIRING), [`${COPPER}:${WIRING}`, `${WIRE}:${WIRING}`]);
  await show(second, now);
  assert.equal(made(WIRING), 'Made on site: Copper Ingot and Wire');
  assert.equal(marked(WIRING), null);
  assert.equal(notice(), null);
});

test('raw resources and nuclear recipes are never followed (#921, #933)', async () => {
  // A Water mark stays listed with its own note while a part is ticked beside it.
  await show(generated(), alpha(['Water', 'Wire']), true);
  assert.equal(noteOf(ALPHA, 'Water'), RAW_NOTE);
  assert.equal(noteOf(ALPHA, 'Copper Ingot'), FOR_WIRE);
  // Copper Ingot ticked too: its ingredient is Copper Ore, a raw resource, so nothing more.
  const before = boxes(ALPHA);
  tick(box(ALPHA, 'Copper Ingot')!, true);
  await nextTick();
  assert.deepEqual(boxes(ALPHA), before);
  assert.equal(box(ALPHA, 'Copper Ore'), null);
  // A nuclear part: the planner never makes a group its own line of Encased Uranium Cell, so its
  // ingredients are not offered for it, and the offers are the same marked or not.
  const plan = generated();
  const rows = plan.stages['3'].rows!;
  const stator = rows.find(row => row.id === 'Recipe_Stator_C')!;
  const nuclear = (
    id: string,
    name: string,
    inputs: CalcRow['inputs'],
    outputs: CalcRow['outputs'],
  ) => ({
    ...stator,
    id,
    name,
    inputs,
    outputs,
  });
  rows.push(
    nuclear(
      'Recipe_NuclearFuelRod_C',
      'Uranium Fuel Rod',
      { 'Encased Uranium Cell': 10, Stator: 1 },
      { 'Uranium Fuel Rod': 0.4 },
    ),
    nuclear(
      'Recipe_UraniumCell_C',
      'Encased Uranium Cell',
      { Uranium: 50, Concrete: 15, 'Sulfuric Acid': 40 },
      { 'Encased Uranium Cell': 25, 'Sulfuric Acid': 10 },
    ),
  );
  assert.ok(
    rows.some(row => row.outputs.Concrete),
    'a plan line makes Concrete',
  );
  const held = alpha();
  held.assignments.Recipe_NuclearFuelRod_C = [{ group: ALPHA, rate: null }];
  const offers = onSiteOffers(plan, held, ALPHA);
  assert.ok(offers.includes('Encased Uranium Cell'));
  assert.deepEqual(onSiteOffers(plan, held, ALPHA, ['Encased Uranium Cell']), offers);
});

test('a part used only in other phases names them with its ingredients (#941)', () => {
  const plan = generated();
  // Alpha's Stator line is not in the Phase 3 plan: Wire is used in other phases only.
  plan.stages['3'].rows = plan.stages['3'].rows!.filter(row => row.id !== 'Recipe_Stator_C');
  const offers = onSitePickerOffers(plan, alpha(), ALPHA, '3', ['Wire']);
  const noteFor = (item: string) => offers.find(offer => offer.item === item)?.note;
  assert.equal(noteFor('Wire'), '(used by Stator in Phases 4 and 5)');
  assert.equal(noteFor('Copper Ingot'), '(for Wire made on site in Phases 4 and 5)');
  // The ingredients come after the items the Phase 3 cards use, among the other phases' items.
  assert.equal(offers[0]!.note, '');
  assert.deepEqual(
    offers.filter(offer => offer.note).map(offer => offer.item),
    ['Copper Ingot', 'Stator', 'Steel Pipe', 'Wire'],
  );
});
