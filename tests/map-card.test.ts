// The facts on a factory's card on the world map (MAP-3, #1348: public/app/map-factory-card.ts) and
// the side the marker dialog docks at (MAP-4, markerDock in public/app/map-markers.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  factoryFacts,
  needsText,
  powerText,
  type FactoryRow,
} from '../public/app/map-factory-card.ts';
import { markerDock, setMarkerAnchor, takeMarkerAnchor } from '../public/app/map-markers.ts';
import type { FactoryGroups } from '../public/types/index.ts';

const GROUPS: FactoryGroups = {
  groups: [
    { id: 'fg-a', name: 'Iron works' },
    { id: 'fg-b', name: 'Plastics' },
  ],
  assignments: {
    r1: [{ group: 'fg-a', rate: null }],
    r2: [{ group: 'fg-a', rate: null }],
    r3: [{ group: 'fg-b', rate: null }],
  },
};
const row = (id: string, power: number, peakMW: number): FactoryRow => ({
  id,
  outputs: { Thing: 10 },
  generationMW: 0,
  power,
  peakMW,
});
const ROWS = [row('r1', 4, 40), row('r2', 4, 60), row('r3', 30, 300)];
const options = (patch: Partial<Parameters<typeof factoryFacts>[3]> = {}) => ({
  isRunning: () => false,
  count: { built: 0, needed: 10 },
  heldBack: false,
  links: [],
  ...patch,
});

test('a factory card counts its lines, machines and power from its own lines only', () => {
  const facts = factoryFacts(ROWS, GROUPS, 'fg-a', options({ isRunning: r => r.id === 'r1' }));
  assert.equal(facts.lines, 2);
  assert.equal(facts.running, 1);
  assert.equal(facts.powerMW, 100, 'r1 and r2, not r3');
  assert.equal(facts.machines, 10);
  assert.equal(facts.built, 0);
  assert.equal(powerText(facts.powerMW), '100 MW');
  assert.equal(powerText(0), '0 MW');
});

test('the status: held back, running, built, building, not started', () => {
  const status = (patch: Partial<Parameters<typeof factoryFacts>[3]>) =>
    factoryFacts(ROWS, GROUPS, 'fg-a', options(patch)).status;
  assert.equal(status({}), 'not-started');
  assert.equal(status({ count: { built: 3, needed: 10 } }), 'building');
  assert.equal(status({ count: { built: 10, needed: 10 } }), 'built');
  assert.equal(status({ isRunning: () => true, count: { built: 10, needed: 10 } }), 'running');
  assert.equal(status({ heldBack: true, isRunning: () => true }), 'held-back', 'held back wins');
});

test('what a factory needs is what other factories send it, not mines or the sink', () => {
  const links = [
    {
      from: 'fg-b',
      to: 'fg-a',
      items: [
        { item: 'Plastic', rate: 30 },
        { item: 'Rubber', rate: 5 },
      ],
    },
    { from: 'supply/Iron Ore', to: 'fg-a', items: [{ item: 'Iron Ore', rate: 240 }] },
    { from: 'fg-a', to: 'fg-b', items: [{ item: 'Iron Plate', rate: 60 }] },
  ];
  const facts = factoryFacts(ROWS, GROUPS, 'fg-a', options({ links }));
  assert.deepEqual(facts.needs, [{ from: 'Plastics', items: ['Plastic', 'Rubber'] }]);
  assert.equal(needsText(facts.needs), 'Needs Plastic, Rubber from Plastics.');
  assert.equal(
    needsText(factoryFacts(ROWS, GROUPS, 'fg-b', options({ links: [] })).needs),
    'Needs nothing from other factories.',
  );
});

test('markerDock puts the dialog away from the spot: sides on a wide window, sheets on a phone', () => {
  const wide = { width: 1440, height: 900 };
  assert.equal(markerDock({ x: 300, y: 400 }, wide), 'right');
  assert.equal(markerDock({ x: 1100, y: 400 }, wide), 'left');
  assert.equal(markerDock(null, wide), 'right', 'no point: the right side');
  const phone = { width: 390, height: 800 };
  assert.equal(markerDock({ x: 200, y: 200 }, phone), 'bottom');
  assert.equal(markerDock({ x: 200, y: 600 }, phone), 'top');
  assert.equal(markerDock({ x: 200, y: 200 }, { width: 720, height: 800 }), 'bottom');
  assert.equal(markerDock({ x: 200, y: 200 }, { width: 721, height: 800 }), 'right');
});

test('the anchor of the marker dialog is taken once', () => {
  setMarkerAnchor({ x: 5, y: 6 });
  assert.deepEqual(takeMarkerAnchor(), { x: 5, y: 6 });
  assert.equal(takeMarkerAnchor(), null);
});
