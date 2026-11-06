// Create stations from train links (#1301): the proposal (app/train-proposal.ts) and the trainAdd
// and trainRemove updates that save it and its Undo.
// - The proposal: a pick-up station at the supplying factory or a mining outpost for a
//   `supply/<resource>` link, a drop-off station at the receiving factory, their platforms with the
//   cargo, and a one-way line between them whose train passes its own checks (lineChecks).
// - The wagon suggestion: the wagons the Between-factories card's linkLoad counts (#1305: the round
//   trip's load, and the rate through a platform's two ports), each on a belt (or pipe) whose full
//   rate over a round trip fits 32 stacks (or 1,600 m³).
// - The matching: a link a line already carries is served and proposes nothing; a station is
//   reused only when it is a stop of no line, has the end's owner and loads exactly the cargo (a
//   drop-off: unloads and loads nothing); ends that cannot own a station are skipped; a re-run
//   after Create adds nothing, and edits since never bring duplicates.
// - The round trip: the map's estimate from the two ends' places (station, else factory) instead
//   of the default; the link's own figure or a typed one wins.
// - The updates: trainAdd adds stations and lines in one write and refuses an id that exists, so it
//   never overwrites; trainRemove removes by id; the state stays version 30.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBase, mutate, validateState, TRAIN_STATION_MAX } from '../public/state.ts';
import { lineChecks, type ItemFacts } from '../public/app/train-lines.ts';
import { linkLoad } from '../public/app/logistics.ts';
import { BELT_MARKS, PIPE_MARKS } from '../public/preferences.ts';
import {
  createdEntries,
  freshName,
  linkEnd,
  maxWagons,
  proposeTrains,
  roundTripEstimate,
  ownerMatches,
  suggestWagons,
  wagonText,
  type LinkProposal,
  type ProposalIds,
  type ProposalWorld,
  type TrainLinkInput,
} from '../public/app/train-proposal.ts';
import './helpers/en-us-numbers.ts';
import { version1 } from './types/fixtures.ts';
import type { ProgressState, TrainLine, TrainStation, UpdateOp } from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const FACTS: ItemFacts = {
  stack: item => ({ 'Iron Ore': 100, 'Iron Plate': 200, Screws: 500, Coal: 100 })[item] ?? 100,
  fluid: item => ['Crude Oil', 'Water', 'Nitrogen Gas'].includes(item),
};
const GROUPS = [
  { id: 'fg-smelt01', name: 'Smelting' },
  { id: 'fg-parts01', name: 'Parts' },
  { id: 'fg-steel01', name: 'Steel' },
];
// Fixed ids, one per link and role in a run, numbered over all runs: ts-pick1, ts-drop2, tl-line3.
let made = 0;
const idsFor = (): ProposalIds => {
  const ids = new Map<string, string>();
  return (kind, key, role) => {
    const at = `${kind}|${key}|${role}`;
    if (!ids.has(at)) ids.set(at, `${kind}-${role.slice(0, 4)}${++made}`);
    return ids.get(at)!;
  };
};
const ORE: TrainLinkInput = {
  from: 'supply/Iron Ore',
  to: 'fg-smelt01',
  items: [{ item: 'Iron Ore', rate: 780 }],
  roundTripMin: 5,
};
const PLATES: TrainLinkInput = {
  from: 'fg-smelt01',
  to: 'fg-parts01',
  items: [
    { item: 'Iron Plate', rate: 120 },
    { item: 'Screws', rate: 400 },
  ],
  roundTripMin: 8,
};
const OIL: TrainLinkInput = {
  from: 'supply/Crude Oil',
  to: 'fg-parts01',
  items: [{ item: 'Crude Oil', rate: 500 }],
  roundTripMin: 5,
};
const world = (over: Partial<ProposalWorld> = {}): ProposalWorld => ({
  groups: GROUPS,
  stations: [],
  lines: [],
  facts: FACTS,
  belt: 5,
  pipe: 2,
  name: id => id,
  ...over,
});
const propose = (links: TrainLinkInput[], over: Partial<ProposalWorld> = {}, trips = {}) =>
  proposeTrains(links, world(over), { ids: idsFor(), trips });
