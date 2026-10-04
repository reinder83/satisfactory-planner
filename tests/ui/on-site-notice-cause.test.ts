// Made on site: the recalculation notice counts and words each item's lines, not a group's marks
// (#985, #970, #938). A recalculation gives a group its own line of an item only where a row of
// the group uses it (siteCopies in planner/on-site.ts), so onSiteSettings keeps only those items,
// per item, and onSiteChange compares them with the lines the plan has, counted the same way from
// the shares it was calculated with. So:
// - #938 part 1: a mark no line of the group uses asks for no recalculation;
// - #938 part 2: a group that loses the last consumer of one item, while another of its marks
//   keeps one, asks for one that drops that line;
// - #970: "Now: …" names only the items a recalculation would give a line for, as the heading does;
// - #985: when only a group's lines changed, the notice says that ("Alpha marks Wire, but none of
//   its lines uses it now; …"), and a neutral "what … differs from this plan" covers a real change to the marks and a consumer moving in for a mark the plan did not record (#1006);
// - a plan stored by an earlier release, whose settings.onSite lists a mark without a consumer,
//   loads as it is and asks for nothing until a line would change.
// Each recalculation here is the real planner's (generatedWith).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setFactoryEditing, setFactoryFilter, setQuery } from '../../public/app/session.ts';
import { adaClearFault, adaCurrent, setAdaIndex } from '../../public/app/ada-panel.ts';
import { render } from '../../public/app/shell.ts';
import { onSiteSettings } from '../../public/app/on-site.ts';
import {
  onSiteChange,
  onSiteSummaries,
  RAW_NOTE,
  UNUSED_NOTE,
} from '../../public/app/on-site-picker.ts';
import { validateTransfer } from '../../public/transfer.ts';
import { $, generated, generatedWith, go, open, page } from './setup.ts';
import type {
  CalcRow,
  FactoryGroups,
  StageKey,
  StoredCalculatedPlan,
} from '../../public/types/index.ts';

const ALPHA = 'fg-alpha1';
const BETA = 'fg-beta1';
const GAMMA = 'fg-gamma1';
// Neutral, so it is true whether a mark changed or a consumer moved in for a mark the plan did not
// record (#1006).
const MARKS_CHANGED = /What your factory groups make on site differs from this plan\./;
const ALPHA_DROPS_WIRE =
  "Alpha marks Wire, but none of its lines uses it now; a recalculation would drop Alpha's Wire line";

// #985's groups: Alpha holds the Stator line (`statorIn` says where it is), Beta 75/min of Cable,
// Gamma the rest of Cable and the Wire line; Alpha and Beta mark Wire unless `local` says
// otherwise.
const trio = (
  statorIn = ALPHA,
  local: FactoryGroups['local'] = { [ALPHA]: ['Wire'], [BETA]: ['Wire'] },
): FactoryGroups => ({
  groups: [
    { id: ALPHA, name: 'Alpha' },
    { id: BETA, name: 'Beta' },
    { id: GAMMA, name: 'Gamma' },
  ],
  assignments: {
    Recipe_Stator_C: [{ group: statorIn, rate: null }],
    Recipe_Cable_C: [
      { group: BETA, rate: 75 },
      { group: GAMMA, rate: null },
    ],
    Recipe_Wire_C: [{ group: GAMMA, rate: null }],
  },
  local,
});
// One group, Alpha, holding `rows` (only the Stator takes Wire, only the Rotor Screws) and marking
// `local`.
const alpha = (local: string[], rows = ['Recipe_Stator_C']): FactoryGroups => ({
  groups: [{ id: ALPHA, name: 'Alpha' }],
  assignments: Object.fromEntries(rows.map(row => [row, [{ group: ALPHA, rate: null }]])),
  local: { [ALPHA]: local },
});

