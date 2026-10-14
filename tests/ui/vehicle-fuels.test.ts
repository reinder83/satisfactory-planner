// Game version slice 1 (#1165, part of #1081) on the pages: the Logistics page offers the whole
// vehicle fuel list, a link saved before keeps its fuel and its text, and picking a new fuel is
// an ordinary progress update; the server Backup page names the game data.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { $, $$, applyUpdate, catalog, generated, go, open, page, stubFetch } from './setup.ts';
import type { UpdateOp } from '../../public/types/index.ts';

const plan = generated();
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const KEY = 'fg-smelt1:fg-parts1';
// Two groups splitting Phase 3's lines, with a truck on Coal between them (state version 7).
const openLogistics = async (fuel = 'Coal') => {
  const rows = plan.stages['3'].rows!;
  open({
    calculated: plan,
    workspace: { catalog: catalog() },
    state: {
      version: 7,
      factoryGroups: {
        groups: [
          { id: 'fg-smelt1', name: 'Smelting' },
          { id: 'fg-parts1', name: 'Parts' },
        ],
        assignments: Object.fromEntries(
          rows.map((r, i) => [r.id, [{ group: i % 2 ? 'fg-parts1' : 'fg-smelt1', rate: null }]]),
        ),
        links: { [KEY]: { mode: 'truck', roundTripMin: 5, fuel } },
      },
    },
  });
  go('logistics');
  render();
  await nextTick();
};

beforeEach(() => page());

test('the fuel menu lists the twelve vehicle fuels and keeps a saved link’s fuel', async () => {
  await openLogistics();
  const select = $<HTMLSelectElement>(`[data-link-fuel="${KEY}"]`)!;
  assert.equal(select.value, 'Coal', 'the saved fuel stays picked');
  assert.deepEqual(
    $$<HTMLOptionElement>(`[data-link-fuel="${KEY}"] option`).map(o => o.value),
    [
      'Packaged Fuel',
      'Packaged Turbofuel',
      'Packaged Rocket Fuel',
      'Packaged Ionized Fuel',
      'Packaged Liquid Biofuel',
      'Packaged Oil',
      'Packaged Heavy Oil Residue',
      'Battery',
      'Coal',
      'Compacted Coal',
      'Petroleum Coke',
      'Solid Biofuel',
    ],
  );
  assert.match(
    $(`[data-link-out="${KEY}"] [data-link-load]`)!.textContent!,
    /Up to [\d.,]+ Coal\/min if they never stop\./,
  );
});

test('picking Battery saves it as version 17 and burns 6,000 MJ a battery', async () => {
  await openLogistics();
  const trucks = Number(
    /^(\d+) trucks?/.exec($(`[data-link-out="${KEY}"] [data-link-load]`)!.textContent!)![1],
  );
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  const select = $<HTMLSelectElement>(`[data-link-fuel="${KEY}"]`)!;
  select.value = 'Battery';
  select.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(calls.at(-1)![1], {
    type: 'factoryLinkTransport',
    from: 'fg-smelt1',
    to: 'fg-parts1',
    mode: 'truck',
    roundTripMin: 5,
    fuel: 'Battery',
  });
  assert.equal(state.version, 17);
  assert.deepEqual(state.factoryGroups.links![KEY], {
    mode: 'truck',
    roundTripMin: 5,
    fuel: 'Battery',
  });
  // 75 MW per truck: 0.75 Battery a minute each.
  const burn = (trucks * 75 * 60) / 6000;
  assert.match(
    $(`[data-link-out="${KEY}"] [data-link-load]`)!.textContent!,
    new RegExp(`Up to ${String(burn).replace('.', '\\.')} Battery/min if they never stop\\.`),
  );
});

test('the server Backup page names the game data', () => {
  open({ profileId: 'original' });
  go('backup');
  render();
  assert.equal(
    $('[data-game-data]')!.textContent!.replace(/\s+/g, ' ').trim(),
    'Satisfactory 1.1 data (SatisfactoryTools b5210ae9), balance unchanged through 1.2.4.0. Recipe data source',
  );
  assert.equal(
    $('[data-game-data] a')!.getAttribute('href'),
    'https://github.com/greeny/SatisfactoryTools',
  );
});
