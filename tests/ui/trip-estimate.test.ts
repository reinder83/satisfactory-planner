// The round trip estimated from the map (LOG-2, #1347). Factories and stations have places on the
// world map, so a train link or line with no round trip of its own shows the map's estimate
// (the figure of "Create stations from train links", routeEstimate in app/train-proposal.ts),
// labelled "estimate":
// - Between factories: a train link still on the default 5 minutes, both factories placed, shows
//   the estimate in the Round trip box and in "≈ 2.8 min estimate" beside it; with an end not
//   placed the box says 5 and nothing is labelled; a figure saved on the link, or typed, wins;
// - the estimate is display only: changing the link's fuel or By saves the 5 minutes it had;
// - the line editor prefills the box with the estimate while no round trip is saved and every
//   stop has a place (its station's, else its factory's); typing, even clearing the box, ends it,
//   and a line with a saved round trip shows that one.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test } from 'vitest';
import { groupLinks } from '../../public/app/group-links.ts';
import { calcStage, calculated, setLogisticsTab } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { factoryGroupsState } from '../../public/app/views/factories.ts';
import { $, applyUpdate, generated, go, open, page, stubFetch } from './setup.ts';
import type { TrainLine, TrainStation, UpdateOp } from '../../public/types/index.ts';

const plan = generated();
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();
const click = async (selector: string) => {
  $<HTMLElement>(selector)!.click();
  await settle();
};
const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input'));
};

const GROUPS = [
  { id: 'fg-smelt1', name: 'Iron & steel works' },
  { id: 'fg-parts1', name: 'Parts' },
];
let sent: UpdateOp[] = [];
const stub = () => {
  sent = [];
  stubFetch<UpdateOp>({
    '/api/update': (update: UpdateOp) => {
      sent.push(update);
      return applyUpdate(update);
    },
  });
};

// A link between the two factories, on a train with `roundTripMin`, the factories 1 km apart on
// the map unless `places` says otherwise.
async function showLink(
  roundTripMin: number,
  places: Record<string, { x: number; y: number }> | null = {
    'fg-smelt1': { x: 0, y: 0 },
    'fg-parts1': { x: 100_000, y: 0 },
  },
) {
  const rows = plan.stages['3'].rows!;
  const groups = {
    groups: GROUPS,
    assignments: Object.fromEntries(
      rows.map((r, i) => [r.id, [{ group: i % 2 ? 'fg-parts1' : 'fg-smelt1', rate: null }]]),
    ),
  };
  open({ calculated: structuredClone(plan), phase: '3', state: { factoryGroups: groups } });
  const link = groupLinks(calcStage()!, factoryGroupsState(), calculated!.settings.onSite).find(
    entry => GROUPS.some(g => g.id === entry.from) && GROUPS.some(g => g.id === entry.to),
  )!;
  assert.ok(link, 'the plan has a link between the factories');
  const key = `${link.from}:${link.to}`;
  open({
    calculated: structuredClone(plan),
    phase: '3',
    state: {
      factoryGroups: { ...groups, links: { [key]: { mode: 'train', roundTripMin } } },
      ...(places
        ? { factoryPlaces: { [link.from]: places['fg-smelt1']!, [link.to]: places['fg-parts1']! } }
        : {}),
    },
  });
  stub();
  go('logistics');
  render();
  await nextTick();
  return key;
}
const tripBox = (key: string) => $<HTMLInputElement>(`[data-link-trip="${key}"]`)!;
const estimateNote = (key: string) =>
  tripBox(key).closest('label')!.querySelector<HTMLElement>('[data-link-trip-estimate]');

beforeEach(() => page());
afterEach(() => $<HTMLDialogElement>('#detail')?.close());

test('a train link on the default round trip shows the map estimate, labelled', async () => {
  const key = await showLink(5);
  assert.equal(tripBox(key).value, '2.8');
  assert.equal(text(estimateNote(key)!), '≈ 2.8 min estimate');
  assert.equal(tripBox(key).getAttribute('aria-describedby'), estimateNote(key)!.id);
});

test('with an end not on the map the round trip stays 5 minutes and nothing is labelled', async () => {
  const key = await showLink(5, null);
  assert.equal(tripBox(key).value, '5');
  assert.equal(estimateNote(key), null);
});

test('a round trip saved on the link wins over the estimate', async () => {
  const key = await showLink(7);
  assert.equal(tripBox(key).value, '7');
  assert.equal(estimateNote(key), null);
});