// The plan "Recalculate with items made on site" makes from `plan` and the groups now.
function recalculated(plan: StoredCalculatedPlan, now: FactoryGroups) {
  const onSite = onSiteSettings(plan, now);
  const { onSite: _old, ...settings } = plan.settings;
  return generatedWith({ ...settings, ...(onSite ? { onSite } : {}) });
}
// The items of `group`'s own lines in `phase`, sorted.
const lineItems = (plan: StoredCalculatedPlan, group: string, phase: StageKey = '3') =>
  [
    ...new Set(
      plan.stages[phase]
        .rows!.filter(row => row.onSite?.group === group)
        .flatMap(row => Object.keys(row.outputs)),
    ),
  ].sort();

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
const notice = () => words('[data-on-site-recalc]');
const made = (group: string) => words(`#section-${group} [data-on-site-made]`);
const marked = (group: string) => words(`#section-${group} [data-on-site-marked]`);
const box = (group: string, item: string) =>
  $<HTMLInputElement>(`[data-on-site-picker="${group}"] [data-on-site-item="${item}"]`);
// ADA's remark with this id, if ADA has it among its lines now.
function adaSays(id: string): string {
  adaClearFault();
  for (let i = 0; i < 60; i++) {
    setAdaIndex(i);
    const line = adaCurrent();
    if (line?.id === id) return line.text;
  }
  return '';
}

beforeEach(() => {
  page();
  setQuery('');
  setFactoryFilter('all');
  setFactoryEditing(false);
  go('factories');
});