const byKey = (proposals: LinkProposal[], link: TrainLinkInput) =>
  proposals.find(proposal => proposal.key === `${link.from}:${link.to}`)!;
const all = (proposals: LinkProposal[]) => new Set(proposals.map(proposal => proposal.key));

// A profile with the three factories, in the shape the tests apply updates to.
const base = (): ProgressState =>
  validateState(
    json({ ...version1, factoryGroups: { groups: GROUPS, assignments: {} } }),
  ) as ProgressState;
const addOp = (entries: { stations: TrainStation[]; lines: TrainLine[] }): UpdateOp => ({
  type: 'trainAdd',
  ...entries,
});
// Runs the proposal on `state` and creates every proposed link, as Create does.
const createAll = (state: ProgressState, links: TrainLinkInput[]) => {
  const proposals = proposeTrains(
    links,
    world({ stations: state.trainStations ?? [], lines: state.trainLines ?? [] }),
    { ids: idsFor() },
  );
  const entries = createdEntries(proposals, all(proposals));
  return {
    proposals,
    entries,
    state: entries.lines.length ? mutate(json(state), addOp(entries)) : state,
  };
};

test('a supply link gets an outpost pick-up, a factory drop-off and a line that passes its checks', () => {
  const [ore] = propose([ORE]);
  assert.equal(ore!.status, 'propose');
  assert.equal(ore!.fromName, 'Iron Ore outpost');
  assert.equal(ore!.toName, 'Smelting');
  const pickup = ore!.pickup!.station,
    dropoff = ore!.dropoff!.station;
  assert.deepEqual(pickup.owner, { kind: 'outpost', resource: 'Iron Ore', nodes: {} });
  assert.deepEqual(dropoff.owner, { kind: 'factory', id: 'fg-smelt01' });
  assert.equal(pickup.name, 'Iron Ore outpost pick-up for Smelting');
  assert.equal(dropoff.name, 'Smelting drop-off from Iron Ore outpost');
  // 780/min over 5 minutes is 3,900 ore: two wagons of 3,200, each on a Mk.4 belt (480/min, which
  // brings 2,400 a trip; a Mk.5 would bring 3,900 and overfill it).
  assert.deepEqual(pickup.platforms, [
    { kind: 'load', cargo: ['Iron Ore'], belt: 4 },
    { kind: 'load', cargo: ['Iron Ore'], belt: 4 },
  ]);
  assert.deepEqual(dropoff.platforms, [
    { kind: 'unload', belt: 4 },
    { kind: 'unload', belt: 4 },
  ]);
  assert.deepEqual(ore!.line, {
    id: ore!.line!.id,
    name: 'Iron Ore outpost to Smelting',
    cars: ['loco', 'wagon', 'wagon'],
    stops: [pickup.id, dropoff.id],
    direction: 'oneWay',
    roundTrip: 5,
  });
  assert.deepEqual(lineChecks(ore!.line!, [pickup, dropoff], FACTS), []);
  assert.equal(wagonText(ore!.wagons[0]!), '2 freight wagons for Iron Ore on Mk.4 belts');
  // Water and Nitrogen Gas come from wells only; Crude Oil from oil nodes unless said otherwise.
  assert.deepEqual(linkEnd('supply/Nitrogen Gas', world()), {
    owner: { kind: 'outpost', resource: 'Nitrogen Gas', nodes: {}, wells: true },
    name: 'Nitrogen Gas outpost',
  });
  assert.deepEqual((linkEnd('supply/Crude Oil', world()) as { owner: object }).owner, {
    kind: 'outpost',
    resource: 'Crude Oil',
    nodes: {},
  });
});

