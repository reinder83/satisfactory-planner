// Two fields that save on change, edited in quick succession (#627, #654): shared by the server
// edition's test (input-race.test.ts) and the browser edition's (input-race-browser.test.ts).
// Saving any control redraws everything that reads session state, twice: when the Saving
// indicator comes on and after the save. A field bound to the saved value was put back by a
// redraw over what was typed in it but not yet committed, and the change event that followed
// saved the old value. Each race below is one kind of field: a delivery counter, a bay name, a
// group name and a link's round trip.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { groupLinks } from '../../public/app/group-links.ts';
import { setFactoryEditing, setLayoutEditing, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { storageBays } from '../../public/app/views/storage.ts';
import { $, catalog, generated, go, open, page } from './setup.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};

export interface Race {
  // Opens the page with both fields.
  open: () => Promise<void> | void;
  first: string;
  second: string;
  // What is committed in the first field, and typed in the second: before the first is
  // committed, and then more while it saves.
  commit: string;
  typed: [string, string];
  // The first and second field's stored values, and what they should read in the end.
  stored: () => [unknown, unknown];
  expected: [unknown, unknown];
}

const bayName = (id: string) => storageBays().find(bay => bay.id === id)?.name;
const groupName = (id: string) => state.factoryGroups?.groups.find(g => g.id === id)?.name;

export const races: Record<string, Race> = {
  'delivery counter': {
    open() {
      go('plan');
      open({ state: { deliveries: { '3-modular-engine': 0, '3-versatile-framework': 0 } } });
      render();
    },
    first: '#delivery-3-modular-engine',
    second: '#delivery-3-versatile-framework',
    commit: '5',
    typed: ['12', '124'],
    stored: () => [state.deliveries['3-modular-engine'], state.deliveries['3-versatile-framework']],
    expected: [5, 124],
  },
  'bay name': {
    async open() {
      go('storage');
      open();
      setLayoutEditing(true);
      render();
      await nextTick();
    },
    first: '[data-bay-rename="C"]',
    second: '[data-bay-rename="D"]',
    commit: 'Bay C renamed',
    typed: ['Ne', 'New D'],
    stored: () => [bayName('C'), bayName('D')],
    expected: ['Bay C renamed', 'New D'],
  },
  'group name': {
    async open() {
      go('factories');
      open({
        state: {
          factoryGroups: {
            groups: [
              { id: 'fg-cable01', name: 'Cable factory' },
              { id: 'fg-plates1', name: 'Stitched plates' },
            ],
            assignments: {},
          },
        },
      });
      setFactoryEditing(true);
      render();
      await nextTick();
    },
    first: '[data-group-rename="fg-cable01"]',
    second: '[data-group-rename="fg-plates1"]',
    commit: 'Cables',
    typed: ['Pla', 'Plates'],
    stored: () => [groupName('fg-cable01'), groupName('fg-plates1')],
    expected: ['Cables', 'Plates'],
  },
  'round trip': (() => {
    const plan = generated(),
      rows = plan.stages['3'].rows!,
      factoryGroups = {
        groups: [
          { id: 'fg-smelt1', name: 'Smelting' },
          { id: 'fg-parts1', name: 'Parts' },
        ],
        assignments: Object.fromEntries(
          rows.map((r, i) => [r.id, [{ group: i % 2 ? 'fg-parts1' : 'fg-smelt1', rate: null }]]),
        ),
      },
      // Two links that go by truck.
      [one, two] = groupLinks(plan.stages['3'], factoryGroups).map(l => l.from + ':' + l.to),
      truck = { mode: 'truck' as const, roundTripMin: 5, fuel: 'Packaged Fuel' },
      trip = (key: string) => state.factoryGroups?.links?.[key]?.roundTripMin;
    return {
      async open() {
        go('logistics');
        open({
          calculated: plan,
          workspace: { catalog: catalog() },
          state: {
            version: 7,
            factoryGroups: { ...factoryGroups, links: { [one!]: truck, [two!]: truck } },
          },
        });
        render();
        await nextTick();
      },
      first: `[data-link-trip="${one}"]`,
      second: `[data-link-trip="${two}"]`,
      commit: '9',
      typed: ['3', '34'],
      stored: () => [trip(one!), trip(two!)],
      expected: [9, 34],
    };
  })(),
};

// `stub(held)` makes the edition's saves reply; each save awaits held() first, which holds the
// first save until the second field has been typed in and lets every later one through.
export async function typedDuringSave(race: Race, stub: (held: () => Promise<void>) => void) {
  page();
  await race.open();
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  let first = true;
  stub(() => {
    if (!first) return Promise.resolve();
    first = false;
    return gate;
  });
  const one = $<HTMLInputElement>(race.first)!,
    two = $<HTMLInputElement>(race.second)!;
  assert.ok(one && two, 'both fields are drawn');
  const type = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  // Typing starts in the second field before the first is committed, and goes on while the
  // first one saves: the Saving indicator and the redraw after the save both leave it alone.
  type(two, race.typed[0]);
  type(one, race.commit);
  one.dispatchEvent(new Event('change'));
  await nextTick();
  assert.equal(two.value, race.typed[0], 'kept while the Saving indicator comes on');
  type(two, race.typed[1]);
  release();
  await settle();
  assert.equal(race.stored()[0], race.expected[0]);
  assert.equal(two.value, race.typed[1], 'kept after the other field saved');
  two.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(race.stored(), race.expected, 'the typed value is saved');
  assert.equal(two.value, race.typed[1]);
  assert.equal(one.value, race.commit);
}
