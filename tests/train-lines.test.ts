// Train logistics, slices 2 to 4 (#1284): state version 30 and the train lines' logic.
// - State: `trainLines` (a line's train, stops, direction and round trip), `trainLayout` (the
//   network diagram), and on a station a place on the world map, a pipe on a platform and an outpost
//   on oil or resource wells. Every released format loads unchanged and gains no field; an upgrade
//   from 29, 28 and 1 keeps everything else; a malformed line or part is left out and the rest
//   stays; removing the last of them brings the state back to the version its other content needs;
//   a newer version is refused with the update message. The `trainLine` and `trainLayout` updates
//   write one entry and refuse a malformed one; deleting a station takes it off every line.
// - Carry and share: a new profile carried with its factories takes the lines and layout, a
//   recalculation in place keeps them, a share keeps them.
// - Both editions: a reload, a full export and import, a progress backup and its restore, and a
//   recalculation in place keep every new field, and each edition imports the other's export.
// - Logic: what each wagon carries (the platform in the wagon's place at each stop), the line
//   checks, what a wagon holds per round trip, and an outpost's extractors against its platforms
//   and trains.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { calculate, catalog } from '../planner.ts';
import {
  checkBase,
  mutate,
  newProfileState,
  shareState,
  TRAIN_CAR_MAX,
  TRAIN_LINE_MAX,
  TRAIN_STOP_MAX,
  validateState,
} from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import {
  consistText,
  fillText,
  lineCargo,
  lineChecks,
  newLineId,
  newLineName,
  outpostChecks,
  outpostYield,
  wagonCargo,
  wagonFill,
  wagonPlan,
  withRearLoco,
  withWagon,
  type ItemFacts,
} from '../public/app/train-lines.ts';
import { ownerText, platformText } from '../public/app/train-stations.ts';
import './helpers/en-us-numbers.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { states, version1, version28, version29, version30 } from './types/fixtures.ts';
import type {
  ProgressState,
  SaveExport,
  StoredCalculatedPlan,
  TrainLine,
  TrainStation,
  UpdateOp,
  WorkspaceSummary,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const FACTS: ItemFacts = {
  stack: item => ({ 'Iron Ore': 100, 'Iron Plate': 200, Screws: 500 })[item] ?? 100,
  fluid: item => ['Crude Oil', 'Water', 'Nitrogen Gas'].includes(item),
};
const MINE: TrainStation = {
  id: 'ts-mine01',
  name: 'Iron mine',
  owner: { kind: 'outpost', resource: 'Iron Ore', nodes: { pure: 2 } },
  platforms: [
    { kind: 'load', cargo: ['Iron Ore'], belt: 5 },
    { kind: 'load', cargo: ['Iron Ore'], belt: 5 },
    { kind: 'empty' },
  ],
};
const WORKS: TrainStation = {
  id: 'ts-works2',
  name: 'Iron works',
  platforms: [{ kind: 'unload', belt: 5 }, { kind: 'unload', belt: 5 }, { kind: 'empty' }],
};
const SHUTTLE: TrainLine = {
  id: 'tl-shut01',
  name: 'Ore shuttle',
  cars: ['loco', 'wagon', 'wagon', 'loco'],
  stops: ['ts-mine01', 'ts-works2'],
  direction: 'backAndForth',
  roundTrip: 4,
};
const lineOp = (line: TrainLine | string): UpdateOp => {
  if (typeof line === 'string') return { type: 'trainLine', id: line, value: null };
  const { id, ...value } = line;
  return { type: 'trainLine', id, value };
};
const stationOp = (station: TrainStation | string): UpdateOp => {
  if (typeof station === 'string') return { type: 'trainStation', id: station, value: null };
  const { id, ...value } = station;
  return { type: 'trainStation', id, value };
};
const withTrains = (base: object, extra: object = {}) =>
  validateState(json({ ...base, trainStations: [MINE, WORKS], ...extra }));

test('train lines are state version 30; every released format loads unchanged', () => {
  for (const [state, version] of states) {
    const clean = validateState(json(state));
    assert.equal(clean.version, version);
    if (version < 30) {
      assert.equal('trainLines' in clean, false, `version ${version}`);
      assert.equal('trainLayout' in clean, false, `version ${version}`);
    }
  }
  const clean = validateState(json(version30));
  assert.equal(clean.version, 30);
  assert.deepEqual(clean.trainLines, version30.trainLines);
  assert.deepEqual(clean.trainLayout, version30.trainLayout);
  assert.deepEqual(clean.trainStations, version30.trainStations);
  assert.deepEqual(validateState(json(clean)), clean, 'a repeated load changes nothing');
  // From 29, 28 and 1: the lines come on top, everything else as it was.
  for (const older of [version29, version28, version1]) {
    const before = withTrains(older);
    const upgraded = withTrains(older, { trainLines: [SHUTTLE] });
    assert.equal(upgraded.version, 30);
    assert.deepEqual(upgraded.trainLines, [SHUTTLE]);
    const { trainLines: _lines, ...rest } = upgraded;
    assert.deepEqual({ ...rest, version: before.version }, before);
    assert.equal(before.version, 29, 'stations alone are 29');
    assert.deepEqual(withTrains(older, { trainLines: [] }), before, 'no line is no content');
  }
  // Each part only version 30 knows makes the state 30 on its own.
  const parts: [string, object][] = [
    ['a layout', { trainLayout: { stations: { 'ts-mine01': [10, 10] } } }],
    ['a map place', { trainStations: [{ ...MINE, place: { x: 100, y: -200 } }] }],
    ['a pipe', { trainStations: [{ ...WORKS, platforms: [{ kind: 'unload', pipe: 2 }] }] }],
    [
      'an oil outpost',
      {
        trainStations: [{ ...MINE, owner: { kind: 'outpost', resource: 'Crude Oil', nodes: {} } }],
      },
    ],
    [
      'a well',
      {
        trainStations: [
          {
            ...MINE,
            owner: { kind: 'outpost', resource: 'Water', nodes: { pure: 1 }, wells: true },
          },
        ],
      },
    ],
  ];
  for (const [what, extra] of parts) assert.equal(withTrains(version28, extra).version, 30, what);
  // A newer planner's state is refused with the update message, never stripped.
  assert.throws(
    () => validateState({ ...json(version30), version: 31 }),
    /newer planner version\. Update the app/,
  );
});

test('outposts on oil and wells: kept as v30, wells implied for Nitrogen Gas and Water', () => {
  const owners = (owner: unknown) =>
    withTrains(version28, { trainStations: [{ ...MINE, owner }] }).trainStations![0]!.owner;
  assert.deepEqual(owners({ kind: 'outpost', resource: 'Crude Oil', nodes: { pure: 1 } }), {
    kind: 'outpost',
    resource: 'Crude Oil',
    nodes: { pure: 1 },
  });
  assert.deepEqual(
    owners({ kind: 'outpost', resource: 'Crude Oil', nodes: { pure: 1 }, wells: true }),
    { kind: 'outpost', resource: 'Crude Oil', nodes: { pure: 1 }, wells: true },
  );
  // Nitrogen Gas and Water come from wells only, so the flag is kept whatever was stored.
  assert.deepEqual(owners({ kind: 'outpost', resource: 'Nitrogen Gas', nodes: { normal: 2 } }), {
    kind: 'outpost',
    resource: 'Nitrogen Gas',
    nodes: { normal: 2 },
    wells: true,
  });
  // An ordinary resource on wells: the flag is left out, the owner kept.
  assert.deepEqual(owners({ kind: 'outpost', resource: 'Coal', nodes: {}, wells: true }), {
    kind: 'outpost',
    resource: 'Coal',
    nodes: {},
  });
  // The update refuses it whole.
  assert.throws(
    () =>
      mutate(
        json(version28),
        stationOp({
          ...MINE,
          owner: { kind: 'outpost', resource: 'Coal', nodes: {}, wells: true },
        }),
      ),
    /Invalid train station/,
  );
  const well = mutate(
    json(version28),
    stationOp({ ...MINE, owner: { kind: 'outpost', resource: 'Water', nodes: { pure: 3 } } }),
  );
  assert.equal(well.version, 30);
  assert.equal(
    ownerText(well.trainStations![0]!.owner, []),
    'Resource well: Water on 3 pure satellite nodes',
  );
});

test('a malformed line, stop, spot or station part is left out and the rest is kept', () => {
  const at = (extra: object) => withTrains(version28, extra);
  for (const bad of ['lines', { 0: SHUTTLE }, null, 7])
    assert.equal('trainLines' in at({ trainLines: bad }), false, JSON.stringify(bad));
  const kept = at({
    trainLines: [
      { ...SHUTTLE, id: 'shuttle' },
      SHUTTLE,
      { ...SHUTTLE, id: 'tl-blank2', name: '  ' },
      { ...SHUTTLE, name: 'Same id again' },
      'line',
      {
        id: 'tl-messy3',
        name: '  Messy  ',
        extra: true,
        cars: ['loco', 'caboose', 'wagon', 7],
        stops: ['ts-mine01', 'ts-gone09', 'nope', 'ts-works2'],
        direction: 'sideways',
        roundTrip: -2,
      },
      {
        id: 'tl-trip04',
        name: 'Trip',
        cars: 'many',
        stops: 'all',
        direction: 'oneWay',
        roundTrip: 3.14159,
      },
    ],
  });
  assert.deepEqual(kept.trainLines, [
    SHUTTLE,
    {
      id: 'tl-messy3',
      name: 'Messy',
      cars: ['loco', 'wagon'],
      stops: ['ts-mine01', 'ts-works2'],
      direction: 'oneWay',
    },
    { id: 'tl-trip04', name: 'Trip', cars: [], stops: [], direction: 'oneWay', roundTrip: 3.1 },
  ]);
  // The limits.
  const long = at({
    trainLines: [
      {
        ...SHUTTLE,
        cars: Array(TRAIN_CAR_MAX + 4).fill('wagon'),
        stops: Array(TRAIN_STOP_MAX + 3).fill('ts-mine01'),
        roundTrip: 601,
      },
    ],
  }).trainLines![0]!;
  assert.equal(long.cars.length, TRAIN_CAR_MAX);
  assert.equal(long.stops.length, TRAIN_STOP_MAX);
  assert.equal('roundTrip' in long, false, 'past 600 minutes is no round trip');
  const many = Array.from({ length: TRAIN_LINE_MAX + 2 }, (_, i) => ({
    ...SHUTTLE,
    id: `tl-l${String(i).padStart(4, '0')}`,
  }));
  assert.equal(at({ trainLines: many }).trainLines!.length, TRAIN_LINE_MAX);
  // The layout: a spot of a station the profile does not have, or out of range, is left out.
  assert.deepEqual(
    at({
      trainLayout: {
        stations: { 'ts-mine01': [12.4, 30], 'ts-gone09': [1, 1], 'ts-works2': [-5, 1] },
        zoom: 0.756,
        pan: [3, 4],
        extra: 1,
      },
    }).trainLayout,
    { stations: { 'ts-mine01': [12, 30] }, zoom: 0.76, pan: [3, 4] },
  );
  assert.equal('trainLayout' in at({ trainLayout: { zoom: 9, pan: 'x' } }), false);
  assert.equal(at({ trainLayout: { zoom: 1, pan: [0, 0] } }).version, 29, 'says nothing');
  // A station's place and pipe: kept in range, left out otherwise.
  const parts = at({
    trainStations: [
      {
        ...MINE,
        place: { x: 10.6, y: -4 },
        platforms: [{ kind: 'load', cargo: ['Water'], pipe: 3 }],
      },
      { ...WORKS, place: { x: 'far', y: 0 }, platforms: [{ kind: 'unload', pipe: 1, belt: 2 }] },
    ],
  }).trainStations!;
  assert.deepEqual(parts, [
    { ...MINE, place: { x: 11, y: -4 }, platforms: [{ kind: 'load', cargo: ['Water'] }] },
    { ...WORKS, platforms: [{ kind: 'unload', belt: 2, pipe: 1 }] },
  ]);
});

test('the trainLine update adds, replaces and removes one line; a deleted station leaves it', () => {
  const base = withTrains(version28);
  const added = mutate(json(base), lineOp(SHUTTLE));
  assert.equal(added.version, 30);
  assert.deepEqual(added.trainLines, [SHUTTLE]);
  const loop: TrainLine = { ...SHUTTLE, id: 'tl-loop02', name: 'Loop', direction: 'oneWay' };
  const both = mutate(json(added), lineOp(loop));
  assert.deepEqual(both.trainLines, [SHUTTLE, loop]);
  const changed = { ...SHUTTLE, name: 'Renamed', cars: ['loco', 'wagon'] as TrainLine['cars'] };
  const { roundTrip: _trip, ...withoutTrip } = changed;
  const replaced = mutate(json(both), lineOp(withoutTrip));
  assert.deepEqual(replaced.trainLines, [withoutTrip, loop]);
  const removed = mutate(json(replaced), lineOp(SHUTTLE.id));
  assert.deepEqual(removed.trainLines, [loop]);
  assert.deepEqual(mutate(json(removed), lineOp(SHUTTLE.id)), removed, 'gone stays gone');
  const none = mutate(json(removed), lineOp(loop.id));
  assert.deepEqual(none, base, 'version 29 again, exactly as before');
  // Checked whole.
  assert.throws(
    () => mutate(json(base), lineOp({ ...SHUTTLE, stops: ['ts-mine01', 'ts-gone09'] })),
    /Unknown train station/,
  );
  const bad = (value: unknown, id = 'tl-new01') => ({ type: 'trainLine', id, value }) as UpdateOp;
  for (const update of [
    bad({ ...SHUTTLE, id: undefined }, 'line'),
    bad('line'),
    bad({ name: ' ', cars: [], stops: [], direction: 'oneWay' }),
    bad({ name: 'A', cars: ['caboose'], stops: [], direction: 'oneWay' }),
    bad({ name: 'A', cars: [], stops: ['nope'], direction: 'oneWay' }),
    bad({ name: 'A', cars: [], stops: [], direction: 'sideways' }),
    bad({ name: 'A', cars: [], stops: [], direction: 'oneWay', roundTrip: 0 }),
    bad({
      name: 'A',
      cars: Array(TRAIN_CAR_MAX + 1).fill('wagon'),
      stops: [],
      direction: 'oneWay',
    }),
    { type: 'trainLine', id: 'tl-new01' } as UpdateOp,
  ])
    assert.throws(() => mutate(json(base), update), /Invalid train line/);
  // Deleting a station takes it off every line, and its spot off the diagram.
  const laid = mutate(json(both), {
    type: 'trainLayout',
    layout: { stations: { 'ts-mine01': [5, 5], 'ts-works2': [300, 5] } },
  });
  const gone = mutate(json(laid), stationOp(MINE.id));
  assert.deepEqual(
    gone.trainLines!.map(line => line.stops),
    [['ts-works2'], ['ts-works2']],
  );
  assert.deepEqual(gone.trainLayout, { stations: { 'ts-works2': [300, 5] } });
  // The layout update: whole, a malformed one refused, null drops it.
  assert.throws(
    () =>
      mutate(json(both), { type: 'trainLayout', layout: { stations: { 'ts-gone09': [1, 1] } } }),
    /Invalid train network layout/,
  );
  assert.equal('trainLayout' in mutate(json(laid), { type: 'trainLayout', layout: null }), false);
  // One entry per write: never refused for a stale revision.
  const current = { ...json(both), revision: 4 };
  assert.doesNotThrow(() => checkBase(current, lineOp(SHUTTLE), '2'));
  assert.doesNotThrow(() => checkBase(current, { type: 'trainLayout', layout: null }, '2'));
});

test('a new profile carried with its factories takes the lines; a share keeps them', () => {
  const source = validateState(json(version30));
  const carried = newProfileState(null, json(source), null, { planEdits: true }, undefined).state;
  assert.deepEqual(carried.trainLines, version30.trainLines);
  assert.deepEqual(carried.trainLayout, version30.trainLayout);
  assert.deepEqual(carried.trainStations, version30.trainStations);
  assert.equal(carried.version, 30);
  const without = newProfileState(null, json(source), null, { notes: true }, undefined).state;
  assert.equal('trainLines' in without, false);
  assert.equal('trainLayout' in without, false);
  const shared = shareState(json(source));
  assert.deepEqual(shared.trainLines, version30.trainLines);
  assert.deepEqual(shared.trainLayout, version30.trainLayout);
});

test('each wagon carries what the platform in its place loads; empty platforms are skipped', () => {
  const stations = [MINE, WORKS];
  const wagons = wagonPlan(SHUTTLE, stations);
  assert.deepEqual(
    wagons.map(wagon => [wagon.number, wagon.car, wagon.loads.length, wagon.unloads.length]),
    [
      [1, 2, 1, 1],
      [2, 3, 1, 1],
    ],
  );
  assert.deepEqual(wagonCargo(wagons[0]!), ['Iron Ore']);
  assert.deepEqual(lineCargo(SHUTTLE, stations), ['Iron Ore']);
  // An empty platform under a wagon: nothing loads or unloads it there.
  const spaced = { ...WORKS, platforms: [{ kind: 'empty' as const }, ...WORKS.platforms] };
  const shifted = wagonPlan(SHUTTLE, [MINE, spaced]);
  assert.equal(shifted[0]!.unloads.length, 0);
  // Fill per round trip: a Mk.5 belt (780/min) for 4 minutes is 3,120 of the 3,200 a wagon holds.
  const fill = wagonFill(wagons[0]!, wagons[0]!.loads[0]!, 4, FACTS)!;
  assert.deepEqual([fill.perTrip, fill.holds, fill.fits, fill.carries], [3120, 3200, true, 780]);
  assert.equal(fillText(fill), '3,120 of 3,200 per trip');
  const over = wagonFill(wagons[0]!, wagons[0]!.loads[0]!, 5, FACTS)!;
  assert.equal(over.fits, false);
  assert.equal(over.carries, 640, 'the belt backs up to what the wagon holds per trip');
  assert.equal(fillText(over), '3,900 per trip, more than the 3,200 it holds');
  assert.equal(wagonFill(wagons[0]!, wagons[0]!.loads[0]!, undefined, FACTS), null);
  // A fluid wagon: a Mk.2 pipe (600 m³/min) against 1,600 m³.
  const oil: TrainStation = {
    ...MINE,
    platforms: [{ kind: 'load', cargo: ['Crude Oil'], pipe: 2 }],
  };
  const fluid = wagonPlan({ ...SHUTTLE, stops: [oil.id] }, [oil])[0]!;
  const tank = wagonFill(fluid, fluid.loads[0]!, 2, FACTS)!;
  assert.deepEqual([tank.fluid, tank.perTrip, tank.holds, tank.fits], [true, 1200, 1600, true]);
  assert.equal(fillText(tank), '1,200 m³ of 1,600 m³ per trip');
  assert.equal(platformText(oil.platforms[0]!), 'Load Crude Oil · Mk.2 (600 m³/min) pipe');
});

test('the line checks: consist, stops, platforms, wagons and what a wagon holds', () => {
  const keys = (line: TrainLine, stations = [MINE, WORKS]) =>
    lineChecks(line, stations, FACTS).map(check => check.key);
  assert.deepEqual(keys(SHUTTLE), [], 'a line that matches has no checks');
  // Back and forth without a rear locomotive offers one.
  const noRear = { ...SHUTTLE, cars: ['loco', 'wagon', 'wagon'] as TrainLine['cars'] };
  const rear = lineChecks(noRear, [MINE, WORKS], FACTS).find(check => check.key === 'rear-loco')!;
  assert.equal(rear.fix, 'rearLoco');
  assert.match(rear.text, /^Back and forth needs a locomotive at the rear too/);
  assert.deepEqual(withRearLoco(noRear.cars), ['loco', 'wagon', 'wagon', 'loco']);
  assert.deepEqual(keys({ ...noRear, direction: 'oneWay' }), []);
  // The front car, no cars, no wagons, too few stops.
  assert.ok(keys({ ...SHUTTLE, cars: ['wagon', 'loco'] }).includes('first-loco'));
  assert.deepEqual(keys({ ...SHUTTLE, cars: [] }).slice(0, 1), ['no-cars']);
  assert.ok(keys({ ...SHUTTLE, cars: ['loco', 'loco'] }).includes('no-wagons'));
  assert.ok(keys({ ...SHUTTLE, stops: ['ts-mine01'] }).includes('stops'));
  // A station with fewer platforms than cars behind the locomotive.
  const long = {
    ...SHUTTLE,
    cars: ['loco', 'wagon', 'wagon', 'wagon', 'loco'] as TrainLine['cars'],
  };
  const short = lineChecks(long, [MINE, WORKS], FACTS).find(
    check => check.key === 'platforms:ts-mine01',
  )!;
  assert.equal(
    short.text,
    'Iron mine has 3 platforms for the 4 cars behind the locomotive: add 1 (an empty platform for a locomotive).',
  );
  assert.equal(short.station, 'ts-mine01');
  // The rear locomotive at a freight platform; a wagon at an empty one.
  const loco = lineChecks(
    { ...SHUTTLE, cars: ['loco', 'wagon', 'loco'] },
    [MINE, WORKS],
    FACTS,
  ).find(check => check.key.startsWith('loco-at:ts-mine01'))!;
  assert.equal(
    loco.text,
    'At Iron mine the locomotive in car 3 stands at platform 2, a freight platform: make that an empty platform.',
  );
  const empty = keys({ ...SHUTTLE, cars: ['loco', 'wagon', 'wagon', 'wagon', 'loco'] }, [
    { ...MINE, platforms: [...MINE.platforms, { kind: 'empty' }, { kind: 'empty' }] },
    { ...WORKS, platforms: [...WORKS.platforms, { kind: 'empty' }] },
  ]);
  assert.ok(empty.includes('wagon-at:ts-mine01:3'));
  // A wagon that loads nothing, and one loaded but never unloaded.
  const idle = keys(SHUTTLE, [
    { ...MINE, platforms: [MINE.platforms[0]!, { kind: 'unload' }] },
    WORKS,
  ]);
  assert.ok(idle.includes('wagon-nothing:2'));
  const kept = keys({ ...SHUTTLE, stops: ['ts-mine01', 'ts-mine01'] });
  assert.ok(kept.includes('wagon-kept:1') && kept.includes('wagon-kept:2'));
  // More than a wagon holds in a round trip, and no round trip entered.
  const full = lineChecks({ ...SHUTTLE, roundTrip: 5 }, [MINE, WORKS], FACTS);
  assert.equal(
    full.find(check => check.key === 'wagon-full:1:ts-mine01')!.text,
    'Wagon 1 at Iron mine: its Mk.5 belt brings 3,900 in a 5-minute round trip, more than the 3,200 the wagon holds (32 stacks of 100). The belt backs up to 640/min: add a wagon or shorten the round trip.',
  );
  const { roundTrip: _trip, ...noTrip } = SHUTTLE;
  assert.deepEqual(keys(noTrip), ['round-trip']);
  // Fluids and solids in one wagon.
  const mixed = keys({ ...SHUTTLE, stops: ['ts-mine01', 'ts-works2', 'ts-oil003'] }, [
    MINE,
    WORKS,
    { id: 'ts-oil003', name: 'Oil', platforms: [{ kind: 'load', cargo: ['Crude Oil'], pipe: 2 }] },
  ]);
  assert.ok(mixed.includes('wagon-mixed:1'));
});

test('the editor helpers: a wagon goes in front of the rear locomotive; words and names', () => {
  assert.deepEqual(withWagon(['loco', 'wagon', 'loco'], 'backAndForth'), [
    'loco',
    'wagon',
    'wagon',
    'loco',
  ]);
  assert.deepEqual(withWagon(['loco', 'wagon', 'loco'], 'oneWay'), [
    'loco',
    'wagon',
    'loco',
    'wagon',
  ]);
  assert.deepEqual(withWagon(['loco'], 'backAndForth'), ['loco', 'wagon']);
  assert.equal(consistText(['loco', 'wagon', 'wagon', 'loco']), 'Locomotive, 2 wagons, locomotive');
  assert.equal(consistText([]), 'No cars yet');
  assert.equal(newLineName([]), 'Line 1');
  assert.equal(newLineName([{ name: 'Line 2' }]), 'Line 3');
  assert.match(newLineId(), /^tl-[a-z0-9]{10}$/);
});

test("an outpost's extractors against its loading platforms and the trains that load there", () => {
  const survey = { mark: 3, clock: 2.5 };
  // Two pure Iron Ore nodes with Mk.3 miners at 250%: 1,200/min each.
  assert.equal(outpostYield({ resource: 'Iron Ore', nodes: { pure: 2 } }, survey), 2400);
  assert.equal(outpostYield({ resource: 'Crude Oil', nodes: { normal: 1 } }, survey), 300);
  assert.equal(outpostYield({ resource: 'Water', nodes: { pure: 2 }, wells: true }, survey), 600);
  const checks = (station: TrainStation, lines = [SHUTTLE]) =>
    outpostChecks(station, lines, [station, WORKS], survey, FACTS);
  // Two Mk.5 belts take 1,560 of the 2,400/min; the shuttle carries 1,560/min away.
  const found = checks(MINE);
  assert.deepEqual(
    found.map(check => check.key),
    ['outpost-lanes:ts-mine01', 'outpost-trains:ts-mine01'],
  );
  assert.equal(
    found[0]!.text,
    "Iron mine: its extractors give 2,400 Iron Ore/min (Mk.3 miners at 250%), but its loading platforms' belts take 1,560/min: add a platform or a faster belt.",
  );
  assert.equal(
    found[1]!.text,
    'Iron mine: the trains that load Iron Ore here carry away 1,560/min of the 2,400/min its extractors give: add a wagon or a train, or shorten a round trip.',
  );
  // One impure node (300/min) fits; no loading platform for it says so.
  assert.deepEqual(
    checks({ ...MINE, owner: { kind: 'outpost', resource: 'Iron Ore', nodes: { impure: 1 } } }),
    [],
  );
  const none = checks({ ...MINE, platforms: [{ kind: 'unload' }] });
  assert.equal(none[0]!.key, 'outpost-none:ts-mine01');
  // No round trip on the line: nothing to say about the trains.
  const { roundTrip: _trip, ...noTrip } = SHUTTLE;
  assert.deepEqual(
    checks(MINE, [noTrip]).map(check => check.key),
    ['outpost-lanes:ts-mine01'],
  );
  assert.deepEqual(checks(WORKS), [], 'only an outpost is checked');
});

// Both editions: every new field survives a reload, a full export and import, a progress backup
// and its restore, and a recalculation in place that carries nothing.
const BASE = { phase: '3', recipes: 'standard' };
const MAPPED: TrainStation = { ...MINE, place: { x: -1000, y: 2500 } };
const OIL: TrainStation = {
  id: 'ts-oil003',
  name: 'Oil field',
  owner: { kind: 'outpost', resource: 'Crude Oil', nodes: { normal: 2 }, wells: true },
  platforms: [{ kind: 'load', cargo: ['Crude Oil'], pipe: 2 }],
};
const LAYOUT = {
  stations: { 'ts-mine01': [20, 30] as [number, number] },
  zoom: 1.25,
  pan: [5, 0] as [number, number],
};
async function checkEdition(
  request: (route: string, body?: unknown) => Promise<unknown>,
  reload: () => Promise<void>,
) {
  type Context = { profile: { id: string }; plan: StoredCalculatedPlan; state: ProgressState };
  const context = async () => (await request('/api/context')) as Context;
  await request('/api/profiles', { saveName: 'World', name: 'Trains', settings: BASE });
  for (const station of [MAPPED, WORKS, OIL]) await request('/api/update', stationOp(station));
  await request('/api/update', lineOp(SHUTTLE));
  await request(
    '/api/update',
    lineOp({ ...SHUTTLE, id: 'tl-oil0002', stops: ['ts-oil003', 'ts-works2'] }),
  );
  await request('/api/update', { type: 'trainLayout', layout: LAYOUT });
  await reload();
  const after = (await context()).state;
  assert.equal(after.version, 30);
  const expected = {
    trainStations: [MAPPED, WORKS, OIL],
    trainLines: [SHUTTLE, { ...SHUTTLE, id: 'tl-oil0002', stops: ['ts-oil003', 'ts-works2'] }],
    trainLayout: LAYOUT,
  };
  const trains = (state: Pick<ProgressState, 'trainStations' | 'trainLines' | 'trainLayout'>) => ({
    trainStations: state.trainStations,
    trainLines: state.trainLines,
    trainLayout: state.trainLayout,
  });
  assert.deepEqual(trains(after), expected);
  const exported = (await request('/api/export-saves')) as SaveExport;
  assert.deepEqual(trains(validateTransfer(exported).saves[0]!.profiles[0]!.state), expected);
  await request('/api/import-saves', exported);
  assert.equal(((await request('/api/workspace')) as WorkspaceSummary).saves.length, 2);
  const backup = (await request('/api/export')) as { state: ProgressState };
  assert.deepEqual(trains(backup.state), expected);
  for (const line of expected.trainLines) await request('/api/update', lineOp(line.id));
  await request('/api/update', { type: 'trainLayout', layout: null });
  assert.equal((await context()).state.version, 30, 'the map place and the well are 30 alone');
  await request('/api/import', backup);
  const restored = await context();
  assert.deepEqual(trains(restored.state), expected);
  await request('/api/recalculate', {
    name: 'Trains',
    backupName: 'Trains (before edit)',
    settings: restored.plan.settings,
    planCreatedAt: restored.plan.createdAt,
    carry: {},
  });
  const recalculated = await context();
  assert.notEqual(recalculated.plan.createdAt, restored.plan.createdAt, 'recalculated');
  assert.deepEqual(trains(recalculated.state), expected);
  return { exported, expected };
}

async function dockerEdition<T>(
  run: (
    request: (route: string, body?: unknown) => Promise<unknown>,
    reload: () => Promise<void>,
  ) => Promise<T>,
) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'satisfactory-lines-'));
  let server: Awaited<ReturnType<typeof createApp>> | undefined;
  let url = '';
  const listen = async () => {
    server = await createApp({ dataDir: dir, password: '' });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  };
  const close = () => new Promise<void>(resolve => server!.close(() => resolve()));
  const request = async (route: string, body?: unknown) => {
    const res = await fetch(url + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(res.ok, route + ' ' + res.status + ' ' + (res.ok ? '' : await res.clone().text()));
    return res.json();
  };
  await listen();
  try {
    return await run(request, async () => {
      await close();
      await listen();
    });
  } finally {
    await close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
}
const browserEdition = (records = new Map<string, unknown>()) => {
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
    );
  let api = open();
  return {
    records,
    request: (route: string, body?: unknown) =>
      api(route, body === undefined ? undefined : { body: JSON.stringify(body) }),
    reload: async () => {
      api = open();
    },
  };
};