test('several items and fluids: a wagon kind and platform per item, locomotives per four wagons', () => {
  const [plates, oil] = propose([PLATES, OIL]);
  // Plates: 120/min × 8 = 960 of 6,400 (stack 200): 1 wagon on a Mk.2 belt (120 × 8 = 960).
  // Screws: 400 × 8 = 3,200 of 16,000: 1 wagon on a Mk.4 belt (480 × 8 = 3,840).
  assert.deepEqual(
    plates!.wagons.map(wagon => [wagon.item, wagon.wagons, wagon.lane]),
    [
      ['Iron Plate', 1, 'Mk.2 belt'],
      ['Screws', 1, 'Mk.4 belt'],
    ],
  );
  assert.deepEqual(plates!.pickup!.station.platforms, [
    { kind: 'load', cargo: ['Iron Plate'], belt: 2 },
    { kind: 'load', cargo: ['Screws'], belt: 4 },
  ]);
  // Crude Oil: 500 m³/min × 5 = 2,500 m³: two fluid wagons of 1,600 on a Mk.1 pipe each (300 ×
  // 5 = 1,500).
  assert.deepEqual(oil!.wagons, [
    { item: 'Crude Oil', rate: 500, fluid: true, wagons: 2, mark: 1, lane: 'Mk.1 pipe', ports: 1 },
  ]);
  assert.deepEqual(oil!.pickup!.station.platforms[0], {
    kind: 'load',
    cargo: ['Crude Oil'],
    pipe: 1,
  });
  assert.equal(wagonText(oil!.wagons[0]!), '2 fluid freight wagons for Crude Oil on Mk.1 pipes');
  for (const proposal of [plates!, oil!])
    assert.deepEqual(
      lineChecks(proposal.line!, [proposal.pickup!.station, proposal.dropoff!.station], FACTS),
      [],
      proposal.key,
    );
  // Nine wagons take three locomotives in front, with an empty platform for each one behind the
  // first (5,700/min over 5 minutes is 28,500 ore, 8.9 wagons).
  const [big] = propose([{ ...ORE, items: [{ item: 'Iron Ore', rate: 5700 }] }]);
  assert.equal(big!.locomotives, 3);
  assert.deepEqual(big!.line!.cars.slice(0, 4), ['loco', 'loco', 'loco', 'wagon']);
  assert.deepEqual(
    big!.pickup!.station.platforms.slice(0, 3).map(platform => platform.kind),
    ['empty', 'empty', 'load'],
  );
  const stations = [big!.pickup!.station, big!.dropoff!.station];
  assert.deepEqual(lineChecks(big!.line!, stations, FACTS), []);
  assert.equal(wagonText(big!.wagons[0]!), '9 freight wagons for Iron Ore on 2 × Mk.4 belts each');
  // More than one train pulls: the line keeps 32 wagons and says how many the rate needs.
  assert.equal(maxWagons(), 32);
  const [huge] = propose([{ ...ORE, items: [{ item: 'Iron Ore', rate: 40 * 640 }] }]);
  assert.equal(huge!.wanted, 40);
  assert.equal(huge!.line!.cars.length, 40);
  assert.equal(huge!.line!.cars.filter(car => car === 'wagon').length, 32);
});

test('the wagon suggestion: the card’s wagons, each on a belt that fits a round trip', () => {
  const best = { belt: 6, pipe: 2 };
  const pick = (item: string, rate: number, trip: number, lanes = best) => {
    const wagon = suggestWagons(item, rate, trip, FACTS, lanes);
    return [wagon.wagons, wagon.lane];
  };
  assert.deepEqual(pick('Iron Ore', 60, 5), [1, 'Mk.1 belt']);
  assert.deepEqual(pick('Iron Ore', 480, 5), [1, 'Mk.4 belt']);
  // 640/min fills one wagon per trip (3,200), and a wagon loads through two ports (#1305), as the
  // card counts: one wagon. The belt that carries all 640 (Mk.5) brings 3,900 a trip and overfills
  // it, so the platform records the fastest belt that fits (Mk.4, 2,400 a trip), the second port
  // taking the rest.
  assert.deepEqual(pick('Iron Ore', 640, 5), [1, 'Mk.4 belt']);
  assert.equal(suggestWagons('Iron Ore', 640, 5, FACTS, best).ports, 2);
  assert.equal(suggestWagons('Iron Ore', 480, 5, FACTS, best).ports, 1);
  // Only Mk.3 belts in the phase: 640/min needs two wagons, as the card says (2 × 270 each).
  assert.deepEqual(pick('Iron Ore', 640, 5, { belt: 3, pipe: 1 }), [2, 'Mk.3 belt']);
  // A bigger stack fits more: Screws (500 a stack) at 1,200/min, 10 minutes: 12,000 of 16,000.
  assert.deepEqual(pick('Screws', 1200, 10), [1, 'Mk.6 belt']);
  assert.deepEqual(pick('Water', 300, 5), [1, 'Mk.1 pipe']);
  assert.deepEqual(pick('Water', 600, 5), [2, 'Mk.1 pipe']);
  // A trip so long that even a Mk.1 belt overfills a wagon: the wagons the rate needs (3,600 of
  // 3,200 a wagon) on the slowest belt; the line's checks then say how far it backs up.
  assert.deepEqual(pick('Iron Ore', 60, 60), [2, 'Mk.1 belt']);
});

