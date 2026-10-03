// public/preferences.ts is a facade over public/preferences/ (#777): it only re-exports the
// names its importers use, both editions ship the folder and the Docker image carries its sources.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as preferences from '../public/preferences.ts';

const modules = fs
  .readdirSync(new URL('../public/preferences/', import.meta.url))
  .filter(name => name.endsWith('.ts'));

test('preferences.ts re-exports the names it exported before the split', () => {
  assert.deepEqual(Object.keys(preferences).sort(), [
    'GUIDED_TOPUP_RATE',
    'MINER_BASE',
    'OIL_BASE',
    'WELL_BASE',
    'blankCounts',
    'blankExtraction',
    'clockChoices',
    'constructionItems',
    'distributions',
    'droneFuels',
    'droneSupply',
    'elevatorParts',
    'extractionLimits',
    'guidedQuestions',
    'guidedStandingQuestion',
    'guidedTopupItems',
    'helpText',
    'knownWorld',
    'matchingPreset',
    'minedResources',
    'minerMarks',
    'nodeCounts',
    'nodePresets',
    'nodeYield',
    'oilNodeResources',
    'phaseParts',
    'powerOptions',
    'presetCounts',
    'presetPurities',
    'presetSurvey',
    'purities',
    'purities3',
    'purityFactor',
    'resourceAvailable',
    'resourceDefaults',
    'resourcePool',
    'richShape',
    'startingSurvey',
    'storageOptions',
    'storageRateFor',
    'tutorialKeys',
    'uncountedResources',
    'uniformPurities',
    'vehicleFuels',
    'wantsStorage',
    'wellResources',
    'wellYield',
  ]);
});

test('preferences.ts holds no code of its own, only re-exports', () => {
  const code = fs
    .readFileSync(new URL('../public/preferences.ts', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.startsWith('//'))
    .join('\n');
  const statements = code.split(/;\n?/).filter(statement => statement.trim());
  for (const statement of statements)
    assert.match(statement, /^export \{[\w\s,]+\} from '\.\/preferences\/[\w-]+\.ts'$/);
});

test('the Docker image copies the sources of public/preferences/ next to their built .js', () => {
  const docker = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(
    docker,
    /^COPY --from=build --chown=node:node \/src\/public\/preferences\/\*\.ts \.\/public\/preferences\/\r?$/m,
  );
});

test('both editions ship every module of public/preferences/ (build.ts)', () => {
  const build = fs.readFileSync(new URL('../build.ts', import.meta.url), 'utf8');
  assert.match(build, /const SHARED_DIRS = \[[^\]]*'preferences'[^\]]*\];/);
  for (const name of modules) assert.ok(build.includes(`'preferences/${name}',`), name);
});
