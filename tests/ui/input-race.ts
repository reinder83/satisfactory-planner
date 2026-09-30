// Two fields that save on change, edited in quick succession (#627, #654): shared by the server
// edition's test (input-race.test.ts) and the browser edition's (input-race-browser.test.ts).
// Saving any control redraws everything that reads session state, twice: when the Saving
// indicator comes on and after the save. A field bound to the saved value was put back by a
// redraw over what was typed in it but not yet committed, and the change event that followed
// saved the old value. Each race below is one kind of field: a delivery counter, a bay name, a
// group name, a factory's rate in its group and a link's round trip.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { groupLinks } from '../../public/app/group-links.ts';
import { setFactoryEditing, setLayoutEditing, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { storageBays } from '../../public/app/views/storage.ts';
import { $, applyUpdate, catalog, generated, go, open, page } from './setup.ts';
import type { ProgressState, UpdateOp } from '../../public/types/index.ts';

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
  // For a field of a list (ui/draft.ts useDrafts, #683): `set` writes the second field's value,
  // saved in another tab, into a save's reply; `commits` are committed in the first field, one
  // per save, and `others` are what the other tab saves meanwhile.
  elsewhere?: {
    set: (reply: ProgressState, value: string) => void;
    commits: [string, string, string];
    others: [string, string, string];
  };
}

const bayName = (id: string) => storageBays().find(bay => bay.id === id)?.name;
const groupName = (id: string) => state.factoryGroups?.groups.find(g => g.id === id)?.name;
const groupRate = (key: string) => state.factoryGroups?.assignments[key]?.[0]?.rate;

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
    elsewhere: {
      set(reply, value) {
        reply.factoryGroups!.groups.find(g => g.id === 'fg-plates1')!.name = value;
      },
      commits: ['Cables', 'Wires', 'Cords'],
      others: ['Plates elsewhere', 'Plates again', 'Plates at last'],
    },
  },
  // A factory card's rate in its group (#691), beside another factory's.
  'group rate': {
    async open() {
      go('factories');
      open({
        state: {
          factoryGroups: {
            groups: [
              { id: 'fg-cable01', name: 'Cable factory' },
              { id: 'fg-plates1', name: 'Stitched plates' },
            ],
            assignments: {
              wire: [{ group: 'fg-cable01', rate: 300 }],
              computer: [{ group: 'fg-plates1', rate: 10 }],
            },
          },
        },
      });
      setFactoryEditing(true);
      render();
      await nextTick();
    },
    first: '[data-assign-rate="wire"][data-group="fg-cable01"]',
    second: '[data-assign-rate="computer"][data-group="fg-plates1"]',
    commit: '120',
    typed: ['1', '12'],
    stored: () => [groupRate('wire'), groupRate('computer')],
    expected: [120, 12],
    elsewhere: {
      set(reply, value) {
        reply.factoryGroups!.assignments.computer![0]!.rate = Number(value);
      },
      commits: ['120', '150', '180'],
      others: ['15', '20', '25'],
    },
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
      elsewhere: {
        set(reply: ProgressState, value: string) {
          reply.factoryGroups!.links![two!]!.roundTripMin = Number(value);
        },
        commits: ['9', '8', '7'] as [string, string, string],
        others: ['12', '15', '20'] as [string, string, string],
      },
    };
  })(),
};

const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input'));
};

// `stub(held)` makes the edition's saves reply; each save awaits held() first, which holds the
// first save until the returned release() and lets every later one through.
type Stub = (held: () => Promise<void>) => void;
function holdFirst(stub: Stub) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  let first = true;
  stub(() => {
    if (!first) return Promise.resolve();
    first = false;
    return gate;
  });
  return release;
}

// The first save is held until the second field has been typed in.
export async function typedDuringSave(race: Race, stub: Stub) {
  page();
  await race.open();
  const release = holdFirst(stub);
  const one = $<HTMLInputElement>(race.first)!,
    two = $<HTMLInputElement>(race.second)!;
  assert.ok(one && two, 'both fields are drawn');
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

// One field typed in again while its own save is in flight (#664): the delivery counter, which
// stays editable while it saves (the other fields are read-only meanwhile, app/busy.ts). Its save
// changes the saved count, and a draft replaced by every new saved count lost what was typed
// after the commit. It is kept, then saved when committed in turn. `typed` is what is typed
// during the save: another count, or the count saved before (0), which a draft compared with
// the value saved before took for untouched (#678).
export async function typedDuringOwnSave(stub: Stub, typed = '7') {
  page();
  await races['delivery counter']!.open();
  const release = holdFirst(stub);
  const input = $<HTMLInputElement>('#delivery-3-modular-engine')!,
    stored = () => state.deliveries['3-modular-engine'];
  assert.ok(input, 'the counter is drawn');
  type(input, '5');
  input.dispatchEvent(new Event('change'));
  await nextTick();
  type(input, typed);
  release();
  await settle();
  assert.equal(stored(), 5);
  assert.equal(input.value, typed, 'kept after its own save of the count before');
  input.dispatchEvent(new Event('change'));
  await settle();
  assert.equal(stored(), Number(typed), 'the typed count is saved');
  assert.equal(input.value, typed);
}

// A field of a list whose value another tab saves, arriving with the reply to a save of another
// field (#683). Untouched, the field shows it. Typed in and then typed back to the value saved
// before, but not committed, it keeps what is typed: a draft compared with the value saved
// before took it for untouched. Committed, it saves that, and is untouched again. `answer`
// makes the edition's saves reply with what answer(update) returns.
export async function typedBackWhileAnotherTabSaves(
  race: Race,
  answer: (reply: (update: UpdateOp) => ProgressState) => void,
) {
  const elsewhere = race.elsewhere!;
  page();
  await race.open();
  let other: string | null = null;
  answer(update => {
    const reply = applyUpdate(update);
    if (other !== null) elsewhere.set(reply, other);
    return reply;
  });
  const one = $<HTMLInputElement>(race.first)!,
    two = () => $<HTMLInputElement>(race.second)!;
  assert.ok(one && two(), 'both fields are drawn');
  const commitFirst = async (value: string, saved: string | null) => {
    other = saved;
    type(one, value);
    one.dispatchEvent(new Event('change'));
    await settle();
    assert.equal(String(race.stored()[0]), value);
  };
  await commitFirst(elsewhere.commits[0], elsewhere.others[0]);
  assert.equal(two().value, elsewhere.others[0], 'untouched: another tab’s value is shown');
  type(two(), race.typed[1]);
  type(two(), elsewhere.others[0]);
  await commitFirst(elsewhere.commits[1], elsewhere.others[1]);
  assert.equal(two().value, elsewhere.others[0], 'typed back to the value saved before: kept');
  other = null;
  two().dispatchEvent(new Event('change'));
  await settle();
  assert.equal(String(race.stored()[1]), elsewhere.others[0], 'the typed value is saved');
  assert.equal(two().value, elsewhere.others[0]);
  await commitFirst(elsewhere.commits[2], elsewhere.others[2]);
  assert.equal(two().value, elsewhere.others[2], 'untouched after its commit: follows again');
}