// The suggestion is the card's (#1305): for one item, the freight cars (or fluid cars) linkLoad counts
// for the same link, over rates, round trips and the belts the phase has, so the preview and the
// Between-factories card never show different counts. The created line still passes its checks.
test('the wagon suggestion agrees with the Between-factories card', () => {
  const catalog = { stacks: { 'Iron Ore': 100 }, packaged: {}, vehicleFuels: [] };
  const fluids = new Set(['Water']);
  for (const [belt, pipe] of [
    [3, 1],
    [6, 2],
  ] as const)
    for (const trip of [0.5, 1, 2, 5, 10, 20, 40])
      for (const rate of [30, 60, 100, 250, 480, 640, 780, 1200, 2000, 3000, 6000, 12000]) {
        for (const item of ['Iron Ore', 'Water']) {
          const wagon = suggestWagons(item, rate, trip, FACTS, { belt, pipe });
          const card = linkLoad(
            [{ item, rate }],
            { mode: 'train', roundTripMin: trip },
            catalog,
            fluids,
            { belt: BELT_MARKS[belt - 1]!.cap, pipe: PIPE_MARKS[pipe - 1]!.cap },
          );
          const label = `${item} ${rate}/min, ${trip} min, Mk.${belt} belts`;
          assert.equal(wagon.wagons, card.freightCars + card.fluidCars, label);
        }
      }
});

test('the round trip: the map estimate replaces the default; the link’s own or a typed one wins', () => {
  // 1 km apart: 2 × 1,000 m × 1.3 at 25 m/s is 104 s, plus half a minute at each stop: 2.73 min,
  // rounded up to 2.8.
  assert.deepEqual(roundTripEstimate({ x: 0, y: 0 }, { x: 100_000, y: 0 }), {
    minutes: 2.8,
    km: 1,
  });
  assert.equal(roundTripEstimate({ x: 0, y: 0 }, { x: 0, y: 0 }).minutes, 1);
  assert.equal(roundTripEstimate({ x: -900_000, y: 0 }, { x: 900_000, y: 900_000 }).minutes, 35.9);
  const places = { 'fg-smelt01': { x: 0, y: 0 }, 'fg-parts01': { x: 300_000, y: 400_000 } };
  // 5 km apart and the default 5 minutes on the link: the estimate.
  const link = { ...PLATES, roundTripMin: 5 };
  const [mapped] = propose([link], { places });
  assert.equal(mapped!.tripSource, 'map');
  assert.deepEqual(mapped!.estimate, { minutes: 9.7, km: 5 });
  assert.equal(mapped!.line!.roundTrip, 9.7);
  // The suggestion follows: Screws at 400/min over 9.7 minutes is 3,880, one wagon of 16,000 on a
  // Mk.4 belt (4,656 a trip).
  assert.deepEqual(
    mapped!.wagons.map(wagon => wagon.wagons),
    [1, 1],
  );
  // A round trip saved on the link (any figure but the default) is kept, with the estimate beside it.
  const [own] = propose([PLATES], { places });
  assert.equal(own!.tripSource, 'link');
  assert.equal(own!.roundTrip, 8);
  assert.equal(own!.estimate?.minutes, 9.7);
  // Typed in the preview: that one, and a typed one that is no round trip is ignored.
  const [typed] = propose([link], { places }, { [`${link.from}:${link.to}`]: 3.25 });
  assert.equal(typed!.tripSource, 'edited');
  assert.equal(typed!.roundTrip, 3.3);
  const [wrong] = propose([link], { places }, { [`${link.from}:${link.to}`]: 0 });
  assert.equal(wrong!.tripSource, 'map');
  // An outpost has no place of its own: no estimate, the link's round trip.
  const [ore] = propose([ORE], { places });
  assert.equal(ore!.estimate, undefined);
  assert.equal(ore!.tripSource, 'link');
  // A reused station's place counts for its end.
  const outpost: TrainStation = {
    id: 'ts-mine01',
    name: 'My mine',
    owner: { kind: 'outpost', resource: 'Iron Ore', nodes: { pure: 2 } },
    platforms: [{ kind: 'load', cargo: ['Iron Ore'], belt: 5 }],
    place: { x: 0, y: 100_000 },
  };
  const [placed] = propose([ORE], { places, stations: [outpost] });
  assert.equal(placed!.pickup!.reused, true);
  assert.deepEqual(placed!.estimate, { minutes: 2.8, km: 1 });
});

