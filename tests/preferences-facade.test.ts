// public/preferences.ts is a facade over public/preferences/ (#777): it only re-exports the
// names its importers use, both editions ship the folder and the Docker image carries its sources.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as preferences from '../public/preferences.ts';

const modules = fs
  .readdirSync(new URL('../public/preferences/', import.meta.url))
  .filter(name => name.endsWith('.ts'));

// rawResources was added after the split, as the raw-resource list the planner and the interface
// share (#921), the Water Extractor figures and counts for the byproduct advice (#1024), and the
// extraction power the plan's power model charges (#1064), and the mining and belts per phase
// (#1065), with the belt you already have (phaseBelt, #1068), and the generators you already have
// (OWNED_GENERATORS, ownedGeneratorCounts, #1068).
test('preferences.ts re-exports the names it exported before the split', () => {
  assert.deepEqual(Object.keys(preferences).sort(), [
    'BELT_MARKS',
    'DEFAULT_EXTRACTION',
    'EXTRACTOR_CLOCK_DECIMALS',
    'EXTRACTOR_MIN_RATE',
    'EXTRACTOR_OPTIONS',
    'EXTRACTOR_RATE_STEP',
    'EXTRACTOR_TIERS',
    'GUIDED_TOPUP_RATE',
    'MINER_BASE',
    'MINER_MARKS',
    'MINER_MW',
    'OIL_BASE',
    'OIL_EXTRACTOR_MW',
    'OVERCLOCK',
    'OWNED_GENERATORS',
    'OWNED_GENERATORS_MAX',
    'PHASE_CLOCK',
    'PIPE_MARKS',
    'PRESSURIZER_MW',
    'WATER_EXTRACTOR',
    'WELL_BASE',
    'WELL_SATELLITES',
    'bestMark',
    'blankCounts',
    'blankExtraction',
    'clockChoices',
    'constructionItems',
    'distributions',
    'droneFuels',
    'droneSupply',
    'elevatorParts',
    'extractionLimits',
    'extractionMWPerUnit',
    'extractorBuilt',
    'extractorClocks',
    'extractorMW',
    'extractorOption',
    'extractorShards',
    'guidedBudgetsQuestion',
    'guidedHaveQuestion',
    'guidedQuestions',
    'guidedStandingQuestion',
    'guidedTopupFrom',
    'guidedTopupItems',
    'helpText',
    'isWellKind',
    'knownWorld',
    'matchingPreset',
    'minedResources',
    'minerMarks',
    'miningAdvice',
    'miningLinearMW',
    'miningMW',
    'nodeCounts',
    'nodePresets',
    'nodeYield',
    'oilNodeResources',
    'ownedGeneratorCounts',
    'phaseBelt',
    'phaseClock',
    'phaseForTier',
    'phaseMiner',
    'phaseMining',
    'phaseParts',
    'powerOptions',
    'presetCounts',
    'presetPurities',
    'presetSurvey',
    'purities',
    'purities3',
    'purityFactor',
    'rawResources',
    'resourceAvailable',
    'resourceDefaults',
    'resourcePool',
    'richShape',
    'settableRate',
    'sourceClock',
    'sourceMWPerUnit',
    'sourceYield',
    'startingSurvey',
    'storageOptions',
    'storageRateFor',
    'turbofuelRecipes',
    'tutorialKeys',
    'uncountedResources',
    'uniformPurities',
    'vehicleFuels',
    'wantsStorage',
    'waterClock',
    'waterExtractors',
    'waterMWPerUnit',
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
