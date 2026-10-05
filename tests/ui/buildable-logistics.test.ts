// Logistics advice you can build (#1067), on the planner's own plans with the default factories
// (synthetic profiles, calculated in Node as the other component tests do):
// - the factory dialog splits a line's machines over its deliveries so that they add up to the
//   line's machines, by largest remainder (splitMachines in flow.ts), never more;
// - the flow page and the Logistics page name the same transport for every link (linkCarrier in
//   logistics.ts): a vehicle saved on a link, Water Extractors at the site for Water, else belts;
// - a link of many small items puts them on a mixed belt, on both pages.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test } from 'vitest';
import { calcFlowModel, FLUIDS, itemBelts, lanePlan } from '../../public/app/flow.ts';
import { groupFlow } from '../../public/app/group-flow.ts';
import { groupLinks } from '../../public/app/group-links.ts';
import { linkItemWords, VEHICLES } from '../../public/app/logistics.ts';
import { calcStage, flowRoute, setQuery, viewOf } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { $, $$, catalog, generated, generatedWith, go, open, page } from './setup.ts';
import type {
  CurrentCalculatedPlan,
  FactoryGroups,
  LinkMode,
  Phase,
  StageKey,
} from '../../public/types/index.ts';

// Three profiles: the default plan from Phase 1, every alternate from Phase 4, and whole machines
// from Phase 3.
const plans: [string, CurrentCalculatedPlan][] = [
  ['default', generated()],
  ['all alternates, Phase 4', generatedWith({ phase: '4', recipes: 'all' })],
  ['whole machines, Phase 3', generatedWith({ phase: '3', wholeMachines: true })],
];
const phasesOf = (plan: CurrentCalculatedPlan): StageKey[] =>
  (['1', '2', '3', '4', '5'] as StageKey[]).filter(
    phase => Number(phase) >= Number(plan.settings.phase || 1) && plan.stages[phase]?.rows?.length,
  );

beforeEach(() => {
  page();
  setQuery('');
});

test('every line’s machines per delivery add up to its machines, on every profile (#1067)', () => {
  let split = 0,
    over = 0;
  for (const [label, plan] of plans)
    for (const phase of phasesOf(plan)) {
      open({
        calculated: structuredClone(plan),
        phase: phase as Phase,
        state: { factoryGroups: defaultFactoryGroups(plan) },
      });
      for (const row of calcStage()!.rows!) {
        const model = calcFlowModel(row);
        const words = /split ≈ (.*) across the deliveries below$/.exec(model.bar?.sub ?? '');
        if (!words) continue;
        split++;
        const counts = words[1]!.split(' / ').map(count => (count === '<1' ? 0 : Number(count)));
        const where = `${label}, Phase ${phase}: ${row.name}`;
        assert.equal(
          counts.reduce((sum, count) => sum + count, 0),
          row.machines,
          `${where}: ${words[1]}`,
        );
        const machines = model.outputs.filter(output => output.machines !== undefined);
        assert.equal(
          machines.reduce((sum, output) => sum + output.machines!, 0),
          row.machines,
          where,
        );
        // Rounding each delivery up, as before, said more machines than the line has.
        const ceiled = model.outputs
          .filter(output => output.mach !== undefined && output.kind !== 'sink')
          .reduce((sum, output) => sum + Math.ceil(output.mach! - 1e-9), 0);
        if (ceiled > row.machines) over++;
      }
    }
  assert.ok(split > 20, `${split} lines split their machines`);
  assert.ok(over > 0, 'some line’s deliveries rounded up came to more than its machines');
});

// The transport each link has on the Logistics page, from its Out row: the vehicle picked, "belt",
// or "extract" for Water pumped at the site, keyed `<from>:<to>`.
function logisticsChoices(): Map<string, string> {
  const choices = new Map<string, string>();
  for (const row of $$('[data-link-out]')) {
    const select = row.querySelector<HTMLSelectElement>('[data-link-mode]');
    choices.set(
      row.dataset.linkOut!,
      row.querySelector('[data-link-extract]') ? 'extract' : select!.value,
    );
  }
  return choices;
}
// The transport a flow page's words name (linkItemWords): a vehicle, extraction, or belts.
const VEHICLE_OF = new Map(
  (Object.keys(VEHICLES) as LinkMode[]).map(mode => [
    'by ' + VEHICLES[mode].name.toLowerCase(),
    mode,
  ]),
);
const flowChoice = (words: string) =>
  words === 'Water Extractors here' ? 'extract' : (VEHICLE_OF.get(words) ?? 'belt');

// Default factories with a vehicle saved on a few links: a train on the largest link between two
// factories, a truck on the next, a drone on a raw resource's link, a truck on a Water link (which
// Water Extractors make needless) and, as saved before #231, a tractor on the mines of a factory.
function withVehicles(plan: CurrentCalculatedPlan, phase: StageKey): FactoryGroups {
  const groups = defaultFactoryGroups(plan);
  const links = groupLinks(plan.stages[phase], groups, plan.settings.onSite);
  const between = links.filter(link => link.from.startsWith('fg-') && link.to.startsWith('fg-'));
  const mined = links.filter(link => link.from.startsWith('supply/') && link.to.startsWith('fg-'));
  const water = mined.find(link => link.from === 'supply/Water');
  const ore = mined.find(link => link.from !== 'supply/Water');
  // A factory other than the drone's that mines something besides Water.
  const last = mined.find(link => link.from !== 'supply/Water' && link.to !== ore?.to);
  groups.links = {
    ...(between[0] && {
      [`${between[0].from}:${between[0].to}`]: { mode: 'train', roundTripMin: 6 },
    }),
    ...(between[1] && {
      [`${between[1].from}:${between[1].to}`]: { mode: 'truck', roundTripMin: 4, fuel: 'Coal' },
    }),
    ...(ore && { [`${ore.from}:${ore.to}`]: { mode: 'drone', roundTripMin: 3 } }),
    ...(water && {
      [`${water.from}:${water.to}`]: { mode: 'truck', roundTripMin: 4, fuel: 'Coal' },
    }),
    ...(last && { [`mines:${last.to}`]: { mode: 'tractor', roundTripMin: 5, fuel: 'Coal' } }),
  };
  return groups;
}