test('matching: a link a line carries is served; re-running after Create adds nothing', () => {
  let state = base();
  const first = createAll(state, [ORE, PLATES, OIL]);
  state = first.state;
  assert.equal(state.version, 30);
  assert.equal(state.trainStations!.length, 6);
  assert.equal(state.trainLines!.length, 3);
  // The second run: every link is served by the line Create made, and nothing is created.
  const again = createAll(state, [ORE, PLATES, OIL]);
  assert.deepEqual(
    again.proposals.map(proposal => [proposal.status, proposal.servedBy]),
    [
      ['served', ['Iron Ore outpost to Smelting']],
      ['served', ['Smelting to Parts']],
      ['served', ['Crude Oil outpost to Parts']],
    ],
  );
  assert.deepEqual(again.entries, { stations: [], lines: [] });
  // Edits since keep it served: a renamed line and station, a wagon added, another round trip.
  const line = state.trainLines![0]!;
  const station = state.trainStations![0]!;
  const { id: lineId, ...lineValue } = line;
  const { id: stationId, ...stationValue } = station;
  state = mutate(json(state), {
    type: 'trainLine',
    id: lineId,
    value: { ...lineValue, name: 'Ore run', cars: [...line.cars, 'wagon'], roundTrip: 7 },
  });
  state = mutate(json(state), {
    type: 'trainStation',
    id: stationId,
    value: { ...stationValue, name: 'North mine' },
  });
  const edited = createAll(state, [ORE, PLATES, OIL]);
  assert.deepEqual(
    edited.proposals.map(proposal => proposal.status),
    ['served', 'served', 'served'],
  );
  assert.deepEqual(edited.proposals[0]!.servedBy, ['Ore run']);
  // A line deleted: its stations are no stop of any line, so they are reused, not duplicated.
  state = mutate(json(state), { type: 'trainLine', id: lineId, value: null });
  const rebuilt = createAll(state, [ORE, PLATES, OIL]);
  const ore = byKey(rebuilt.proposals, ORE);
  assert.equal(ore.status, 'propose');
  assert.equal(ore.pickup!.reused, true);
  assert.equal(ore.pickup!.station.name, 'North mine');
  assert.equal(ore.dropoff!.reused, true);
  assert.deepEqual(rebuilt.entries.stations, [], 'no station added');
  assert.equal(rebuilt.entries.lines.length, 1);
  assert.equal(rebuilt.state.trainStations!.length, 6);
  // Reused stations are never changed.
  assert.deepEqual(rebuilt.state.trainStations, state.trainStations);
  assert.deepEqual(rebuilt.state.trainLines!.slice(0, 2), state.trainLines);
});