test('a typed round trip replaces the estimate and is what is saved; the estimate alone saves nothing', async () => {
  const key = await showLink(5);
  // Changing something else saves the 5 minutes the link had, not the estimate.
  const fuelled = $<HTMLSelectElement>(`[data-link-mode="${key}"]`)!;
  fuelled.value = 'truck';
  fuelled.dispatchEvent(new Event('change'));
  await settle();
  const changed = sent.filter(update => update.type === 'factoryLinkTransport');
  assert.equal(changed.length, 1);
  assert.ok(changed[0]!.type === 'factoryLinkTransport' && 'roundTripMin' in changed[0]!);
  assert.equal(changed[0]!.roundTripMin, 5, 'the estimate is never saved on its own');
  const box = tripBox(key);
  type(box, '6.5');
  box.dispatchEvent(new Event('change'));
  await settle();
  const saved = sent.filter(update => update.type === 'factoryLinkTransport').at(-1)!;
  assert.ok(saved.type === 'factoryLinkTransport' && 'roundTripMin' in saved);
  assert.equal(saved.roundTripMin, 6.5);
  assert.equal(tripBox(key).value, '6.5');
  assert.equal(estimateNote(key), null);
});

// The line editor.
const MINE: TrainStation = {
  id: 'ts-mine01',
  name: 'Iron mine',
  owner: { kind: 'outpost', resource: 'Iron Ore', nodes: { pure: 2 } },
  platforms: [{ kind: 'load', cargo: ['Iron Ore'], belt: 5 }],
  place: { x: 0, y: 0 },
};
const WORKS: TrainStation = {
  id: 'ts-works2',
  name: 'Works',
  owner: { kind: 'factory', id: 'fg-smelt1' },
  platforms: [{ kind: 'unload', belt: 5 }],
};
async function showLines(
  stations: TrainStation[],
  lines: TrainLine[] = [],
  places: Record<string, { x: number; y: number }> = { 'fg-smelt1': { x: 100_000, y: 0 } },
) {
  open({
    state: {
      version: 30,
      factoryGroups: { groups: GROUPS, assignments: {} },
      factoryPlaces: places,
      trainStations: stations,
      trainLines: lines,
    },
  });
  stub();
  setLogisticsTab('trains');
  go('logistics');
  render();
  await settle();
}
const lineTrip = () => $<HTMLInputElement>('[data-line-trip]')!;
const addStops = async (...ids: string[]) => {
  const select = $<HTMLSelectElement>('[data-stop-select]')!;
  for (const id of ids) {
    select.value = id;
    select.dispatchEvent(new Event('change'));
    await click('[data-stop-add]');
  }
};

test('the line editor prefills the round trip from the stops’ places, labelled; typing ends it', async () => {
  // The mine is placed itself, the works through its factory: 1 km apart.
  await showLines([MINE, WORKS]);
  await click('[data-line-add]');
  assert.equal(lineTrip().value, '', 'no stops, no estimate');
  assert.equal($('[data-line-trip-estimate]'), null);
  await addStops('ts-mine01', 'ts-works2');
  assert.equal(lineTrip().value, '2.8');
  assert.equal(lineTrip().dataset.tripSource, 'map');
  assert.match(
    text($('[data-line-trip-estimate]')!),
    /^≈ 2\.8 min estimate from the stops’ places/,
  );
  // Typing replaces it, and clearing the box leaves it empty rather than bringing it back.
  type(lineTrip(), '3');
  await settle();
  assert.equal(lineTrip().value, '3');
  assert.equal($('[data-line-trip-estimate]'), null);
  type(lineTrip(), '');
  await settle();
  assert.equal(lineTrip().value, '');
  assert.equal($('[data-line-trip-estimate]'), null);
  // A typed figure is what Add line saves.
  type(lineTrip(), '4.5');
  await click('[data-line-save]');
  const update = sent.find(entry => entry.type === 'trainLine')!;
  assert.ok(update.type === 'trainLine');
  assert.equal(update.value!.roundTrip, 4.5);
});

test('the estimate is saved with the line only when the player leaves it in the box', async () => {
  await showLines([MINE, WORKS]);
  await click('[data-line-add]');
  await addStops('ts-mine01', 'ts-works2');
  await click('[data-line-save]');
  const update = sent.find(entry => entry.type === 'trainLine')!;
  assert.ok(update.type === 'trainLine');
  assert.equal(update.value!.roundTrip, 2.8);
});

test('a stop with no place on the map leaves the round trip empty, and a saved one wins', async () => {
  const bare: TrainStation = { ...WORKS, owner: undefined };
  await showLines([MINE, bare]);
  await click('[data-line-add]');
  await addStops('ts-mine01', 'ts-works2');
  assert.equal(lineTrip().value, '');
  assert.equal($('[data-line-trip-estimate]'), null);
  $<HTMLDialogElement>('#detail')!.close();
  await showLines(
    [MINE, WORKS],
    [
      {
        id: 'tl-ore0001',
        name: 'Ore run',
        cars: ['loco', 'wagon'],
        stops: ['ts-mine01', 'ts-works2'],
        direction: 'oneWay',
        roundTrip: 9,
      },
    ],
  );
  await click('[data-line-edit="tl-ore0001"]');
  assert.equal(lineTrip().value, '9');
  assert.equal($('[data-line-trip-estimate]'), null);
});
