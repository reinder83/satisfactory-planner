// What a factory group's heading says it makes on site outside edit mode (#931): the items of its
// own lines in the open plan, not the marks it saved (factoryGroups.local). A mark without a line
// is listed apart with why, in the picker's words, and one the plan was calculated without says
// it needs a recalculation, as the page's notice does (GroupSections.vue, onSiteSummaries in
// app/on-site-picker.ts).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setFactoryEditing, setFactoryFilter, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { onSiteSettings } from '../../public/app/on-site.ts';
import { onSiteSummaries } from '../../public/app/on-site-picker.ts';
import { $, evil, generated, generatedWith, go, open, page } from './setup.ts';
import type {
  CalcRow,
  FactoryGroups,
  Phase,
  StoredCalculatedPlan,
} from '../../public/types/index.ts';

const MOTORS = 'fg-motors1';
const WIRING = 'fg-wiring1';
const WIRE = 'Recipe_Wire_C';
const MOTOR_ROWS = ['Recipe_Rotor_C', 'Recipe_Stator_C', 'Recipe_Motor_C'];

// Motors holds the Rotor, Stator and Motor lines (only the Stator takes Wire), Wiring the Cable
// line; both mark Wire unless `local` says otherwise.
const groups = (
  motorRows = MOTOR_ROWS,
  local: FactoryGroups['local'] = { [MOTORS]: ['Wire'], [WIRING]: ['Wire'] },
  motorsName = 'Motors',
): FactoryGroups => ({
  groups: [
    { id: MOTORS, name: motorsName },
    { id: WIRING, name: 'Wiring' },
  ],
  assignments: {
    ...Object.fromEntries(motorRows.map(row => [row, [{ group: MOTORS, rate: null }]])),
    Recipe_Cable_C: [{ group: WIRING, rate: null }],
  },
  local,
});
// The plan "Recalculate with items made on site" makes from `plan` and the groups now: the real
// planner, with settings.onSite worked out as the page works it out.
function recalculated(plan: StoredCalculatedPlan, now: FactoryGroups) {
  const onSite = onSiteSettings(plan, now);
  return generatedWith(onSite ? { onSite } : {});
}
const show = async (plan: StoredCalculatedPlan, now: FactoryGroups, phase: Phase = '3') => {
  open({ calculated: plan, state: { factoryGroups: now }, phase });
  render();
  await nextTick();
};
const words = (selector: string) => $(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
const made = (group: string) => words(`#section-${group} [data-on-site-made]`);
const marked = (group: string) => words(`#section-${group} [data-on-site-marked]`);
const lineGroups = (plan: StoredCalculatedPlan) =>
  plan.stages['3'].rows!.filter(row => row.onSite).map(row => row.onSite!.group);
const notice = () => $('[data-on-site-recalc]');

beforeEach(() => {
  page();
  setQuery('');
  setFactoryFilter('all');
  setFactoryEditing(false);
  go('factories');
});

test("a plan with the groups' lines: each heading lists what it makes, as before", async () => {
  const plan = recalculated(generated(), groups());
  assert.deepEqual(lineGroups(plan).sort(), [MOTORS, WIRING]);
  await show(plan, groups());
  for (const group of [MOTORS, WIRING]) {
    assert.equal(words(`#section-${group} [data-on-site-items]`), 'Made on site: Wire');
    assert.equal(marked(group), null);
  }
  assert.equal(notice(), null);
  // While editing, the picker takes the summary's place.
  setFactoryEditing(true);
  render();
  await nextTick();
  assert.equal($('[data-on-site-items]'), null);
  assert.ok($(`[data-on-site-picker="${MOTORS}"]`));
  // A group that marks nothing and has no line says nothing.
  await show(generated(), groups(MOTOR_ROWS, {}));
  assert.equal($('[data-on-site-items]'), null);
});

test('a group that no longer uses its mark does not claim it makes it (#931)', async () => {
  // Both groups mark Wire, recalculated: both get a Wire line.
  const first = recalculated(generated(), groups());
  // Then the Stator rows leave Motors. Its Wire line is still in the open plan, until a
  // recalculation, and the page says the plan needs one.
  const withoutStator = groups(['Recipe_Rotor_C', 'Recipe_Motor_C']);
  await show(first, withoutStator);
  assert.equal(made(MOTORS), 'Made on site: Wire (until a recalculation)');
  assert.equal(marked(MOTORS), null);
  assert.equal(made(WIRING), 'Made on site: Wire');
  assert.ok(notice(), 'the plan needs a recalculation');
  // Recalculated again: only Wiring has a Wire line, and Motors' heading says its mark gives it
  // none, in the picker's words, rather than that it makes Wire.
  const second = recalculated(first, withoutStator);
  assert.deepEqual(lineGroups(second), [WIRING]);
  await show(second, withoutStator);
  assert.equal(made(MOTORS), null);
  assert.equal(marked(MOTORS), 'Marked, not made on site: Wire (no line here uses it now)');
  assert.doesNotMatch(words(`#section-${MOTORS} [data-on-site-items]`)!, /^Made on site/);
  assert.equal(made(WIRING), 'Made on site: Wire');
  assert.equal(notice(), null, 'nothing more to recalculate');
});

test('a mark the plan was not calculated with needs a recalculation', async () => {
  // Saved marks, no recalculation yet: the plan makes everything centrally.
  await show(generated(), groups(MOTOR_ROWS, { [MOTORS]: ['Wire'], [WIRING]: ['Screws'] }));
  assert.equal(made(MOTORS), null);
  assert.equal(marked(MOTORS), 'Marked, not made on site: Wire (needs a recalculation)');
  assert.match(notice()!.textContent!, /This plan needs a recalculation\./);
  // Wiring's Cable line takes no Screws, so a recalculation would not give it a line either.
  assert.equal(marked(WIRING), 'Marked, not made on site: Screws (no line here uses it now)');
  // A further mark beside a line the plan has.
  const plan = recalculated(generated(), groups());
  await show(plan, groups(MOTOR_ROWS, { [MOTORS]: ['Steel Pipe', 'Wire'], [WIRING]: ['Wire'] }));
  assert.equal(made(MOTORS), 'Made on site: Wire');
  assert.equal(marked(MOTORS), 'Marked, not made on site: Steel Pipe (needs a recalculation)');
});

test("a raw resource's mark says it can't be made on site", async () => {
  const plan = recalculated(generated(), groups());
  await show(plan, groups(MOTOR_ROWS, { [MOTORS]: ['Water', 'Wire'], [WIRING]: ['Wire'] }));
  assert.equal(made(MOTORS), 'Made on site: Wire');
  assert.equal(marked(MOTORS), "Marked, not made on site: Water (can't be made on site)");
  // Water alone, before any recalculation: still not made on site, and nothing to recalculate.
  await show(generated(), groups(MOTOR_ROWS, { [MOTORS]: ['Water'] }));
  assert.equal(made(MOTORS), null);
  assert.equal(marked(MOTORS), "Marked, not made on site: Water (can't be made on site)");
  assert.equal(notice(), null);
});

test('the heading follows the phase shown: a phase without the line, or with it made centrally', async () => {
  const plan = recalculated(generated(), groups());
  // Phase 4 without Motors' line, as when a group has no consumer there.
  plan.stages['4'].rows = plan.stages['4'].rows!.filter(row => row.onSite?.group !== MOTORS);
  await show(plan, groups(), '4');
  assert.equal(made(MOTORS), null);
  assert.equal(marked(MOTORS), 'Marked, not made on site: Wire (no line in this phase)');
  assert.equal(made(WIRING), 'Made on site: Wire');
  // The planner made it centrally there (onSiteDropped), which the phase's warning explains.
  plan.stages['4'].onSiteDropped = { [MOTORS]: ['Wire'] };
  const summary = onSiteSummaries(plan, groups(), plan.stages['4']);
  assert.deepEqual(summary[MOTORS], {
    made: [],
    marked: [{ item: 'Wire', note: '(made centrally in this phase)' }],
  });
  // Phase 3 still has it.
  await show(plan, groups(), '3');
  assert.equal(made(MOTORS), 'Made on site: Wire');
});

test('a hostile group name and item stay text', async () => {
  const plan = recalculated(generated(), groups());
  // A line for an item with a hostile name, as a damaged or hand-made plan could hold.
  const rows = plan.stages['3'].rows!;
  const wire = rows.find(row => row.id === `${WIRE}:${MOTORS}`)!;
  const line: CalcRow = { ...wire, outputs: { [evil]: 1 } };
  rows.splice(rows.indexOf(wire), 1, line);
  plan.settings.onSite![MOTORS]!.items = [evil];
  await show(plan, groups(MOTOR_ROWS, { [MOTORS]: [evil], [WIRING]: ['Wire'] }, evil));
  assert.ok(made(MOTORS)!.startsWith(`Made on site: ${evil}`));
  assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');
  assert.equal($(`#section-${MOTORS} h2`)!.textContent, evil);
});