test('the Docker server keeps the train lines, and a browser edition imports its export', async () => {
  const { exported, expected } = await dockerEdition(checkEdition);
  const browser = browserEdition();
  await browser.request('/api/import-saves', exported);
  const stored = (
    browser.records.get('main') as { saves: { profiles: { state: ProgressState }[] }[] }
  ).saves[0]!.profiles[0]!.state;
  assert.deepEqual(stored.trainLines, expected.trainLines);
  assert.deepEqual(stored.trainLayout, expected.trainLayout);
  assert.deepEqual(stored.trainStations, expected.trainStations);
  assert.equal(stored.version, 30);
});

test('the browser edition keeps the train lines, and the Docker server imports its export', async () => {
  const browser = browserEdition();
  const { exported, expected } = await checkEdition(browser.request, browser.reload);
  await dockerEdition(async request => {
    await request('/api/import-saves', exported);
    const { state } = (await request('/api/context')) as { state: ProgressState };
    assert.deepEqual(state.trainLines, expected.trainLines);
    assert.deepEqual(state.trainLayout, expected.trainLayout);
    assert.deepEqual(state.trainStations, expected.trainStations);
  });
});

// The browser edition serves stored progress without validateState (AGENTS.md): stored version
// 28, 29 and 30 records load as they were.
test('the browser edition loads stored progress of version 28, 29 and 30 unchanged', async () => {
  for (const state of [version28, version29, version30]) {
    const browser = browserEdition();
    await browser.request('/api/profiles', { saveName: 'World', name: 'Old', settings: BASE });
    const main = browser.records.get('main') as { saves: { profiles: { state: unknown }[] }[] };
    main.saves[0]!.profiles[0]!.state = json(state);
    await browser.reload();
    const loaded = (await browser.request('/api/context')) as { state: ProgressState };
    assert.deepEqual(loaded.state, validateState(json(state)));
    assert.equal(loaded.state.version, state.version);
  }
});

// The Docker server opens a progress file holding a version 30 state as it was, and one holding a
// version 29 state unchanged (no migration rewrites it).
test('the Docker server opens stored version 29 and 30 progress unchanged', async () => {
  for (const state of [version29, version30]) {
    await dockerEdition(async (request, reload) => {
      await request('/api/profiles', { saveName: 'World', name: 'Old', settings: BASE });
      const { profile } = (await request('/api/context')) as { profile: { id: string } };
      await request('/api/import', {
        format: 'satisfactory-planner-backup',
        exportedAt: '2026-10-31T00:00:00.000Z',
        saveName: 'World',
        profileName: 'Old',
        profileId: profile.id,
        state: json(state),
      });
      await reload();
      const loaded = (await request('/api/context')) as { state: ProgressState };
      const { revision: _a, ...got } = loaded.state;
      const { revision: _b, ...want } = validateState(json(state));
      assert.deepEqual(got, want);
    });
  }
});
