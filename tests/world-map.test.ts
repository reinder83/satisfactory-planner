// World coordinates on the map image (#1283, public/app/world-map.ts): the image's edges are the
// calibrated world bounds, x grows east and y south, and the two conversions undo each other, so
// positions stored in game units land on the same spot of any image calibrated the same way.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  imageToWorld,
  WORLD_MAP,
  worldToImage,
  type WorldMapImage,
} from '../public/app/world-map.ts';

const close = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${what}: ${actual} ≠ ${expected}`);

test('the calibration is the 750,000-unit square of the whole world, north up', () => {
  const { west, east, north, south } = WORLD_MAP.bounds;
  close(east - west, 750_000.664, 'west to east');
  close(south - north, 750_000, 'north to south');
  assert.ok(west < 0 && east > 0 && north < 0 && south > 0, 'the origin is on the map');
  assert.equal(WORLD_MAP.width, WORLD_MAP.height, 'a square image for a square world');
});

test('the image corners are the world bounds', () => {
  const { west, east, north, south } = WORLD_MAP.bounds;
  const topLeft = worldToImage({ x: west, y: north });
  close(topLeft.x, 0, 'north-west x');
  close(topLeft.y, 0, 'north-west y');
  const bottomRight = worldToImage({ x: east, y: south });
  close(bottomRight.x, WORLD_MAP.width, 'south-east x');
  close(bottomRight.y, WORLD_MAP.height, 'south-east y');
  // East is right and south is down.
  const origin = worldToImage({ x: 0, y: 0 });
  assert.ok(worldToImage({ x: 1000, y: 0 }).x > origin.x, 'east is to the right');
  assert.ok(worldToImage({ x: 0, y: 1000 }).y > origin.y, 'south is down');
  // The world's origin: 324,698.832 of 750,000.664 units from the west edge, halfway down.
  close(origin.x, (324_698.832 / 750_000.664) * 1280, 'origin x');
  close(origin.y, 640, 'origin y');
});

test('image to world undoes world to image, inside and outside the image', () => {
  for (const point of [
    { x: 0, y: 0 },
    { x: -250_000, y: 120_000 },
    { x: 400_000, y: -360_000 },
    { x: 900_000, y: 500_000 },
  ]) {
    const back = imageToWorld(worldToImage(point));
    close(back.x, point.x, 'x');
    close(back.y, point.y, 'y');
  }
  const corner = imageToWorld({ x: WORLD_MAP.width, y: 0 });
  close(corner.x, WORLD_MAP.bounds.east, 'north-east x');
  close(corner.y, WORLD_MAP.bounds.north, 'north-east y');
});

test('another image calibrated to the same world puts a world point on the same spot', () => {
  const half: WorldMapImage = { ...WORLD_MAP, width: 640, height: 640 };
  const point = { x: 123_456, y: -98_765 };
  const full = worldToImage(point);
  const small = worldToImage(point, half);
  close(small.x * 2, full.x, 'x scales with the image');
  close(small.y * 2, full.y, 'y scales with the image');
});
