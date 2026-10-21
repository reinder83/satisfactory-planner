// What a build-plan step takes to build (#1073, public/app/build-materials.ts): the buildings
// added up, the parts they cost from the build-cost table, the belts and pipes by their mark only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMaterials,
  buildingName,
  buildMaterials,
  buildWords,
  partsWords,
} from '../public/app/build-materials.ts';

test('a fixed set of buildings costs the parts of the table, the largest amount first', () => {
  const materials = buildMaterials(
    [
      { building: 'Refinery', count: 2 },
      { building: 'Water Extractor', count: 1 },
    ],
    ['Mk.4 belts', 'Mk.2 pipes'],
  );
  assert.deepEqual(materials.parts, [
    ['Copper Sheet', 60],
    ['Steel Pipe', 60],
    ['Encased Industrial Beam', 20],
    ['Motor', 20],
    ['Reinforced Iron Plate', 10],
    ['Rotor', 10],
  ]);
  assert.equal(
    buildWords(materials),
    '2 Refineries + 1 Water Extractor + Mk.4 belts and Mk.2 pipes',
  );
  assert.equal(
    partsWords(materials),
    '60 × Copper Sheet, 60 × Steel Pipe, 20 × Encased Industrial Beam, 20 × Motor, 10 × Reinforced Iron Plate, 10 × Rotor',
  );
  assert.deepEqual(materials.unknown, []);
});

test('the same building twice counts once, and nothing to build is no materials', () => {
  const twice = buildMaterials([
    { building: 'Constructor', count: 3 },
    { building: 'Constructor', count: 2 },
    { building: 'Smelter', count: 0 },
  ]);
  assert.deepEqual(twice.buildings, [{ building: 'Constructor', count: 5 }]);
  assert.equal(partsWords(twice), '40 × Cable, 10 × Reinforced Iron Plate');
  const none = buildMaterials([], ['Mk.1 belts']);
  assert.equal(buildWords(none), '');
  assert.equal(partsWords(none), '');
});

test('a building with no cost is named, never guessed', () => {
  const materials = buildMaterials([{ building: 'Space Elevator', count: 1 }]);
  assert.deepEqual(materials.unknown, ['Space Elevator']);
  assert.deepEqual(materials.parts, []);
  assert.equal(buildWords(materials), '1 Space Elevator');
});

test('several steps add up into one list, each lane once', () => {
  const total = addMaterials([
    buildMaterials([{ building: 'Smelter', count: 4 }], ['Mk.2 belts']),
    buildMaterials([{ building: 'Smelter', count: 1 }], ['Mk.2 belts', 'Mk.1 pipes']),
  ]);
  assert.equal(buildWords(total), '5 Smelters + Mk.2 belts and Mk.1 pipes');
  assert.equal(partsWords(total), '40 × Wire, 25 × Iron Rod');
});

test('building names take their plural as the game words them', () => {
  assert.equal(buildingName('Refinery', 1), 'Refinery');
  assert.equal(buildingName('Refinery', 41), 'Refineries');
  assert.equal(buildingName('Foundry', 2), 'Foundries');
  assert.equal(buildingName('Water Extractor', 35), 'Water Extractors');
  assert.equal(buildingName('Miner Mk.2', 3), 'Miners Mk.2');
  assert.equal(buildingName('Nuclear Power Plant', 2), 'Nuclear Power Plants');
});