test('matching: owners, cargo and stops decide which stations are reused', () => {
  // Owners match by factory, by an outpost's resource (whatever its nodes) and storage.
  assert.equal(
    ownerMatches({ kind: 'factory', id: 'fg-a' }, { kind: 'factory', id: 'fg-a' }),
    true,
  );
  assert.equal(
    ownerMatches({ kind: 'factory', id: 'fg-a' }, { kind: 'factory', id: 'fg-b' }),
    false,
  );
  assert.equal(
    ownerMatches(
      { kind: 'outpost', resource: 'Coal', nodes: { pure: 3 } },
      { kind: 'outpost', resource: 'Coal', nodes: {} },
    ),
    true,
  );
  assert.equal(
    ownerMatches(
      { kind: 'outpost', resource: 'Coal', nodes: {} },
      { kind: 'outpost', resource: 'Iron Ore', nodes: {} },
    ),
    false,
  );
  assert.equal(ownerMatches({ kind: 'storage' }, { kind: 'storage' }), true);
  assert.equal(ownerMatches(undefined, { kind: 'storage' }), false);
  const mine = (over: Partial<TrainStation> = {}): TrainStation => ({
    id: 'ts-mine01',
    name: 'My mine',
    owner: { kind: 'outpost', resource: 'Iron Ore', nodes: {} },
    platforms: [{ kind: 'empty' }, { kind: 'load', cargo: ['Iron Ore'], belt: 3 }],
    ...over,
  });
  const works: TrainStation = {
    id: 'ts-works1',
    name: 'My works',
    owner: { kind: 'factory', id: 'fg-smelt01' },
    platforms: [{ kind: 'unload', belt: 3 }],
  };
  // The player's own stations with the right owner and cargo, on no line: used as they are.
  const [reused] = propose([ORE], { stations: [mine(), works] });
  assert.deepEqual(
    [reused!.pickup!.reused, reused!.pickup!.station.id, reused!.dropoff!.station.id],
    [true, 'ts-mine01', 'ts-works1'],
  );
  assert.deepEqual(reused!.line!.stops, ['ts-mine01', 'ts-works1']);
  // The line's checks say what the player's station lacks; nothing changes it.
  assert.ok(
    lineChecks(reused!.line!, [mine(), works], FACTS).some(check =>
      check.key.startsWith('platforms:'),
    ),
  );
  // Not reused: another cargo too, another owner, a stop of a line, a drop-off that loads.
  const other = (station: TrainStation) => propose([ORE], { stations: [station, works] })[0]!;
  const mixed = mine({ platforms: [{ kind: 'load', cargo: ['Iron Ore', 'Coal'] }] });
  assert.equal(other(mixed).pickup!.reused, false);
  const coal = mine({ owner: { kind: 'outpost', resource: 'Coal', nodes: {} } });
  assert.equal(other(coal).pickup!.reused, false);
  const elsewhere: TrainLine = {
    id: 'tl-other1',
    name: 'Other',
    cars: ['loco', 'wagon'],
    stops: ['ts-mine01'],
    direction: 'oneWay',
  };
  const [called] = propose([ORE], { stations: [mine(), works], lines: [elsewhere] });
  assert.equal(called!.pickup!.reused, false, 'a stop of a line is not taken over');
  assert.equal(called!.status, 'propose', 'a line that unloads nowhere serves nothing');
  const loading: TrainStation = { ...works, platforms: [{ kind: 'load', cargo: ['Coal'] }] };
  assert.equal(propose([ORE], { stations: [mine(), loading] })[0]!.dropoff!.reused, false);
  // One station serves one link: the second link into Smelting gets a new drop-off.
  const coalLink = { ...ORE, from: 'supply/Coal', items: [{ item: 'Coal', rate: 120 }] };
  const [first, second] = propose([ORE, coalLink], { stations: [works] });
  assert.equal(first!.dropoff!.reused, true);
  assert.equal(second!.dropoff!.reused, false);
  // The ticked links claim first: unticking the first leaves the station to the second.
  const unticked = proposeTrains([ORE, coalLink], world({ stations: [works] }), {
    ids: idsFor(),
    unticked: new Set([`${ORE.from}:${ORE.to}`]),
  });
  assert.equal(unticked[0]!.dropoff!.reused, false);
  assert.equal(unticked[1]!.dropoff!.reused, true);
  assert.deepEqual(
    createdEntries(unticked, new Set([`${coalLink.from}:${coalLink.to}`])).lines.map(
      line => line.stops,
    ),
    [[unticked[1]!.pickup!.station.id, 'ts-works1']],
  );
});

