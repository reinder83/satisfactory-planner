// A factory group's heading outside edit mode lists the marks that share a reason under one note
// (#955): "Cable and Quickwire (no line here uses it now); Water (can't be made on site)", not the
// note after each mark. The notes keep their wording and the order they come in (the marks sorted
// by item), and the "Made on site" line groups its "(until a recalculation)" items the same way
// (GroupSections.vue, onSiteEntriesText in app/on-site-picker.ts). Plain text, never markup.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { setFactoryEditing, setFactoryFilter, setQuery } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { onSiteSettings } from '../../public/app/on-site.ts';
import { $, evil, generated, generatedWith, go, open, page } from './setup.ts';
import type { FactoryGroups, StoredCalculatedPlan } from '../../public/types/index.ts';

const MOTORS = 'fg-motors1';
const WIRING = 'fg-wiring1';

// Motors holds the Rotor, Stator and Motor lines (Iron Rod, Screws, Steel Pipe and Wire go in),
// Wiring the Cable line (Wire goes in).
const groups = (local: FactoryGroups['local'], motorsName = 'Motors'): FactoryGroups => ({
  groups: [
    { id: MOTORS, name: motorsName },
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
// The plan "Recalculate with items made on site" makes from the plain plan with `marks`.
let planned: StoredCalculatedPlan | undefined;
const bothMakeWire = () =>
  structuredClone(
    (planned ??= generatedWith({
      onSite: onSiteSettings(generated(), groups({ [MOTORS]: ['Wire'], [WIRING]: ['Wire'] })),
    })),
  );
const show = async (plan: StoredCalculatedPlan, now: FactoryGroups) => {
  open({ calculated: plan, state: { factoryGroups: now }, phase: '3' });
  render();
  await nextTick();
};
const words = (selector: string) => $(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
const made = (group: string) => words(`#section-${group} [data-on-site-made]`);
const marked = (group: string) => words(`#section-${group} [data-on-site-marked]`);
const count = (text: string, part: string) => text.split(part).length - 1;

beforeEach(() => {
  page();
  setQuery('');
  setFactoryFilter('all');
  setFactoryEditing(false);
  go('factories');
});

test('marks that share a reason are listed under one note, in the order the notes come', async () => {
  await show(
    bothMakeWire(),
    groups({
      [MOTORS]: ['Cable', 'Iron Rod', 'Quickwire', 'Screws', 'Steel Pipe', 'Water', 'Wire'],
      [WIRING]: ['Wire'],
    }),
  );
  assert.equal(made(MOTORS), 'Made on site: Wire');
  // Cable comes first, so its note does; Iron Rod's comes next, Water's last.
  const text = marked(MOTORS)!;
  assert.equal(
    text,
    'Marked, not made on site: Cable and Quickwire (no line here uses it now); ' +
      'Iron Rod, Screws and Steel Pipe (needs a recalculation); ' +
      "Water (can't be made on site)",
  );
  for (const note of [
    '(no line here uses it now)',
    '(needs a recalculation)',
    "(can't be made on site)",
  ])
    assert.equal(count(text, note), 1, `${note} once`);
});

test('the order of the notes follows the first mark of each, not a fixed order', async () => {
  // Iron Rod (needs a recalculation) comes before Quickwire (no line here uses it now), and
  // Screws joins Iron Rod's note although it comes after Quickwire.
  await show(
    bothMakeWire(),
    groups({ [MOTORS]: ['Screws', 'Quickwire', 'Iron Rod', 'Wire'], [WIRING]: ['Wire'] }),
  );
  assert.equal(
    marked(MOTORS),
    'Marked, not made on site: Iron Rod and Screws (needs a recalculation); ' +
      'Quickwire (no line here uses it now)',
  );
  // Two marks with one reason in another group.
  await show(bothMakeWire(), groups({ [MOTORS]: ['Wire'], [WIRING]: ['Wire', 'Screws', 'Rotor'] }));
  assert.equal(
    marked(WIRING),
    'Marked, not made on site: Rotor and Screws (no line here uses it now)',
  );
});

test('a single mark, and one mark per reason, read as before', async () => {
  await show(bothMakeWire(), groups({ [MOTORS]: ['Steel Pipe', 'Wire'], [WIRING]: ['Wire'] }));
  assert.equal(marked(MOTORS), 'Marked, not made on site: Steel Pipe (needs a recalculation)');
  assert.equal(marked(WIRING), null);
  // One mark under each of three reasons: each keeps its own note, the runs apart by "; ".
  await show(
    bothMakeWire(),
    groups({ [MOTORS]: ['Quickwire', 'Steel Pipe', 'Water', 'Wire'], [WIRING]: ['Wire'] }),
  );
  assert.equal(
    marked(MOTORS),
    'Marked, not made on site: Quickwire (no line here uses it now); ' +
      "Steel Pipe (needs a recalculation); Water (can't be made on site)",
  );
});

test('"Made on site" groups its "until a recalculation" items the same way', async () => {
  // Wiring made Copper Ingot and Wire on site.
  const plan = generatedWith({
    onSite: onSiteSettings(
      generated(),
      groups({ [MOTORS]: ['Wire'], [WIRING]: ['Copper Ingot', 'Wire'] }),
    ),
  });
  await show(plan, groups({ [MOTORS]: ['Wire'], [WIRING]: ['Copper Ingot', 'Wire'] }));
  assert.equal(made(WIRING), 'Made on site: Copper Ingot and Wire');
  // It keeps only Wire: Copper Ingot is made until a recalculation, Wire still is.
  await show(plan, groups({ [MOTORS]: ['Wire'], [WIRING]: ['Wire'] }));
  assert.equal(made(WIRING), 'Made on site: Copper Ingot (until a recalculation); Wire');
  // It marks neither: both lines under one note.
  await show(plan, groups({ [MOTORS]: ['Wire'] }));
  assert.equal(made(WIRING), 'Made on site: Copper Ingot and Wire (until a recalculation)');
  assert.equal(count(made(WIRING)!, '(until a recalculation)'), 1);
});

test('a hostile item and group name stay text when grouped', async () => {
  // An unknown item reads as one the planner cannot make on site, as Water does.
  await show(
    bothMakeWire(),
    groups({ [MOTORS]: [evil, 'Water', 'Wire'], [WIRING]: ['Wire'] }, evil),
  );
  assert.equal(
    marked(MOTORS),
    `Marked, not made on site: ${evil} and Water (can't be made on site)`,
  );
  assert.equal(document.querySelector('x-evil'), null, 'no user text is inserted as markup');
  assert.equal($(`#section-${MOTORS} h2`)!.textContent, evil);
});
