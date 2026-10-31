// Markers on the world map and its layer switches (#1283, slice 2): the progress state's
// `mapMarkers` and `mapLayers` (state version 27). Every released format loads unchanged and
// gains neither field, an upgrade from 26, 25 and 1 keeps everything else, the fields are checked
// (counts, lengths, finite spots in range), the last marker removed and every layer shown again
// bring the state back to the version its other content needs, and a newer version is refused
// with the update message. Both editions save them, keep them through a reload, a full export and
// import, a progress backup and its restore, and a recalculation in place; a new profile carried
// with its notes takes the markers, a share keeps the markers and leaves the layers behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { calculate, catalog } from '../planner.ts';
import {
  checkBase,
  MAP_MARKER_MAX,
  mapMarkerId,
  mutate,
  newProfileState,
  shareState,
  validateState,
} from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import {
  MARKER_NUDGE,
  MARKER_NUDGE_SHIFT,
  markerAria,
  markerHex,
  markerTarget,
  mapLayerShown,
  newMarkerId,
  newMarkerName,
  newMarkerTarget,
  nudgedMarker,
  onMap,
} from '../public/app/map-markers.ts';
import { WORLD_MAP, imageToWorld, worldToImage } from '../public/app/world-map.ts';
import { adaRemarks } from '../public/ada.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { states, version1, version25, version26, version27 } from './types/fixtures.ts';
import type {
  MapMarker,
  ProgressState,
  SaveExport,
  StoredCalculatedPlan,
  UpdateOp,
  WorkspaceSummary,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const IRON: MapMarker = {
  id: 'mk-iron01',
  name: 'Pure iron',
  type: 'resource',
  color: 'orange',
  x: -120500,
  y: 48250,
};
const ARCH: MapMarker = { id: 'mk-arch02', name: 'Stone arch', type: 'landmark', x: 30000, y: -1 };
const place = (marker: MapMarker): UpdateOp => {
  const { id, ...value } = marker;
  return { type: 'mapMarker', id, value };
};

test('markers and layers are state version 27; every released format loads unchanged', () => {
  for (const [state, version] of states) {
    const clean = validateState(json(state));
    assert.equal(clean.version, version);
    if (version < 27) {
      assert.equal('mapMarkers' in clean, false, `version ${version}`);
      assert.equal('mapLayers' in clean, false, `version ${version}`);
    }
  }
  const clean = validateState(json(version27));
  assert.equal(clean.version, 27);
  assert.deepEqual(clean.mapMarkers, version27.mapMarkers);
  assert.deepEqual(clean.mapLayers, { markers: false });
  assert.deepEqual(validateState(json(clean)), clean, 'a repeated load changes nothing');
  // From version 26 (#1239), 25 (#1240) and 1: the fields come on top, everything else as it was.
  for (const older of [version26, version25, version1]) {
    const before = validateState(json(older));
    for (const extra of [
      { mapMarkers: [IRON] },
      { mapLayers: { markers: false } },
      { mapMarkers: [IRON, ARCH], mapLayers: { stations: false } },
    ]) {
      const upgraded = validateState(json({ ...older, ...extra }));
      assert.equal(upgraded.version, 27, JSON.stringify(extra));
      const { mapMarkers: _markers, mapLayers: _layers, ...rest } = upgraded;
      assert.deepEqual({ ...rest, version: before.version }, before);
    }
    // Nothing to keep is no content: an empty list and layers all shown stay at the old version.
    const blank = validateState(
      json({ ...older, mapMarkers: [], mapLayers: { markers: true, factories: true } }),
    );
    assert.deepEqual(blank, before);
  }
});

test('the fields are checked: bounded counts and lengths, known types and finite spots', () => {
  const at = (marker: unknown) => json({ ...version26, mapMarkers: [marker] });
  // A spot is kept in whole game units; a name is trimmed; unknown fields are left out.
  const kept = validateState(
    at({ ...IRON, name: '  Pure iron  ', x: -120500.4, y: 48250.6, extra: 1 }),
  );
  assert.deepEqual(kept.mapMarkers, [{ ...IRON, y: 48251 }]);
  assert.deepEqual(validateState(at({ ...ARCH, x: -0.2 })).mapMarkers, [{ ...ARCH, x: 0 }]);
  assert.equal(
    validateState(at({ ...IRON, name: 'x'.repeat(60) })).mapMarkers![0]!.name.length,
    60,
  );
  for (const bad of [
    { ...IRON, id: 'iron' },
    { ...IRON, id: 'mk-ABCD' },
    { ...IRON, id: '__proto__' },
    { ...IRON, name: '' },
    { ...IRON, name: '   ' },
    { ...IRON, name: 'x'.repeat(61) },
    { ...IRON, name: 7 },
    { ...IRON, type: 'station' },
    { ...IRON, color: '#ff0000' },
    { ...IRON, x: Number.NaN },
    { ...IRON, x: '12' },
    { ...IRON, y: 1_000_001 },
    { ...IRON, y: null },
    [IRON],
    null,
  ])
    assert.throws(() => validateState(at(bad)), /Invalid map markers/, JSON.stringify(bad));
  // JSON cannot carry Infinity, but a stored object can.
  assert.throws(
    () => validateState({ ...json(version26), mapMarkers: [{ ...IRON, x: Infinity }] }),
    /Invalid map markers/,
  );
  assert.throws(
    () => validateState(json({ ...version26, mapMarkers: [IRON, { ...ARCH, id: IRON.id }] })),
    /Invalid map markers/,
    'each id once',
  );
  assert.throws(
    () => validateState(json({ ...version26, mapMarkers: { [IRON.id]: IRON } })),
    /Invalid map markers/,
  );
  const many = Array.from({ length: MAP_MARKER_MAX + 1 }, (_, i) => ({
    ...ARCH,
    id: `mk-a${String(i).padStart(4, '0')}`,
  }));
  assert.equal(
    validateState(json({ ...version26, mapMarkers: many.slice(1) })).mapMarkers!.length,
    500,
  );
  assert.throws(
    () => validateState(json({ ...version26, mapMarkers: many })),
    /Invalid map markers/,
  );
  for (const bad of [
    { markers: 'no' },
    { markers: 0 },
    { roads: false },
    [],
    'markers',
    { toString: false },
  ])
    assert.throws(
      () => validateState(json({ ...version26, mapLayers: bad })),
      /Invalid map layers/,
      JSON.stringify(bad),
    );
  // A newer planner's state is refused with the update message, never stripped.
  assert.throws(
    () => validateState({ ...json(version27), version: 31 }),
    /newer planner version\. Update the app/,
  );
});

test('the updates place, replace and remove one marker and show or hide a layer', () => {
  const placed = mutate(json(version26), place(IRON));
  assert.equal(placed.version, 27);
  assert.deepEqual(placed.mapMarkers, [IRON]);
  const two = mutate(json(placed), place(ARCH));
  assert.deepEqual(
    two.mapMarkers!.map(m => m.id),
    [IRON.id, ARCH.id],
    'a new marker goes after the others',
  );
  // Replaced where it is, whole: the colour left out is the type's own again.
  const { color: _color, ...plainIron } = IRON;
  const edited = mutate(json(two), place({ ...plainIron, name: 'Iron, pure', x: 1, y: 2 }));
  assert.deepEqual(edited.mapMarkers, [{ ...plainIron, name: 'Iron, pure', x: 1, y: 2 }, ARCH]);
  const removed = mutate(json(edited), { type: 'mapMarker', id: IRON.id, value: null });
  assert.deepEqual(removed.mapMarkers, [ARCH]);
  assert.deepEqual(
    mutate(json(removed), { type: 'mapMarker', id: IRON.id, value: null }),
    removed,
    'a marker already gone stays gone',
  );
  // The last one removed: the state is version 26 again, exactly as before.
  const empty = mutate(json(removed), { type: 'mapMarker', id: ARCH.id, value: null });
  assert.equal('mapMarkers' in empty, false);
  assert.deepEqual(empty, validateState(json(version26)));
  for (const bad of [
    { type: 'mapMarker', id: 'nope', value: plainIron },
    { type: 'mapMarker', id: IRON.id, value: { ...plainIron, name: '' } },
    { type: 'mapMarker', id: IRON.id, value: { ...plainIron, x: 'east' } },
    { type: 'mapMarker', id: IRON.id, value: 'here' },
    { type: 'mapMarker', id: IRON.id },
  ])
    assert.throws(() => mutate(json(version26), bad as UpdateOp), /Invalid map marker/);
  // The 501st marker is refused with what to do.
  const full = validateState(
    json({
      ...version26,
      mapMarkers: Array.from({ length: MAP_MARKER_MAX }, (_, i) => ({
        ...ARCH,
        id: `mk-a${String(i).padStart(4, '0')}`,
      })),
    }),
  );
  assert.throws(() => mutate(json(full), place(IRON)), /at most 500 markers\. Delete one/);
  assert.doesNotThrow(() => mutate(json(full), place({ ...ARCH, id: 'mk-a0000', x: 5 })));
  // Layers: hiding one is stored, showing it again forgets it.
  const hidden = mutate(json(version26), { type: 'mapLayer', layer: 'markers', value: false });
  assert.equal(hidden.version, 27);
  assert.deepEqual(hidden.mapLayers, { markers: false });
  const both = mutate(json(hidden), { type: 'mapLayer', layer: 'factories', value: false });
  assert.deepEqual(both.mapLayers, { factories: false, markers: false });
  const shown = mutate(json(both), { type: 'mapLayer', layer: 'factories', value: true });
  assert.deepEqual(shown.mapLayers, { markers: false });
  const all = mutate(json(shown), { type: 'mapLayer', layer: 'markers', value: true });
  assert.deepEqual(all, validateState(json(version26)), 'every layer shown: version 26 again');
  for (const bad of [
    { type: 'mapLayer', layer: 'roads', value: false },
    { type: 'mapLayer', layer: 'markers', value: 'off' },
  ])
    assert.throws(() => mutate(json(version26), bad as UpdateOp), /Invalid map layers/);
  // One marker or one layer per write: neither undoes another tab's change, so neither is refused
  // for a stale revision.
  const current = { ...validateState(json(version27)), revision: 4 };
  assert.doesNotThrow(() => checkBase(current, place(IRON), '2'));
  assert.doesNotThrow(() =>
    checkBase(current, { type: 'mapLayer', layer: 'markers', value: true }, '2'),
  );
});

test('a new profile carried with its notes takes the markers; a share leaves the layers', () => {
  const source = validateState(json(version27));
  const withNotes = newProfileState(null, json(source), null, { notes: true }, undefined).state;
  assert.deepEqual(withNotes.mapMarkers, version27.mapMarkers);
  assert.equal('mapLayers' in withNotes, false, 'the layers shown stay the source profile’s');
  assert.equal(withNotes.version, 27);
  const without = newProfileState(null, json(source), null, { planEdits: true }, undefined).state;
  assert.equal('mapMarkers' in without, false);
  const shared = shareState(json(source));
  assert.deepEqual(shared.mapMarkers, version27.mapMarkers);
  assert.equal('mapLayers' in shared, false);
});

test('the map helpers: spots on the map, the arrow keys, the dialog target and the words', () => {
  const { west, east, south } = WORLD_MAP.bounds;
  assert.deepEqual(onMap({ x: west - 5000, y: south + 1 }), {
    x: Math.round(west),
    y: Math.round(south),
  });
  assert.deepEqual(onMap({ x: 10.4, y: -0.3 }), { x: 10, y: 0 });
  // An arrow key moves a marker MARKER_NUDGE px on screen at the zoom shown, Shift further.
  const start = { x: 0, y: 0 };
  for (const zoom of [0.25, 1, 2.5]) {
    const right = nudgedMarker(start, 'ArrowRight', false, zoom)!;
    const moved = worldToImage(right).x - worldToImage(start).x;
    assert.ok(Math.abs(moved * zoom - MARKER_NUDGE) < 0.01, `zoom ${zoom}: ${moved * zoom} px`);
    assert.equal(right.y, 0);
    const up = nudgedMarker(start, 'ArrowUp', true, zoom)!;
    const lifted = worldToImage(start).y - worldToImage(up).y;
    assert.ok(Math.abs(lifted * zoom - MARKER_NUDGE_SHIFT) < 0.01, `zoom ${zoom}, Shift`);
  }
  assert.equal(nudgedMarker(start, 'Enter', false, 1), null);
  assert.deepEqual(
    nudgedMarker({ x: Math.round(east), y: 0 }, 'ArrowRight', true, 1),
    { x: Math.round(east), y: 0 },
    'never off the map',
  );
  // The dialog's target names a marker or a new marker's spot.
  assert.deepEqual(markerTarget(newMarkerTarget({ x: -120500, y: 48250 })), {
    spot: { x: -120500, y: 48250 },
  });
  assert.deepEqual(markerTarget('mk-iron01'), { id: 'mk-iron01' });
  for (let i = 0; i < 20; i++) assert.ok(mapMarkerId(newMarkerId()));
  assert.equal(newMarkerName([]), 'Marker 1');
  assert.equal(newMarkerName([{ name: 'Marker 2' }]), 'Marker 3');
  assert.equal(newMarkerName([{ name: 'A' }, { name: 'Marker 3' }]), 'Marker 4');
  assert.equal(
    markerAria(IRON),
    'Pure iron, Resource node. Enter edits it, the arrow keys move it, Delete removes it.',
  );
  assert.equal(markerHex(IRON), '#f89c1c');
  assert.equal(markerHex({ type: 'landmark' }), '#7cc4ff', 'the type’s own colour');
  assert.equal(mapLayerShown(undefined, 'markers'), true);
  assert.equal(mapLayerShown({ markers: false }, 'markers'), false);
  assert.equal(mapLayerShown({ markers: false }, 'factories'), true);
  // A spot stored in game units lands where it was placed on the image, and back.
  const image = { x: 640, y: 321 };
  const back = worldToImage(imageToWorld(image));
  assert.ok(Math.abs(back.x - image.x) < 1e-9 && Math.abs(back.y - image.y) < 1e-9);
});

test('ADA on the map: no markers yet, how many, or hidden', () => {
  const line = (facts: object) =>
    adaRemarks({ view: 'map', ...facts }).find(remark => remark.id === 'map-markers');
  assert.match(line({ mapMarkers: 0 })!.text, /^No markers yet\. Click the map/);
  assert.match(line({ mapMarkers: 1 })!.text, /^1 marker on the map\. Drag one to move it/);
  assert.match(line({ mapMarkers: 3 })!.text, /^3 markers on the map\./);
  assert.match(
    line({ mapMarkers: 2, mapMarkersHidden: true })!.text,
    /^The markers are hidden on this profile \(2 markers\)\. Tick Markers/,
  );
  assert.equal(line({ mapMarkers: 2 })!.tone, 'calm');
  // adaFacts (app/ada-panel.ts) gives the counts only on the map page with a save open.
  assert.equal(line({}), undefined, 'not without the counts');
});

// Both editions: the markers and layers are saved, kept through a reload, a full export and
// import, a progress backup and its restore, and a recalculation in place that carries nothing.
const BASE = { phase: '3', recipes: 'standard' };
async function checkEdition(
  request: (route: string, body?: unknown) => Promise<unknown>,
  reload: () => Promise<void>,
) {
  type Context = { profile: { id: string }; plan: StoredCalculatedPlan; state: ProgressState };
  const context = async () => (await request('/api/context')) as Context;
  await request('/api/profiles', { saveName: 'World', name: 'Mapped', settings: BASE });
  await request('/api/update', place(IRON));
  await request('/api/update', place(ARCH));
  await request('/api/update', { type: 'mapLayer', layer: 'markers', value: false });
  await reload();
  const after = await context();
  assert.equal(after.state.version, 27);
  assert.deepEqual(after.state.mapMarkers, [IRON, ARCH]);
  assert.deepEqual(after.state.mapLayers, { markers: false });
  // A full export carries them and an import brings them back on the copy.
  const exported = (await request('/api/export-saves')) as SaveExport;
  assert.deepEqual(validateTransfer(exported).saves[0]!.profiles[0]!.state.mapMarkers, [
    IRON,
    ARCH,
  ]);
  await request('/api/import-saves', exported);
  const summary = (await request('/api/workspace')) as WorkspaceSummary;
  assert.equal(summary.saves.length, 2);
  // The progress backup and its restore.
  const backup = (await request('/api/export')) as { state: ProgressState };
  assert.deepEqual(backup.state.mapMarkers, [IRON, ARCH]);
  await request('/api/update', { type: 'mapMarker', id: IRON.id, value: null });
  await request('/api/update', { type: 'mapLayer', layer: 'markers', value: true });
  assert.equal((await context()).state.version < 27, false, 'one marker is left');
  await request('/api/import', backup);
  const restored = await context();
  assert.deepEqual(restored.state.mapMarkers, [IRON, ARCH]);
  assert.deepEqual(restored.state.mapLayers, { markers: false });
  // A recalculation in place that carries nothing keeps the map: the same profile, the same world.
  await request('/api/recalculate', {
    name: 'Mapped',
    backupName: 'Mapped (before edit)',
    settings: restored.plan.settings,
    planCreatedAt: restored.plan.createdAt,
    carry: {},
  });
  const recalculated = await context();
  assert.notEqual(recalculated.plan.createdAt, restored.plan.createdAt, 'recalculated');
  assert.deepEqual(recalculated.state.mapMarkers, [IRON, ARCH]);
  assert.deepEqual(recalculated.state.mapLayers, { markers: false });
  return exported;
}

async function dockerEdition<T>(
  run: (
    request: (route: string, body?: unknown) => Promise<unknown>,
    reload: () => Promise<void>,
  ) => Promise<T>,
) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'satisfactory-map-'));
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