test('the flow page and Logistics name the same transport for every link, on every profile (#1067)', async () => {
  const seen = new Set<string>();
  for (const [label, plan] of plans) {
    const phase = phasesOf(plan).at(-1)!;
    const groups = withVehicles(plan, phase);
    open({
      calculated: structuredClone(plan),
      phase: phase as Phase,
      workspace: { catalog: catalog() },
      state: { version: 11, factoryGroups: groups },
    });
    go('logistics');
    render();
    await nextTick();
    const choices = logisticsChoices();
    assert.ok(choices.size > 5, `${label}: ${choices.size} links`);
    // Each factory's flow, worded as its page words it.
    const stage = plan.stages[phase];
    const belts = (item: string, rate: number) => itemBelts(item, rate, phase);
    for (const group of groups.groups) {
      const flow = groupFlow(
        stage,
        groups,
        group.id,
        belts,
        undefined,
        plan.settings.onSite,
        link =>
          linkItemWords(
            link,
            groups.links,
            FLUIDS,
            (rate, fluid) => lanePlan(rate, fluid, phase),
            belts,
          ),
      )!;
      const check = (key: string, words: string, where: string) => {
        assert.ok(choices.has(key), `${label}: ${key} is on the Logistics page`);
        assert.equal(
          flowChoice(words),
          choices.get(key),
          `${label}, ${group.name}: ${where} ${key}`,
        );
        seen.add(choices.get(key)!);
      };
      for (const port of flow.ins) check(`${port.place}:${group.id}`, port.belts, port.item);
      for (const port of [...flow.outs, ...flow.fold.ports])
        check(`${group.id}:${port.place}`, port.belts, port.item);
      // Each line's part of a port names it the same way.
      for (const line of flow.lines)
        for (const row of [...line.inputs, ...line.outputs])
          for (const link of row.links) {
            if (link.from.kind === 'place')
              check(`${link.from.id}:${group.id}`, link.belts, `${line.name} ← ${row.item}`);
            if (link.to.kind === 'place')
              check(`${group.id}:${link.to.id}`, link.belts, `${line.name} → ${row.item}`);
          }
    }
  }
  // Every kind of transport came up somewhere.
  for (const kind of ['belt', 'extract', 'train', 'truck', 'drone', 'tractor'])
    assert.ok(seen.has(kind), `${kind} among ${[...seen].join(', ')}`);
});

// Opens a factory's flow page, as a deep link does.
async function showFlow(plan: CurrentCalculatedPlan, groups: FactoryGroups, groupId: string) {
  open({
    calculated: structuredClone(plan),
    phase: '3',
    state: { version: 11, factoryGroups: groups },
  });
  location.hash = '#' + flowRoute(groupId);
  go(viewOf(location.hash.slice(1)));
  render();
  await nextTick();
  await nextTick();
}
const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

test('a train link reads "by freight train" on the flow page, and Water "Water Extractors here" (#1067)', async () => {
  const plan = generated();
  const groups = withVehicles(plan, '3');
  const train = Object.entries(groups.links!).find(([, transport]) => transport.mode === 'train')!;
  const [from, to] = train[0].split(':') as [string, string];
  await showFlow(plan, groups, to);
  const rows = $$('.gf-row').map(text);
  assert.ok(
    rows.some(row => row.endsWith('by freight train')),
    `a port into ${to} from ${from}: ${JSON.stringify(rows)}`,
  );
  const water = groupLinks(plan.stages['3'], groups).find(link => link.from === 'supply/Water')!;
  await showFlow(plan, groups, water.to);
  const waterRows = $$('.gf-row').map(text);
  assert.ok(
    waterRows.some(row => /^Water\s?[\d.,]+\s?m³\/min\s?Water Extractors here$/.test(row)),
    JSON.stringify(waterRows),
  );
});

test('a sink or storage link of many small items takes one mixed belt on both pages (#1067)', async () => {
  const plan = generated();
  const groups = defaultFactoryGroups(plan);
  const link = groupLinks(plan.stages['3'], groups).find(
    candidate => candidate.to === 'storage' && candidate.items.length > 3,
  )!;
  assert.ok(link, 'a factory sends several small items to storage');
  open({ calculated: structuredClone(plan), phase: '3', state: { factoryGroups: groups } });
  go('logistics');
  render();
  await nextTick();
  const out = $(`[data-link-out="${link.from}:storage"]`)!;
  // One belt per item type said `${link.items.length} × Mk.4 belts` before.
  assert.equal(text(out.querySelector('[data-link-badge]')!), '1 × Mk.4 mixed belt');
  assert.match(
    text(out.querySelector('[data-link-mixed]')!),
    new RegExp(
      `^The ${link.items.length} items under 120/min share a mixed belt; Smart Splitters sort them where it arrives\\.$`,
    ),
  );
  await showFlow(plan, groups, link.from);
  const fold = $('[data-gf-fold]')!;
  for (const item of link.items)
    assert.ok(
      [...fold.querySelectorAll('.gf-row')]
        .map(text)
        .some(row => row.startsWith(item.item) && row.endsWith('mixed Mk.4 belt')),
      item.item,
    );
});
