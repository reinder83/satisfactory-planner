// Create stations from train links on the Logistics page's Trains tab (#1301:
// ui/factories/TrainsFromLinks.vue and ui/detail/TrainProposalDialog.vue), on the planner's own
// plan with the default factories and three links set to go by train (one from a mining source,
// two between factories, one pair of them placed on the world map):
// - the panel counts the links and opens the preview, which lists each link with its stations,
//   train and round trip (the map's estimate where both ends are placed), all ticked;
// - an unticked link is left out, and Create saves the rest as one trainAdd update, closes the
//   preview, puts focus back on the button and says so in a toast with Undo;
// - a second run proposes only the link left out, a third has nothing to add;
// - a round trip typed in the preview is the line's, and one that is none is refused under it;
// - Undo takes out what Create added, in one trainRemove update. Names are text, never markup.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { groupLinks, isSource, sourceItem } from '../../public/app/group-links.ts';
import { calcStage, setLogisticsTab, state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { factoryGroupsState } from '../../public/app/views/factories.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { $, $$, applyUpdate, evil, generated, go, open, page, stubFetch } from './setup.ts';
import type {
  CurrentCalculatedPlan,
  FactoryGroups,
  Phase,
  ProgressState,
  UpdateOp,
} from '../../public/types/index.ts';

const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const dialog = () => $<HTMLDialogElement>('#detail')!;
const click = async (selector: string, root: ParentNode = document) => {
  root.querySelector<HTMLButtonElement>(selector)!.click();
  await settle();
};
const PHASE: Phase = '3';

// The plan, its default factories (one renamed to a hostile name) and three of its links on a
// train: the largest from a mined resource, and the two largest between factories.
let plan: CurrentCalculatedPlan;
let groups: FactoryGroups;
let keys: { ore: string; first: string; second: string };
function setUp() {
  plan ??= generated();
  const defaults = defaultFactoryGroups(plan);
  defaults.groups[0] = { ...defaults.groups[0]!, name: evil };
  open({ calculated: structuredClone(plan), phase: PHASE, state: { factoryGroups: defaults } });
  const links = groupLinks(calcStage()!, factoryGroupsState(), plan.settings.onSite);
  const isGroup = (id: string) => defaults.groups.some(group => group.id === id);
  const ore = links.find(link => isSource(link.from) && sourceItem(link.from) !== 'Water');
  const between = links.filter(link => isGroup(link.from) && isGroup(link.to));
  assert.ok(ore && between.length >= 2, 'the plan has links to put on trains');
  keys = {
    ore: `${ore.from}:${ore.to}`,
    first: `${between[0]!.from}:${between[0]!.to}`,
    second: `${between[1]!.from}:${between[1]!.to}`,
  };
  groups = {
    ...defaults,
    links: {
      [keys.ore]: { mode: 'train', roundTripMin: 5 },
      [keys.first]: { mode: 'train', roundTripMin: 5 },
      [keys.second]: { mode: 'train', roundTripMin: 7 },
    },
  };
  return between[0]!;
}

let sent: UpdateOp[] = [];
async function showTrains(progress: Partial<ProgressState> = {}) {
  const placed = setUp();
  open({
    calculated: structuredClone(plan),
    phase: PHASE,
    state: {
      factoryGroups: groups,
      // The first link's two factories are 1 km apart on the map.
      factoryPlaces: { [placed.from]: { x: 0, y: 0 }, [placed.to]: { x: 100_000, y: 0 } },
      ...progress,
    },
  });
  sent = [];
  stubFetch<UpdateOp>({
    '/api/update': (update: UpdateOp) => {
      sent.push(update);
      return applyUpdate(update);
    },
  });
  setLogisticsTab('trains');
  go('logistics');
  render();
  await settle();
}
const card = (key: string) => dialog().querySelector<HTMLElement>(`[data-proposal="${key}"]`)!;
const statuses = () =>
  Object.fromEntries(
    [...dialog().querySelectorAll<HTMLElement>('[data-proposal]')].map(item => [
      item.dataset.proposal,
      item.dataset.proposalStatus,
    ]),
  );

beforeEach(() => page());
afterEach(() => dialog()?.close());

test('the preview lists each train link with its stations, train and round trip', async () => {
  await showTrains();
  const panel = $('[data-trains-from-links]')!;
  assert.match(
    panel.querySelector('[data-trains-from-links-text]')!.textContent!,
    /^3 links go by train in Phase 3; none has a train line yet\./,
  );
  await click('[data-trains-from-links-open]');
  assert.equal(dialog().open, true);
  assert.equal($('#detail-title')!.textContent, 'Create stations from train links');
  assert.deepEqual(statuses(), {
    [keys.ore]: 'propose',
    [keys.first]: 'propose',
    [keys.second]: 'propose',
  });
  // Every link starts ticked, named by its ends, its parts describing the checkbox.
  for (const key of Object.values(keys)) {
    const box = card(key).querySelector<HTMLInputElement>('[data-proposal-pick]')!;
    assert.equal(box.checked, true);
    const parts = document.getElementById(box.getAttribute('aria-describedby')!)!;
    assert.ok(parts.querySelector('[data-proposal-pickup]'));
  }
  // The mined resource: a new mining outpost at the pick-up end.
  const ore = card(keys.ore);
  assert.match(
    ore.querySelector('[data-proposal-pickup]')!.textContent!,
    /^Pick-up: new station “.+ outpost pick-up for .+” \(Mining outpost: .+\), \d+ platforms?: \d+ load\.$/,
  );
  assert.match(
    ore.querySelector('[data-proposal-line]')!.textContent!,
    /one-way loop, 1 locomotive and \d+ wagons?: \d+ freight wagons? for /,
  );
  assert.equal(ore.querySelector<HTMLInputElement>('[data-proposal-trip]')!.value, '5');
  assert.equal(ore.querySelector<HTMLElement>('[data-proposal-trip]')!.dataset.tripSource, 'link');
  // Both ends on the map, the default round trip on the link: the estimate, marked as one.
  const first = card(keys.first);
  const trip = first.querySelector<HTMLInputElement>('[data-proposal-trip]')!;
  assert.equal(trip.value, '2.8');
  assert.equal(trip.dataset.tripSource, 'map');
  assert.match(
    first.querySelector('[data-proposal-trip-note]')!.textContent!.replace(/\s+/g, ' ').trim(),
    /^Estimate\. The stations are 1 km apart on the map; this assumes about 90 km\/h on track 1\.3 times the straight line and 30 seconds at each stop\. Edit it/,
  );
  // The link's own round trip (not the default) is kept.
  assert.equal(
    card(keys.second).querySelector<HTMLInputElement>('[data-proposal-trip]')!.value,
    '7',
  );
  // The hostile factory name is text.
  assert.equal(dialog().querySelector('x-evil'), null);
  assert.ok(dialog().textContent!.includes(evil));
  // Cancel saves nothing.
  await click('[data-proposal-cancel]');
  assert.equal(dialog().open, false);
  assert.deepEqual(sent, []);
});

test('untick, Create, then a second and third run add only what is missing; Undo takes it out', async () => {
  await showTrains();
  await click('[data-trains-from-links-open]');
  const create = () => dialog().querySelector<HTMLButtonElement>('[data-proposal-create]')!;
  assert.equal(create().textContent!.trim(), 'Create 6 stations and 3 lines');
  const box = card(keys.second).querySelector<HTMLInputElement>('[data-proposal-pick]')!;
  box.checked = false;
  box.dispatchEvent(new Event('change'));
  await settle();
  assert.equal(create().textContent!.trim(), 'Create 4 stations and 2 lines');
  const opener = $<HTMLButtonElement>('[data-trains-from-links-open]')!;
  await click('[data-proposal-create]', dialog());
  assert.equal(sent.length, 1);
  const added = sent[0]! as Extract<UpdateOp, { type: 'trainAdd' }>;
  assert.equal(added.type, 'trainAdd');
  assert.equal(added.stations.length, 4);
  assert.equal(added.lines.length, 2);
  assert.equal(dialog().open, false);
  assert.equal(document.activeElement, opener, 'focus goes back to the button');
  assert.match($('#toast')!.textContent!, /^Created 4 train stations and 2 train lines\. Undo/);
  // The page shows them, the line on the map's estimate, and its checks are clear.
  assert.equal($$('[data-station-card]').length, 4);
  assert.equal($$('[data-line-card]').length, 2);
  const estimated = state.trainLines!.find(line => line.roundTrip === 2.8)!;
  assert.ok(estimated, 'the estimated round trip is the line’s');
  assert.equal($(`[data-line="${estimated.id}"] [data-line-check]`), null);
  assert.match(
    $('[data-trains-from-links-text]')!.textContent!,
    /^3 links go by train in Phase 3; 1 of them has no train line yet\./,
  );
  // The second run: the two created are served, only the one left out is proposed.
  await click('[data-trains-from-links-open]');
  assert.deepEqual(statuses(), {
    [keys.ore]: 'served',
    [keys.first]: 'served',
    [keys.second]: 'propose',
  });
  assert.match(
    card(keys.ore).querySelector('[data-proposal-served]')!.textContent!.trim(),
    /^Already goes by “Iron Ore outpost to .+”: nothing to add\.$/,
  );
  assert.equal(create().textContent!.trim(), 'Create 2 stations and 1 line');
  await click('[data-proposal-create]', dialog());
  assert.equal(state.trainStations!.length, 6);
  assert.equal(state.trainLines!.length, 3);
  // The third run: nothing to add.
  await click('[data-trains-from-links-open]');
  assert.deepEqual(new Set(Object.values(statuses())), new Set(['served']));
  assert.ok(dialog().querySelector('[data-proposal-nothing]'));
  assert.equal(create().disabled, true);
  await click('[data-proposal-cancel]');
  // Undo of the last Create: its line and stations go, in one write.
  sent = [];
  $('#toast')!.querySelector<HTMLButtonElement>('button')!.click();
  await settle();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.type, 'trainRemove');
  assert.equal(state.trainStations!.length, 4);
  assert.equal(state.trainLines!.length, 2);
  assert.match(
    $('#toast')!.textContent!,
    /^Removed the 2 train stations and 1 train line that Create added\./,
  );
});

