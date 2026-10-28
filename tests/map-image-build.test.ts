// The world map's image (#1283) ships in both editions: build.ts copies public/images/ into the
// Docker edition (dist/web, which the image serves as public/) and, by its allowlist, into the
// Pages edition (dist/satisfactory-planner), the page loads it by a page-relative path that works
// under both editions' roots, and the Docker server sends it with its own content type (every
// response carries nosniff). Built into a temporary folder (PLANNER_DIST), so it never races the
// other tests that build into dist/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contentTypes } from '../server.ts';
import { WORLD_MAP } from '../public/app/world-map.ts';

const IMAGE = 'images/satisfactory-map.webp';

test('both editions carry the map image, as the page asks for it', t => {
  const dist = mkdtempSync(path.join(os.tmpdir(), 'planner-map-build-'));
  t.after(() => rmSync(dist, { recursive: true, force: true }));
  const build = spawnSync(process.execPath, ['build.ts'], {
    encoding: 'utf8',
    env: { ...process.env, PLANNER_DIST: dist },
  });
  assert.equal(build.status, 0, build.stderr);
  const source = readFileSync(path.join('public', IMAGE));
  assert.equal(WORLD_MAP.src, './' + IMAGE, 'a page-relative path to the shipped file');
  for (const edition of ['web', 'satisfactory-planner']) {
    const shipped = readFileSync(path.join(dist, edition, IMAGE));
    assert.ok(shipped.equals(source), `${edition} has the image unchanged`);
    const app = readFileSync(path.join(dist, edition, 'app.js'), 'utf8');
    assert.ok(app.includes(WORLD_MAP.src), `${edition}'s app.js asks for ${WORLD_MAP.src}`);
  }
});

test('the image is a WebP of the size the calibration is for, served as image/webp', () => {
  const image = readFileSync(path.join('public', IMAGE));
  assert.equal(image.subarray(0, 4).toString('latin1'), 'RIFF');
  assert.equal(image.subarray(8, 12).toString('latin1'), 'WEBP');
  // A VP8X header: the canvas width and height less one, 24-bit little-endian, at bytes 24 and 27.
  assert.equal(image.subarray(12, 16).toString('latin1'), 'VP8X');
  assert.equal(image.readUIntLE(24, 3) + 1, WORLD_MAP.width);
  assert.equal(image.readUIntLE(27, 3) + 1, WORLD_MAP.height);
  assert.equal(contentTypes['.webp'], 'image/webp');
});