test('matching: an item already carried is left out; ends without an owner are skipped', () => {
  const plates: TrainStation = {
    id: 'ts-plate01',
    name: 'Plates out',
    owner: { kind: 'factory', id: 'fg-smelt01' },
    platforms: [{ kind: 'load', cargo: ['Iron Plate'], belt: 2 }],
  };
  const parts: TrainStation = {
    id: 'ts-parts01',
    name: 'Parts in',
    owner: { kind: 'factory', id: 'fg-parts01' },
    platforms: [{ kind: 'unload', belt: 2 }],
  };
  const run: TrainLine = {
    id: 'tl-plate01',
    name: 'Plate run',
    cars: ['loco', 'wagon'],
    stops: ['ts-plate01', 'ts-parts01'],
    direction: 'oneWay',
  };
  const [partly] = propose([PLATES], { stations: [plates, parts], lines: [run] });
  assert.equal(partly!.status, 'propose');
  assert.deepEqual(partly!.servedBy, ['Plate run']);
  assert.deepEqual(partly!.missing, [{ item: 'Screws', rate: 400 }]);
  assert.deepEqual(partly!.pickup!.station.platforms, [
    { kind: 'load', cargo: ['Screws'], belt: 4 },
  ]);
  // Unloaded at another factory's station: not this link's line.
  const steel = {
    ...parts,
    id: 'ts-steel01',
    owner: { kind: 'factory' as const, id: 'fg-steel01' },
  };
  const toSteel = { ...run, stops: ['ts-plate01', 'ts-steel01'] };
  assert.deepEqual(
    propose([PLATES], { stations: [plates, steel], lines: [toSteel] })[0]!.servedBy,
    [],
  );
  // Ends that cannot own a station.
  const skipped = propose(
    [
      { ...PLATES, from: 'ungrouped' },
      { ...PLATES, from: 'supply/Iron Plate' },
      { ...PLATES, to: 'sink' },
      { ...PLATES, to: 'storage' },
    ],
    { name: id => ({ sink: 'AWESOME Sink', storage: 'Protected storage' })[id] ?? id },
  );
  assert.deepEqual(
    skipped.map(proposal => [proposal.status, proposal.reason]),
    [
      [
        'skipped',
        'Ungrouped production lines are in no factory, so there is no factory to put a station at.',
      ],
      ['skipped', 'Iron Plate is existing supply, which has no place for a station.'],
      ['skipped', 'AWESOME Sink is no place for a train station.'],
      ['propose', ''],
    ],
  );
  assert.deepEqual(skipped[3]!.dropoff!.station.owner, { kind: 'storage' });
  assert.deepEqual(createdEntries(skipped, all(skipped)).lines.length, 1);
});

test('names: numbered when taken, cut to 60 characters', () => {
  const taken = new Set(['Smelting to Parts']);
  assert.equal(freshName('Smelting to Parts', taken, 60), 'Smelting to Parts 2');
  assert.equal(freshName('Smelting to Parts', taken, 60), 'Smelting to Parts 3');
  const long = 'A'.repeat(70);
  const name = freshName(long, new Set(), 60);
  assert.equal(name.length, 60);
  assert.ok(name.endsWith('…'));
  const again = freshName(long, new Set([name]), 60);
  assert.equal(again.length, 60);
  assert.ok(again.endsWith('… 2'));
  // Two links between the same pair of names in one run get their own station and line names.
  const proposals = propose([ORE, { ...ORE, to: 'fg-parts01' }], {
    groups: [GROUPS[0]!, { id: 'fg-parts01', name: 'Smelting' }],
  });
  assert.deepEqual(
    proposals.map(proposal => proposal.line!.name),
    ['Iron Ore outpost to Smelting', 'Iron Ore outpost to Smelting 2'],
  );
});