test("#985: a marking group's last consumer moved out: the notice says so, not that the marks changed", async () => {
  // Alpha and Beta mark Wire and are recalculated: both have their own Wire line.
  const first = recalculated(generated(), trio());
  assert.deepEqual(lineItems(first, ALPHA), ['Wire']);
  assert.deepEqual(lineItems(first, BETA), ['Wire']);
  assert.equal(onSiteChange(first, trio()), null);
  // The Stator moves from Alpha to Gamma; no mark changes.
  const moved = trio(GAMMA);
  const change = onSiteChange(first, moved)!;
  assert.equal(change.marksChanged, false);
  assert.deepEqual(change.uses, [ALPHA_DROPS_WIRE]);
  assert.equal(change.now, 'Beta makes Wire on site');
  assert.equal(change.had, 'Alpha makes Wire on site; Beta makes Wire on site');
  await show(first, moved);
  assert.equal(
    notice(),
    'This plan needs a recalculation. ' +
      ALPHA_DROPS_WIRE +
      '. Now: Beta makes Wire on site. This plan: Alpha makes Wire on site; Beta makes Wire on ' +
      'site. Nothing changes until you start it. Recalculate with items made on site creates a ' +
      'new profile that plans it and opens it; this profile stays as it is.',
  );
  assert.doesNotMatch(notice()!, MARKS_CHANGED);
  assert.ok($('[data-on-site-recalc] [data-recalc-on-site]'));
  // ADA follows the same rule.
  const ada = adaSays('on-site-pending');
  assert.match(ada, /^What your factory groups' lines use changed/);
  assert.doesNotMatch(ada, /differs from this plan/);
  // The heading: Alpha's Wire line until a recalculation; the picker still has Wire ticked.
  assert.equal(made(ALPHA), 'Made on site: Wire (until a recalculation)');
  await show(first, moved, true);
  assert.equal(box(ALPHA, 'Wire')?.checked, true);
  // The recalculation does what the notice said, and then there is nothing more to do.
  const second = recalculated(first, moved);
  assert.deepEqual(lineItems(second, ALPHA), []);
  assert.deepEqual(lineItems(second, BETA), ['Wire']);
  await show(second, moved);
  assert.equal(notice(), null);
  // Alpha holds no line now; its summary keeps the mark with the picker's note.
  assert.deepEqual(onSiteSummaries(second, moved, second.stages['3'])[ALPHA], {
    made: [],
    marked: [{ item: 'Wire', note: UNUSED_NOTE }],
  });
});

test('a real change to the marks gets the neutral words, alone or beside a moved line', async () => {
  const first = recalculated(generated(), trio());
  // Beta clears Wire.
  const cleared = trio(ALPHA, { [ALPHA]: ['Wire'] });
  const change = onSiteChange(first, cleared)!;
  assert.equal(change.marksChanged, true);
  assert.deepEqual(change.uses, []);
  await show(first, cleared);
  assert.match(notice()!, MARKS_CHANGED);
  assert.match(notice()!, /Now: Alpha makes Wire on site\./);
  assert.match(notice()!, /This plan: Alpha makes Wire on site; Beta makes Wire on site\./);
  assert.equal($('[data-on-site-use]'), null);
  assert.match(
    adaSays('on-site-pending'),
    /^What your factory groups make on site differs from this plan/,
  );
  // A new mark on a plan without any: the same words.
  await show(generated(), trio());
  assert.match(notice()!, MARKS_CHANGED);
  assert.match(notice()!, /Now: Alpha makes Wire on site; Beta makes Wire on site\./);
  assert.match(notice()!, /This plan makes everything on central lines\./);
  // Both at once: each cause in its own words.
  await show(first, trio(GAMMA, { [ALPHA]: ['Wire'] }));
  assert.match(notice()!, MARKS_CHANGED);
  assert.match(notice()!, new RegExp(ALPHA_DROPS_WIRE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(notice()!, /Now no group makes anything on site\./);
  assert.match(adaSays('on-site-pending'), /^What your factory groups make on site differs/);
});

test('#938 part 1: a mark no line of the group uses asks for no recalculation', async () => {
  // Alpha holds the Stator (Wire and Steel Pipe in) and marks Screws, which it does not use.
  const marks = alpha(['Screws', 'Wire']);
  assert.deepEqual(onSiteSettings(generated(), marks)![ALPHA]!.items, ['Wire']);
  await show(generated(), marks);
  assert.match(notice()!, /Now: Alpha makes Wire on site\./);
  assert.doesNotMatch(notice()!, /Screws/);
  // Calculated with Wire alone: marking Screws too changes no line, so nothing is asked.
  const plan = recalculated(generated(), alpha(['Wire']));
  assert.deepEqual(lineItems(plan, ALPHA), ['Wire']);
  assert.equal(onSiteChange(plan, marks), null);
  await show(plan, marks);
  assert.equal(notice(), null);
  assert.equal(adaSays('on-site-pending'), '');
  assert.equal(marked(ALPHA), `Marked, not made on site: Screws ${UNUSED_NOTE}`);
  // Recalculated with both marks: the same plan, frozen with Wire only.
  const again = recalculated(generated(), marks);
  assert.deepEqual(again.settings.onSite?.[ALPHA]?.items, ['Wire']);
  assert.deepEqual(lineItems(again, ALPHA), ['Wire']);
  assert.equal(onSiteChange(again, marks), null);
});

test('#938 part 2: losing the last consumer of one mark while another keeps one asks', async () => {
  // Alpha holds the Stator (Wire) and the Rotor (Screws), and marks both items.
  const both = alpha(['Screws', 'Wire'], ['Recipe_Stator_C', 'Recipe_Rotor_C']);
  const first = recalculated(generated(), both);
  assert.deepEqual(lineItems(first, ALPHA), ['Screws', 'Wire']);
  assert.equal(onSiteChange(first, both), null);
  // The Rotor leaves Alpha: no line of it uses Screws now, while the Stator still uses Wire.
  const withoutRotor = alpha(['Screws', 'Wire']);
  const change = onSiteChange(first, withoutRotor)!;
  assert.ok(change, 'the plan needs a recalculation');
  assert.equal(change.marksChanged, false);
  assert.deepEqual(change.uses, [
    "Alpha marks Screws, but none of its lines uses it now; a recalculation would drop Alpha's Screws line",
  ]);
  assert.equal(change.now, 'Alpha makes Wire on site');
  assert.equal(change.had, 'Alpha makes Screws and Wire on site');
  await show(first, withoutRotor);
  assert.match(notice()!, /^This plan needs a recalculation\. Alpha marks Screws, but none/);
  // The recalculation drops the Screws line, keeps the Wire line, and asks nothing more.
  const second = recalculated(first, withoutRotor);
  assert.deepEqual(lineItems(second, ALPHA), ['Wire']);
  assert.equal(onSiteChange(second, withoutRotor), null);
});

test('#970: "Now:" names only the items a recalculation gives a line, as the heading does', async () => {
  // Alpha holds only the Stator and marks Quickwire, which no Alpha line uses, and Wire.
  const marks = alpha(['Quickwire', 'Wire']);
  await show(generated(), marks);
  assert.match(notice()!, /Now: Alpha makes Wire on site\./);
  assert.doesNotMatch(notice()!, /Quickwire/);
  assert.equal(
    marked(ALPHA),
    `Marked, not made on site: Quickwire ${UNUSED_NOTE}; Wire (needs a recalculation)`,
  );
  // The recalculation gives exactly that line, and is frozen with exactly that item.
  const plan = recalculated(generated(), marks);
  assert.deepEqual(plan.settings.onSite?.[ALPHA]?.items, ['Wire']);
  assert.deepEqual(lineItems(plan, ALPHA), ['Wire']);
  await show(plan, marks);
  assert.equal(notice(), null);
  assert.equal(made(ALPHA), 'Made on site: Wire');
  assert.equal(marked(ALPHA), `Marked, not made on site: Quickwire ${UNUSED_NOTE}`);
  // Clearing the unused mark later changes no line either.
  assert.equal(onSiteChange(plan, alpha(['Wire'])), null);
  // A radioactive item (#933) its lines use gets no line from the planner: the notice does not
  // name it, and the heading says it can't be made on site.
  const nuclear = generated();
  const rows = nuclear.stages['3'].rows!;
  const stator = rows.find(row => row.id === 'Recipe_Stator_C')!;
  const row = (id: string, name: string, inputs: CalcRow['inputs'], outputs: CalcRow['outputs']) =>
    ({ ...stator, id, name, inputs, outputs }) satisfies CalcRow;
  rows.push(
    row(
      'Recipe_NuclearFuelRod_C',
      'Uranium Fuel Rod',
      { 'Encased Uranium Cell': 10 },
      {
        'Uranium Fuel Rod': 0.4,
      },
    ),
    row(
      'Recipe_UraniumCell_C',
      'Encased Uranium Cell',
      { Uranium: 50, Concrete: 15, 'Sulfuric Acid': 40 },
      { 'Encased Uranium Cell': 25, 'Sulfuric Acid': 10 },
    ),
  );
  const rods = alpha(['Encased Uranium Cell'], ['Recipe_NuclearFuelRod_C']);
  assert.equal(onSiteSettings(nuclear, rods), undefined);
  assert.equal(onSiteChange(nuclear, rods), null);
  assert.deepEqual(onSiteSummaries(nuclear, rods, nuclear.stages['3'])[ALPHA]!.marked, [
    { item: 'Encased Uranium Cell', note: RAW_NOTE },
  ]);
});

test('#1006: a consumer moving in for a mark the plan did not record gets the neutral words', async () => {
  // Alpha marks Wire while the Stator sits in Gamma: no Alpha row uses Wire, so the recalculated
  // plan neither gives Alpha a line nor records the mark.
  const first = recalculated(generated(), trio(GAMMA));
  assert.deepEqual(lineItems(first, ALPHA), []);
  assert.equal(first.settings.onSite?.[ALPHA], undefined);
  // The Stator moves into Alpha. Nothing tells this apart from a new mark, so the notice says
  // only that the groups' made-on-site lines differ from the plan, which is true either way.
  const moved = trio(ALPHA);
  const change = onSiteChange(first, moved)!;
  assert.equal(change.marksChanged, true);
  await show(first, moved);
  assert.match(notice()!, MARKS_CHANGED);
  assert.doesNotMatch(notice()!, /You changed|changed since it was calculated/);
  assert.match(notice()!, /Now: Alpha makes Wire on site; Beta makes Wire on site\./);
  assert.match(adaSays('on-site-pending'), /^What your factory groups make on site differs/);
});

test('compat: a plan an earlier release stored with a mark no line uses loads and asks nothing', async () => {
  // What an earlier release froze for Alpha marking Quickwire and Wire: every mark of a group
  // with any consumer, so Quickwire too, which no Alpha row uses (#938, #970).
  const shares = onSiteSettings(generated(), alpha(['Wire']))![ALPHA]!.shares;
  const stored = generatedWith({
    ...generated().settings,
    onSite: { [ALPHA]: { name: 'Alpha', items: ['Quickwire', 'Wire'], shares } },
  });
  assert.deepEqual(stored.settings.onSite?.[ALPHA]?.items, ['Quickwire', 'Wire']);
  assert.deepEqual(lineItems(stored, ALPHA), ['Wire']);
  assert.deepEqual(lineItems(stored, ALPHA, '4'), ['Wire'], 'no Quickwire line in any phase');
  // It still imports as it is.
  const marks = alpha(['Quickwire', 'Wire']);
  const imported = validateTransfer({
    format: 'satisfactory-planner-saves',
    version: 1,
    exportedAt: '2026-10-01T12:00:00.000Z',
    saves: [
      {
        id: 's1',
        name: 'World',
        activeProfile: 'p1',
        profiles: [
          {
            id: 'p1',
            name: 'Made on site',
            kind: 'calculated',
            plan: stored,
            state: {
              version: 14,
              settings: { phase: '3' },
              checks: {},
              notes: {},
              deliveries: {},
              customTasks: [],
              factoryGroups: marks,
            },
          },
        ],
      },
    ],
  });
  const loaded = imported.saves[0]!.profiles[0]!;
  assert.deepEqual(loaded.plan!.settings.onSite, stored.settings.onSite);
  assert.deepEqual(loaded.state.factoryGroups?.local, { [ALPHA]: ['Quickwire', 'Wire'] });
  // Its stored Quickwire is no line: no notice with the marks it was made with, nor once the
  // unused mark is cleared, so it never asks for a recalculation that would change nothing.
  assert.equal(onSiteChange(stored, marks), null);
  assert.equal(onSiteChange(stored, alpha(['Wire'])), null);
  await show(stored, marks);
  assert.equal(notice(), null);
  assert.equal(made(ALPHA), 'Made on site: Wire');
  assert.equal(marked(ALPHA), `Marked, not made on site: Quickwire ${UNUSED_NOTE}`);
  // Once an Alpha line uses Quickwire (the AI Limiter, Phases 4 and 5), the stored mark gives a
  // line: the notice says Alpha's lines now use it, not that the marks changed.
  const limiter = alpha(['Quickwire', 'Wire'], ['Recipe_Stator_C', 'Recipe_AILimiter_C']);
  const change = onSiteChange(stored, limiter)!;
  assert.equal(change.marksChanged, false);
  assert.deepEqual(change.uses, [
    "Alpha's lines now use Quickwire, which it marks; a recalculation would add Alpha's Quickwire line",
  ]);
  assert.equal(change.now, 'Alpha makes Quickwire and Wire on site');
  assert.equal(change.had, 'Alpha makes Wire on site');
  await show(stored, limiter);
  assert.doesNotMatch(notice()!, MARKS_CHANGED);
  assert.match(notice()!, /Alpha's lines now use Quickwire, which it marks;/);
  assert.equal(marked(ALPHA), 'Marked, not made on site: Quickwire (needs a recalculation)');
  const next = recalculated(stored, limiter);
  assert.deepEqual(lineItems(next, ALPHA, '4'), ['Quickwire', 'Wire']);
  assert.equal(onSiteChange(next, limiter), null);
});
