// The blue side bar on a flow page's input row (#908, ui/group-flow/FlowCard.vue): it means "fed
// from outside the group", so a row fed only by its own line (a self link, #898) has none, a row
// fed only from outside keeps it and a row fed by another line of the group has none. Mounted the
// way group-flow-page.test.ts mounts the page, on the default Phase 3 plan and factory groups.
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { beforeEach, test, vi } from 'vitest';
import * as model from '../../public/app/group-flow.ts';
import type { FlowLink, FlowRow, GroupFlow } from '../../public/app/group-flow.ts';
import { flowRoute, setQuery, viewOf } from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { isLaneLink } from '../../public/app/views/group-flow-page.ts';
import { defaultFactoryGroups } from '../../public/state/factory-groups.ts';
import { $$, generated, go, open, page } from './setup.ts';
import type { FactoryGroups } from '../../public/types/index.ts';

// The default plans have no self link, so while `self` is set the first input of the open
// group's first line gets one: 'only' makes it the row's only link, 'also' adds it beside the
// row's own links.
const hooks = vi.hoisted(() => ({ self: null as null | 'only' | 'also' }));
vi.mock('../../public/app/group-flow.ts', async original => {
  const actual = await original<typeof import('../../public/app/group-flow.ts')>();
  return {
    ...actual,
    groupFlow: (...args: Parameters<typeof actual.groupFlow>) => {
      const flow = actual.groupFlow(...args);
      if (!hooks.self || !flow?.lines[0]) return flow;
      const line = flow.lines[0];
      const input = line.inputs[0]!;
      const self: FlowLink & { self: boolean } = {
        item: input.item,
        rate: 1,
        belts: '1 × Mk.1 belt',
        from: { kind: 'line', id: line.id },
        to: { kind: 'line', id: line.id },
        loop: false,
        self: true,
      };
      if (hooks.self === 'only') input.links = [self];
      else input.links.push(self);
      return flow;
    },
  };
});

const plan = generated();
const groups: FactoryGroups = defaultFactoryGroups(plan);
const GROUP = 'fg-iron01';

async function show() {
  open({ calculated: structuredClone(plan), phase: '3', state: { factoryGroups: groups } });
  location.hash = '#' + flowRoute(GROUP);
  go(viewOf(location.hash.slice(1)));
  render();
  await nextTick();
  await nextTick();
}
const flow = (): GroupFlow => model.groupFlow(plan.stages['3'], groups, GROUP, () => '')!;
const inputs = (): FlowRow[] => flow().lines.flatMap(line => line.inputs);
const rowEl = (row: FlowRow) => $$('.gf-in').find(el => el.getAttribute('data-row') === row.id)!;

beforeEach(() => {
  page();
  setQuery('');
  hooks.self = null;
});

test('an input row fed only by its own line has no outside bar (#908)', async () => {
  hooks.self = 'only';
  await show();
  const row = $$('.gf-card')[0]!.querySelector('.gf-in')!;
  assert.match(row.textContent!, /from itself/);
  assert.ok(!row.classList.contains('outside'), 'a self link is not a feed from outside');
});

test('an input row fed only from outside the group keeps its outside bar', async () => {
  await show();
  const outside = inputs().filter(
    row => row.links.length && row.links.every(link => link.from.kind === 'place'),
  );
  assert.ok(outside.length, 'the default group has a row fed only from outside');
  for (const row of outside) assert.ok(rowEl(row).classList.contains('outside'), row.id);
});

test('an input row fed by another line of the group has no outside bar', async () => {
  await show();
  const inside = inputs().filter(row => row.links.some(isLaneLink));
  assert.ok(inside.length, 'the default group has a row fed by another line');
  for (const row of inside) assert.ok(!rowEl(row).classList.contains('outside'), row.id);
});

test('a row fed from outside and by itself keeps the bar: no other line feeds it', async () => {
  const first = flow().lines[0]!.inputs[0]!;
  assert.ok(
    first.links.some(link => link.from.kind === 'place') && !first.links.some(isLaneLink),
    'the first line’s first input is fed only from outside',
  );
  hooks.self = 'also';
  await show();
  const row = $$('.gf-card')[0]!.querySelector('.gf-in')!;
  assert.ok(row.classList.contains('outside'));
});
