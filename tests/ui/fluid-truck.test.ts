// Game version slice 2 (#1177, part of #1081) on the Logistics page: a link that carries a fluid
// offers the Fluid Truck from Phase 3 (Tier 5) on, listed disabled with when it comes before
// that; picking it is an ordinary progress update (version 18) and the link's figures follow
// the tanks; packaging for a truck stays the other choice.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { state } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { FLUIDS } from '../../public/app/flow.ts';
import { groupLinks } from '../../public/app/group-links.ts';
import { $, $$, applyUpdate, catalog, generated, go, open, page, stubFetch } from './setup.ts';
import type { FactoryGroups, LinkTransport, Phase, UpdateOp } from '../../public/types/index.ts';

const plan = generated();
// Phase 2 as a copy of Phase 3's lines, planned from Phase 2, so a fluid link shows in a phase
// before Tier 5.
plan.stages['2'] = structuredClone(plan.stages['3']);
plan.settings.phase = '2';
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  await nextTick();
};
const rows = plan.stages['3'].rows!;
const groups = (links?: Record<string, LinkTransport>): FactoryGroups => ({
  groups: [
    { id: 'fg-smelt1', name: 'Smelting' },
    { id: 'fg-parts1', name: 'Parts' },
  ],
  assignments: Object.fromEntries(
    rows.map((r, i) => [r.id, [{ group: i % 2 ? 'fg-parts1' : 'fg-smelt1', rate: null }]]),
  ),
  ...(links ? { links } : {}),
});
// A link between the two groups that carries a fluid, and one that carries none.
const between = groupLinks(plan.stages['3'], groups()).filter(
  l => l.from.startsWith('fg-') && l.to.startsWith('fg-'),
);
const fluidLink = between.find(l => l.items.some(i => FLUIDS.has(i.item)))!;
const KEY = fluidLink.from + ':' + fluidLink.to;
const openLogistics = async (phase: Phase, links?: Record<string, LinkTransport>) => {
  open({
    calculated: plan,
    phase,
    workspace: { catalog: catalog() },
    state: { version: links ? 7 : 3, factoryGroups: groups(links) },
  });
  go('logistics');
  render();
  await nextTick();
};
const options = (key: string) =>
  $$<HTMLOptionElement>(`[data-link-mode="${key}"] option`).map(o => ({
    value: o.value,
    label: o.textContent!.trim(),
    disabled: o.disabled,
  }));

beforeEach(() => page());

test('a fluid link offers the Fluid Truck from Phase 3, a solid link does not', async () => {
  assert.ok(fluidLink, 'the split has a fluid link between the factories');
  await openLogistics('3');
  assert.deepEqual(
    options(KEY).map(o => o.value),
    ['belt', 'truck', 'fluidTruck', 'tractor', 'explorer', 'train', 'drone'],
  );
  assert.deepEqual(
    options(KEY).find(o => o.value === 'fluidTruck'),
    { value: 'fluidTruck', label: 'Fluid Truck', disabled: false },
  );
  const solid = between.find(l => !l.items.some(i => FLUIDS.has(i.item)));
  if (solid) assert.ok(!options(solid.from + ':' + solid.to).some(o => o.value === 'fluidTruck'));
});

test('before Tier 5 the option says when it comes and cannot be picked', async () => {
  await openLogistics('2');
  assert.deepEqual(
    options(KEY).find(o => o.value === 'fluidTruck'),
    { value: 'fluidTruck', label: 'Fluid Truck (Tier 5, from Phase 3)', disabled: true },
  );
  // A link saved on it in a later phase keeps showing it picked, and says when it comes.
  await openLogistics('2', { [KEY]: { mode: 'fluidTruck', roundTripMin: 5, fuel: 'Coal' } });
  const select = $<HTMLSelectElement>(`[data-link-mode="${KEY}"]`)!;
  assert.equal(select.value, 'fluidTruck');
  assert.equal(options(KEY).find(o => o.value === 'fluidTruck')!.disabled, false);
  assert.equal(
    $(`[data-link-out="${KEY}"] [data-fluid-truck-later]`)!.textContent!.trim(),
    'Fluid Trucks come with Tier 5 (Phase 3): until then, package the fluids for a road vehicle.',
  );
});

test('picking the Fluid Truck saves version 18 and shows the tanks instead of packages', async () => {
  await openLogistics('3', { [KEY]: { mode: 'truck', roundTripMin: 5, fuel: 'Coal' } });
  const out = () => $(`[data-link-out="${KEY}"]`)!;
  assert.match(out().textContent!, /Packaged for the trip:/, 'a truck packages the fluid');
  const calls = stubFetch<UpdateOp>({ '/api/update': applyUpdate });
  const select = $<HTMLSelectElement>(`[data-link-mode="${KEY}"]`)!;
  select.value = 'fluidTruck';
  select.dispatchEvent(new Event('change'));
  await settle();
  assert.deepEqual(calls.at(-1)![1], {
    type: 'factoryLinkTransport',
    from: fluidLink.from,
    to: fluidLink.to,
    mode: 'fluidTruck',
    roundTripMin: 5,
    fuel: 'Coal',
  });
  assert.equal(state.version, 18);
  assert.deepEqual(state.factoryGroups.links![KEY], {
    mode: 'fluidTruck',
    roundTripMin: 5,
    fuel: 'Coal',
  });
  const lines = $$(`[data-link-out="${KEY}"] [data-link-load]`).map(p => p.textContent!.trim());
  assert.ok(
    lines.some(line =>
      /fluid trucks?, [\d.,]+ of 3[.,]200 m³ each trip \([\d.,]+ tank loads\/min\)/.test(line),
    ),
    lines.join(' | '),
  );
  assert.ok(lines.some(line => /Up to [\d.,]+ Coal\/min if they never stop\./.test(line)));
  assert.doesNotMatch(out().textContent!, /Packaged for the trip/);
  assert.equal($(`[data-link-out="${KEY}"] [data-fluid-truck-later]`), null);
  assert.equal($<HTMLSelectElement>(`[data-link-fuel="${KEY}"]`)!.value, 'Coal');
  // The receiver's badge counts the fluid trucks.
  assert.match($(`[data-link-in="${KEY}"] [data-link-badge]`)!.textContent!, /fluid trucks?$/);
  // Back to a truck: packaging again, and an older release reads it.
  select.value = 'truck';
  select.dispatchEvent(new Event('change'));
  await settle();
  assert.equal(state.version, 7);
  assert.match(out().textContent!, /Packaged for the trip:/);
});