test('the Docker server keeps markers and layers, and a browser edition imports its export', async () => {
  const exported = await dockerEdition(checkEdition);
  const browser = browserEdition();
  await browser.request('/api/import-saves', exported);
  const summary = (await browser.request('/api/workspace')) as WorkspaceSummary;
  const save = summary.saves[0]!;
  const stored = (
    browser.records.get('main') as { saves: { profiles: { state: ProgressState }[] }[] }
  ).saves[0]!.profiles[0]!.state;
  assert.ok(save);
  assert.deepEqual(stored.mapMarkers, [IRON, ARCH]);
  assert.deepEqual(stored.mapLayers, { markers: false });
});

test('the browser edition keeps markers and layers, and the Docker server imports its export', async () => {
  const browser = browserEdition();
  const exported = await checkEdition(browser.request, browser.reload);
  await dockerEdition(async request => {
    await request('/api/import-saves', exported);
    // The server had no save, so the imported copy is the one open.
    const { state } = (await request('/api/context')) as { state: ProgressState };
    assert.deepEqual(state.mapMarkers, [IRON, ARCH]);
    assert.deepEqual(state.mapLayers, { markers: false });
  });
});

// The browser edition serves stored progress without validateState (AGENTS.md): a version-27
// record keeps its markers and a version-26 one loads as it was, without them.
test('the browser edition loads stored progress of version 26 and 27 unchanged', async () => {
  for (const state of [version26, version27]) {
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