test('a typed round trip is the line’s; one that is no round trip is refused under its box', async () => {
  await showTrains();
  await click('[data-trains-from-links-open]');
  const trip = card(keys.ore).querySelector<HTMLInputElement>('[data-proposal-trip]')!;
  trip.value = '0';
  trip.dispatchEvent(new Event('input'));
  await settle();
  await click('[data-proposal-create]', dialog());
  assert.deepEqual(sent, [], 'nothing saved');
  assert.equal(trip.getAttribute('aria-invalid'), 'true');
  assert.equal(document.activeElement, trip);
  assert.match(
    card(keys.ore).querySelector('.form-error')!.textContent!,
    /^Give the round trip in minutes/,
  );
  trip.value = '12.5';
  trip.dispatchEvent(new Event('input'));
  await settle();
  assert.equal(trip.dataset.tripSource, 'edited');
  await click('[data-proposal-create]', dialog());
  const added = sent[0]! as Extract<UpdateOp, { type: 'trainAdd' }>;
  assert.deepEqual(
    added.lines.map(line => line.roundTrip ?? 0).sort((x, y) => x - y),
    [2.8, 7, 12.5],
  );
});

test('with no link on a train the button has nothing to do', async () => {
  setUp();
  open({
    calculated: structuredClone(plan),
    phase: PHASE,
    state: { factoryGroups: { ...groups, links: {} } },
  });
  setLogisticsTab('trains');
  go('logistics');
  render();
  await settle();
  assert.match(
    $('[data-trains-from-links-text]')!.textContent!,
    /^No link goes by train in Phase 3\./,
  );
  assert.equal($<HTMLButtonElement>('[data-trains-from-links-open]')!.disabled, true);
});
