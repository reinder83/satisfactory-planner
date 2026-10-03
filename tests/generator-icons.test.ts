// A calculated generator row shows its building's icon (rowIcon in public/app/views/calculated.ts,
// #350), and a nuclear plant's flow shows its waste item (#375): each is bundled in public/icons/
// with its source attribution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { slug } from '../public/app/format.ts';

const icons = new URL('../public/icons/', import.meta.url);

test('every generator the planner models has a bundled, attributed building icon', () => {
  const planner = fs.readFileSync(new URL('../planner/recipes.ts', import.meta.url), 'utf8');
  // The generator recipes in planner/recipes.ts generators(): the ones with a negative power.
  const machines = [
    ...new Set(
      [...planner.matchAll(/machine: '([^']+)',\s+phase: \d,\s+power: -/g)].map(m => m[1]!),
    ),
  ].sort();
  assert.deepEqual(machines, ['Coal Generator', 'Fuel Generator', 'Nuclear Power Plant']);
  const sources: Record<string, { file: string; url: string; source: string }> = JSON.parse(
    fs.readFileSync(new URL('sources.json', icons), 'utf8'),
  );
  for (const name of [...machines, 'Uranium Waste', 'Plutonium Waste']) {
    const png = fs.readFileSync(new URL(slug(name) + '.png', icons));
    assert.equal(png.subarray(1, 4).toString(), 'PNG', name);
    assert.equal(sources[name]?.file, slug(name) + '.png', name);
    assert.match(sources[name]!.url, /^https:\/\/satisfactory\.wiki\.gg\/images\//, name);
    assert.match(sources[name]!.source, /^https:\/\/satisfactory\.wiki\.gg\/wiki\/File:/, name);
  }
});