test('trainAdd adds stations and lines in one write and never replaces; trainRemove takes them out', () => {
  const start = base();
  const { entries, state } = createAll(start, [ORE, PLATES]);
  assert.deepEqual(state.trainStations, entries.stations);
  assert.deepEqual(state.trainLines, entries.lines);
  assert.equal(state.version, 30);
  // An id that exists, sent twice, a stop of no station, an unknown factory, a malformed entry:
  // the whole write is refused.
  const station = entries.stations[0]!;
  const line = entries.lines[0]!;
  const fresh = { ...station, id: 'ts-fresh01' };
  for (const [update, error] of [
    [addOp({ stations: [station], lines: [] }), /Invalid train station/],
    [addOp({ stations: [fresh, fresh], lines: [] }), /Invalid train station/],
    [addOp({ stations: [], lines: [line] }), /Invalid train line/],
    [
      addOp({ stations: [fresh], lines: [{ ...line, id: 'tl-fresh01', stops: ['ts-gone001'] }] }),
      /Unknown train station/,
    ],
    [
      addOp({ stations: [{ ...fresh, owner: { kind: 'factory', id: 'fg-gone001' } }], lines: [] }),
      /Unknown factory/,
    ],
    [
      addOp({
        stations: [{ ...fresh, platforms: [{ kind: 'load', cargo: ['Nope'] }] }],
        lines: [],
      }),
      /Invalid train station/,
    ],
    [addOp({ stations: [], lines: [] }), /Invalid train stations and lines/],
    [{ type: 'trainAdd', stations: 'x', lines: [] }, /Invalid train/],
  ] as const)
    assert.throws(() => mutate(json(state), update as UpdateOp), error);
  // At most 200 stations: the profile has 4.
  const many = Array.from({ length: TRAIN_STATION_MAX - 4 }, (_, i) => ({
    ...fresh,
    id: `ts-many${String(i).padStart(3, '0')}`,
  }));
  const full = mutate(json(state), addOp({ stations: many, lines: [] }));
  assert.equal(full.trainStations!.length, TRAIN_STATION_MAX);
  assert.throws(
    () =>
      mutate(
        json(state),
        addOp({ stations: [...many, { ...fresh, id: 'ts-over001' }], lines: [] }),
      ),
    /at most 200 train stations/,
  );
  // A line may call at a station of the profile and one of the same write.
  const extra = mutate(
    json(state),
    addOp({
      stations: [fresh],
      lines: [{ ...line, id: 'tl-fresh01', stops: [station.id, fresh.id] }],
    }),
  );
  assert.deepEqual(extra.trainLines!.at(-1)!.stops, [station.id, fresh.id]);
  // Not base-sensitive: one write adds or removes only its own entries.
  assert.doesNotThrow(() => checkBase({ ...state, revision: 4 }, addOp(entries), '2'));
  // trainRemove: by id, gone stays gone, and the last of them gives back the state before.
  const removed = mutate(json(state), {
    type: 'trainRemove',
    stations: entries.stations.map(entry => entry.id),
    lines: entries.lines.map(entry => entry.id),
  });
  assert.deepEqual(removed, { ...start, revision: removed.revision });
  assert.deepEqual(
    mutate(json(removed), { type: 'trainRemove', stations: [station.id], lines: [] }),
    removed,
  );
  // A removed station leaves the lines that are kept.
  const one = mutate(json(state), { type: 'trainRemove', stations: [station.id], lines: [] });
  assert.equal(one.trainLines!.length, 2);
  assert.equal(one.trainLines![0]!.stops.includes(station.id), false);
  for (const update of [
    { type: 'trainRemove', stations: ['nope'], lines: [] },
    { type: 'trainRemove', stations: [], lines: 'tl-x' },
  ])
    assert.throws(
      () => mutate(json(state), update as UpdateOp),
      /Invalid train stations and lines/,
    );
});
